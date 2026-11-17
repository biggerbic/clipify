/*
 * YouTube publishing and analytics for Clipify.
 * Adapted from Postiz (https://github.com/gitroomhq/postiz-app, AGPL-3.0), file
 * libraries/nestjs-libraries/src/integrations/social/youtube.provider.ts at commit 4823080b.
 * Changes: no NestJS/googleapis, desktop loopback OAuth with PKCE, single-request upload of a local
 * file, native scheduling via status.publishAt, per-video daily analytics.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { authorize, pkce, REDIRECT_URI } from '../oauth'

export const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly'
]

export interface YtTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}
export interface YtApp {
  clientId: string
  clientSecret: string
}

async function tokenRequest(app: YtApp, params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, ...params })
  })
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; error_description?: string; error?: string }
  if (!res.ok) throw new Error(`Google sign-in failed: ${json.error_description ?? json.error ?? res.status}`)
  return json
}

export async function connect(app: YtApp): Promise<{ tokens: YtTokens; channel: { id: string; title: string; handle?: string; avatar?: string } }> {
  const { verifier, challenge, state } = pkce()
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: YT_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    })
  const code = await authorize(url, state)
  const t = await tokenRequest(app, { code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI, code_verifier: verifier })
  if (!t.refresh_token) throw new Error('Google did not return a refresh token. Remove Clipify from your Google account permissions and connect again.')
  const tokens = { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000 }
  const channel = await myChannel(tokens.accessToken)
  return { tokens, channel }
}

/** Fresh access token; returns the (possibly updated) token set so the caller can persist it. */
export async function fresh(app: YtApp, tokens: YtTokens): Promise<YtTokens> {
  if (tokens.expiresAt > Date.now() + 120_000) return tokens
  const t = await tokenRequest(app, { refresh_token: tokens.refreshToken, grant_type: 'refresh_token' })
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? tokens.refreshToken, expiresAt: Date.now() + t.expires_in * 1000 }
}

async function api<T>(accessToken: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (res.status === 401) throw new Error('YouTube login expired. Reconnect the channel in Settings → Accounts.')
  if (!res.ok) throw new Error(`YouTube API error ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as T
}

export async function myChannel(accessToken: string): Promise<{ id: string; title: string; handle?: string; avatar?: string; subscribers?: number }> {
  const j = await api<{ items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } }; statistics?: { subscriberCount?: string } }[] }>(
    accessToken,
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true'
  )
  const c = j.items?.[0]
  if (!c) throw new Error('This Google account has no YouTube channel.')
  return { id: c.id, title: c.snippet.title, handle: c.snippet.customUrl, avatar: c.snippet.thumbnails?.default?.url, subscribers: Number(c.statistics?.subscriberCount ?? 0) }
}

/**
 * Upload a local video. With `publishAt` the video is uploaded now as private and YouTube itself publishes it
 * at that time, so the computer can be off.
 */
export async function upload(
  accessToken: string,
  file: string,
  meta: { title: string; description: string; tags: string[]; publishAt?: string }
): Promise<{ id: string; url: string }> {
  const size = (await stat(file)).size
  const session = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=true', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(size)
    },
    body: JSON.stringify({
      snippet: { title: meta.title.slice(0, 100), description: meta.description, ...(meta.tags.length ? { tags: meta.tags } : {}), categoryId: '20' },
      status: {
        privacyStatus: meta.publishAt ? 'private' : 'public',
        ...(meta.publishAt ? { publishAt: new Date(meta.publishAt).toISOString() } : {}),
        selfDeclaredMadeForKids: false
      }
    })
  })
  const uploadUri = session.headers.get('location')
  if (!session.ok || !uploadUri) throw new Error(`YouTube would not start the upload (${session.status}): ${(await session.text()).slice(0, 300)}`)
  // Shorts are small: one PUT of the whole file (the session stays resumable if this ever needs chunking).
  const res = await fetch(uploadUri, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
    body: Readable.toWeb(createReadStream(file)) as unknown as BodyInit,
    duplex: 'half'
  } as RequestInit)
  const body = await res.text()
  if (!res.ok) throw new Error(`YouTube upload failed (${res.status}): ${body.slice(0, 300)}`)
  const { id } = JSON.parse(body) as { id: string }
  return { id, url: `https://youtube.com/shorts/${id}` }
}

interface Report {
  columnHeaders?: { name: string }[]
  rows?: (string | number)[][]
}
function rows(r: Report): Record<string, number | string>[] {
  const cols = r.columnHeaders?.map((c) => c.name) ?? []
  return (r.rows ?? []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])))
}
const day = (d: Date): string => d.toISOString().slice(0, 10)

/** Channel-level daily numbers (YouTube Analytics keeps history, so missed days are filled in later). */
export async function channelDaily(accessToken: string, days: number): Promise<{ date: string; views: number; likes: number; comments: number; shares: number; subscribersGained: number; subscribersLost: number }[]> {
  const end = new Date()
  const start = new Date(Date.now() - days * 864e5)
  const r = await api<Report>(
    accessToken,
    'https://youtubeanalytics.googleapis.com/v2/reports?' +
      new URLSearchParams({ ids: 'channel==MINE', startDate: day(start), endDate: day(end), metrics: 'views,likes,comments,shares,subscribersGained,subscribersLost', dimensions: 'day', sort: 'day' })
  )
  return rows(r).map((x) => ({
    date: String(x.day),
    views: Number(x.views),
    likes: Number(x.likes),
    comments: Number(x.comments),
    shares: Number(x.shares),
    subscribersGained: Number(x.subscribersGained),
    subscribersLost: Number(x.subscribersLost)
  }))
}

/** One video's daily numbers since it was published. */
export async function videoDaily(accessToken: string, videoId: string, since: string): Promise<{ date: string; views: number; likes: number; comments: number; shares: number }[]> {
  const r = await api<Report>(
    accessToken,
    'https://youtubeanalytics.googleapis.com/v2/reports?' +
      new URLSearchParams({ ids: 'channel==MINE', startDate: since.slice(0, 10), endDate: day(new Date()), metrics: 'views,likes,comments,shares', dimensions: 'day', filters: `video==${videoId}`, sort: 'day' })
  )
  return rows(r).map((x) => ({ date: String(x.day), views: Number(x.views), likes: Number(x.likes), comments: Number(x.comments), shares: Number(x.shares) }))
}

/** Lifetime counters straight from the Data API (available immediately, unlike Analytics). */
export async function videoTotals(accessToken: string, videoIds: string[]): Promise<Map<string, { views: number; likes: number; comments: number }>> {
  const out = new Map<string, { views: number; likes: number; comments: number }>()
  for (let i = 0; i < videoIds.length; i += 50) {
    const j = await api<{ items?: { id: string; statistics: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(
      accessToken,
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds.slice(i, i + 50).join(',')}`
    )
    for (const v of j.items ?? []) out.set(v.id, { views: Number(v.statistics.viewCount ?? 0), likes: Number(v.statistics.likeCount ?? 0), comments: Number(v.statistics.commentCount ?? 0) })
  }
  return out
}
