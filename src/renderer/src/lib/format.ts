export function compact(n: number): string {
  if (!Number.isFinite(n)) return '–'
  const abs = Math.abs(n)
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`
  return String(Math.round(n))
}

export function duration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function timecode(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

export function ago(iso?: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const abs = Math.abs(diff)
  const fmt = (v: number, u: string): string => `${v}${u}`
  const val = abs < 36e5 ? fmt(Math.max(1, Math.round(abs / 6e4)), 'm') : abs < 864e5 ? fmt(Math.round(abs / 36e5), 'h') : fmt(Math.round(abs / 864e5), 'd')
  return diff >= 0 ? `${val} ago` : `in ${val}`
}

export function dateTime(iso?: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function percentChange(now: number, before: number): number | null {
  if (!before) return now ? null : 0
  return ((now - before) / before) * 100
}

export function greeting(): string {
  const h = new Date().getHours()
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ')
