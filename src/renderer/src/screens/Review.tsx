import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Captions, Crop, FileText, Pause, Play, Redo2, Scissors, Sparkles, Trash2, Type, Undo2, Wand2 } from 'lucide-react'
import type { CaptionWord, Edl, Scene } from '@shared/api'
import { CAPTION_PRESETS, type CaptionStyle, type Descriptions, type HookStyle, type Project, type Variant } from '@shared/types'
import { api } from '@/lib/api'
import { attempt, navigate, toast } from '@/lib/store'
import { cx, timecode } from '@/lib/format'
import { Badge, Button, Field, Input, Segmented, Select, Spinner, Switch, Textarea } from '@/ui'
import { variantMedia } from './Project'

type Tab = 'captions' | 'hook' | 'frame' | 'description'
const OP_LABEL = { generate: 'Generated', trim: 'Trim', frame: 'Frame', captions: 'Captions', hook: 'Hook' } as const

export function Review({ project, variantId, onProject }: { project: Project; variantId?: string; onProject: (p: Project) => void }) {
  const ready = project.variants.filter((v) => v.revisions.length)
  const v = project.variants.find((x) => x.id === variantId && x.revisions.length) ?? ready[0]
  const [tab, setTab] = useState<Tab>('captions')
  const [busy, setBusy] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)
  const [length, setLength] = useState(0)
  const [playing, setPlaying] = useState(false)
  const media = v ? variantMedia(project, v) : undefined

  /** Run an edit that re-renders; the engine can take a while, so the player shows progress. */
  const run = useCallback(
    async (label: string, fn: () => Promise<Project>, done: string) => {
      setBusy(label)
      const p = await attempt(fn, done)
      if (p) onProject(p)
      setBusy(null)
    },
    [onProject]
  )

  if (!v) return <div className="p-8 text-text-3">No rendered variant yet.</div>
  const seek = (t: number): void => {
    if (video.current) video.current.currentTime = Math.max(0, Math.min(length || 0, t))
  }

  return (
    <div className="grid h-full grid-cols-[260px_1fr_380px] grid-rows-[1fr_auto]">
      {/* left: variants + transcript */}
      <aside className="row-span-1 flex min-h-0 flex-col border-r border-line">
        <div className="p-4">
          <p className="label mb-2">Variants</p>
          <ul className="flex flex-col gap-1.5">
            {project.variants.map((x) => (
              <li key={x.id}>
                <button
                  disabled={!x.revisions.length}
                  onClick={() => navigate({ name: 'project', id: project.id, step: 'review', variantId: x.id })}
                  className={cx('flex w-full items-center gap-3 rounded-[12px] p-2 text-left transition-colors disabled:opacity-40', x.id === v.id ? 'bg-raised ring-1 ring-accent/50' : 'hover:bg-raised/60')}
                >
                  <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-raised-2 text-xs">{String(x.index).padStart(2, '0')}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{x.recipeName}</span>
                    <span className="block truncate text-xs text-text-3">{x.hookText || 'No hook'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line p-4">
          <p className="label mb-2">What's said</p>
          <p className="text-[13px] leading-relaxed text-text-2 select-text">{project.meta?.transcript || 'No speech detected.'}</p>
        </div>
      </aside>

      {/* center: player */}
      <section className="relative flex min-h-0 flex-col items-center justify-center gap-3 p-5">
        <div className="relative aspect-[9/16] h-full max-h-[calc(100%-44px)] overflow-hidden rounded-[18px] border border-line bg-black shadow-[0_8px_32px_rgba(0,0,0,.35)]">
          {media && (
            <video
              key={media}
              ref={video}
              src={media}
              className="h-full w-full object-contain"
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onClick={(e) => (e.currentTarget.paused ? void e.currentTarget.play() : e.currentTarget.pause())}
              playsInline
            />
          )}
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 text-center">
                <Spinner size={22} />
                <p className="text-sm">{busy}…</p>
                <p className="max-w-[220px] text-xs text-text-3">The engine is re-rendering. This takes a few seconds to a minute.</p>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5" aria-label="Revisions">
          {v.revisions.map((r) => (
            <button
              key={r.id}
              onClick={() => void run('Switching revision', () => api.setRevision(project.id, v.id, r.id), '')}
              title={`${OP_LABEL[r.op]} · ${new Date(r.createdAt).toLocaleTimeString()}`}
              className={cx('h-7 rounded-full border px-2.5 text-xs transition-colors', r.id === v.current ? 'border-accent bg-accent/12 text-accent' : 'border-line text-text-3 hover:text-text-2')}
            >
              {r.id} · {OP_LABEL[r.op]}
            </button>
          ))}
        </div>
      </section>

      {/* right: inspector */}
      <aside className="flex min-h-0 flex-col border-l border-line">
        <div role="tablist" className="grid shrink-0 grid-cols-4 border-b border-line">
          {(
            [
              ['captions', 'Captions', <Captions size={16} key="c" />],
              ['hook', 'Hook', <Type size={16} key="h" />],
              ['frame', 'Frame', <Crop size={16} key="f" />],
              ['description', 'Text', <FileText size={16} key="d" />]
            ] as const
          ).map(([id, label, icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('relative flex h-12 flex-col items-center justify-center gap-0.5 text-xs', tab === id ? 'text-text' : 'text-text-3 hover:text-text-2')}>
              {icon}
              {label}
              <span className={cx('absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-accent', tab === id ? 'opacity-100' : 'opacity-0')} />
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === 'captions' && <CaptionsPanel key={v.id} project={project} v={v} busy={Boolean(busy)} onApply={(style, words) => void run('Burning captions', () => api.setCaptions(project.id, v.id, style, words), 'Captions updated')} />}
          {tab === 'hook' && <HookPanel key={v.id} v={v} busy={Boolean(busy)} onApply={(text, style) => void run('Burning hook', () => api.setHook(project.id, v.id, text, style), 'Hook updated')} />}
          {tab === 'frame' && <FramePanel project={project} busy={Boolean(busy)} onApply={(o) => void run('Reframing all variants', () => api.reframe(project.id, v.id, o), 'Framing updated on every variant')} />}
          {tab === 'description' && <DescriptionPanel key={v.id} project={project} v={v} onProject={onProject} />}
        </div>
      </aside>

      {/* bottom: timeline */}
      <div className="col-span-3 border-t border-line">
        <Timeline
          project={project}
          v={v}
          time={time}
          length={length}
          playing={playing}
          busy={Boolean(busy)}
          onSeek={seek}
          onToggle={() => (video.current?.paused ? void video.current.play() : video.current?.pause())}
          onTrim={(segments) => void run('Cutting all variants', () => api.trim(project.id, v.id, segments), 'New cut applied to every variant')}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- timeline
function Timeline({ project, v, time, length, playing, busy, onSeek, onToggle, onTrim }: { project: Project; v: Variant; time: number; length: number; playing: boolean; busy: boolean; onSeek: (t: number) => void; onToggle: () => void; onTrim: (s: { start: number; end: number }[]) => void }) {
  const [strip, setStrip] = useState<{ thumbs: string[]; peaks: number[] }>({ thumbs: [], peaks: [] })
  const [edl, setEdl] = useState<Edl | null>(null)
  const [segs, setSegs] = useState<{ start: number; end: number }[]>([])
  const [past, setPast] = useState<{ start: number; end: number }[][]>([])
  const [future, setFuture] = useState<{ start: number; end: number }[][]>([])
  const [words, setWords] = useState<CaptionWord[]>([])
  const track = useRef<HTMLDivElement>(null)
  const cutTrack = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.timelineStrip(project.id, v.id).then(setStrip).catch(() => undefined)
    void api.captionWords(project.id, v.id).then(setWords).catch(() => setWords([]))
  }, [project.id, v.id, v.current])
  useEffect(() => {
    void api
      .edl(project.id, v.id)
      .then((e) => {
        setEdl(e)
        setSegs(e.segments)
        setPast([])
        setFuture([])
      })
      .catch(() => setEdl(null))
  }, [project.id, v.id, project.engine.baseFile])

  const total = Math.max(length, 0.01)
  const commit = (next: { start: number; end: number }[]): void => {
    setPast((p) => [...p, segs])
    setFuture([])
    setSegs(next)
  }
  const changed = edl && JSON.stringify(edl.segments) !== JSON.stringify(segs)
  const src = edl?.sourceDuration || project.clip.duration || 1
  const snap = (t: number): number => {
    if (!edl) return t
    let best = t
    let dist = 0.35
    for (const w of edl.words) {
      for (const edge of [w.s, w.e]) if (Math.abs(edge - t) < dist) (dist = Math.abs(edge - t)), (best = edge)
    }
    return Math.round(best * 1000) / 1000
  }
  const dragEdge = (i: number, edge: 'start' | 'end') => (e: RPointerEvent) => {
    e.preventDefault()
    const rect = cutTrack.current!.getBoundingClientRect()
    const before = segs
    let latest = segs
    const move = (ev: PointerEvent): void => {
      const t = snap(Math.max(0, Math.min(src, ((ev.clientX - rect.left) / rect.width) * src)))
      latest = segs.map((s, j) => {
        if (j !== i) return s
        const min = edl?.limits.min_segment_seconds ?? 0.5
        return edge === 'start' ? { ...s, start: Math.min(t, s.end - min) } : { ...s, end: Math.max(t, s.start + min) }
      })
      setSegs(latest)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (JSON.stringify(latest) !== JSON.stringify(before)) {
        setPast((p) => [...p, before])
        setFuture([])
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // Output time → source time, through the current cut (for splitting at the playhead).
  const outToSource = (t: number): number | null => {
    let acc = 0
    for (const s of edl?.segments ?? []) {
      const len = s.end - s.start
      if (t <= acc + len) return s.start + (t - acc)
      acc += len
    }
    return null
  }
  const split = (): void => {
    const at = outToSource(time)
    if (at === null) return
    const i = segs.findIndex((s) => at > s.start + 0.3 && at < s.end - 0.3)
    if (i < 0) return toast('info', 'Move the playhead inside a segment to split it.')
    const s = segs[i]
    commit([...segs.slice(0, i), { start: s.start, end: snap(at) }, { start: snap(at), end: s.end }, ...segs.slice(i + 1)])
  }
  const remove = (i: number): void => {
    if (segs.length <= 1) return toast('info', 'A clip needs at least one segment.')
    commit(segs.filter((_, j) => j !== i))
  }

  const pct = (t: number): string => `${(t / total) * 100}%`
  return (
    <div className="flex flex-col gap-2 px-5 py-3">
      <div className="flex items-center gap-2">
        <button onClick={onToggle} aria-label={playing ? 'Pause' : 'Play'} className="grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-ink hover:brightness-110">
          {playing ? <Pause size={16} /> : <Play size={16} className="translate-x-px" />}
        </button>
        <span className="num w-28 text-[13px] text-text-2">
          {timecode(time)} / {timecode(length)}
        </span>
        <div className="mx-2 h-5 w-px bg-line" />
        <button aria-label="Undo cut change" title="Undo" disabled={!past.length} onClick={() => (setFuture((f) => [segs, ...f]), setSegs(past[past.length - 1]), setPast((p) => p.slice(0, -1)))} className="grid h-8 w-8 place-items-center rounded-lg text-text-2 hover:bg-raised disabled:opacity-30">
          <Undo2 size={16} />
        </button>
        <button aria-label="Redo cut change" title="Redo" disabled={!future.length} onClick={() => (setPast((p) => [...p, segs]), setSegs(future[0]), setFuture((f) => f.slice(1)))} className="grid h-8 w-8 place-items-center rounded-lg text-text-2 hover:bg-raised disabled:opacity-30">
          <Redo2 size={16} />
        </button>
        <Button size="sm" variant="ghost" icon={<Scissors size={15} />} onClick={split} disabled={!edl}>
          Split at playhead
        </Button>
        <div className="flex-1" />
        {changed && (
          <>
            <span className="text-[13px] text-text-3">Applies to every variant</span>
            <Button size="sm" variant="ghost" onClick={() => edl && (setSegs(edl.segments), setPast([]), setFuture([]))}>
              Reset
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => onTrim(segs)}>
              Apply cut
            </Button>
          </>
        )}
      </div>

      <div className="grid grid-cols-[72px_1fr] items-center gap-x-3 gap-y-1.5 text-xs text-text-3">
        <span>Cut</span>
        <div ref={cutTrack} className="relative h-9 rounded-lg bg-raised" title="Source clip: drag segment edges to trim (snaps to words)">
          {segs.map((s, i) => (
            <div key={i} className="group absolute top-1 bottom-1 rounded-md border border-accent/60 bg-accent/25" style={{ left: `${(s.start / src) * 100}%`, width: `${((s.end - s.start) / src) * 100}%` }}>
              <span onPointerDown={dragEdge(i, 'start')} className="absolute top-0 -left-1 h-full w-2 cursor-ew-resize rounded-l-md bg-accent" role="slider" aria-label={`Segment ${i + 1} start`} aria-valuenow={s.start} tabIndex={0} />
              <span onPointerDown={dragEdge(i, 'end')} className="absolute top-0 -right-1 h-full w-2 cursor-ew-resize rounded-r-md bg-accent" role="slider" aria-label={`Segment ${i + 1} end`} aria-valuenow={s.end} tabIndex={0} />
              <button onClick={() => remove(i)} aria-label={`Delete segment ${i + 1}`} className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded bg-black/60 p-0.5 text-text group-hover:block">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        <span>Video</span>
        <div
          ref={track}
          className="relative h-14 cursor-pointer overflow-hidden rounded-lg bg-raised"
          onPointerDown={(e) => {
            const r = track.current!.getBoundingClientRect()
            onSeek(((e.clientX - r.left) / r.width) * total)
          }}
        >
          <div className="flex h-full">
            {strip.thumbs.map((t) => (
              <img key={t} src={`clipify-media://${encodeURIComponent(project.id)}/${t.split('\\').join('/')}`} alt="" className="h-full min-w-0 flex-1 object-cover opacity-80" draggable={false} />
            ))}
          </div>
          <Playhead left={pct(time)} />
        </div>

        <span>Audio</span>
        <div className="relative h-8 overflow-hidden rounded-lg bg-raised">
          <svg viewBox={`0 0 ${strip.peaks.length || 1} 100`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
            {strip.peaks.map((p, i) => (
              <rect key={i} x={i} width={0.7} y={50 - p * 48} height={Math.max(2, p * 96)} fill="var(--color-text-3)" />
            ))}
          </svg>
          <Playhead left={pct(time)} />
        </div>

        <span>Captions</span>
        <div className="relative h-7 overflow-hidden rounded-lg bg-raised">
          {v.captions &&
            words.map((w, i) => (
              <span key={i} className="absolute top-1 bottom-1 truncate rounded bg-danger/70 px-1 text-[10px] leading-5 text-white" style={{ left: pct(w.startMs / 1000), width: pct(Math.max(0.15, (w.endMs - w.startMs) / 1000)) }}>
                {w.text}
              </span>
            ))}
          <Playhead left={pct(time)} />
        </div>
      </div>
    </div>
  )
}

function Playhead({ left }: { left: string }) {
  return <span className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-danger" style={{ left }} aria-hidden />
}

// ---------------------------------------------------------------- captions
const FONTS = ['Montserrat ExtraBold', 'Anton', 'Impact', 'Verdana']
function CaptionsPanel({ project, v, busy, onApply }: { project: Project; v: Variant; busy: boolean; onApply: (s: CaptionStyle | null, words?: CaptionWord[]) => void }) {
  const [on, setOn] = useState(Boolean(v.captions))
  const [style, setStyle] = useState<CaptionStyle>(v.captions ?? { preset: 'hormozi' })
  const [words, setWords] = useState<CaptionWord[] | null>(null)
  const [editWords, setEditWords] = useState(false)
  const set = (p: Partial<CaptionStyle>): void => setStyle({ ...style, ...p })
  useEffect(() => {
    if (editWords && !words) void api.captionWords(project.id, v.id).then(setWords)
  }, [editWords, words, project.id, v.id])
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="font-medium">Captions</p>
        <Switch label="Captions on" checked={on} onChange={setOn} />
      </div>
      {on && (
        <>
          <div>
            <p className="mb-2 text-[13px] text-text-2">Look</p>
            <div className="grid grid-cols-3 gap-2">
              {CAPTION_PRESETS.map((p) => (
                <button key={p} onClick={() => setStyle({ preset: p })} aria-pressed={style.preset === p} className={cx('h-10 rounded-[10px] border text-[13px] capitalize transition-colors', style.preset === p ? 'border-accent bg-accent/12 text-accent' : 'border-line text-text-2 hover:border-line-strong')}>
                  {p === 'oneword' ? 'One word' : p}
                </button>
              ))}
            </div>
          </div>
          <Segmented label="Animation" value={style.style ?? 'karaoke'} onChange={(s) => set({ style: s })} items={[{ value: 'karaoke', label: 'Word highlight' }, { value: 'classic', label: 'Classic' }]} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Position">
              {(id) => (
                <Select id={id} value={style.position ?? 'bottom'} onChange={(e) => set({ position: e.target.value as CaptionStyle['position'] })}>
                  <option value="top">Top</option>
                  <option value="middle">Middle</option>
                  <option value="bottom">Bottom</option>
                </Select>
              )}
            </Field>
            <Field label="Font">
              {(id) => (
                <Select id={id} value={style.font_name ?? ''} onChange={(e) => set({ font_name: e.target.value || undefined })}>
                  <option value="">Preset font</option>
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={`Size ${style.font_size ?? 'preset'}`}>{(id) => <input id={id} type="range" min={24} max={80} value={style.font_size ?? 44} onChange={(e) => set({ font_size: Number(e.target.value) })} className="accent-[var(--color-accent)]" />}</Field>
            <Field label="Words per line">
              {(id) => (
                <Select id={id} value={style.max_chars ?? 0} onChange={(e) => set({ max_chars: Number(e.target.value) || undefined })}>
                  <option value={0}>Preset</option>
                  <option value={1}>One word</option>
                  <option value={9}>Short</option>
                  <option value={16}>Medium</option>
                  <option value={24}>Long</option>
                </Select>
              )}
            </Field>
            <Field label="Highlight colour">{(id) => <input id={id} type="color" value={style.highlight_color ?? '#FFE500'} onChange={(e) => set({ highlight_color: e.target.value.toUpperCase() })} className="h-10 w-full cursor-pointer rounded-[10px] border border-line bg-raised" />}</Field>
            <Field label="Effect">
              {(id) => (
                <Select id={id} value={style.effect ?? ''} onChange={(e) => set({ effect: (e.target.value || undefined) as CaptionStyle['effect'] })}>
                  <option value="">Preset</option>
                  <option value="none">None</option>
                  <option value="pop">Pop</option>
                  <option value="glow">Glow</option>
                  <option value="box">Box</option>
                  <option value="highlight">Highlight</option>
                </Select>
              )}
            </Field>
          </div>
          <label className="flex items-center justify-between text-sm text-text-2">
            Uppercase <Switch label="Uppercase" checked={style.uppercase ?? true} onChange={(u) => set({ uppercase: u })} />
          </label>
          <div className="rounded-[12px] border border-line p-3">
            <button className="flex w-full items-center justify-between text-sm" onClick={() => setEditWords(!editWords)} aria-expanded={editWords}>
              Fix caption words <span className="text-[13px] text-accent">{editWords ? 'Hide' : 'Edit'}</span>
            </button>
            {editWords && (
              <div className="mt-3 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                {!words && <Spinner />}
                {words?.map((w, i) => (
                  <input key={i} aria-label={`Word ${i + 1}`} value={w.text} onChange={(e) => setWords(words.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} className="h-7 rounded-md border border-line bg-raised px-1.5 text-[13px] text-text focus:border-accent focus:outline-none" style={{ width: `${Math.max(3, w.text.length + 1)}ch` }} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
      <Button variant="primary" disabled={busy} onClick={() => onApply(on ? style : null, editWords && words ? words : undefined)}>
        Apply captions
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------- hook
function HookPanel({ v, busy, onApply }: { v: Variant; busy: boolean; onApply: (text: string, style: HookStyle | null) => void }) {
  const [on, setOn] = useState(Boolean(v.hook))
  const [text, setText] = useState(v.hookText)
  const [style, setStyle] = useState<HookStyle>(v.hook ?? { style: 'pill', size: 'M', position: 'auto', font: 'montserrat', duration_seconds: null })
  const set = (p: Partial<HookStyle>): void => setStyle({ ...style, ...p })
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="font-medium">Hook text</p>
        <Switch label="Hook on" checked={on} onChange={setOn} />
      </div>
      {on && (
        <>
          <Field label="Text" hint="Short is better: 3–8 words.">
            {(id) => <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} className="min-h-16" />}
          </Field>
          <div>
            <p className="mb-2 text-[13px] text-text-2">Style</p>
            <div className="grid grid-cols-4 gap-2">
              {(['pill', 'classic', 'dark', 'yellow', 'red', 'outline', 'outline_yellow'] as const).map((s) => (
                <button key={s} onClick={() => set({ style: s })} aria-pressed={style.style === s} className={cx('h-9 rounded-[10px] border text-xs capitalize', style.style === s ? 'border-accent bg-accent/12 text-accent' : 'border-line text-text-2 hover:border-line-strong')}>
                  {s.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
          <Segmented label="Size" value={style.size} onChange={(s) => set({ size: s })} items={[{ value: 'S', label: 'Small' }, { value: 'M', label: 'Medium' }, { value: 'L', label: 'Large' }]} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Font">
              {(id) => (
                <Select id={id} value={style.font} onChange={(e) => set({ font: e.target.value as HookStyle['font'] })}>
                  <option value="montserrat">Montserrat</option>
                  <option value="anton">Anton</option>
                  <option value="serif">Serif</option>
                </Select>
              )}
            </Field>
            <Field label="Position">
              {(id) => (
                <Select id={id} value={style.position} onChange={(e) => set({ position: e.target.value as HookStyle['position'] })}>
                  <option value="auto">Auto (avoids faces)</option>
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                </Select>
              )}
            </Field>
            <Field label="Visible for">
              {(id) => (
                <Select id={id} value={style.duration_seconds ?? 0} onChange={(e) => set({ duration_seconds: Number(e.target.value) || null })}>
                  <option value={0}>Whole clip</option>
                  <option value={3}>First 3 s</option>
                  <option value={5}>First 5 s</option>
                  <option value={8}>First 8 s</option>
                </Select>
              )}
            </Field>
          </div>
        </>
      )}
      <Button variant="primary" disabled={busy || (on && !text.trim())} onClick={() => onApply(on ? text : '', on ? style : null)}>
        Apply hook
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------- frame
function FramePanel({ project, busy, onApply }: { project: Project; busy: boolean; onApply: (o: Record<string, number | { top: number; bottom: number }>) => void }) {
  const [scenes, setScenes] = useState<Scene[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [crops, setCrops] = useState<Record<number, number | { top: number; bottom: number }>>({})
  const load = async (): Promise<void> => {
    setLoading(true)
    const s = await attempt(() => api.scenes(project.id, ''))
    if (s) setScenes(s)
    setLoading(false)
  }
  const thumb = (t?: string): string | undefined => (t ? `clipify-media://${encodeURIComponent(project.id)}/${t.split('\\').join('/')}` : undefined)
  return (
    <div className="flex flex-col gap-4">
      <p className="font-medium">Framing</p>
      <p className="text-[13px] text-text-3">Choose what each shot shows in the vertical frame. Applies to every variant, because they share one cut.</p>
      {!scenes ? (
        <Button onClick={() => void load()} loading={loading} icon={<Crop size={16} />}>
          Load scenes
        </Button>
      ) : (
        <>
          {scenes.map((s) => {
            const c = crops[s.index]
            const stacked = typeof c === 'object'
            const center = typeof c === 'number' ? c : typeof s.crop === 'number' ? s.crop : 0.5
            return (
              <div key={s.index} className="panel flex flex-col gap-3 rounded-[14px] p-3">
                <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                  {thumb(s.thumbnail) && <img src={thumb(s.thumbnail)} alt="" className="h-full w-full object-cover" />}
                  {!stacked && <div className="absolute top-0 bottom-0 border-2 border-accent bg-accent/10" style={{ width: '31.6%', left: `${Math.max(0, Math.min(68.4, center * 100 - 15.8))}%` }} />}
                </div>
                <div className="flex items-center justify-between text-[13px] text-text-2">
                  <span className="num">
                    Scene {s.index + 1} · {timecode(s.start)}–{timecode(s.end)}
                  </span>
                  <label className="flex items-center gap-2">
                    Stack two areas
                    <Switch label="Stack two areas" checked={stacked} onChange={(on) => setCrops({ ...crops, [s.index]: on ? { top: 0.5, bottom: 0.15 } : center })} />
                  </label>
                </div>
                {stacked ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Top area (gameplay)">{(id) => <input id={id} type="range" min={0} max={1} step={0.01} value={(c as { top: number }).top} onChange={(e) => setCrops({ ...crops, [s.index]: { ...(c as { top: number; bottom: number }), top: Number(e.target.value) } })} className="accent-[var(--color-accent)]" />}</Field>
                    <Field label="Bottom area (facecam)">{(id) => <input id={id} type="range" min={0} max={1} step={0.01} value={(c as { bottom: number }).bottom} onChange={(e) => setCrops({ ...crops, [s.index]: { ...(c as { top: number; bottom: number }), bottom: Number(e.target.value) } })} className="accent-[var(--color-accent)]" />}</Field>
                  </div>
                ) : (
                  <Field label="Crop position">{(id) => <input id={id} type="range" min={0} max={1} step={0.01} value={center} onChange={(e) => setCrops({ ...crops, [s.index]: Number(e.target.value) })} className="accent-[var(--color-accent)]" />}</Field>
                )}
              </div>
            )
          })}
          <Button variant="primary" disabled={busy || !Object.keys(crops).length} onClick={() => onApply(Object.fromEntries(Object.entries(crops).map(([k, val]) => [k, val])))}>
            Apply framing
          </Button>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- descriptions
function DescriptionPanel({ project, v, onProject }: { project: Project; v: Variant; onProject: (p: Project) => void }) {
  const [d, setD] = useState<Descriptions | null>(v.descriptions ?? null)
  const [busy, setBusy] = useState(false)
  const [credit, setCredit] = useState('')
  useEffect(() => void api.creditBlock(project.id).then(setCredit), [project.id])
  const generate = async (): Promise<void> => {
    setBusy(true)
    const r = await attempt(() => api.generateDescriptions(project.id, v.id))
    if (r) setD(r)
    setBusy(false)
  }
  const save = async (): Promise<void> => {
    if (!d) return
    const p = await attempt(() => api.saveDescriptions(project.id, v.id, d), 'Descriptions saved')
    if (p) onProject(p)
  }
  const len = useMemo(() => ({ yt: d?.youtube.title.length ?? 0, ig: d?.instagram.caption.length ?? 0, tt: d?.tiktok.caption.length ?? 0 }), [d])
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Post text</p>
        {d && <Badge tone={d.source === 'claude' ? 'accent' : 'neutral'} icon={d.source === 'claude' ? <Sparkles size={11} /> : undefined}>{d.source === 'claude' ? 'Claude' : 'OpenShorts'}</Badge>}
      </div>
      <Button onClick={() => void generate()} loading={busy} icon={<Wand2 size={16} />}>
        {d ? 'Write again' : 'Write descriptions'}
      </Button>
      {d && (
        <>
          <Field label={`YouTube title · ${len.yt}/100`}>{(id) => <Input id={id} maxLength={100} value={d.youtube.title} onChange={(e) => setD({ ...d, youtube: { ...d.youtube, title: e.target.value } })} />}</Field>
          <Field label="YouTube description">{(id) => <Textarea id={id} value={d.youtube.description} onChange={(e) => setD({ ...d, youtube: { ...d.youtube, description: e.target.value } })} />}</Field>
          <Field label={`Instagram caption · ${len.ig}/2200`}>{(id) => <Textarea id={id} maxLength={2200} value={d.instagram.caption} onChange={(e) => setD({ ...d, instagram: { ...d.instagram, caption: e.target.value } })} />}</Field>
          <Field label={`TikTok caption · ${len.tt}/2200`}>{(id) => <Textarea id={id} maxLength={2200} value={d.tiktok.caption} onChange={(e) => setD({ ...d, tiktok: { ...d.tiktok, caption: e.target.value } })} />}</Field>
          {credit && (
            <div className="rounded-[12px] border border-dashed border-line-strong p-3">
              <p className="label mb-1">Credit line (already at the end of each text)</p>
              <p className="text-[13px] text-text-2">{credit}</p>
            </div>
          )}
          <Button variant="primary" onClick={() => void save()}>
            Save text
          </Button>
        </>
      )}
    </div>
  )
}
