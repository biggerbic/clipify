// Spike: one Twitch clip → base render → caption + hook variant, against the real native engine.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { enginePaths, type Manifest } from '../src/main/engine/installer'
import { detectProfile } from '../src/main/engine/profile'
import { startEngine, stopEngine } from '../src/main/engine/process'

const clipUrl = process.argv[2]
const duration = Number(process.argv[3] ?? 30)
const outDir = process.argv[4] ?? 'out/e2e'
mkdirSync(outDir, { recursive: true })
const root = join(homedir(), 'Library/Application Support/Clipify/engine')
const p = enginePaths(root, JSON.parse(readFileSync('engine/manifest.json', 'utf8')) as Manifest)
const log: string[] = []
const eng = await startEngine(p, await detectProfile(), (l) => log.push(l))
const api = async (path: string, init?: RequestInit): Promise<any> => {
  const res = await fetch(eng.url + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}
const t = Date.now()
const secs = (): string => `${((Date.now() - t) / 1000).toFixed(0)}s`
try {
  const started = await api('/api/process', {
    method: 'POST',
    body: JSON.stringify({
      url: clipUrl, acknowledged: true, target_clips: 1, output_format: 'vertical', layouts: 'auto',
      clip_min_seconds: Math.max(5, Math.floor(duration - 10)), clip_max_seconds: Math.max(10, Math.ceil(duration)),
      captions: false, auto_hook: false
    })
  })
  console.log('job', started.job_id, started.status)
  let status: any
  for (;;) {
    status = await api(`/api/status/${started.job_id}`)
    if (['completed', 'failed'].includes(status.status)) break
    await new Promise((r) => setTimeout(r, 3000))
  }
  console.log('base', status.status, secs())
  writeFileSync(join(outDir, 'status.json'), JSON.stringify(status, null, 2))
  if (status.status !== 'completed') throw new Error('job failed: ' + (status.logs ?? []).slice(-12).join('\n'))
  const clip = status.result.clips[0]
  console.log('clip', clip.video_url, 'start', clip.start, 'end', clip.end, 'hook', clip.viral_hook_text)
  const base = clip.video_url.split('/').pop()
  const sub = await api('/api/subtitle', { method: 'POST', body: JSON.stringify({ job_id: started.job_id, clip_index: 0, preset: 'hormozi', input_filename: base }) })
  console.log('subtitle ->', sub.new_video_url, secs())
  const hook = await api('/api/hook', {
    method: 'POST',
    body: JSON.stringify({ job_id: started.job_id, clip_index: 0, text: 'WAIT FOR IT', input_filename: sub.new_video_url.split('/').pop(), style: 'pill', size: 'M', position: 'auto' })
  })
  console.log('hook ->', JSON.stringify(hook).slice(0, 200), secs())
  for (const [name, url] of [['base.mp4', clip.video_url], ['captioned.mp4', sub.new_video_url], ['hooked.mp4', hook.new_video_url ?? hook.video_url]]) {
    if (!url) continue
    const res = await fetch(eng.url + url)
    writeFileSync(join(outDir, name), Buffer.from(await res.arrayBuffer()))
    console.log('saved', name, res.status)
  }
} catch (err) {
  console.error('E2E FAILED', (err as Error).message)
  console.error(log.slice(-40).join('\n'))
  process.exitCode = 1
} finally {
  writeFileSync(join(outDir, 'engine.log'), log.join('\n'))
  stopEngine(eng.child)
}
