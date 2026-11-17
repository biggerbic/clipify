import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Check, CircleAlert, Clock, Eye, Film, Loader2, Minus } from 'lucide-react'
import type { Background, Platform, PostStatus, ProjectStatus } from '@shared/types'
import { api } from '@/lib/api'
import { compact, cx, duration } from '@/lib/format'
import { Badge, type Tone } from '@/ui'

export const PLATFORM_LABEL: Record<Platform, string> = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok' }
const PLATFORM_COLOR: Record<Platform, string> = { youtube: 'bg-youtube', instagram: 'bg-instagram', tiktok: 'bg-tiktok' }

export function PlatformDot({ platform, withLabel }: { platform: Platform; withLabel?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-text-2">
      <span className={cx('h-2 w-2 rounded-full', PLATFORM_COLOR[platform])} aria-hidden />
      {withLabel ? PLATFORM_LABEL[platform] : <span className="sr-only">{PLATFORM_LABEL[platform]}</span>}
    </span>
  )
}

const PROJECT_STATUS: Record<ProjectStatus, { tone: Tone; label: string; icon: ReactNode }> = {
  generating: { tone: 'info', label: 'Generating', icon: <Loader2 size={12} className="spin" /> },
  review: { tone: 'accent', label: 'Review', icon: <Eye size={12} /> },
  ready: { tone: 'accent', label: 'Ready', icon: <Check size={12} /> },
  scheduled: { tone: 'warning', label: 'Scheduled', icon: <Clock size={12} /> },
  published: { tone: 'success', label: 'Published', icon: <Check size={12} /> },
  failed: { tone: 'danger', label: 'Failed', icon: <CircleAlert size={12} /> }
}
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const s = PROJECT_STATUS[status]
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  )
}

const POST_STATUS: Record<PostStatus, { tone: Tone; label: string }> = {
  queued: { tone: 'info', label: 'Queued' },
  uploading: { tone: 'info', label: 'Uploading' },
  scheduled: { tone: 'warning', label: 'Scheduled' },
  published: { tone: 'success', label: 'Published' },
  failed: { tone: 'danger', label: 'Failed' },
  missed: { tone: 'danger', label: 'Missed' },
  manual: { tone: 'success', label: 'Posted manually' }
}
export function PostStatusBadge({ status }: { status: PostStatus }) {
  const s = POST_STATUS[status]
  return (
    <Badge tone={s.tone} icon={status === 'uploading' ? <Loader2 size={12} className="spin" /> : undefined}>
      {s.label}
    </Badge>
  )
}

/** First frame of a local video as a poster (no autoplay). */
export function VideoThumb({ src, className }: { src?: string; className?: string }) {
  if (!src)
    return (
      <div className={cx('grid place-items-center bg-raised text-text-3', className)}>
        <Film size={22} aria-hidden />
      </div>
    )
  return <video src={`${src}#t=0.5`} preload="metadata" muted playsInline className={cx('bg-raised object-cover', className)} aria-hidden />
}

/** 9:16 card: title and avatar on a bottom scrim, status top-left, duration top-right. */
export function MediaCard({
  media,
  image,
  title,
  subtitle,
  topLeft,
  topRight,
  onClick,
  active,
  className
}: {
  media?: string
  image?: string
  title: string
  subtitle?: ReactNode
  topLeft?: ReactNode
  topRight?: ReactNode
  onClick?: () => void
  active?: boolean
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cx('lift group relative aspect-[9/16] w-full overflow-hidden rounded-[16px] border border-line bg-raised text-left', active && 'border-accent ring-1 ring-accent', className)}
    >
      {image ? <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : <VideoThumb src={media} className="absolute inset-0 h-full w-full" />}
      <div className="scrim-bottom absolute inset-0" />
      {topLeft && <div className="absolute top-3 left-3">{topLeft}</div>}
      {topRight && <div className="absolute top-3 right-3">{topRight}</div>}
      <div className="absolute inset-x-0 bottom-0 p-3.5">
        <p className="line-clamp-2 text-[15px] leading-snug font-medium text-text">{title}</p>
        {subtitle && <div className="mt-1.5 text-[13px] text-text-2">{subtitle}</div>}
      </div>
    </button>
  )
}

export function DurationPill({ seconds }: { seconds: number }) {
  return <span className="num rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-text">{duration(seconds)}</span>
}

export function Delta({ now, before }: { now: number; before: number }) {
  if (!before && !now) return <span className="text-text-3">–</span>
  if (!before) return <span className="text-[13px] text-success">new</span>
  const pct = ((now - before) / before) * 100
  const up = pct >= 0.5
  const down = pct <= -0.5
  return (
    <span className={cx('num inline-flex items-center gap-0.5 text-[13px]', up ? 'text-success' : down ? 'text-danger' : 'text-text-3')}>
      {up ? <ArrowUpRight size={14} /> : down ? <ArrowDownRight size={14} /> : <Minus size={14} />}
      {Math.abs(pct).toFixed(pct > -10 && pct < 10 ? 1 : 0)}%
    </span>
  )
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return <div className={className} />
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - (v / max) * 28}`).join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function StatTile({ label, value, now, before, spark }: { label: string; value: number; now: number; before: number; spark?: number[] }) {
  return (
    <div className="glass flex min-w-0 flex-col gap-2 rounded-[16px] p-4">
      <span className="label">{label}</span>
      <div className="flex items-end justify-between gap-2">
        <span className="num font-display text-[34px] leading-none font-light tracking-tight">{compact(value)}</span>
        <Delta now={now} before={before} />
      </div>
      {spark && <Sparkline values={spark} className="h-7 w-full" />}
    </div>
  )
}

/** Unsplash photo behind Home/Dashboard, with the attribution Unsplash requires. */
export function useBackground(screen: 'home' | 'dashboard'): Background | null {
  const [bg, setBg] = useState<Background | null>(null)
  useEffect(() => {
    void api.background(screen).then(setBg).catch(() => setBg(null))
  }, [screen])
  return bg
}

export function Attribution({ bg }: { bg: Background }) {
  return (
    <p className="text-xs text-text-2">
      Photo by{' '}
      <a className="underline decoration-text-3 underline-offset-2 hover:text-text" href={bg.photographerUrl} target="_blank" rel="noreferrer">
        {bg.photographer}
      </a>{' '}
      on{' '}
      <a className="underline decoration-text-3 underline-offset-2 hover:text-text" href={bg.unsplashUrl} target="_blank" rel="noreferrer">
        Unsplash
      </a>
    </p>
  )
}

export function Thumb({ src, className }: { src: string; className?: string }) {
  return <img src={src} alt="" loading="lazy" className={cx('object-cover', className)} />
}

export { compact }
