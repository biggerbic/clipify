import type { ClipQuery, TwitchCategory, TwitchChannel, TwitchClip } from '@shared/types'
import { getSecret } from '../store/secrets'

const HELIX = 'https://api.twitch.tv/helix'
let token: { value: string; expires: number; clientId: string } | null = null

async function credentials(): Promise<{ id: string; secret: string }> {
  const id = await getSecret('twitchClientId')
  const secret = await getSecret('twitchClientSecret')
  if (!id || !secret) throw new Error('Twitch is not set up yet. Add your Twitch app in Settings → Setup.')
  return { id, secret }
}

async function appToken(): Promise<{ value: string; clientId: string }> {
  const { id, secret } = await credentials()
  if (token && token.clientId === id && token.expires > Date.now() + 60_000) return token
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' })
  })
  if (!res.ok) throw new Error(`Twitch rejected the app credentials (${res.status}). Check Client ID and Secret in Settings.`)
  const j = (await res.json()) as { access_token: string; expires_in: number }
  token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000, clientId: id }
  return token
}

async function helix<T>(path: string, params: Record<string, string | string[] | undefined>): Promise<T[]> {
  const t = await appToken()
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    for (const one of Array.isArray(v) ? v : [v]) qs.append(k, one)
  }
  const res = await fetch(`${HELIX}${path}?${qs}`, { headers: { 'Client-Id': t.clientId, Authorization: `Bearer ${t.value}` } })
  if (res.status === 401) token = null
  if (!res.ok) throw new Error(`Twitch API ${path} failed (${res.status})`)
  return ((await res.json()) as { data: T[] }).data
}

const boxArt = (url: string): string => url.replace('{width}', '188').replace('{height}', '250')

interface HelixClip {
  id: string
  url: string
  embed_url: string
  broadcaster_id: string
  broadcaster_name: string
  creator_name: string
  game_id: string
  language: string
  title: string
  view_count: number
  created_at: string
  thumbnail_url: string
  duration: number
  is_featured: boolean
}

const gameNames = new Map<string, string>()
async function withGameNames(clips: HelixClip[]): Promise<TwitchClip[]> {
  const missing = [...new Set(clips.map((c) => c.game_id).filter((g) => g && !gameNames.has(g)))]
  for (let i = 0; i < missing.length; i += 100) {
    for (const g of await helix<{ id: string; name: string }>('/games', { id: missing.slice(i, i + 100) })) gameNames.set(g.id, g.name)
  }
  return clips.map((c) => ({
    id: c.id,
    url: c.url,
    embedUrl: c.embed_url,
    broadcasterId: c.broadcaster_id,
    broadcasterName: c.broadcaster_name,
    creatorName: c.creator_name,
    gameId: c.game_id,
    gameName: gameNames.get(c.game_id),
    language: c.language,
    title: c.title,
    viewCount: c.view_count,
    createdAt: c.created_at,
    thumbnailUrl: c.thumbnail_url,
    duration: c.duration,
    isFeatured: c.is_featured
  }))
}

export async function topCategories(): Promise<TwitchCategory[]> {
  const data = await helix<{ id: string; name: string; box_art_url: string }>('/games/top', { first: '60' })
  return data.map((g) => ({ id: g.id, name: g.name, boxArtUrl: boxArt(g.box_art_url) }))
}

export async function searchCategories(q: string): Promise<TwitchCategory[]> {
  if (!q.trim()) return []
  const data = await helix<{ id: string; name: string; box_art_url: string }>('/search/categories', { query: q, first: '30' })
  return data.map((g) => ({ id: g.id, name: g.name, boxArtUrl: boxArt(g.box_art_url) }))
}

export async function searchChannels(q: string): Promise<TwitchChannel[]> {
  if (!q.trim()) return []
  const data = await helix<{ id: string; broadcaster_login: string; display_name: string; thumbnail_url: string; is_live: boolean; game_name: string }>(
    '/search/channels',
    { query: q, first: '30' }
  )
  return data.map((c) => ({ id: c.id, login: c.broadcaster_login, name: c.display_name, avatarUrl: c.thumbnail_url, live: c.is_live, gameName: c.game_name }))
}

