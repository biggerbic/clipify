import { useEffect, useState } from 'react'
import { ChevronRight, CircleAlert, ExternalLink, Eye, RotateCcw, Trash2 } from 'lucide-react'
import type { Project, Variant } from '@shared/types'
import { api } from '@/lib/api'
import { attempt, navigate, useStore } from '@/lib/store'
import { ago, compact, cx, duration } from '@/lib/format'
import { Badge, Button, Spinner } from '@/ui'
import { ProjectStatusBadge, VideoThumb } from '@/components/common'
import { Review } from './Review'
import { Publish } from './Publish'

type Step = 'source' | 'generate' | 'review' | 'publish'
const STEPS: { id: Step; label: string }[] = [
  { id: 'source', label: 'Source' },
  { id: 'generate', label: 'Generate' },
  { id: 'review', label: 'Review' },
  { id: 'publish', label: 'Publish' }
]

export const variantMedia = (p: Project, v: Variant): string | undefined => {
  const rev = v.revisions.find((r) => r.id === v.current) ?? v.revisions[v.revisions.length - 1]
  return rev ? `clipify-media://${encodeURIComponent(p.id)}/${rev.file.split('\\').join('/')}` : undefined
}

function defaultStep(p: Project): Step {
  if (p.status === 'generating' || p.status === 'failed') return 'generate'
  if (p.status === 'scheduled' || p.status === 'published') return 'publish'
  return 'review'
}

export function ProjectScreen({ id, step, variantId }: { id: string; step?: Step | 'generate' | 'review' | 'publish'; variantId?: string }) {
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const last = useStore((s) => s.lastProject)
  useEffect(() => {
    api.getProject(id).then(setProject, (e: Error) => setError(e.message))
  }, [id])
  useEffect(() => {
    if (last?.id === id) setProject(last)
  }, [last, id])

  if (error) return <div className="p-8 text-danger">{error}</div>
  if (!project) return <div className="p-8"><Spinner /></div>
  const active: Step = (step as Step) ?? defaultStep(project)
  const go = (s: Step): void => navigate({ name: 'project', id, step: s === 'source' ? undefined : s, variantId })
  const canReview = project.variants.some((v) => v.status === 'ready')

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-4 border-b border-line px-8 py-3">
        <nav className="flex min-w-0 items-center gap-1.5 text-sm" aria-label="Breadcrumb">
          <button onClick={() => navigate({ name: 'projects' })} className="text-text-3 hover:text-text">
            Projects
          </button>
          <ChevronRight size={14} className="text-text-3" aria-hidden />
          <span className="max-w-[360px] truncate text-text">{project.clip.title}</span>
        </nav>
        <ProjectStatusBadge status={project.status} />
        <div className="flex-1" />
        <ol className="flex items-center gap-1" aria-label="Project steps">
          {STEPS.map((s, i) => {
            const disabled = (s.id === 'review' || s.id === 'publish') && !canReview
            return (
              <li key={s.id} className="flex items-center gap-1">
                {i > 0 && <span className="h-px w-5 bg-line-strong" aria-hidden />}
                <button
                  disabled={disabled}
                  onClick={() => go(s.id)}
                  aria-current={active === s.id ? 'step' : undefined}
                  className={cx('flex h-8 items-center gap-2 rounded-full px-3 text-[13px] transition-colors disabled:opacity-40', active === s.id ? 'bg-accent/12 text-accent' : 'text-text-3 hover:text-text-2')}
                >
                  <span className={cx('num grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold', active === s.id ? 'bg-accent text-accent-ink' : 'bg-raised-2 text-text-2')}>{i + 1}</span>
                  {s.label}
                </button>
              </li>
            )
          })}
        </ol>
        <div className="flex-1" />
        {project.status === 'failed' && (
          <Button size="sm" icon={<RotateCcw size={15} />} onClick={() => void attempt(() => api.retryProject(id))}>
            Retry
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 size={15} />}
          onClick={() => {
            if (confirm('Delete this project and its videos from this computer? Published posts stay online.')) void api.deleteProject(id).then(() => navigate({ name: 'projects' }))
          }}
        >
          Delete
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {active === 'source' && <SourceStep project={project} />}
        {active === 'generate' && <GenerateStep project={project} onOpen={(v) => navigate({ name: 'project', id, step: 'review', variantId: v })} />}
        {active === 'review' && <Review project={project} variantId={variantId} onProject={setProject} />}
        {active === 'publish' && <Publish project={project} onProject={setProject} />}
      </div>
    </div>
  )
}

