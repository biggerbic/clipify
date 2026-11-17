import { useMemo, useState } from 'react'
import { ArrowRight, Link2 } from 'lucide-react'
import type { Project, Saved, TwitchClip } from '@shared/types'
import { api, useLoad } from '@/lib/api'
import { attempt, navigate, useStore } from '@/lib/store'
import { compact, cx, dateTime, greeting } from '@/lib/format'
import { Spinner } from '@/ui'
import { Attribution, DurationPill, MediaCard, ProjectStatusBadge, useBackground } from '@/components/common'
import { CreateProjectDialog } from './Library'
import { currentMedia } from './Projects'

export function Home() {
  const bg = useBackground('home')
  const version = useStore((s) => s.projectsVersion)
  const queue = useStore((s) => s.queue)
  const { data: projects } = useLoad<Project[]>(() => api.listProjects(), [version])
  const { data: saved } = useLoad<Saved>(() => api.saved())
  const { data: stats } = useLoad(() => api.statsOverview('7d'), [])
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [clip, setClip] = useState<TwitchClip | null>(null)

  const today = useMemo(() => {
    const posts = (projects ?? []).flatMap((p) => p.variants.flatMap((v) => v.posts.map((post) => ({ p, post }))))
    const isToday = (iso?: string): boolean => Boolean(iso) && new Date(iso!).toDateString() === new Date().toDateString()
    const upcoming = posts.filter((x) => x.post.status === 'scheduled' && x.post.scheduledAt && new Date(x.post.scheduledAt).getTime() > Date.now()).sort((a, b) => a.post.scheduledAt!.localeCompare(b.post.scheduledAt!))
    return {
      queue: queue.filter((q) => q.state === 'running' || q.state === 'queued').length,
      review: (projects ?? []).filter((p) => p.status === 'review').length,
      scheduledToday: posts.filter((x) => x.post.status === 'scheduled' && isToday(x.post.scheduledAt)).length,
      attention: posts.filter((x) => x.post.status === 'failed' || x.post.status === 'missed').length,
      next: upcoming[0]
    }
  }, [projects, queue])

  const open = async (): Promise<void> => {
    setBusy(true)
    const c = await attempt(() => api.clipFromUrl(url))
    setBusy(false)
    if (c) {
      setUrl('')
      setClip(c)
    }
  }
  const quick = [...(saved?.channels ?? []).map((c) => c.name), ...(saved?.categories ?? []).map((c) => c.name)].slice(0, 5)
  const views = stats?.totals.views ?? 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-8 py-8">
        {/* hero card: photo left, glass panel right (homepage reference) */}
        <section className="relative grid min-h-[460px] grid-cols-[1fr_380px] overflow-hidden rounded-[24px] border border-line shadow-[0_8px_32px_rgba(0,0,0,.35)]">
          <div className="absolute inset-0" style={{ backgroundColor: bg?.color ?? '#10292a' }}>
            {bg ? <img src={bg.url} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-[radial-gradient(120%_90%_at_20%_10%,#1f4a46_0%,#0d1c1e_55%,#0a1113_100%)]" />}
            <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/20 to-black/40" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          </div>

          <div className="relative flex flex-col justify-between p-10">
            <span className="font-display text-sm font-medium text-text">clipify.</span>
            <div>
              <p className="mb-3 text-text-2">{greeting()}</p>
              <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                <span className="num font-display text-[104px] leading-[0.9] font-extralight tracking-tight">{compact(views)}</span>
                <div className="pb-3">
                  <p className="font-display text-[32px] leading-tight font-light">views</p>
                  <p className="text-sm text-text-2">this week, from your Clipify posts</p>
                </div>
              </div>
              {today.next && (
                <button onClick={() => navigate({ name: 'schedule' })} className="mt-6 inline-flex items-center gap-2 text-sm text-text-2 hover:text-text">
                  Next post: <span className="text-text">{today.next.p.clip.title}</span> · {dateTime(today.next.post.scheduledAt)}
                  <ArrowRight size={15} />
                </button>
              )}
              {bg && (
                <div className="mt-6">
                  <Attribution bg={bg} />
                </div>
              )}
            </div>
          </div>

          <aside className="glass relative flex flex-col rounded-none border-0 border-l border-line">
            <form
              className="flex"
              onSubmit={(e) => {
                e.preventDefault()
                if (url) void open()
              }}
            >
              <label className="flex-1 px-7 pt-7 pb-3">
                <span className="sr-only">Paste a Twitch clip link</span>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a Twitch clip link" className="w-full border-b border-line-strong bg-transparent pb-2 text-sm text-text placeholder:text-text-3 focus:border-accent focus:outline-none" />
              </label>
              <button type="submit" disabled={!url || busy} aria-label="Open clip" className="grid h-[72px] w-[72px] place-items-center bg-accent/80 text-accent-ink transition-colors hover:bg-accent disabled:opacity-60">
                {busy ? <Spinner size={18} className="text-accent-ink" /> : <Link2 size={20} />}
              </button>
            </form>
            <ul className="flex flex-col gap-1 px-7 pt-4">
              {quick.length ? (
                quick.map((q) => (
                  <li key={q}>
                    <button onClick={() => navigate({ name: 'library' })} className="py-1.5 text-sm text-text-2 hover:text-text">
                      {q}
                    </button>
                  </li>
                ))
              ) : (
                <li className="py-1.5 text-sm text-text-3">Save channels and categories in the Library to see them here.</li>
              )}
            </ul>
            <div className="mx-7 my-5 h-px bg-line-strong" />
            <p className="px-7 pb-4 text-sm font-medium">Today</p>
            <dl className="flex flex-col gap-4 px-7 pb-7 text-sm">
              {(
                [
                  ['In the queue', today.queue, { name: 'projects' }],
                  ['Ready to review', today.review, { name: 'projects' }],
                  ['Scheduled today', today.scheduledToday, { name: 'schedule' }],
                  ['Needs attention', today.attention, { name: 'schedule' }]
                ] as const
              ).map(([label, n, route]) => (
                <button key={label} onClick={() => navigate(route)} className="flex items-center justify-between text-left">
                  <dt className="text-text-2">{label}</dt>
                  <dd className={cx('num', label === 'Needs attention' && n ? 'text-danger' : 'text-text')}>{n}</dd>
                </button>
              ))}
            </dl>
          </aside>
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-[20px] font-medium">Recent projects</h2>
            <button onClick={() => navigate({ name: 'projects' })} className="inline-flex items-center gap-1 text-sm text-text-2 hover:text-text">
              All projects <ArrowRight size={15} />
            </button>
          </div>
          {!projects ? (
            <Spinner />
          ) : projects.length === 0 ? (
            <p className="text-text-3">No projects yet. Paste a clip link above or browse the Library.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-5">
              {projects.slice(0, 6).map((p) => (
                <MediaCard
                  key={p.id}
                  media={currentMedia(p)}
                  image={currentMedia(p) ? undefined : p.clip.thumbnailUrl}
                  title={p.clip.title}
                  subtitle={p.clip.broadcasterName}
                  topLeft={<ProjectStatusBadge status={p.status} />}
                  topRight={<DurationPill seconds={p.clip.duration} />}
                  onClick={() => navigate({ name: 'project', id: p.id })}
                />
              ))}
            </div>
          )}
        </section>
      </div>
      <CreateProjectDialog clip={clip} onClose={() => setClip(null)} />
    </div>
  )
}
