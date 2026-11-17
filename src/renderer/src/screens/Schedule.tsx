import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Account, Post, Project, Variant } from '@shared/types'
import { api, useLoad } from '@/lib/api'
import { navigate, useStore } from '@/lib/store'
import { cx } from '@/lib/format'
import { Button, IconButton, Spinner } from '@/ui'
import { PlatformDot, PostStatusBadge } from '@/components/common'

interface Row {
  p: Project
  v: Variant
  post: Post
  at: Date
}

export function Schedule() {
  const version = useStore((s) => s.projectsVersion)
  const { data: projects } = useLoad<Project[]>(() => api.listProjects(), [version])
  const { data: accounts } = useLoad<Account[]>(() => api.accounts())
  const [weekOffset, setWeekOffset] = useState(0)

  const rows = useMemo<Row[]>(
    () =>
      (projects ?? []).flatMap((p) =>
        p.variants.flatMap((v) =>
          v.posts
            .map((post) => ({ p, v, post, at: new Date(post.scheduledAt ?? post.publishedAt ?? p.updatedAt) }))
            .filter((r) => !Number.isNaN(r.at.getTime()))
        )
      ),
    [projects]
  )
  if (!projects || !accounts) return <div className="p-8"><Spinner /></div>

  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + weekOffset * 7) // Monday
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 864e5))
  const attention = rows.filter((r) => r.post.status === 'failed' || r.post.status === 'missed')
  const upcoming = rows.filter((r) => r.post.status === 'scheduled' && r.at.getTime() > Date.now()).sort((a, b) => a.at.getTime() - b.at.getTime())
  const name = (id: string): string => accounts.find((a) => a.id === id)?.name ?? ''
  const open = (r: Row): void => navigate({ name: 'project', id: r.p.id, step: 'publish' })

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col px-8 py-6">
        <div className="mb-5 flex items-center gap-3">
          <h1 className="font-display text-[28px] font-normal">Schedule</h1>
          <div className="flex-1" />
          <IconButton label="Previous week" onClick={() => setWeekOffset(weekOffset - 1)}>
            <ChevronLeft size={18} />
          </IconButton>
          <span className="num w-52 text-center text-sm text-text-2">
            {days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <IconButton label="Next week" onClick={() => setWeekOffset(weekOffset + 1)}>
            <ChevronRight size={18} />
          </IconButton>
          {weekOffset !== 0 && (
            <Button size="sm" variant="ghost" onClick={() => setWeekOffset(0)}>
              This week
            </Button>
          )}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 overflow-hidden rounded-[20px] border border-line">
          {days.map((d) => {
            const isToday = d.toDateString() === new Date().toDateString()
            const items = rows.filter((r) => r.at.toDateString() === d.toDateString()).sort((a, b) => a.at.getTime() - b.at.getTime())
            return (
              <div key={d.toISOString()} className={cx('flex min-h-0 flex-col border-r border-line last:border-r-0', isToday && 'bg-accent/[0.04]')}>
                <div className="flex items-baseline gap-2 border-b border-line px-3 py-2.5">
                  <span className="label">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                  <span className={cx('num font-display text-lg', isToday ? 'text-accent' : 'text-text')}>{d.getDate()}</span>
                </div>
                <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
                  {items.map((r) => (
                    <li key={r.post.id}>
                      <button onClick={() => open(r)} className="lift w-full rounded-[10px] border border-line bg-raised p-2 text-left">
                        <span className="num flex items-center justify-between gap-1 text-xs text-text-3">
                          {r.at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          <PlatformDot platform={r.post.platform} />
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[13px] leading-snug">{r.p.clip.title}</span>
                        <span className="mt-1 block truncate text-[11px] text-text-3">{name(r.post.accountId)}</span>
                        <span className="mt-1.5 block">
                          <PostStatusBadge status={r.post.status} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
      <aside className="w-80 shrink-0 overflow-y-auto border-l border-line px-5 py-6">
        <p className="label mb-3">Needs attention</p>
        {attention.length === 0 ? (
          <p className="mb-6 text-[13px] text-text-3">No failed or missed posts.</p>
        ) : (
          <ul className="mb-6 flex flex-col gap-2">
            {attention.map((r) => (
              <li key={r.post.id}>
                <button onClick={() => open(r)} className="flex w-full flex-col gap-1 rounded-[12px] border border-danger/30 bg-danger/8 p-3 text-left">
                  <span className="flex items-center justify-between">
                    <PlatformDot platform={r.post.platform} withLabel />
                    <PostStatusBadge status={r.post.status} />
                  </span>
                  <span className="line-clamp-2 text-sm">{r.p.clip.title}</span>
                  <span className="text-xs text-text-3">{r.post.error}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="label mb-3">Upcoming</p>
        {upcoming.length === 0 ? (
          <p className="text-[13px] text-text-3">Nothing scheduled. Schedule posts from a project's Publish step.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.slice(0, 20).map((r) => (
              <li key={r.post.id}>
                <button onClick={() => open(r)} className="flex w-full items-start gap-3 rounded-[12px] p-2 text-left hover:bg-raised">
                  <span className="num w-14 shrink-0 text-xs text-text-3">
                    {r.at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    <br />
                    {r.at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-sm">{r.p.clip.title}</span>
                    <span className="flex items-center gap-1.5 text-xs text-text-3">
                      <PlatformDot platform={r.post.platform} /> {name(r.post.accountId)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  )
}
