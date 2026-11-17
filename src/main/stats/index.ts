import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { dialog } from 'electron'
import type { Period, StatsOverview } from '@shared/types'
import { getSettings } from '../store/settings'
import { listProjects } from '../store/projects'
import { instagramAccount, listAccounts, markStatus, youtubeAccess } from '../publish/accounts'
import * as yt from '../publish/youtube/provider'
import * as ig from '../publish/instagram/provider'
import { openStats, type DB } from './db'
import { overview } from './overview'

let db: DB | null = null
let dbPath = ''
async function stats(): Promise<DB> {
  const file = join((await getSettings()).libraryDir, 'stats.sqlite')
  if (!db || dbPath !== file) {
    db?.close()
    db = openStats(file)
    dbPath = file
  }
  return db
}

export async function statsOverview(period: Period, accountId?: string): Promise<StatsOverview> {
  return overview(await stats(), period, await listAccounts(), await listProjects(), accountId)
}

let collecting: Promise<void> | null = null
/** Pull fresh numbers for every published post and connected account. Safe to call often. */
export function collect(): Promise<void> {
  collecting ??= doCollect().finally(() => (collecting = null))
  return collecting
}

async function doCollect(): Promise<void> {
  const d = await stats()
  const now = new Date().toISOString()
  const projects = await listProjects()
  const accounts = await listAccounts()

  const upsertPost = d.prepare(`INSERT INTO posts VALUES (@post_id,@account_id,@platform,@project_id,@variant_id,@recipe,@channel,@category,@title,@url,@thumb,@published_at)
    ON CONFLICT(post_id) DO UPDATE SET url=excluded.url, title=excluded.title, thumb=excluded.thumb, published_at=excluded.published_at`)
  const snap = d.prepare('INSERT OR REPLACE INTO post_snap VALUES (?,?,?,?,?,?)')
  const daily = d.prepare('INSERT OR REPLACE INTO account_daily VALUES (?,?,?,?)')

  const live: { postId: string; accountId: string; platform: 'youtube' | 'instagram'; remoteId: string; publishedAt: string }[] = []
  for (const p of projects) {
    for (const v of p.variants) {
      const rev = v.revisions.find((r) => r.id === v.current) ?? v.revisions[v.revisions.length - 1]
      for (const post of v.posts) {
        if (!post.remoteId || (post.platform !== 'youtube' && post.platform !== 'instagram')) continue
        const publishedAt = post.publishedAt ?? post.scheduledAt ?? p.updatedAt
        if (new Date(publishedAt).getTime() > Date.now()) continue
        upsertPost.run({
          post_id: post.id,
          account_id: post.accountId,
          platform: post.platform,
          project_id: p.id,
          variant_id: v.id,
          recipe: v.recipeName,
          channel: p.clip.broadcasterName,
          category: p.clip.gameName ?? '',
          title: v.descriptions?.youtube.title || p.clip.title,
          url: post.url ?? null,
          thumb: rev ? `clipify-media://${encodeURIComponent(p.id)}/${rev.file.split('\\').join('/')}` : null,
          published_at: publishedAt
        })
        live.push({ postId: post.id, accountId: post.accountId, platform: post.platform, remoteId: post.remoteId, publishedAt })
      }
    }
  }

  for (const acc of accounts) {
    const mine = live.filter((x) => x.accountId === acc.id)
    try {
      if (acc.platform === 'youtube') {
        const token = await youtubeAccess(acc.id)
        const totals = await yt.videoTotals(token, mine.map((m) => m.remoteId))
        for (const m of mine) {
          const t = totals.get(m.remoteId)
          if (!t) continue
          const prevShares = (d.prepare('SELECT shares FROM post_snap WHERE post_id=? ORDER BY at DESC LIMIT 1').get(m.postId) as { shares: number } | undefined)?.shares ?? 0
          snap.run(m.postId, now, t.views, t.likes, t.comments, prevShares)
        }
        for (const row of await yt.channelDaily(token, 30)) daily.run(acc.id, row.date, row.subscribersGained - row.subscribersLost, null)
        // shares only exist in Analytics: refresh them once a day per video
        if (!isToday(d, `yt-shares-${acc.id}`)) {
          for (const m of mine) {
            const rows = await yt.videoDaily(token, m.remoteId, m.publishedAt).catch(() => [])
            const shares = rows.reduce((s, r) => s + r.shares, 0)
            d.prepare('UPDATE post_snap SET shares=? WHERE post_id=? AND at=?').run(shares, m.postId, now)
          }
          markToday(d, `yt-shares-${acc.id}`)
        }
      } else if (acc.platform === 'instagram') {
        const a = await instagramAccount(acc.id)
        for (const m of mine) {
          const t = await ig.mediaTotals(a, m.remoteId).catch(() => null)
          if (t) snap.run(m.postId, now, t.views, t.likes, t.comments, t.shares)
        }
        const info = await ig.accountInfo(a).catch(() => null)
        for (const row of await ig.accountDaily(a, 30).catch(() => [])) daily.run(acc.id, row.date, row.followerCount ?? 0, info?.followers ?? null)
      }
      if (acc.status === 'error') await markStatus(acc.id, 'ok')
    } catch {
      if (acc.status === 'ok') await markStatus(acc.id, 'error')
    }
  }

  // Keep hourly detail for 3 days (growth speed), then one snapshot per post per day.
  d.prepare(
    `DELETE FROM post_snap WHERE at < ? AND rowid NOT IN (SELECT MAX(rowid) FROM post_snap GROUP BY post_id, substr(at,1,10))`
  ).run(new Date(Date.now() - 3 * 864e5).toISOString())
  d.prepare("INSERT OR REPLACE INTO meta VALUES ('lastCollectedAt', ?)").run(now)
}

function isToday(d: DB, key: string): boolean {
  const r = d.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined
  return r?.value === new Date().toISOString().slice(0, 10)
}
function markToday(d: DB, key: string): void {
  d.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run(key, new Date().toISOString().slice(0, 10))
}

export function startCollector(): void {
  setTimeout(() => void collect().catch(() => undefined), 15_000)
  setInterval(() => void collect().catch(() => undefined), 60 * 60_000)
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function exportCsv(kind: 'posts' | 'accounts', period: Period): Promise<{ ok: boolean; path?: string }> {
  const o = overview(await stats(), period, await listAccounts(), await listProjects(), undefined, Infinity)
  const rows: unknown[][] =
    kind === 'posts'
      ? [['title', 'platform', 'account', 'published', 'views', 'likes', 'comments', 'shares', 'engagement_rate', 'url'], ...o.topPosts.map((p) => [p.title, p.platform, p.accountName, p.publishedAt, p.views, p.likes, p.comments, p.shares, p.engagementRate.toFixed(4), p.url])]
      : [['account', 'platform', 'views', 'likes', 'comments', 'shares', 'posts'], ...o.accounts.map((a) => [a.account.name, a.account.platform, a.totals.views, a.totals.likes, a.totals.comments, a.totals.shares, a.totals.posts])]
  const res = await dialog.showSaveDialog({ defaultPath: `clipify-${kind}-${period}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] })
  if (res.canceled || !res.filePath) return { ok: false }
  await writeFile(res.filePath, rows.map((r) => r.map(csvCell).join(',')).join('\n'))
  return { ok: true, path: res.filePath }
}
