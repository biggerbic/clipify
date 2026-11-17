import { useEffect, useRef, useState } from 'react'
import type { Api, ApiEvent } from '@shared/api'

interface Bridge {
  invoke(method: string, ...args: unknown[]): Promise<unknown>
  on(cb: (e: ApiEvent) => void): () => void
  platform: string
}
declare global {
  interface Window {
    clipify: Bridge
  }
}

const cleanError = (err: unknown): Error => {
  const msg = err instanceof Error ? err.message : String(err)
  return new Error(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
}

/** Typed client: api.listProjects() → ipc 'clipify:listProjects'. */
export const api = new Proxy({} as Api, {
  get:
    (_t, method: string) =>
    (...args: unknown[]) =>
      window.clipify.invoke(method, ...args).catch((err) => {
        throw cleanError(err)
      })
})

export const platform = window.clipify?.platform ?? 'darwin'

export function onEvent(cb: (e: ApiEvent) => void): () => void {
  return window.clipify.on(cb)
}

/** Load async data with loading/error state; `reload` re-runs it. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; error: string | null; loading: boolean; reload: () => void; setData: (d: T) => void } {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const seq = useRef(0)
  useEffect(() => {
    const mine = ++seq.current
    setLoading(true)
    fn()
      .then((d) => {
        if (mine === seq.current) {
          setData(d)
          setError(null)
        }
      })
      .catch((e: Error) => mine === seq.current && setError(e.message))
      .finally(() => mine === seq.current && setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData }
}
