import { randomBytes } from 'node:crypto'
import { Notification, powerSaveBlocker } from 'electron'
import type { PublishTarget } from '@shared/api'
import type { Post, Project } from '@shared/types'
import { ctx } from '../context'
import { getProject, listProjects, updateProject } from '../store/projects'
import { getSettings } from '../store/settings'
import { currentFile } from '../jobs/editor'
import { generateDescriptions, renderCredit } from '../claude/descriptions'
import { getSaved } from '../store/saved'
import { instagramAccount, listAccounts, youtubeAccess } from './accounts'
import * as yt from './youtube/provider'
import * as ig from './instagram/provider'

/** Project status follows its posts. */
export function deriveStatus(p: Project): Project['status'] {
  if (p.status === 'generating') return 'generating'
  if (!p.variants.some((v) => v.status === 'ready')) return 'failed'
  const posts = p.variants.flatMap((v) => v.posts)
  if (posts.some((x) => x.status === 'published' || x.status === 'manual')) return 'published'
  if (posts.some((x) => x.status === 'scheduled' || x.status === 'queued' || x.status === 'uploading')) return 'scheduled'
  if (p.variants.some((v) => v.descriptions)) return 'ready'
  return 'review'
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show()
}

export async function creditFor(p: Project): Promise<string> {
  const saved = await getSaved()
  const template = saved.creditOverrides[p.clip.broadcasterId] ?? (await getSettings()).creditTemplate
  return renderCredit(template, p)
}

async function patchPost(projectId: string, variantId: string, postId: string, patch: Partial<Post>): Promise<Project> {
  return updateProject(projectId, (p) => {
    const post = p.variants.find((v) => v.id === variantId)?.posts.find((x) => x.id === postId)
    if (post) Object.assign(post, patch)
    p.status = deriveStatus(p)
  })
}

/** Upload one post now (YouTube scheduled posts are uploaded now and published by YouTube at their time). */
async function send(projectId: string, variantId: string, postId: string): Promise<void> {
  let p = await getProject(projectId)
  const v = p.variants.find((x) => x.id === variantId)!
  const post = v.posts.find((x) => x.id === postId)!
  if (!v.descriptions) {
    const d = await generateDescriptions(p, v, await creditFor(p))
    p = await updateProject(projectId, (proj) => void (proj.variants.find((x) => x.id === variantId)!.descriptions = d))
  }
  const d = p.variants.find((x) => x.id === variantId)!.descriptions!
  const file = await currentFile(projectId, variantId)
  await patchPost(projectId, variantId, postId, { status: 'uploading', error: undefined })
  try {
    if (post.platform === 'youtube') {
      const token = await youtubeAccess(post.accountId)
      const scheduled = post.mode === 'scheduled' && post.scheduledAt && new Date(post.scheduledAt).getTime() > Date.now() + 60_000
      const res = await yt.upload(token, file, {
        title: d.youtube.title,
        description: d.youtube.description,
        tags: d.youtube.tags,
        publishAt: scheduled ? post.scheduledAt : undefined
      })
      await patchPost(projectId, variantId, postId, {
        status: scheduled ? 'scheduled' : 'published',
        remoteId: res.id,
        url: res.url,
        publishedAt: scheduled ? post.scheduledAt : new Date().toISOString()
      })
    } else if (post.platform === 'instagram') {
      const acc = await instagramAccount(post.accountId)
      const quota = await ig.publishingQuota(acc).catch(() => null)
      if (quota && quota.used >= quota.total) throw new Error(`Instagram's daily limit of ${quota.total} posts is reached for this account. Try again tomorrow.`)
      const res = await ig.publishReel(acc, file, d.instagram.caption)
      await patchPost(projectId, variantId, postId, { status: 'published', remoteId: res.id, url: res.url, publishedAt: new Date().toISOString() })
    }
    const name = (await listAccounts()).find((a) => a.id === post.accountId)?.name ?? post.platform
    ctx.notice('success', `Posted to ${name}.`)
  } catch (err) {
    await patchPost(projectId, variantId, postId, { status: 'failed', error: (err as Error).message })
    notify('Clipify: post failed', (err as Error).message)
    ctx.notice('error', (err as Error).message)
  }
}

