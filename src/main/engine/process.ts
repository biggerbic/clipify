import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { toolEnv, type EnginePaths } from './installer'
import type { Profile } from './profile'

const isWin = process.platform === 'win32'

export async function freePort(preferred = 8000): Promise<number> {
  const tryPort = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const srv = createServer()
      srv.once('error', reject)
      srv.listen(port, '127.0.0.1', () => {
        const actual = (srv.address() as { port: number }).port
        srv.close(() => resolve(actual))
      })
    })
  try {
    return await tryPort(preferred)
  } catch {
    return tryPort(0)
  }
}

/** CUDA 12 DLL folders from the nvidia-* wheels; ctranslate2 (whisper) loads cuBLAS/cuDNN from PATH on Windows. */
function cudaDllDirs(p: EnginePaths): string[] {
  const nv = join(p.venv, 'Lib', 'site-packages', 'nvidia')
  if (!isWin || !existsSync(nv)) return []
  return readdirSync(nv)
    .map((d) => join(nv, d, 'bin'))
    .filter((d) => existsSync(d))
}

export interface RunningEngine {
  url: string
  child: ChildProcess
}

/** Start OpenShorts' API (uvicorn) on a free localhost port; resolves once /health/ready answers. */
export async function startEngine(p: EnginePaths, profile: Profile, onLine: (line: string) => void): Promise<RunningEngine> {
  killStale(p)
  const port = await freePort(8000)
  const base = toolEnv(p)
  const env: NodeJS.ProcessEnv = {
    ...base,
    ...profile.env,
    FFMPEG_REAL_BIN: join(p.bin, isWin ? 'ffmpeg.exe' : 'ffmpeg'),
    // OpenShorts drains running jobs for up to 14 min on shutdown (a server deploy feature); a desktop app quits now.
    DRAIN_TIMEOUT_SECONDS: '3',
    PATH: [...cudaDllDirs(p), base.PATH].join(isWin ? ';' : ':')
  }
  const child = spawn(p.venvPython, ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(port), '--timeout-graceful-shutdown', '5'], {
    cwd: p.source,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // own process group on macOS/Linux, so stopping it also stops the job processes it started
    detached: !isWin
  })
  if (child.pid) writeFileSync(pidFile(p), String(child.pid))
  const feed = (buf: Buffer): void => buf.toString().split(/\r?\n/).filter(Boolean).forEach(onLine)
  child.stdout?.on('data', feed)
  child.stderr?.on('data', feed)

  const url = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Engine exited during start (code ${child.exitCode}). See the engine log.`)
    try {
      const res = await fetch(`${url}/health/ready`)
      if (res.ok) return { url, child }
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  await stopEngine(child, p)
  throw new Error('Engine did not become ready within 3 minutes.')
}

const pidFile = (p: EnginePaths): string => join(p.root, 'engine.pid')

function killTree(pid: number, signal: NodeJS.Signals): void {
  try {
    if (isWin) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    else process.kill(-pid, signal)
  } catch {
    /* already gone */
  }
}

/** An engine left running by a crash or force-quit still holds its port and CPU: stop it before starting a new one. */
function killStale(p: EnginePaths): void {
  if (!existsSync(pidFile(p))) return
  const pid = Number(readFileSync(pidFile(p), 'utf8'))
  // Only if that PID is still our engine: after a reboot the number may belong to another program.
  const cmd = isWin
    ? spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }).stdout
    : spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout
  const ours = isWin ? /python/i.test(cmd ?? '') : (cmd ?? '').includes('uvicorn app:app') && (cmd ?? '').includes(p.venv)
  if (pid > 0 && ours) killTree(pid, 'SIGKILL')
  rmSync(pidFile(p), { force: true })
}

/**
 * Stop the engine and every job process it started. OpenShorts ignores SIGTERM (it drains jobs like a server
 * deploy), but SIGINT shuts it down in about a second; anything still alive after 5 s is killed.
 */
export async function stopEngine(child: ChildProcess, p?: EnginePaths): Promise<void> {
  if (p) rmSync(pidFile(p), { force: true })
  if (child.exitCode !== null || !child.pid) return
  const pid = child.pid
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  killTree(pid, 'SIGINT')
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000))
  if ((await Promise.race([exited, timeout])) === 'timeout') killTree(pid, 'SIGKILL')
}
