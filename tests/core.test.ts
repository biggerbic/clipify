import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Main-process modules import electron; these tests only exercise their pure parts.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), isPackaged: true, getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false },
  dialog: {},
  shell: {},
  Notification: { isSupported: () => false },
  powerSaveBlocker: { start: () => 1, stop: () => undefined }
}))

import { parseClipSlug } from '../src/main/twitch/client'
import { finalize, renderCredit, LIMITS } from '../src/main/claude/descriptions'
import { isPrivateAddress } from '../src/main/engine/share'
import { phase } from '../src/main/jobs/generate'
import { openTeamSetup, sealTeamSetup } from '../src/main/setup/team'
import { openStats } from '../src/main/stats/db'
import { overview } from '../src/main/stats/overview'
import { deriveStatus } from '../src/main/publish/publisher'
import type { Account, Project } from '../src/shared/types'

const clip = {
  id: 'Slug-abc',
  url: 'https://www.twitch.tv/shroud/clip/Slug-abc',
  embedUrl: '',
  broadcasterId: '1',
  broadcasterName: 'shroud',
  creatorName: 'clipper1',
  gameId: '2',
  gameName: 'Valorant',
  language: 'en',
  title: 'insane clutch',
  viewCount: 10,
  createdAt: '2026-11-01T10:00:00Z',
  thumbnailUrl: '',
  duration: 30,
  isFeatured: false
}
const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
  status: 'review',
  clip,
  notes: '',
  engine: {},
  variants: [{ id: 'v1', index: 1, recipeId: 'bold', recipeName: 'Bold', hookText: 'x', captions: null, hook: null, status: 'ready', revisions: [], posts: [] }],
  ...over
})

describe('Twitch clip links', () => {
  it('reads the slug from every clip URL shape', () => {
    expect(parseClipSlug('https://clips.twitch.tv/FunnyClipSlug-AbC123')).toBe('FunnyClipSlug-AbC123')
    expect(parseClipSlug('https://www.twitch.tv/shroud/clip/SmilingSpooky-uly93')).toBe('SmilingSpooky-uly93')
    expect(parseClipSlug('twitch.tv/shroud/clip/Abc?filter=clips')).toBe('Abc')
    expect(parseClipSlug('https://m.twitch.tv/clip/MobileSlug')).toBe('MobileSlug')
    expect(parseClipSlug('https://clips.twitch.tv/embed?clip=EmbedSlug&parent=x')).toBe('EmbedSlug')
  })
  it('rejects links that are not clips', () => {
    expect(parseClipSlug('https://www.twitch.tv/shroud')).toBeNull()
    expect(parseClipSlug('https://youtube.com/watch?v=1')).toBeNull()
    expect(parseClipSlug('not a url at all')).toBeNull()
  })
})

describe('descriptions', () => {
  it('fills the credit template', () => {
    expect(renderCredit('Clip: {streamer} {streamer_url} by {clipper} ({category}) {unknown}', project())).toBe('Clip: shroud https://twitch.tv/shroud by clipper1 (Valorant) {unknown}')
  })
  it('always keeps the full credit block, shortening copy instead', () => {
    const credit = 'Credit: https://twitch.tv/shroud — sponsor https://example.com'
    const long = 'word '.repeat(2000)
    const d = finalize(
      { youtube: { title: 'T'.repeat(300), description: long, tags: ['a'] }, instagram: { caption: long, hashtags: Array.from({ length: 40 }, (_, i) => `#t${i}`) }, tiktok: { caption: long, hashtags: ['#a', 'a', '#A'] } },
      credit,
      'claude'
    )
    expect(d.youtube.title.length).toBeLessThanOrEqual(LIMITS.youtubeTitle)
    for (const text of [d.youtube.description, d.instagram.caption, d.tiktok.caption]) expect(text.endsWith(credit)).toBe(true)
    expect(d.instagram.caption.length).toBeLessThanOrEqual(LIMITS.instagramCaption)
    expect(d.instagram.hashtags).toHaveLength(30)
    expect(d.tiktok.hashtags).toEqual(['#A']) // de-duplicated case-insensitively
  })
})

