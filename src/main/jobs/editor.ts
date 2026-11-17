import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Edl, Scene } from '@shared/api'
import type { CaptionStyle, HookStyle, Project } from '@shared/types'
import { os, fileName, type OsCaptionWord } from '../openshorts/client'
import { getProject, projectDir, updateProject } from '../store/projects'
import { addRevision } from './generate'
import { run } from '../util/run'
import { ffmpegBinaries } from '../engine/service'

// One edit at a time per project: trim/frame re-render the shared base and then every variant.
const editLocks = new Map<string, Promise<unknown>>()
function serial<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const next = (editLocks.get(projectId) ?? Promise.resolve()).then(fn, fn)
  editLocks.set(
    projectId,
    next.catch(() => undefined)
  )
  return next
}

function variantOf(p: Project, variantId: string): Project['variants'][number] {
  const v = p.variants.find((x) => x.id === variantId)
  if (!v) throw new Error('Variant not found')
  return v
}

export async function edl(projectId: string): Promise<Edl> {
  const p = await getProject(projectId)
  if (!p.engine.jobId) throw new Error('Not generated yet')
  const e = await os.edl(p.engine.jobId)
  return { segments: e.segments, words: e.words, duration: e.duration, sourceDuration: e.source.duration, limits: e.limits }
}

export async function captionWords(projectId: string, variantId: string): Promise<OsCaptionWord[]> {
  const p = await getProject(projectId)
  const v = variantOf(p, variantId)
  if (v.captionWords?.length) return v.captionWords
  if (!p.engine.jobId) return []
  return (await os.transcript(p.engine.jobId)).captions
}

/** Replace the shared base (new cut or framing), then re-burn every variant's overlays onto it. */
async function rebase(projectId: string, newEngineUrl: string, op: 'trim' | 'frame', params: unknown): Promise<Project> {
  const p = await getProject(projectId)
  const n = (p.variants[0]?.revisions.length ?? 0) + 1
  await os.download(newEngineUrl, join(await projectDir(projectId), 'base', `base_${op}_${n}.mp4`))
  await updateProject(projectId, (proj) => {
    proj.engine.baseFile = fileName(newEngineUrl)
    // caption word edits are clip-relative: a new cut invalidates their timing
    if (op === 'trim') for (const v of proj.variants) v.captionWords = undefined
  })
  let last = await getProject(projectId)
  for (const v of last.variants) {
    if (v.status === 'failed' && !v.revisions.length) continue
    last = await addRevision(projectId, v.id, op, {}, params)
  }
  return last
}

export function trim(projectId: string, segments: { start: number; end: number }[]): Promise<Project> {
  return serial(projectId, async () => {
    const p = await getProject(projectId)
    const res = await os.rerender(p.engine.jobId!, segments)
    return rebase(projectId, res.new_video_url, 'trim', { segments })
  })
}

export async function scenes(projectId: string): Promise<Scene[]> {
  const p = await getProject(projectId)
  const dir = join(await projectDir(projectId), 'thumbs')
  const res = await os.scenes(p.engine.jobId!)
  const out: Scene[] = []
  for (const s of res.scenes) {
    let thumbnail: string | undefined
    if (s.thumbnail_url) {
      thumbnail = join('thumbs', `scene_${s.index}.jpg`)
      await os.download(s.thumbnail_url, join(dir, `scene_${s.index}.jpg`)).catch(() => (thumbnail = undefined))
    }
    out.push({ index: s.index, start: s.start, end: s.end, thumbnail, crop: s.suggested_center })
  }
  return out
}

export function reframe(projectId: string, overrides: Record<string, number | { top: number; bottom: number }>): Promise<Project> {
  return serial(projectId, async () => {
    const p = await getProject(projectId)
    const res = await os.reframe(p.engine.jobId!, overrides)
    return rebase(projectId, res.new_video_url, 'frame', { overrides })
  })
}

export function setCaptions(projectId: string, variantId: string, style: CaptionStyle | null, words?: OsCaptionWord[]): Promise<Project> {
  return serial(projectId, () => addRevision(projectId, variantId, 'captions', { captions: style, captionWords: words }, { style }))
}

export function setHook(projectId: string, variantId: string, text: string, style: HookStyle | null): Promise<Project> {
  return serial(projectId, () => addRevision(projectId, variantId, 'hook', { hookText: text, hook: style }, { text, style }))
}

export function setRevision(projectId: string, variantId: string, revisionId: string): Promise<Project> {
  return updateProject(projectId, (p) => {
    const v = variantOf(p, variantId)
    if (!v.revisions.some((r) => r.id === revisionId)) throw new Error('Revision not found')
    v.current = revisionId
  })
}

export async function currentFile(projectId: string, variantId: string): Promise<string> {
  const p = await getProject(projectId)
  const v = variantOf(p, variantId)
  const rev = v.revisions.find((r) => r.id === v.current) ?? v.revisions[v.revisions.length - 1]
  if (!rev) throw new Error('This variant has no video yet.')
  return join(await projectDir(projectId), rev.file)
}

/** Thumbnail strip + audio peaks for the timeline, cached next to the revision. */
export async function timelineStrip(projectId: string, variantId: string): Promise<{ thumbs: string[]; peaks: number[] }> {
  const p = await getProject(projectId)
  const v = variantOf(p, variantId)
  const rev = v.revisions.find((r) => r.id === v.current) ?? v.revisions[v.revisions.length - 1]
  if (!rev) return { thumbs: [], peaks: [] }
  const dir = await projectDir(projectId)
  const cacheRel = join('thumbs', `${v.id}_${rev.id}`)
  const cacheDir = join(dir, cacheRel)
  const peaksFile = join(cacheDir, 'peaks.json')
  const count = 12
  // ffmpeg may produce one frame fewer than asked near the end of a clip: list what actually exists
  const listThumbs = async (): Promise<string[]> => (await readdir(cacheDir)).filter((f) => /^t\d+\.jpg$/.test(f)).sort().map((f) => join(cacheRel, f))
  if (existsSync(peaksFile)) return { thumbs: await listThumbs(), peaks: JSON.parse(await readFile(peaksFile, 'utf8')) as number[] }

  await mkdir(cacheDir, { recursive: true })
  const { ffmpeg } = ffmpegBinaries()
  const input = join(dir, rev.file)
  const duration = Math.max(1, (p.clip.duration || 30) * 1.0)
  await run(ffmpeg, ['-v', 'error', '-y', '-i', input, '-vf', `fps=${count / duration},scale=-2:160`, '-frames:v', String(count), join(cacheDir, 't%02d.jpg')])
  const pcm = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const child = spawn(ffmpeg, ['-v', 'error', '-i', input, '-ac', '1', '-ar', '2000', '-f', 's16le', '-'], { windowsHide: true })
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.on('error', reject)
    child.on('close', () => resolve(Buffer.concat(chunks)))
  })
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
  const buckets = 240
  const size = Math.max(1, Math.floor(samples.length / buckets))
  const peaks: number[] = []
  for (let b = 0; b < buckets; b++) {
    let max = 0
    for (let i = b * size; i < Math.min(samples.length, (b + 1) * size); i++) max = Math.max(max, Math.abs(samples[i]))
    peaks.push(Math.round((max / 32768) * 100) / 100)
  }
  await writeFile(peaksFile, JSON.stringify(peaks))
  return { thumbs: await listThumbs(), peaks }
}
