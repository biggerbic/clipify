/*
 * Instagram (professional accounts via Facebook Login for Business) publishing and analytics for Clipify.
 * Adapted from Postiz (https://github.com/gitroomhq/postiz-app, AGPL-3.0), file
 * libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts at commit 4823080b.
 * Changes: no NestJS, loopback OAuth, and Reels are sent as a RESUMABLE LOCAL UPLOAD
 * (container with upload_type=resumable + rupload.facebook.com) instead of Postiz's public `video_url`,
 * because Instagram's servers cannot fetch a file that only exists on this computer.
 */
import { readFile, stat } from 'node:fs/promises'
import { authorize, pkce, REDIRECT_URI } from '../oauth'

export const GRAPH_VERSION = 'v27.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`
export const IG_SCOPES = ['instagram_basic', 'pages_show_list', 'pages_read_engagement', 'business_management', 'instagram_content_publish', 'instagram_manage_insights']

export interface MetaApp {
  appId: string
  appSecret: string
}
export interface IgAccount {
  igUserId: string
  pageId: string
  username: string
  name: string
  avatar?: string
  /** Long-lived user token (~60 days); page tokens derived from it don't expire. */
  userToken: string
  pageToken: string
  expiresAt: number
}

async function graph<T>(path: string, params: Record<string, string>, init?: RequestInit): Promise<T> {
  const url = `${GRAPH}/${path}?${new URLSearchParams(params)}`
  const res = await fetch(url, init)
  const json = (await res.json()) as T & { error?: { message: string; code?: number } }
  if (!res.ok || json.error) {
    const msg = json.error?.message ?? `HTTP ${res.status}`
    if (json.error?.code === 190) throw new Error('Instagram login expired. Reconnect the account in Settings → Accounts.')
    throw new Error(`Instagram API: ${msg}`)
  }
  return json
}

/** Sign in with Facebook and return every Instagram professional account linked to the user's Pages. */
export async function connect(app: MetaApp): Promise<IgAccount[]> {
  const { state } = pkce()
  const url =
    `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?` +
    new URLSearchParams({ client_id: app.appId, redirect_uri: REDIRECT_URI, state, scope: IG_SCOPES.join(','), response_type: 'code' })
  const code = await authorize(url, state)
  const short = await graph<{ access_token: string }>('oauth/access_token', { client_id: app.appId, client_secret: app.appSecret, redirect_uri: REDIRECT_URI, code })
  const long = await graph<{ access_token: string; expires_in?: number }>('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: app.appId,
    client_secret: app.appSecret,
    fb_exchange_token: short.access_token
  })
  const userToken = long.access_token
  const expiresAt = Date.now() + (long.expires_in ?? 59 * 86400) * 1000
  const pages = await graph<{ data: { id: string; name: string; access_token: string; instagram_business_account?: { id: string } }[] }>('me/accounts', {
    fields: 'id,name,access_token,instagram_business_account',
    limit: '100',
    access_token: userToken
  })
  const out: IgAccount[] = []
  for (const page of pages.data) {
    if (!page.instagram_business_account) continue
    const ig = await graph<{ id: string; username: string; name?: string; profile_picture_url?: string }>(page.instagram_business_account.id, {
      fields: 'id,username,name,profile_picture_url',
      access_token: userToken
    })
    out.push({ igUserId: ig.id, pageId: page.id, username: ig.username, name: ig.name || ig.username, avatar: ig.profile_picture_url, userToken, pageToken: page.access_token, expiresAt })
  }
  if (!out.length) {
    throw new Error(
      'No Instagram professional account was found. The Instagram account must be a Business or Creator account linked to a Facebook Page you manage, and you must select that Page during sign-in.'
    )
  }
  return out
}

export async function publishingQuota(acc: IgAccount): Promise<{ used: number; total: number }> {
  const j = await graph<{ data: { quota_usage: number; config?: { quota_total: number } }[] }>(`${acc.igUserId}/content_publishing_limit`, {
    fields: 'quota_usage,config',
    access_token: acc.pageToken
  })
  return { used: j.data[0]?.quota_usage ?? 0, total: j.data[0]?.config?.quota_total ?? 100 }
}