describe('engine sharing', () => {
  it('accepts only LAN, Tailscale and loopback callers', () => {
    for (const ok of ['127.0.0.1', '::1', '192.168.1.20', '10.0.0.5', '172.20.1.1', '100.101.102.103', '::ffff:192.168.0.2']) expect(isPrivateAddress(ok)).toBe(true)
    for (const bad of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '203.0.113.9']) expect(isPrivateAddress(bad)).toBe(false)
  })
})

describe('generation progress', () => {
  it('maps engine log lines to a plain phase', () => {
    expect(phase(['Job x queued.'])).toBe('Waiting for the engine')
    expect(phase(['queued', '[download] 50%'])).toBe('Downloading the clip')
    expect(phase(['🎬 Scene engine: TransNetV2 — 3 scenes'])).toBe('Finding scenes')
    expect(phase(['✅ Clip 1 ready: output/x.mp4'])).toBe('Finishing the base video')
    expect(phase([])).toBe('Starting')
  })
})

describe('team setup file', () => {
  it('round-trips keys and rejects a wrong passphrase', () => {
    const sealed = sealTeamSetup({ twitchClientId: 'id', twitchClientSecret: 'secret' }, 'correct horse')
    expect(sealed).not.toContain('secret')
    expect(openTeamSetup(sealed, 'correct horse')).toEqual({ twitchClientId: 'id', twitchClientSecret: 'secret' })
    expect(() => openTeamSetup(sealed, 'wrong pass')).toThrow(/Wrong passphrase/)
  })
})

describe('project status', () => {
  it('follows posts', () => {
    expect(deriveStatus(project())).toBe('review')
    const p = project()
    p.variants[0].posts.push({ id: 'a', accountId: 'x', platform: 'youtube', mode: 'scheduled', status: 'scheduled' })
    expect(deriveStatus(p)).toBe('scheduled')
    p.variants[0].posts.push({ id: 'b', accountId: 'x', platform: 'tiktok', mode: 'manual', status: 'manual' })
    expect(deriveStatus(p)).toBe('published')
    expect(deriveStatus(project({ variants: [{ ...project().variants[0], status: 'failed' }] }))).toBe('failed')
  })
})

describe('statistics', () => {
  it('counts growth inside the period from lifetime snapshots', () => {
    const db = openStats(join(mkdtempSync(join(tmpdir(), 'clipify-')), 'stats.sqlite'))
    const now = Date.now()
    const iso = (msAgo: number): string => new Date(now - msAgo).toISOString()
    db.prepare('INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('post1', 'yt_1', 'youtube', 'p1', 'v1', 'Bold', 'shroud', 'Valorant', 'title', null, null, iso(20 * 864e5))
    const snap = db.prepare('INSERT INTO post_snap VALUES (?,?,?,?,?,?)')
    snap.run('post1', iso(19 * 864e5), 1000, 100, 10, 1) // before a 7-day window
    snap.run('post1', iso(8 * 864e5), 5000, 400, 40, 4)
    snap.run('post1', iso(1 * 864e5), 9000, 700, 70, 7)
    db.prepare('INSERT INTO account_daily VALUES (?,?,?,?)').run('yt_1', iso(2 * 864e5).slice(0, 10), 25, null)
    const accounts: Account[] = [{ id: 'yt_1', platform: 'youtube', name: 'Main', connectedAt: iso(0), status: 'ok' }]
    const o = overview(db, '7d', accounts, [project()])
    expect(o.totals.views).toBe(4000) // 9000 now − 5000 at the window start
    expect(o.totals.likes).toBe(300)
    expect(o.totals.followersGained).toBe(25)
    expect(o.previous.views).toBe(4000) // 5000 − 1000 in the week before
    expect(o.series).toHaveLength(7)
    expect(o.series.reduce((s, d) => s + d.youtube, 0)).toBe(4000)
    expect(o.topPosts[0].views).toBe(4000)
    expect(o.insights.recipes[0]).toMatchObject({ name: 'Bold', posts: 1, avgViews: 9000 })
  })
})
