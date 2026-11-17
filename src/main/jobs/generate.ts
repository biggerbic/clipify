import { join } from 'node:path'
import type { Project, QueueItem, Recipe, TwitchClip, Variant } from '@shared/types'
import { ctx } from '../context'
import { os, fileName } from '../openshorts/client'
import { claudeHooks } from '../claude/descriptions'
import { createProjectRecord, getProject, listProjects, projectDir, updateProject } from '../store/projects'
import { getSettings } from '../store/settings'
import { engine } from '../engine/service'

const queue: QueueItem[] = []
let running = 0

function publishQueue(): void {
  ctx.emit({ type: 'queue', items: [...queue] })
}
export function queueItems(): QueueItem[] {
  return [...queue]
}

async function concurrency(): Promise<number> {
  const s = await engine.getStatus()
  return s.profile === 'win-nvidia' ? 2 : 1
}

async function pump(): Promise<void> {
  const limit = await concurrency()
  while (running < limit) {
    const next = queue.find((q) => q.state === 'queued')
    if (!next) return
    next.state = 'running'
    running++
    publishQueue()
    generate(next.projectId)
      .then(() => (next.state = 'done'))
      .catch((err: Error) => {
        next.state = 'failed'
        next.progress = err.message
        ctx.notice('error', `Generation failed for “${next.title}”: ${err.message}`)
      })
      .finally(() => {
        running--
        publishQueue()
        // finished items leave the drawer after a minute
        setTimeout(() => {
          const i = queue.indexOf(next)
          if (i >= 0 && next.state !== 'running' && next.state !== 'queued') queue.splice(i, 1)
          publishQueue()
        }, 60_000)
        void pump()
      })
  }
}

function enqueue(p: Project): void {
  if (queue.some((q) => q.projectId === p.id && (q.state === 'queued' || q.state === 'running'))) return
  queue.push({ projectId: p.id, title: p.clip.title, state: 'queued' })
  publishQueue()
  void pump()
}

function progress(projectId: string, text: string): void {
  const item = queue.find((q) => q.projectId === projectId && q.state === 'running')
  if (item) {
    item.progress = text
    publishQueue()
  }
}

export async function createProject(clip: TwitchClip, variantCount: number, recipeIds: string[]): Promise<Project> {
  const settings = await getSettings()
  const byId = new Map(settings.recipes.map((r) => [r.id, r]))
  const chosen: Recipe[] = recipeIds.map((id) => byId.get(id)).filter((r): r is Recipe => Boolean(r))
  for (const r of settings.recipes) if (chosen.length < variantCount && !chosen.includes(r)) chosen.push(r)
  const record = await createProjectRecord(clip)
  const p = await updateProject(record.id, (proj) => {
    proj.variants = chosen.slice(0, Math.max(1, Math.min(5, variantCount))).map(
      (r, i): Variant => ({
        id: `v${i + 1}`,
        index: i + 1,
        recipeId: r.id,
        recipeName: r.name,
        hookText: '',
        captions: r.captions,
        hook: r.hook,
        status: 'pending',
        revisions: [],
        posts: []
      })
    )
  })
  enqueue(p)
  return p
}

export async function retryProject(id: string): Promise<void> {
  const p = await updateProject(id, (proj) => {
    proj.status = 'generating'
    proj.engine = {}
    for (const v of proj.variants) {
      v.status = 'pending'
      v.error = undefined
      v.revisions = []
      v.current = undefined
      v.engineFile = undefined
    }
  })
  enqueue(p)
}

/** Projects left 'generating' by a quit or crash: offer a retry instead of a forever spinner. */
export async function recoverInterrupted(): Promise<void> {
  for (const p of await listProjects()) {
    if (p.status === 'generating') {
      await updateProject(p.id, (proj) => {
        proj.status = 'failed'
        proj.engine.error = 'Generation was interrupted when Clipify closed. Click Retry.'
      })
    }
  }
}

/** OpenShorts' log lines → one plain-language phase for the queue drawer. */
const PHASES: [RegExp, string][] = [
  [/clip \d+ ready|clip saved|process finished/i, 'Finishing the base video'],
  [/reframe|framed|layout|speaker/i, 'Reframing to vertical'],
  [/scene/i, 'Finding scenes'],
  [/score|detail|moment|gemini|llm/i, 'Choosing the moment'],
  [/transcri|whisper|parakeet/i, 'Transcribing speech'],
  [/download|yt-dlp|fetching|probe/i, 'Downloading the clip'],
  [/queued/i, 'Waiting for the engine']
]
export function phase(logs: unknown[]): string {
  for (const line of [...logs].reverse().slice(0, 30)) {
    if (typeof line !== 'string') continue
    for (const [re, label] of PHASES) if (re.test(line)) return label
  }
  return 'Starting'
}

const relFile = (variant: Variant, rev: number): string => join('variants', variant.id, `${variant.id}_r${rev}.mp4`)

