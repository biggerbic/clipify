import { useEffect, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, ListVideo, Settings, X } from 'lucide-react'
import { api, platform } from '@/lib/api'
import { dismissToast, navigate, useStore, type Route } from '@/lib/store'
import { cx } from '@/lib/format'
import { Spinner } from '@/ui'

const NAV: { name: Route['name']; label: string }[] = [
  { name: 'home', label: 'Home' },
  { name: 'dashboard', label: 'Dashboard' },
  { name: 'library', label: 'Library' },
  { name: 'projects', label: 'Projects' },
  { name: 'schedule', label: 'Schedule' }
]

function EngineDot() {
  const engine = useStore((s) => s.engine)
  const state = engine?.state ?? 'stopped'
  const map = {
    ready: ['bg-success', 'Engine ready'],
    starting: ['bg-warning', 'Engine starting'],
    installing: ['bg-info', 'Installing engine'],
    stopped: ['bg-text-3', 'Engine stopped'],
    'not-installed': ['bg-text-3', 'Engine not installed'],
    error: ['bg-danger', 'Engine error']
  } as const
  const [color, label] = map[state]
  return (
    <button
      onClick={() => navigate({ name: 'settings', section: 'engine' })}
      className="no-drag flex h-9 items-center gap-2 rounded-[10px] px-2.5 text-[13px] text-text-2 hover:bg-raised hover:text-text"
      aria-label={`${label}. Open engine settings`}
      title={engine?.message ?? label}
    >
      <span className={cx('h-2 w-2 rounded-full', color, (state === 'starting' || state === 'installing') && 'animate-pulse')} />
      <span className="hidden xl:inline">{engine?.mode === 'remote' ? 'Remote engine' : label}</span>
    </button>
  )
}

function QueueButton() {
  const queue = useStore((s) => s.queue)
  const [open, setOpen] = useState(false)
  const active = queue.filter((q) => q.state === 'running' || q.state === 'queued').length
  return (
    <div className="no-drag relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx('flex h-9 items-center gap-2 rounded-[10px] px-2.5 text-[13px] text-text-2 hover:bg-raised hover:text-text', open && 'bg-raised text-text')}
      >
        <ListVideo size={17} aria-hidden />
        Queue
        {active > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-accent-ink">{active}</span>}
      </button>
      {open && (
        <div className="glass rise absolute top-11 right-0 z-30 w-[360px] rounded-[16px] p-3">
          <p className="label px-1 pb-2">Generation queue</p>
          {queue.length === 0 && <p className="px-1 py-6 text-center text-text-3">Nothing in the queue.</p>}
          <ul className="flex flex-col gap-1">
            {queue.map((q) => (
              <li key={q.projectId}>
                <button
                  onClick={() => {
                    setOpen(false)
                    navigate({ name: 'project', id: q.projectId })
                  }}
                  className="flex w-full items-start gap-3 rounded-[10px] p-2 text-left hover:bg-raised"
                >
                  <span className="mt-0.5">
                    {q.state === 'running' ? <Spinner size={15} /> : q.state === 'failed' ? <CircleAlert size={15} className="text-danger" /> : q.state === 'done' ? <CircleCheck size={15} className="text-success" /> : <span className="block h-[15px] w-[15px] rounded-full border border-line-strong" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{q.title}</span>
                    <span className="block truncate text-xs text-text-3">{q.progress ?? (q.state === 'queued' ? 'Waiting' : q.state)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SetupBanner() {
  const route = useStore((s) => s.route)
  const [done, setDone] = useState<number | null>(null)
  const engine = useStore((s) => s.engine)
  useEffect(() => {
    void api.setupState().then((s) => setDone(Object.values(s).filter(Boolean).length))
  }, [route.name, engine?.state])
  if (done === null || done >= 8 || route.name === 'settings') return null
  return (
    <div className="flex items-center justify-center gap-3 border-b border-line bg-accent/8 px-4 py-2 text-[13px]">
      <span className="text-text-2">Setup {done}/8 done</span>
      <button onClick={() => navigate({ name: 'settings', section: 'setup' })} className="font-medium text-accent hover:underline">
        Continue setup
      </button>
    </div>
  )
}

function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed top-[68px] right-5 z-50 flex w-[380px] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="glass rise pointer-events-auto flex items-start gap-3 rounded-[14px] p-3.5">
          {t.level === 'error' ? <CircleAlert size={18} className="mt-0.5 shrink-0 text-danger" /> : t.level === 'success' ? <CircleCheck size={18} className="mt-0.5 shrink-0 text-success" /> : <Info size={18} className="mt-0.5 shrink-0 text-info" />}
          <p className="flex-1 text-sm text-text">{t.text}</p>
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="text-text-3 hover:text-text">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function AppFrame({ children }: { children: ReactNode }) {
  const route = useStore((s) => s.route)
  const active = route.name === 'project' ? 'projects' : route.name
  return (
    <div className="flex h-full flex-col">
      <header className={cx('drag relative z-20 flex h-14 shrink-0 items-center gap-6 border-b border-line bg-bg/80 pr-4 backdrop-blur-xl', platform === 'darwin' ? 'pl-24' : 'pl-5 pr-[150px]')}>
        <button onClick={() => navigate({ name: 'home' })} className="no-drag flex items-center gap-2" aria-label="Clipify home">
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-accent/40 bg-accent/10">
            <span className="h-3.5 w-2 rounded-[3px] border-2 border-accent" />
          </span>
          <span className="font-display text-[17px] font-medium tracking-tight">Clipify</span>
        </button>
        <nav className="no-drag flex items-center gap-1" aria-label="Main">
          {NAV.map((n) => (
            <button
              key={n.name}
              onClick={() => navigate({ name: n.name } as Route)}
              aria-current={active === n.name ? 'page' : undefined}
              className={cx('relative h-14 px-3 text-sm transition-colors', active === n.name ? 'text-text' : 'text-text-3 hover:text-text-2')}
            >
              {n.label}
              <span className={cx('absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent transition-opacity', active === n.name ? 'opacity-100' : 'opacity-0')} />
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <QueueButton />
          <EngineDot />
          <button
            onClick={() => navigate({ name: 'settings' })}
            aria-label="Settings"
            title="Settings"
            className={cx('no-drag grid h-9 w-9 place-items-center rounded-[10px] text-text-2 hover:bg-raised hover:text-text', route.name === 'settings' && 'bg-raised text-text')}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>
      <SetupBanner />
      <main className="relative min-h-0 flex-1">{children}</main>
      <Toasts />
    </div>
  )
}