export async function publish(projectId: string, variantId: string, targets: PublishTarget[]): Promise<Project> {
  const created: Post[] = targets.map((t) => ({
    id: randomBytes(6).toString('hex'),
    accountId: t.accountId,
    platform: t.platform,
    mode: t.mode,
    scheduledAt: t.mode === 'scheduled' ? t.scheduledAt : undefined,
    status: t.mode === 'scheduled' && t.platform === 'instagram' ? 'scheduled' : 'queued'
  }))
  const p = await updateProject(projectId, (proj) => {
    proj.variants.find((v) => v.id === variantId)!.posts.push(...created)
    proj.status = deriveStatus(proj)
  })
  // Sequential so one account's error message never interleaves with another's.
  void (async () => {
    for (const post of created) if (post.status === 'queued') await send(projectId, variantId, post.id)
  })()
  return p
}

export function markPosted(projectId: string, variantId: string, accountId: string, url?: string): Promise<Project> {
  return updateProject(projectId, async (p) => {
    const acc = (await listAccounts()).find((a) => a.id === accountId)
    p.variants
      .find((v) => v.id === variantId)!
      .posts.push({
        id: randomBytes(6).toString('hex'),
        accountId,
        platform: acc?.platform ?? 'tiktok',
        mode: 'manual',
        status: 'manual',
        url: url?.trim() || undefined,
        publishedAt: new Date().toISOString()
      })
    p.status = deriveStatus(p)
  })
}

export async function retryPost(projectId: string, variantId: string, postId: string): Promise<Project> {
  const p = await patchPost(projectId, variantId, postId, { status: 'queued', error: undefined, mode: 'now', scheduledAt: undefined })
  void send(projectId, variantId, postId)
  return p
}

export function cancelPost(projectId: string, variantId: string, postId: string): Promise<Project> {
  return updateProject(projectId, (p) => {
    const v = p.variants.find((x) => x.id === variantId)!
    const post = v.posts.find((x) => x.id === postId)
    if (post && ['scheduled', 'failed', 'missed', 'queued'].includes(post.status) && !(post.platform === 'youtube' && post.remoteId)) {
      v.posts = v.posts.filter((x) => x.id !== postId)
    } else if (post?.remoteId) {
      throw new Error('This post is already on YouTube. Delete or reschedule it in YouTube Studio.')
    }
    p.status = deriveStatus(p)
  })
}

// ---------------- scheduler ----------------
const MISSED_AFTER_MS = 15 * 60_000
let blocker: number | null = null
let started = false

async function tick(appStart: boolean): Promise<void> {
  const now = Date.now()
  let dueSoon = false
  for (const p of await listProjects()) {
    for (const v of p.variants) {
      for (const post of v.posts) {
        if (post.status !== 'scheduled' || !post.scheduledAt) continue
        const at = new Date(post.scheduledAt).getTime()
        if (post.platform === 'youtube') {
          // YouTube publishes on its own; reflect it once the time has passed
          if (at <= now) await patchPost(p.id, v.id, post.id, { status: 'published' })
          continue
        }
        if (at - now < 10 * 60_000) dueSoon = true
        if (at > now) continue
        if (appStart && now - at > MISSED_AFTER_MS) {
          await patchPost(p.id, v.id, post.id, { status: 'missed', error: 'Clipify was not running at the scheduled time.' })
          notify('Clipify: scheduled post missed', `“${p.clip.title}” was due ${new Date(at).toLocaleString()}. Open Schedule to post it now or reschedule.`)
          continue
        }
        await send(p.id, v.id, post.id)
      }
    }
  }
  // Keep the app from being suspended right before an Instagram post is due.
  if (dueSoon && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension')
  if (!dueSoon && blocker !== null) {
    powerSaveBlocker.stop(blocker)
    blocker = null
  }
}

export function startScheduler(): void {
  if (started) return
  started = true
  void tick(true).catch(() => undefined)
  setInterval(() => void tick(false).catch(() => undefined), 30_000)
}