/** Popular channels = the biggest live streams right now (overall or in one category). */
export async function topChannels(categoryId?: string): Promise<TwitchChannel[]> {
  const streams = await helix<{ user_id: string; user_login: string; user_name: string; game_name: string; viewer_count: number }>('/streams', {
    first: '40',
    game_id: categoryId
  })
  const avatars = new Map<string, string>()
  const ids = [...new Set(streams.map((s) => s.user_id))]
  for (let i = 0; i < ids.length; i += 100) {
    for (const u of await helix<{ id: string; profile_image_url: string }>('/users', { id: ids.slice(i, i + 100) })) avatars.set(u.id, u.profile_image_url)
  }
  return streams.map((s) => ({
    id: s.user_id,
    login: s.user_login,
    name: s.user_name,
    avatarUrl: avatars.get(s.user_id),
    live: true,
    viewerCount: s.viewer_count,
    gameName: s.game_name
  }))
}

const RANGE_MS = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 } as const

/** Clips for every requested category and channel, merged, filtered and sorted. */
export async function clips(q: ClipQuery, usedIds: Set<string> = new Set()): Promise<TwitchClip[]> {
  const started_at = q.range === 'all' ? undefined : new Date(Date.now() - RANGE_MS[q.range]).toISOString()
  const sources = [...(q.categoryIds ?? []).map((id) => ({ game_id: id })), ...(q.channelIds ?? []).map((id) => ({ broadcaster_id: id }))]
  if (!sources.length) return []
  const perSource = Math.max(20, Math.min(100, Math.floor(300 / sources.length)))
  const batches = await Promise.all(
    sources.map((s) =>
      helix<HelixClip>('/clips', { ...s, started_at, first: String(perSource), is_featured: q.featuredOnly ? 'true' : undefined }).catch(() => [] as HelixClip[])
    )
  )
  const seen = new Set<string>()
  let list = batches.flat().filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
  list = list.filter(
    (c) =>
      (!q.minViews || c.view_count >= q.minViews) &&
      (!q.maxDuration || c.duration <= q.maxDuration) &&
      (!q.language || c.language === q.language) &&
      (!q.hideUsed || !usedIds.has(c.id))
  )
  list.sort((a, b) => (q.sort === 'newest' ? b.created_at.localeCompare(a.created_at) : b.view_count - a.view_count))
  return withGameNames(list.slice(0, 200))
}

/** Clip slug from clips.twitch.tv/<slug>, twitch.tv/<user>/clip/<slug> or m.twitch.tv/clip/<slug>. */
export function parseClipSlug(input: string): string | null {
  let u: URL
  try {
    u = new URL(input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  const parts = u.pathname.split('/').filter(Boolean)
  if (host === 'clips.twitch.tv') return parts[0] && parts[0] !== 'embed' ? parts[0] : u.searchParams.get('clip')
  if (/(^|\.)twitch\.tv$/.test(host)) {
    const i = parts.indexOf('clip')
    return i >= 0 && parts[i + 1] ? parts[i + 1] : null
  }
  return null
}

export async function clipFromUrl(url: string): Promise<TwitchClip> {
  const slug = parseClipSlug(url)
  if (!slug) throw new Error('That does not look like a Twitch clip link (clips.twitch.tv/… or twitch.tv/<channel>/clip/…).')
  const [clip] = await helix<HelixClip>('/clips', { id: slug })
  if (!clip) throw new Error('Twitch could not find that clip. It may have been deleted.')
  return (await withGameNames([clip]))[0]
}

export async function testTwitch(): Promise<string> {
  const top = await topCategories()
  return `Connected. Top category right now: ${top[0]?.name ?? 'n/a'}.`
}
