import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CircleAlert, Download, Flame, RefreshCw, TrendingUp } from 'lucide-react'
import type { Account, Insights, Period, StatsOverview } from '@shared/types'
import { api, useLoad } from '@/lib/api'
import { attempt, navigate, toast } from '@/lib/store'
import { ago, compact, cx, dateTime } from '@/lib/format'
import { Badge, Button, Empty, Segmented, Spinner } from '@/ui'
import { Attribution, MediaCard, PlatformDot, StatTile, useBackground } from '@/components/common'

const PERIODS: { value: Period; label: string }[] = [
  { value: '7d', label: 'Week' },
  { value: '28d', label: 'Month' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'Max' }
]

export function Dashboard({ accountId }: { accountId?: string }) {
  const bg = useBackground('dashboard')
  const [period, setPeriod] = useState<Period>('28d')
  const [refreshing, setRefreshing] = useState(false)
  const { data: accounts } = useLoad<Account[]>(() => api.accounts())
  const { data, loading, reload } = useLoad<StatsOverview>(() => api.statsOverview(period, accountId), [period, accountId])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    await attempt(() => api.collectStats())
    reload()
    setRefreshing(false)
  }
  const spark = (k: 'youtube' | 'instagram' | 'all'): number[] => (data?.series ?? []).map((d) => (k === 'all' ? d.youtube + d.instagram : d[k]))

  return (
    <div className="relative h-full overflow-hidden">
      {/* blurred, darkened Unsplash backdrop */}
      <div className="absolute inset-0" aria-hidden style={{ backgroundColor: bg?.color ?? '#0d1c1e' }}>
        {bg && <img src={bg.url} alt="" className="h-full w-full scale-110 object-cover blur-2xl" />}
        <div className="absolute inset-0 bg-bg/70" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_70%_0%,rgba(95,227,192,.10),transparent_70%)]" />
      </div>

      <div className="relative h-full overflow-y-auto">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-8 py-7">
          <header className="flex flex-wrap items-center gap-4">
            <h1 className="font-display text-[28px] font-normal">{accountId ? (accounts?.find((a) => a.id === accountId)?.name ?? 'Account') : 'Dashboard'}</h1>
            <div className="flex flex-wrap gap-1.5">
              <AccountChip active={!accountId} label="All accounts" onClick={() => navigate({ name: 'dashboard' })} />
              {accounts
                ?.filter((a) => a.platform !== 'tiktok')
                .map((a) => (
                  <AccountChip key={a.id} active={accountId === a.id} label={a.name} platform={a.platform as 'youtube' | 'instagram'} onClick={() => navigate({ name: 'dashboard', accountId: a.id })} />
                ))}
            </div>
            <div className="flex-1" />
            <Segmented label="Period" value={period} onChange={setPeriod} items={PERIODS} />
            <Button size="sm" variant="ghost" icon={<RefreshCw size={15} className={refreshing ? 'spin' : ''} />} onClick={() => void refresh()}>
              {data?.lastCollectedAt ? `Updated ${ago(data.lastCollectedAt)}` : 'Refresh'}
            </Button>
            <Button size="sm" variant="ghost" icon={<Download size={15} />} onClick={() => void attempt(() => api.exportCsv('posts', period)).then((r) => r?.ok && toast('success', 'CSV saved'))}>
              CSV
            </Button>
          </header>

          {loading && !data ? (
            <Spinner />
          ) : !data ? null : !accounts?.some((a) => a.platform !== 'tiktok') ? (
            <div className="glass rounded-[24px]">
              <Empty
                icon={<TrendingUp size={22} />}
                title="Statistics appear once you publish"
                body="Connect YouTube or Instagram and publish a short. Clipify collects views, likes, comments and shares every hour."
                action={
                  <Button variant="primary" onClick={() => navigate({ name: 'settings', section: 'accounts' })}>
                    Connect accounts
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-6 gap-3">
                <StatTile label="Views" value={data.totals.views} now={data.totals.views} before={data.previous.views} spark={spark('all')} />
                <StatTile label="Likes" value={data.totals.likes} now={data.totals.likes} before={data.previous.likes} />
                <StatTile label="Comments" value={data.totals.comments} now={data.totals.comments} before={data.previous.comments} />
                <StatTile label="Shares" value={data.totals.shares} now={data.totals.shares} before={data.previous.shares} />
                <StatTile label="Followers gained" value={data.totals.followersGained} now={data.totals.followersGained} before={data.previous.followersGained} />
                <StatTile label="Posts published" value={data.totals.posts} now={data.totals.posts} before={data.previous.posts} />
              </div>

              <div className="grid grid-cols-[1fr_340px] gap-4">
                <ViewsChart data={data} />
                <TodayPanel insights={data.insights} />
              </div>

              <section>
                <h2 className="mb-3 font-display text-[20px] font-medium">Top videos</h2>
                {data.topPosts.length === 0 ? (
                  <p className="text-text-3">No published posts in this period yet.</p>
                ) : (
                  <div className="grid grid-cols-6 gap-4">
                    {data.topPosts.slice(0, 6).map((p) => (
                      <MediaCard
                        key={p.postId}
                        media={p.thumbnail}
                        title={p.title}
                        subtitle={
                          <span className="num flex items-center gap-2">
                            <PlatformDot platform={p.platform} /> {compact(p.views)} views · {(p.engagementRate * 100).toFixed(1)}%
                          </span>
                        }
                        onClick={() => navigate({ name: 'project', id: p.projectId, step: 'publish' })}
                      />
                    ))}
                  </div>
                )}
              </section>

              <div className="grid grid-cols-3 gap-4">
                <InsightCard title="Best channels and categories">
                  <RankList rows={data.insights.bestSources.map((s) => ({ label: s.name, sub: `${s.kind} · ${s.posts} posts`, value: s.avgViews }))} unit="avg views" />
                </InsightCard>
                <InsightCard title="Which style wins">
                  <RankList rows={data.insights.recipes.map((r) => ({ label: r.name, sub: `${r.posts} posts · ${(r.engagementRate * 100).toFixed(1)}% engagement`, value: r.avgViews }))} unit="avg views" />
                </InsightCard>
                <InsightCard title="Funnel">
                  <Funnel f={data.insights.funnel} />
                </InsightCard>
                <InsightCard title="Best time to post" wide>
                  <Heatmap cells={data.insights.heatmap} />
                </InsightCard>
                <InsightCard title="Posting consistency">
                  <ul className="flex flex-col gap-3">
                    {data.insights.streaks.length === 0 && <li className="text-text-3">No accounts yet.</li>}
                    {data.insights.streaks.map((s) => (
                      <li key={s.accountName} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate">{s.accountName}</span>
                          <span className="block text-[13px] text-text-3">{s.lastPostAt ? `Last post ${ago(s.lastPostAt)}` : 'Nothing posted yet'}{s.nextScheduledAt ? ` · next ${dateTime(s.nextScheduledAt)}` : ''}</span>
                        </span>
                        <Badge tone={s.postsLast7d >= 5 ? 'success' : s.postsLast7d ? 'neutral' : 'warning'}>{s.postsLast7d} this week</Badge>
                      </li>
                    ))}
                  </ul>
                </InsightCard>
              </div>
            </>
          )}
          {bg && (
            <div className="pb-2">
              <Attribution bg={bg} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AccountChip({ active, label, platform, onClick }: { active: boolean; label: string; platform?: 'youtube' | 'instagram'; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={cx('flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors', active ? 'border-accent/50 bg-accent/12 text-text' : 'border-line bg-bg/40 text-text-2 hover:border-line-strong')}>
      {platform && <PlatformDot platform={platform} />}
      <span className="max-w-[160px] truncate">{label}</span>
    </button>
  )
}

function ViewsChart({ data }: { data: StatsOverview }) {
  const rows = data.series.map((d) => ({ ...d, label: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }))
  return (
    <section className="glass rounded-[24px] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[20px] font-medium">Views per day</h2>
        <div className="flex items-center gap-4 text-[13px]">
          <PlatformDot platform="youtube" withLabel />
          <PlatformDot platform="instagram" withLabel />
        </div>
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <defs>
              {(['youtube', 'instagram'] as const).map((k) => (
                <linearGradient key={k} id={`fill-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={`var(--color-${k})`} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={`var(--color-${k})`} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#7F8F8D', fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tick={{ fill: '#7F8F8D', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => compact(v)} width={48} />
            <Tooltip
              contentStyle={{ background: 'rgba(18,28,31,.95)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 12, color: '#EDF3F2' }}
              labelStyle={{ color: '#A9B7B5' }}
              formatter={(v, name) => [compact(Number(v)), name === 'youtube' ? 'YouTube' : 'Instagram']}
            />
            <Area type="monotone" dataKey="youtube" stroke="var(--color-youtube)" strokeWidth={2} fill="url(#fill-youtube)" />
            <Area type="monotone" dataKey="instagram" stroke="var(--color-instagram)" strokeWidth={2} fill="url(#fill-instagram)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

function TodayPanel({ insights }: { insights: Insights }) {
  return (
    <aside className="glass flex flex-col gap-5 rounded-[24px] p-5">
      <div>
        <h2 className="mb-3 flex items-center gap-2 font-display text-[18px] font-medium">
          <Flame size={18} className="text-warning" /> Taking off
        </h2>
        {insights.takingOff.length === 0 ? (
          <p className="text-[13px] text-text-3">Posts gaining 250+ views an hour in their first two days show up here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {insights.takingOff.map((p) => (
              <li key={p.postId}>
                <button onClick={() => navigate({ name: 'project', id: p.projectId, step: 'publish' })} className="flex w-full items-center justify-between gap-2 rounded-[10px] p-2 text-left hover:bg-raised">
                  <span className="min-w-0 truncate text-sm">{p.title}</span>
                  <span className="num shrink-0 text-[13px] text-success">{compact(p.views)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="h-px bg-line" />
      <div>
        <h2 className="mb-3 font-display text-[18px] font-medium">Needs attention</h2>
        {insights.needsAttention.length === 0 ? (
          <p className="text-[13px] text-text-3">All good.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {insights.needsAttention.slice(0, 6).map((n, i) => (
              <li key={i}>
                <button onClick={() => (n.projectId ? navigate({ name: 'project', id: n.projectId, step: 'publish' }) : navigate({ name: 'settings', section: 'accounts' }))} className="flex w-full items-start gap-2 rounded-[10px] p-2 text-left text-[13px] hover:bg-raised">
                  <CircleAlert size={15} className="mt-0.5 shrink-0 text-danger" />
                  <span className="text-text-2">{n.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

function InsightCard({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={cx('glass rounded-[20px] p-5', wide && 'col-span-2')}>
      <h2 className="mb-4 font-display text-[17px] font-medium">{title}</h2>
      {children}
    </section>
  )
}

function RankList({ rows, unit }: { rows: { label: string; sub: string; value: number }[]; unit: string }) {
  if (!rows.length) return <p className="text-[13px] text-text-3">Publish a few posts to compare.</p>
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <ul className="flex flex-col gap-3">
      {rows.slice(0, 6).map((r) => (
        <li key={r.label + r.sub}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="num shrink-0 text-text-2">
              {compact(r.value)} <span className="text-xs text-text-3">{unit}</span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <p className="mt-1 text-xs text-text-3 capitalize">{r.sub}</p>
        </li>
      ))}
    </ul>
  )
}

function Funnel({ f }: { f: Insights['funnel'] }) {
  const rows = [
    ['Clips picked', f.picked],
    ['Generated', f.generated],
    ['Published', f.published],
    ['Passed 10K views', f.over10k]
  ] as const
  const max = Math.max(f.picked, 1)
  return (
    <ul className="flex flex-col gap-3">
      {rows.map(([label, n]) => (
        <li key={label}>
          <div className="flex justify-between text-sm">
            <span className="text-text-2">{label}</span>
            <span className="num">{n}</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-raised">
            <div className="h-full rounded-full bg-accent/80" style={{ width: `${(n / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function Heatmap({ cells }: { cells: Insights['heatmap'] }) {
  if (!cells.length) return <p className="text-[13px] text-text-3">Appears after a few posts at different times.</p>
  const max = Math.max(...cells.map((c) => c.avgViews), 1)
  const at = (d: number, h: number): Insights['heatmap'][number] | undefined => cells.find((c) => c.day === d && c.hour === h)
  return (
    <div className="flex flex-col gap-1" role="table" aria-label="Average views by posting day and hour">
      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
        <div key={d} className="flex items-center gap-1" role="row">
          <span className="w-9 text-xs text-text-3" role="rowheader">
            {DAYS[d]}
          </span>
          {Array.from({ length: 24 }, (_, h) => {
            const c = at(d, h)
            return (
              <span
                key={h}
                role="cell"
                title={c ? `${DAYS[d]} ${h}:00 · ${c.posts} posts · ${compact(c.avgViews)} avg views` : `${DAYS[d]} ${h}:00 · no posts`}
                className="h-4 flex-1 rounded-[3px]"
                style={{ background: c ? `rgba(95,227,192,${0.15 + (c.avgViews / max) * 0.85})` : 'rgba(255,255,255,.04)' }}
              />
            )
          })}
        </div>
      ))}
      <div className="flex justify-between pl-10 text-[11px] text-text-3">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  )
}
