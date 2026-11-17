import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineStatus, InstallStep } from '@shared/types'
import { ctx } from '../context'
import { getSettings, setSettings } from '../store/settings'
import { getSecret, setSecret } from '../store/secrets'
import { enginePaths, installEngine, INSTALL_STEPS, readInstalled, type EnginePaths, type Manifest } from './installer'
import { detectProfile, type Profile } from './profile'
import { startEngine, stopEngine, type RunningEngine } from './process'
import { startShare, stopShare, shareInfo } from './share'

const require = createRequire(import.meta.url)

/** Bundled ffmpeg/ffprobe; inside an asar build the binaries live in app.asar.unpacked. */
export function ffmpegBinaries(): { ffmpeg: string; ffprobe: string } {
  const unpack = (p: string): string => p.replace('app.asar', 'app.asar.unpacked')
  return { ffmpeg: unpack(require('ffmpeg-static') as string), ffprobe: unpack((require('ffprobe-static') as { path: string }).path) }
}

class EngineService {
  private running: RunningEngine | null = null
  private profile: Profile | null = null
  private logs: string[] = []
  private status: EngineStatus = {
    state: 'stopped',
    mode: 'local',
    install: INSTALL_STEPS.map((s) => ({ ...s, status: 'pending' })),
    share: { enabled: false, addresses: [], port: 8765 }
  }
  private starting: Promise<void> | null = null

  manifest(): Manifest {
    return JSON.parse(readFileSync(join(ctx.resources, 'engine', 'manifest.json'), 'utf8')) as Manifest
  }
  paths(): EnginePaths {
    return enginePaths(join(ctx.userData, 'engine'), this.manifest())
  }

  log(line: string): void {
    this.logs.push(line)
    if (this.logs.length > 2000) this.logs.splice(0, this.logs.length - 2000)
  }
  getLogs(): string[] {
    return this.logs.slice(-800)
  }

  private set(patch: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...patch }
    void this.getStatus().then((status) => ctx.emit({ type: 'engine', status }))
  }

  async getStatus(): Promise<EngineStatus> {
    const s = await getSettings()
    if (s.engine.mode === 'remote') return { ...this.status, mode: 'remote', profile: 'remote', profileLabel: s.engine.remoteUrl }
    if (!this.profile) {
      try {
        this.profile = await detectProfile()
      } catch (err) {
        this.set({ state: 'error', message: (err as Error).message })
      }
    }
    if (this.status.state === 'stopped' || this.status.state === 'not-installed') {
      const installed = await readInstalled(this.paths())
      this.status.state = installed?.commit === this.manifest().openshorts.commit ? 'stopped' : 'not-installed'
    }
    return { ...this.status, mode: 'local', profile: this.profile?.id, profileLabel: this.profile?.label, share: shareInfo() }
  }

  async install(): Promise<void> {
    if (this.status.state === 'installing') return
    const profile = (this.profile ??= await detectProfile())
    const steps: InstallStep[] = INSTALL_STEPS.map((s) => ({ ...s, status: 'pending' }))
    this.set({ state: 'installing', install: steps, message: undefined })
    try {
      await installEngine(this.paths(), this.manifest(), profile, ffmpegBinaries(), join(ctx.resources, 'engine', 'patches', 'windows.json'), (e) => {
        const step = steps.find((s) => s.id === e.step)
        if (!step) return
        step.status = e.status
        if (e.percent !== undefined) step.percent = e.percent
        if (e.message) {
          step.message = e.message.slice(0, 200)
          this.log(`[install:${e.step}] ${e.message}`)
        }
        this.set({ install: [...steps] })
      })
      this.set({ state: 'stopped' })
      await this.start()
    } catch (err) {
      this.set({ state: 'error', message: `Install failed: ${(err as Error).message.split('\n')[0]}` })
      throw err
    }
  }

  async start(): Promise<void> {
    if ((await getSettings()).engine.mode === 'remote') return
    if (this.running) return
    if (this.starting) return this.starting
    this.starting = (async () => {
      const profile = (this.profile ??= await detectProfile())
      const installed = await readInstalled(this.paths())
      if (!installed) {
        this.set({ state: 'not-installed' })
        return
      }
      this.set({ state: 'starting', message: undefined })
      try {
        this.running = await startEngine(this.paths(), profile, (l) => this.log(l))
        this.running.child.on('exit', (code) => {
          this.log(`[engine] exited with code ${code}`)
          this.running = null
          if (this.status.state === 'ready') this.set({ state: 'error', message: 'The engine stopped unexpectedly. Restart it from Settings → Engine.' })
        })
        this.set({ state: 'ready' })
        const s = await getSettings()
        if (s.engine.shareEnabled) await this.share(true)
      } catch (err) {
        this.set({ state: 'error', message: (err as Error).message })
      }
    })().finally(() => (this.starting = null))
    return this.starting
  }

  async stop(): Promise<void> {
    stopShare()
    const r = this.running
    this.running = null
    // mark stopped first, so the exit handler doesn't report an intentional stop as a crash
    if ((await getSettings()).engine.mode === 'local') this.set({ state: 'stopped' })
    if (r) await stopEngine(r.child, this.paths())
  }

  async repair(): Promise<void> {
    await this.stop()
    const { rm } = await import('node:fs/promises')
    await rm(this.paths().installed, { force: true })
    await rm(this.paths().source, { recursive: true, force: true })
    await this.install()
  }

  /** Base URL + headers for calling OpenShorts, wherever it runs. */
  async endpoint(): Promise<{ url: string; headers: Record<string, string> }> {
    const s = await getSettings()
    const headers: Record<string, string> = {}
    const gemini = await getSecret('geminiKey')
    if (gemini) headers['X-Gemini-Key'] = gemini
    if (s.engine.mode === 'remote') {
      headers['X-Clipify-Token'] = (await getSecret('remoteToken')) ?? ''
      return { url: s.engine.remoteUrl.replace(/\/$/, ''), headers }
    }
    if (!this.running) await this.start()
    if (!this.running) throw new Error('The engine is not running. Open Settings → Engine.')
    return { url: this.running.url, headers }
  }

  async useRemote(url: string, code: string): Promise<{ ok: boolean; message: string }> {
    const base = url.trim().replace(/\/$/, '')
    const target = /^https?:\/\//.test(base) ? base : `http://${base}`
    try {
      const res = await fetch(`${target}/health/ready`, { headers: { 'X-Clipify-Token': code.trim() }, signal: AbortSignal.timeout(5000) })
      if (res.status === 401) return { ok: false, message: 'The pairing code was not accepted.' }
      if (!res.ok) return { ok: false, message: `The engine answered with ${res.status}.` }
    } catch {
      return { ok: false, message: 'Could not reach that address. Check that both computers are on the same network or Tailscale.' }
    }
    await setSecret('remoteToken', code.trim())
    await setSettings({ engine: { ...(await getSettings()).engine, mode: 'remote', remoteUrl: target } })
    await this.stop()
    this.set({ state: 'ready', mode: 'remote', message: undefined })
    return { ok: true, message: 'Connected to the remote engine.' }
  }

  async useLocal(): Promise<void> {
    await setSettings({ engine: { ...(await getSettings()).engine, mode: 'local' } })
    this.set({ state: 'stopped', mode: 'local' })
    await this.start()
  }

  async share(enabled: boolean): Promise<EngineStatus> {
    const s = await getSettings()
    await setSettings({ engine: { ...s.engine, shareEnabled: enabled } })
    if (enabled && this.running) await startShare(s.engine.sharePort, this.running.url)
    else stopShare()
    return this.getStatus()
  }
}

export const engine = new EngineService()