/** Burn this variant's captions and hook onto the clean base; returns the engine file of the result. */
export async function renderOverlays(p: Project, v: Variant, baseFile: string): Promise<string> {
  const jobId = p.engine.jobId!
  let input = baseFile
  if (v.captions) input = fileName((await os.subtitle(jobId, input, v.captions, v.captionWords)).new_video_url)
  if (v.hook && v.hookText.trim()) input = fileName((await os.hook(jobId, input, v.hookText, v.hook)).new_video_url)
  return input
}

/**
 * Render overlays for one variant and store the result as its next revision.
 * `patch` (new caption/hook settings) is only saved once the render succeeded.
 */
export async function addRevision(
  projectId: string,
  variantId: string,
  op: Variant['revisions'][number]['op'],
  patch: Partial<Pick<Variant, 'captions' | 'hook' | 'hookText' | 'captionWords'>> = {},
  params?: unknown
): Promise<Project> {
  const p = await getProject(projectId)
  const found = p.variants.find((x) => x.id === variantId)
  if (!found || !p.engine.jobId || !p.engine.baseFile) throw new Error('This variant has no rendered base yet.')
  const v: Variant = { ...found, ...patch }
  const engineFile = await renderOverlays(p, v, p.engine.baseFile)
  const rev = v.revisions.length + 1
  const rel = relFile(v, rev)
  await os.download(`/videos/${p.engine.jobId}/${encodeURIComponent(engineFile)}`, join(await projectDir(p.id), rel))
  return updateProject(projectId, (proj) => {
    const pv = proj.variants.find((x) => x.id === variantId)!
    pv.captions = v.captions
    pv.hook = v.hook
    pv.hookText = v.hookText
    pv.captionWords = v.captionWords
    pv.engineFile = engineFile
    pv.revisions.push({ id: `r${rev}`, file: rel, op, params, createdAt: new Date().toISOString() })
    pv.current = `r${rev}`
    pv.status = 'ready'
    pv.error = undefined
  })
}

async function generate(id: string): Promise<void> {
  const p0 = await getProject(id)
  try {
    progress(id, 'Sending clip to the engine')
    const { job_id } = await os.process(p0.clip.url, p0.clip.duration)
    await updateProject(id, async (p) => {
      p.engine = { jobId: job_id, profile: (await engine.getStatus()).profile, commit: engine.manifest().openshorts.commit }
    })

    let status = await os.status(job_id)
    while (!['completed', 'failed'].includes(status.status)) {
      progress(id, phase(status.logs ?? []))
      await new Promise((r) => setTimeout(r, 2500))
      status = await os.status(job_id)
    }
    const clip = status.result?.clips?.[0]
    if (status.status !== 'completed' || !clip) {
      const tail = (status.logs ?? []).slice(-4).join(' · ')
      throw new Error(`The engine could not make a short from this clip. ${tail}`.slice(0, 400))
    }

    progress(id, 'Saving base render')
    const baseFile = fileName(clip.video_url)
    await os.download(clip.video_url, join(await projectDir(id), 'base', 'base.mp4'))
    const transcript = await os
      .transcript(job_id)
      .then((t) => t.captions.map((w) => w.text).join(' '))
      .catch(() => '')
    let p = await updateProject(id, (proj) => {
      proj.engine.baseFile = baseFile
      proj.meta = {
        title: clip.video_title_for_youtube_short,
        hook: clip.viral_hook_text,
        tiktok: clip.video_description_for_tiktok,
        instagram: clip.video_description_for_instagram,
        transcript
      }
    })

    progress(id, 'Writing hooks')
    const fallback = clip.viral_hook_text || p.clip.title
    const hooks = await claudeHooks(p, p.variants.length).catch(() => null)
    p = await updateProject(id, (proj) => {
      proj.variants.forEach((v, i) => (v.hookText = v.hookText || hooks?.[i] || fallback))
    })

    for (const v of p.variants) {
      progress(id, `Rendering variant ${v.index} of ${p.variants.length} (${v.recipeName})`)
      await updateProject(id, (proj) => void (proj.variants.find((x) => x.id === v.id)!.status = 'rendering'))
      try {
        await addRevision(id, v.id, 'generate')
      } catch (err) {
        await updateProject(id, (proj) => {
          const pv = proj.variants.find((x) => x.id === v.id)!
          pv.status = 'failed'
          pv.error = (err as Error).message
        })
      }
    }
    await updateProject(id, (proj) => {
      proj.status = proj.variants.some((v) => v.status === 'ready') ? 'review' : 'failed'
      if (proj.status === 'failed') proj.engine.error = 'No variant could be rendered.'
    })
    ctx.notice('success', `“${p.clip.title}” is ready to review.`)
  } catch (err) {
    await updateProject(id, (proj) => {
      proj.status = 'failed'
      proj.engine.error = (err as Error).message
    })
    throw err
  }
}
