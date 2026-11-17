import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { CaptionStyle, HookStyle } from '@shared/types'
import { engine } from '../engine/service'

export interface OsClip {
  start: number
  end: number
  video_url: string
  viral_hook_text?: string
  video_title_for_youtube_short?: string
  video_description_for_tiktok?: string
  video_description_for_instagram?: string
}
export interface OsStatus {
  status: 'queued' | 'processing' | 'completed' | 'failed' | string
  logs?: string[]
  result?: { clips?: OsClip[]; transcript?: unknown }
}
export interface OsCaptionWord {
  text: string
  startMs: number
  endMs: number
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, headers } = await engine.endpoint()
  const res = await fetch(url + path, { ...init, headers: { 'content-type': 'application/json', ...headers, ...(init.headers ?? {}) } })
  const text = await res.text()
  if (!res.ok) {
    let detail = text
    try {
      const j = JSON.parse(text)
      detail = typeof j.detail === 'string' ? j.detail : (j.detail?.message ?? j.msg ?? text)
    } catch {
      /* plain text */
    }
    throw new Error(`Engine: ${String(detail).slice(0, 300)}`)
  }
  return JSON.parse(text) as T
}
const post = <T>(path: string, body: unknown): Promise<T> => call<T>(path, { method: 'POST', body: JSON.stringify(body) })
export const fileName = (videoUrl: string): string => decodeURIComponent(videoUrl.split('?')[0].split('/').pop() ?? '')

export const os = {
  process(clipUrl: string, duration: number): Promise<{ job_id: string }> {
    return post('/api/process', {
      url: clipUrl,
      acknowledged: true,
      target_clips: 1,
      output_format: 'vertical',
      layouts: 'auto',
      clip_min_seconds: Math.max(5, Math.floor(duration - 10)),
      clip_max_seconds: Math.max(10, Math.ceil(duration)),
      captions: false,
      auto_hook: false
    })
  },
  status: (jobId: string): Promise<OsStatus> => call(`/api/status/${jobId}`),
  subtitle(jobId: string, input: string, style: CaptionStyle, words?: OsCaptionWord[]): Promise<{ new_video_url: string }> {
    return post('/api/subtitle', { job_id: jobId, clip_index: 0, input_filename: input, ...style, ...(words ? { words } : {}) })
  },
  hook(jobId: string, input: string, text: string, style: HookStyle | null): Promise<{ new_video_url: string }> {
    return post('/api/hook', {
      job_id: jobId,
      clip_index: 0,
      input_filename: input,
      text,
      remove: !style || !text.trim(),
      ...(style ?? {})
    })
  },
  edl: (jobId: string): Promise<{
    segments: { start: number; end: number }[]
    words: { w: string; s: number; e: number }[]
    duration: number
    source: { available: boolean; duration: number }
    limits: { max_segments: number; min_segment_seconds: number; max_total_seconds: number }
  }> => call(`/api/clip/${jobId}/0/edl`),
  rerender: (jobId: string, segments: { start: number; end: number }[]): Promise<{ new_video_url: string }> =>
    post('/api/clip/rerender', { job_id: jobId, clip_index: 0, segments, snap_to_words: true, reapply_captions: false }),
  scenes: (jobId: string): Promise<{ scenes: { index: number; start: number; end: number; thumbnail_url?: string; suggested_center: number }[] }> =>
    call(`/api/clip/${jobId}/0/scenes`),
  reframe: (jobId: string, overrides: Record<string, unknown>): Promise<{ new_video_url: string }> =>
    post('/api/clip/reframe', { job_id: jobId, clip_index: 0, crop_overrides: overrides, reapply_captions: false }),
  transcript: (jobId: string): Promise<{ captions: OsCaptionWord[] }> => call(`/api/clip/${jobId}/0/transcript`),

  /** Stream an engine file (e.g. /videos/<job>/<file>) to disk. */
  async download(path: string, dest: string): Promise<void> {
    const { url, headers } = await engine.endpoint()
    const res = await fetch(url + path, { headers })
    if (!res.ok || !res.body) throw new Error(`Engine download failed (${res.status}) for ${path}`)
    await mkdir(dirname(dest), { recursive: true })
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest))
  }
}