/** Publish a local MP4 as a Reel: create container → upload bytes → wait for processing → publish. */
export async function publishReel(acc: IgAccount, file: string, caption: string, onStatus?: (s: string) => void): Promise<{ id: string; url: string }> {
  const container = await graph<{ id: string; uri?: string }>(
    `${acc.igUserId}/media`,
    { media_type: 'REELS', upload_type: 'resumable', caption, share_to_feed: 'true', access_token: acc.pageToken },
    { method: 'POST' }
  )
  const size = (await stat(file)).size
  onStatus?.('uploading')
  // shortcut: whole file in one request (Reels from Clipify are tens of MB); switch to offset chunks if uploads time out
  const up = await fetch(container.uri ?? `https://rupload.facebook.com/ig-api-upload/${GRAPH_VERSION}/${container.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${acc.pageToken}`, offset: '0', file_size: String(size), 'Content-Type': 'application/octet-stream' },
    body: await readFile(file)
  })
  if (!up.ok) throw new Error(`Instagram rejected the upload (${up.status}): ${(await up.text()).slice(0, 300)}`)

  onStatus?.('processing')
  const deadline = Date.now() + 10 * 60_000
  for (;;) {
    const s = await graph<{ status_code: string; status?: string }>(container.id, { fields: 'status_code,status', access_token: acc.pageToken })
    if (s.status_code === 'FINISHED') break
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram could not process the video: ${s.status ?? s.status_code}`)
    if (Date.now() > deadline) throw new Error('Instagram is still processing the video after 10 minutes. Try again later.')
    await new Promise((r) => setTimeout(r, 4000))
  }
  const published = await graph<{ id: string }>(`${acc.igUserId}/media_publish`, { creation_id: container.id, access_token: acc.pageToken }, { method: 'POST' })
  const media = await graph<{ permalink?: string }>(published.id, { fields: 'permalink', access_token: acc.pageToken }).catch(() => ({}) as { permalink?: string })
  return { id: published.id, url: media.permalink ?? `https://www.instagram.com/${acc.username}/` }
}

export async function accountInfo(acc: IgAccount): Promise<{ followers: number; mediaCount: number }> {
  const j = await graph<{ followers_count?: number; media_count?: number }>(acc.igUserId, { fields: 'followers_count,media_count', access_token: acc.pageToken })
  return { followers: j.followers_count ?? 0, mediaCount: j.media_count ?? 0 }
}

/** Daily follower count and reach (Instagram keeps ~2 years of insights). */
export async function accountDaily(acc: IgAccount, days: number): Promise<{ date: string; followerCount?: number; reach?: number }[]> {
  const until = Math.floor(Date.now() / 1000)
  const since = until - Math.min(days, 30) * 86400 // the API caps a range at 30 days
  const j = await graph<{ data: { name: string; values: { value: number; end_time: string }[] }[] }>(`${acc.igUserId}/insights`, {
    metric: 'follower_count,reach',
    period: 'day',
    since: String(since),
    until: String(until),
    access_token: acc.pageToken
  })
  const byDate = new Map<string, { date: string; followerCount?: number; reach?: number }>()
  for (const metric of j.data) {
    for (const v of metric.values) {
      const date = v.end_time.slice(0, 10)
      const row = byDate.get(date) ?? { date }
      if (metric.name === 'follower_count') row.followerCount = v.value
      if (metric.name === 'reach') row.reach = v.value
      byDate.set(date, row)
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Lifetime totals of one Reel. */
export async function mediaTotals(acc: IgAccount, mediaId: string): Promise<{ views: number; likes: number; comments: number; shares: number; saves: number; reach: number }> {
  const j = await graph<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(`${mediaId}/insights`, {
    metric: 'views,reach,saved,likes,comments,shares',
    access_token: acc.pageToken
  })
  const get = (n: string): number => {
    const m = j.data.find((d) => d.name === n)
    return Number(m?.values?.[0]?.value ?? m?.total_value?.value ?? 0)
  }
  return { views: get('views'), likes: get('likes'), comments: get('comments'), shares: get('shares'), saves: get('saved'), reach: get('reach') }
}