function SourceStep({ project }: { project: Project }) {
  const c = project.clip
  return (
    <div className="mx-auto grid max-w-5xl grid-cols-[1.4fr_1fr] gap-8 px-8 py-8">
      <img src={c.thumbnailUrl} alt="" className="aspect-video w-full rounded-[16px] border border-line object-cover" />
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-2xl leading-snug">{c.title}</h1>
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-text-3">Streamer</dt>
          <dd>{c.broadcasterName}</dd>
          <dt className="text-text-3">Category</dt>
          <dd>{c.gameName ?? '–'}</dd>
          <dt className="text-text-3">Views on Twitch</dt>
          <dd className="num">{compact(c.viewCount)}</dd>
          <dt className="text-text-3">Length</dt>
          <dd className="num">{duration(c.duration)}</dd>
          <dt className="text-text-3">Clipped by</dt>
          <dd>{c.creatorName}</dd>
          <dt className="text-text-3">Created</dt>
          <dd>{ago(c.createdAt)}</dd>
        </dl>
        <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
          Open on Twitch <ExternalLink size={14} />
        </a>
      </div>
    </div>
  )
}

/** Variants as tall numbered columns (finished-loading reference). */
function GenerateStep({ project, onOpen }: { project: Project; onOpen: (variantId: string) => void }) {
  const queue = useStore((s) => s.queue)
  const item = queue.find((q) => q.projectId === project.id)
  return (
    <div className="flex h-full flex-col px-8 py-6">
      <div className="mb-5 flex items-center gap-3">
        <h2 className="font-display text-[22px]">{project.status === 'generating' ? 'Making your shorts' : 'Variants'}</h2>
        {project.status === 'generating' && (
          <span className="flex min-w-0 items-center gap-2 text-sm text-text-3">
            <Spinner size={15} />
            <span className="truncate">{item?.state === 'queued' ? 'Waiting in the queue' : (item?.progress ?? 'Working')}</span>
          </span>
        )}
      </div>
      {project.engine.error && (
        <div className="mb-5 flex items-start gap-3 rounded-[14px] border border-danger/30 bg-danger/8 p-4 text-sm">
          <CircleAlert size={18} className="mt-0.5 shrink-0 text-danger" />
          <div className="flex-1">
            <p className="text-text">{project.engine.error}</p>
            <p className="mt-1 text-text-3">The engine log in Settings → Engine has details.</p>
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-0 overflow-x-auto border-y border-line">
        {project.variants.map((v) => {
          const media = variantMedia(project, v)
          return (
            <div key={v.id} className="flex min-w-[240px] flex-1 flex-col border-r border-line last:border-r-0">
              <div className="flex h-12 items-center justify-end px-4">
                <span className="num font-display text-sm text-text-3">{String(v.index).padStart(2, '0')}</span>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-3">
                <button
                  disabled={v.status !== 'ready'}
                  onClick={() => onOpen(v.id)}
                  className={cx('lift relative aspect-[9/16] max-h-full w-full max-w-[260px] overflow-hidden rounded-[14px] border border-line bg-raised', v.status !== 'ready' && 'cursor-default')}
                  aria-label={`Open variant ${v.index}`}
                >
                  {v.status === 'ready' && media ? (
                    <HoverVideo src={media} />
                  ) : v.status === 'failed' ? (
                    <div className="grid h-full place-items-center p-4 text-center text-[13px] text-danger">{v.error ?? 'Failed'}</div>
                  ) : (
                    <div className="skeleton grid h-full place-items-center">{v.status === 'rendering' && <Spinner />}</div>
                  )}
                </button>
              </div>
              <div className="flex h-16 items-center justify-between gap-2 border-t border-line px-5">
                <div className="min-w-0">
                  <p className="truncate text-sm">{v.recipeName}</p>
                  <p className="truncate text-[13px] text-text-3">{v.hookText || '—'}</p>
                </div>
                {v.status === 'ready' && (
                  <Badge tone="accent" icon={<Eye size={12} />}>
                    Review
                  </Badge>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HoverVideo({ src }: { src: string }) {
  return (
    <video
      src={src}
      muted
      loop
      playsInline
      preload="metadata"
      className="absolute inset-0 h-full w-full object-cover"
      onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
      onMouseLeave={(e) => e.currentTarget.pause()}
    />
  )
}

export { VideoThumb }
