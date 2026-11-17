import { useSyncExternalStore } from 'react'
import type { EngineStatus, Project, QueueItem } from '@shared/types'
import { api, onEvent } from './api'

export type Route =
  | { name: 'home' }
  | { name: 'dashboard'; accountId?: string }
  | { name: 'library' }
  | { name: 'projects' }
  | { name: 'project'; id: string; step?: 'generate' | 'review' | 'publish'; variantId?: string }
  | { name: 'schedule' }
  | { name: 'settings'; section?: SettingsSection }

export type SettingsSection = 'setup' | 'engine' | 'keys' | 'accounts' | 'defaults' | 'storage' | 'about'

export interface Toast {
  id: number
  level: 'info' | 'success' | 'error'
  text: string
}

interface State {
  route: Route
  history: Route[]
  engine: EngineStatus | null
  queue: QueueItem[]
  toasts: Toast[]
  /** Bumped on any project event so lists can refetch cheaply. */
  projectsVersion: number
  lastProject: Project | null
}

let state: State = { route: { name: 'home' }, history: [], engine: null, queue: [], toasts: [], projectsVersion: 0, lastProject: null }
const listeners = new Set<() => void>()
function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => pick(state)
  )
}

export function navigate(route: Route): void {
  if (JSON.stringify(route) === JSON.stringify(state.route)) return
  set({ route, history: [...state.history.slice(-30), state.route] })
}
export function back(): void {
  const prev = state.history[state.history.length - 1]
  if (prev) set({ route: prev, history: state.history.slice(0, -1) })
}

let toastId = 0
export function toast(level: Toast['level'], text: string): void {
  const t = { id: ++toastId, level, text }
  set({ toasts: [...state.toasts, t].slice(-4) })
  setTimeout(() => set({ toasts: state.toasts.filter((x) => x.id !== t.id) }), level === 'error' ? 8000 : 4500)
}
export function dismissToast(id: number): void {
  set({ toasts: state.toasts.filter((x) => x.id !== id) })
}

/** Wire main-process events into the store once. */
export function initStore(): void {
  void api.engineStatus().then((engine) => set({ engine }))
  void api.queue().then((queue) => set({ queue }))
  onEvent((e) => {
    if (e.type === 'engine') set({ engine: e.status })
    if (e.type === 'queue') set({ queue: e.items })
    if (e.type === 'project') set({ projectsVersion: state.projectsVersion + 1, lastProject: e.project })
    if (e.type === 'notice') toast(e.level, e.text)
  })
}

/** Run an action, toasting its error instead of throwing into React. */
export async function attempt<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const r = await fn()
    if (success) toast('success', success)
    return r
  } catch (err) {
    toast('error', (err as Error).message)
    return undefined
  }
}
