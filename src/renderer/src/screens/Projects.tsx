import { useMemo, useState } from 'react'
import { FolderOpen, Layers } from 'lucide-react'
import type { Project, ProjectStatus } from '@shared/types'
import { api, useLoad } from '@/lib/api'
import { navigate, useStore } from '@/lib/store'
import { ago, cx } from '@/lib/format'
import { Button, Empty, Spinner, Tabs } from '@/ui'
import { DurationPill, MediaCard, ProjectStatusBadge } from '@/components/common'

export function currentMedia(p: Project): string | undefined {
  const v = p.variants.find((x) => x.revisions.length) ?? p.variants[0]
  const rev = v?.revisions.find((r) => r.id === v.current) ?? v?.revisions[v.revisions.length - 1]
  return rev ? `clipify-media://${encodeURIComponent(p.id)}/${rev.file.split('\\').join('/')}` : undefined
}

type Filter = 'all' | ProjectStatus

export function Projects() {
  const version = useStore((s) => s.projectsVersion)
  const { data, loading } = useLoad(() => api.listProjects(), [version])
  const [status, setStatus] = useState<Filter>('all')
  const [group, setGroup] = useState<string | null>(null)
  const groups = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of data ?? []) for (const k of [p.clip.broadcasterName, p.clip.gameName ?? '']) if (k) m.set(k, (m.get(k) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  }, [data])
  if (loading && !data) return <div className="p-8"><Spinner /></div>
  const list = (data ?? []).filter((p) => (status === 'all' || p.status === status) && (!group || p.clip.broadcasterName === group || p.clip.gameName === group))
  const count = (s: ProjectStatus): number => (data ?? []).filter((p) => p.status === s).length

  if (!data?.length) {
    return (
      <Empty
        icon={<Layers size={22} />}
        title="No projects yet"
        body="Pick a clip in the Library to make your first set of shorts."
        action={
          <Button variant="primary" onClick={() => navigate({ name: 'library' })}>
            Open Library
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6 flex flex-wrap items-center gap-6 border-b border-line">
          <h1 className="pb-2 font-display text-[28px] font-normal">Projects</h1>
          <Tabs
            value={status}
            onChange={setStatus}
            items={[
              { value: 'all', label: 'All', count: data.length },
              { value: 'generating', label: 'Generating', count: count('generating') },
              { value: 'review', label: 'Review', count: count('review') },
              { value: 'ready', label: 'Ready', count: count('ready') },
              { value: 'scheduled', label: 'Scheduled', count: count('scheduled') },
              { value: 'published', label: 'Published', count: count('published') },
              { value: 'failed', label: 'Failed', count: count('failed') }
            ]}
          />
        </div>
        {list.length === 0 ? (
          <Empty icon={<FolderOpen size={20} />} title="Nothing here" body="No projects match this filter." />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-5">
            {list.map((p, i) => (
              <div key={p.id} className="rise" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                <MediaCard
                  media={currentMedia(p)}
                  image={currentMedia(p) ? undefined : p.clip.thumbnailUrl}
                  title={p.clip.title}
                  subtitle={
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{p.clip.broadcasterName}</span>
                      <span aria-hidden>·</span>
                      <span className="whitespace-nowrap">{p.variants.length} variants</span>
                      <span aria-hidden>·</span>
                      <span className="whitespace-nowrap">{ago(p.createdAt)}</span>
                    </span>
                  }
                  topLeft={<ProjectStatusBadge status={p.status} />}
                  topRight={<DurationPill seconds={p.clip.duration} />}
                  onClick={() => navigate({ name: 'project', id: p.id })}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      <aside className="hidden w-64 shrink-0 border-l border-line px-5 py-6 lg:block">
        <p className="label mb-3">Channels and categories</p>
        <ul className="flex flex-col gap-0.5">
          <li>
            <button onClick={() => setGroup(null)} className={cx('flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-sm', !group ? 'bg-raised text-text' : 'text-text-3 hover:text-text-2')}>
              Everything <span className="num text-text-3">{data.length}</span>
            </button>
          </li>
          {groups.map(([name, n]) => (
            <li key={name}>
              <button onClick={() => setGroup(name)} className={cx('flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-2 text-left text-sm', group === name ? 'bg-raised text-text' : 'text-text-3 hover:text-text-2')}>
                <span className="truncate">{name}</span>
                <span className="num text-text-3">{n}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
