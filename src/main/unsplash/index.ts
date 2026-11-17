import { join } from 'node:path'
import type { Background } from '@shared/types'
import { ctx } from '../context'
import { readJson, writeJson } from '../store/json'
import { getSecret } from '../store/secrets'
import { getSettings } from '../store/settings'

const UTM = 'utm_source=clipify&utm_medium=referral'

interface Photo {
  id: string
  color?: string
  urls: { raw: string }
  links: { download_location: string; html: string }
  user: { name: string; links: { html: string } }
}
interface Cache {
  date: string
  query: string
  photos: Photo[]
  tracked: string[]
}

const file = (): string => join(ctx.userData, 'unsplash.json')
const today = (): string => new Date().toISOString().slice(0, 10)

async function api<T>(key: string, path: string): Promise<T> {
  const res = await fetch(`https://api.unsplash.com${path}`, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } })
  if (!res.ok) throw new Error(`Unsplash ${res.status}`)
  return (await res.json()) as T
}

/** One fetch of 10 photos per day (well under the 50 requests/hour demo limit). */
async function photos(key: string, query: string): Promise<Cache> {
  const cache = await readJson<Cache | null>(file(), null)
  if (cache && cache.date === today() && cache.query === query && cache.photos.length) return cache
  const list = await api<Photo[]>(key, `/photos/random?${new URLSearchParams({ query, orientation: 'landscape', content_filter: 'high', count: '10' })}`)
  const next = { date: today(), query, photos: list, tracked: [] }
  await writeJson(file(), next)
  return next
}

/**
 * Background photo for Home or Dashboard. Follows Unsplash's API rules: the image is hotlinked from the
 * returned URL (ixid kept), the download endpoint is called when a photo is used, and the caller shows
 * "Photo by <name> on Unsplash" with these referral links.
 */
export async function background(screen: 'home' | 'dashboard'): Promise<Background | null> {
  const settings = await getSettings()
  const key = await getSecret('unsplashKey')
  if (!settings.unsplash.enabled || !key) return null
  try {
    const cache = await photos(key, settings.unsplash.query)
    const photo = cache.photos[screen === 'home' ? 0 : 1 % cache.photos.length]
    if (!photo) return null
    if (!cache.tracked.includes(photo.id)) {
      await api(key, new URL(photo.links.download_location).pathname + new URL(photo.links.download_location).search).catch(() => undefined)
      cache.tracked.push(photo.id)
      await writeJson(file(), cache)
    }
    const raw = new URL(photo.urls.raw)
    raw.searchParams.set('w', '2400')
    raw.searchParams.set('fit', 'max')
    raw.searchParams.set('q', '80')
    return {
      url: raw.toString(),
      color: photo.color,
      photographer: photo.user.name,
      photographerUrl: `${photo.user.links.html}?${UTM}`,
      unsplashUrl: `https://unsplash.com/?${UTM}`
    }
  } catch {
    return null
  }
}

export async function testUnsplash(): Promise<string> {
  const key = await getSecret('unsplashKey')
  if (!key) throw new Error('No Unsplash key set.')
  await api(key, '/photos/random?count=1&orientation=landscape')
  return 'Connected.'
}
