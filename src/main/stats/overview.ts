import type { Account, Insights, Period, Project, StatsOverview, TopPost, Totals } from '@shared/types'
import type { DB } from './db'

const PERIOD_DAYS: Record<Period, number | null> = { '7d': 7, '28d': 28, '90d': 90, all: null }
const ZERO: Totals = { views: 0, likes: 0, comments: 0, shares: 0, followersGained: 0, posts: 0 }

interface Snap {
  post_id: string
  at: string
  views: number
  likes: number
  comments: number
  shares: number
}
interface PostRow {
  post_id: string
  account_id: string
  platform: 'youtube' | 'instagram' | 'tiktok'
  project_id: string
  variant_id: string
  recipe: string
  channel: string
  category: string
  title: string
  url: string | null
  thumb: string | null
  published_at: string
}

/** Lifetime counters of a post as of `when` (last snapshot at or before it; 0 before publishing). */
function at(snaps: Snap[], when: number): Omit<Snap, 'post_id' | 'at'> {
  let best: Snap | undefined
  for (const s of snaps) if (new Date(s.at).getTime() <= when) best = s
  return best ?? { views: 0, likes: 0, comments: 0, shares: 0 }
}

function sumWindow(posts: PostRow[], snaps: Map<string, Snap[]>, from: number, to: number, accountIds?: Set<string>): Totals {
  const t = { ...ZERO }
  for (const p of posts) {
    if (accountIds && !accountIds.has(p.account_id)) continue
    const s = snaps.get(p.post_id) ?? []
    const a = at(s, from)
    const b = at(s, to)
    t.views += Math.max(0, b.views - a.views)
    t.likes += Math.max(0, b.likes - a.likes)
    t.comments += Math.max(0, b.comments - a.comments)
    t.shares += Math.max(0, b.shares - a.shares)
    const pub = new Date(p.published_at).getTime()
    if (pub >= from && pub <= to) t.posts++
  }
  return t
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export function overview(db: DB, period: Period, accounts: Account[], projects: Project[], accountId?: string, topLimit = 12): StatsOverview {
  const now = Date.now()
  const posts = db.prepare('SELECT * FROM posts').all() as PostRow[]
  const allSnaps = db.prepare('SELECT * FROM post_snap ORDER BY at').all() as Snap[]
  const snaps = new Map<string, Snap[]>()
  for (const s of allSnaps) (snaps.get(s.post_id) ?? snaps.set(s.post_id, []).get(s.post_id)!).push(s)

  const firstPublish = posts.reduce((m, p) => Math.min(m, new Date(p.published_at).getTime()), now)
  const days = PERIOD_DAYS[period] ?? Math.max(1, Math.ceil((now - firstPublish) / 864e5))
  const from = now - days * 864e5
  const prevFrom = from - days * 864e5
  const only = accountId ? new Set([accountId]) : undefined

  const followers = (a: number, b: number): number => {
    const r = db
      .prepare(`SELECT COALESCE(SUM(followers_gained),0) AS n FROM account_daily WHERE date > ? AND date <= ? ${accountId ? 'AND account_id = ?' : ''}`)
      .get(...[day(a), day(b), ...(accountId ? [accountId] : [])]) as { n: number }
    return r.n
  }
  const totals = { ...sumWindow(posts, snaps, from, now, only), followersGained: followers(from, now) }
  const previous = { ...sumWindow(posts, snaps, prevFrom, from, only), followersGained: followers(prevFrom, from) }

  // Daily views gained per platform.
  const series: StatsOverview['series'] = []
  const steps = Math.min(days, 365)
  for (let i = steps - 1; i >= 0; i--) {
    const end = now - i * 864e5
    const start = end - 864e5
    const row = { date: day(end), youtube: 0, instagram: 0 }
    for (const p of posts) {
      if (only && !only.has(p.account_id)) continue
      if (p.platform !== 'youtube' && p.platform !== 'instagram') continue
      const s = snaps.get(p.post_id) ?? []
      row[p.platform] += Math.max(0, at(s, end).views - at(s, start).views)
    }
    series.push(row)
  }

  const accountTotals = accounts
    .filter((a) => !accountId || a.id === accountId)
    .map((account) => ({ account, totals: { ...sumWindow(posts, snaps, from, now, new Set([account.id])), followersGained: 0 } }))

  const toTop = (p: PostRow, from0: number): TopPost => {
    const s = snaps.get(p.post_id) ?? []
    const b = at(s, now)
    const a = at(s, from0)
    const views = Math.max(0, b.views - a.views)
    const likes = Math.max(0, b.likes - a.likes)
    const comments = Math.max(0, b.comments - a.comments)
    const shares = Math.max(0, b.shares - a.shares)
    return {
      postId: p.post_id,
      projectId: p.project_id,
      variantId: p.variant_id,
      platform: p.platform,
      accountName: accounts.find((x) => x.id === p.account_id)?.name ?? '',
      title: p.title,
      thumbnail: p.thumb ?? undefined,
      url: p.url ?? undefined,
      views,
      likes,
      comments,
      shares,
      engagementRate: views ? (likes + comments + shares) / views : 0,
      publishedAt: p.published_at
    }
  }
  const scoped = posts.filter((p) => !only || only.has(p.account_id))
  const topPosts = scoped.map((p) => toTop(p, from)).sort((x, y) => y.views - x.views).slice(0, topLimit)

  return {
    period,
    totals,
    previous,
    series,
    accounts: accountTotals,
    topPosts,
    insights: insights(scoped, snaps, accounts, projects, now),
    lastCollectedAt: (db.prepare("SELECT value FROM meta WHERE key='lastCollectedAt'").get() as { value: string } | undefined)?.value
  }
}

function insights(posts: PostRow[], snaps: Map<string, Snap[]>, accounts: Account[], projects: Project[], now: number): Insights {
  const life = (p: PostRow): Omit<Snap, 'post_id' | 'at'> => at(snaps.get(p.post_id) ?? [], now)
  const group = (key: (p: PostRow) => string): Map<string, PostRow[]> => {
    const m = new Map<string, PostRow[]>()
    for (const p of posts) {
      const k = key(p)
      if (k) (m.get(k) ?? m.set(k, []).get(k)!).push(p)
    }
    return m
  }
  const avg = (list: PostRow[]): number => list.reduce((s, p) => s + life(p).views, 0) / Math.max(1, list.length)
  const er = (list: PostRow[]): number => {
    const t = list.reduce((s, p) => {
      const l = life(p)
      return { v: s.v + l.views, e: s.e + l.likes + l.comments + l.shares }
    }, { v: 0, e: 0 })
    return t.v ? t.e / t.v : 0
  }

  const bestSources = [
    ...[...group((p) => p.channel)].map(([name, l]) => ({ kind: 'channel' as const, name, posts: l.length, avgViews: avg(l) })),
    ...[...group((p) => p.category)].map(([name, l]) => ({ kind: 'category' as const, name, posts: l.length, avgViews: avg(l) }))
  ]
    .sort((a, b) => b.avgViews - a.avgViews)
    .slice(0, 8)

  const recipes = [...group((p) => p.recipe)].map(([name, l]) => ({ name, posts: l.length, avgViews: avg(l), engagementRate: er(l) })).sort((a, b) => b.avgViews - a.avgViews)

  const cells = new Map<string, { day: number; hour: number; total: number; posts: number }>()
  for (const p of posts) {
    const d = new Date(p.published_at)
    const k = `${d.getDay()}-${d.getHours()}`
    const c = cells.get(k) ?? { day: d.getDay(), hour: d.getHours(), total: 0, posts: 0 }
    c.total += life(p).views
    c.posts++
    cells.set(k, c)
  }
  const heatmap = [...cells.values()].map((c) => ({ day: c.day, hour: c.hour, posts: c.posts, avgViews: c.total / c.posts }))

  const publishedProjects = new Set(projects.filter((p) => p.variants.some((v) => v.posts.some((x) => x.status === 'published' || x.status === 'manual'))).map((p) => p.id))
  const over10k = new Set(posts.filter((p) => life(p).views >= 10_000).map((p) => p.project_id))
  const funnel = {
    picked: projects.length,
    generated: projects.filter((p) => p.variants.some((v) => v.status === 'ready')).length,
    published: publishedProjects.size,
    over10k: over10k.size
  }

  const needsAttention: Insights['needsAttention'] = []
  for (const p of projects) {
    for (const v of p.variants) {
      for (const post of v.posts) {
        if (post.status === 'failed') needsAttention.push({ kind: 'failed', text: `Post failed: ${p.clip.title} (${post.platform})`, projectId: p.id })
        if (post.status === 'missed') needsAttention.push({ kind: 'missed', text: `Missed schedule: ${p.clip.title}`, projectId: p.id })
      }
    }
  }
  for (const a of accounts) if (a.status === 'expired') needsAttention.push({ kind: 'expired', text: `${a.name}: login expired, reconnect in Settings` })

  const takingOff = posts
    .filter((p) => now - new Date(p.published_at).getTime() < 48 * 36e5)
    .map((p) => {
      const hours = Math.max(1, (now - new Date(p.published_at).getTime()) / 36e5)
      const l = life(p)
      return { p, perHour: l.views / hours }
    })
    .filter((x) => x.perHour >= 250)
    .sort((a, b) => b.perHour - a.perHour)
    .slice(0, 3)
    .map(({ p }) => {
      const l = life(p)
      return {
        postId: p.post_id,
        projectId: p.project_id,
        variantId: p.variant_id,
        platform: p.platform,
        accountName: accounts.find((x) => x.id === p.account_id)?.name ?? '',
        title: p.title,
        thumbnail: p.thumb ?? undefined,
        url: p.url ?? undefined,
        ...l,
        engagementRate: l.views ? (l.likes + l.comments + l.shares) / l.views : 0,
        publishedAt: p.published_at
      }
    })

  const streaks = accounts.map((a) => {
    const mine = projects.flatMap((p) => p.variants.flatMap((v) => v.posts.filter((x) => x.accountId === a.id)))
    const done = mine.filter((x) => x.publishedAt && (x.status === 'published' || x.status === 'manual')).map((x) => x.publishedAt!).sort()
    const upcoming = mine.filter((x) => x.status === 'scheduled' && x.scheduledAt).map((x) => x.scheduledAt!).sort()
    return {
      accountName: a.name,
      lastPostAt: done[done.length - 1],
      postsLast7d: done.filter((d) => now - new Date(d).getTime() < 7 * 864e5).length,
      nextScheduledAt: upcoming[0]
    }
  })

  return { bestSources, recipes, heatmap, funnel, needsAttention, takingOff, streaks }
}
