import { copyFile, mkdir, readFile, rm, stat, writeFile, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { download, run, type LineFn } from '../util/run'
import type { Profile } from './profile'

export interface Manifest {
  openshorts: { repo: string; commit: string }
  uv: string
  python: string
  torch: { torch: string; torchvision: string }
}

export interface EnginePaths {
  root: string
  bin: string
  uv: string
  python: string
  venv: string
  venvPython: string
  source: string
  models: string
  cache: string
  installed: string
}

const isWin = process.platform === 'win32'
const exe = (name: string): string => (isWin ? `${name}.exe` : name)

export function enginePaths(root: string, m: Manifest): EnginePaths {
  const venv = join(root, 'venv')
  return {
    root,
    bin: join(root, 'bin'),
    uv: join(root, 'bin', exe('uv')),
    python: join(root, 'python'),
    venv,
    venvPython: isWin ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python'),
    source: join(root, `openshorts-${m.openshorts.commit.slice(0, 12)}`),
    models: join(root, 'models'),
    cache: join(root, 'cache'),
    installed: join(root, 'installed.json')
  }
}

export interface InstallProgress {
  step: InstallStepId
  status: 'running' | 'done' | 'failed'
  message?: string
  percent?: number
}

export type InstallStepId = 'uv' | 'python' | 'source' | 'packages' | 'ffmpeg' | 'models' | 'verify'

export const INSTALL_STEPS: { id: InstallStepId; label: string }[] = [
  { id: 'uv', label: 'Installer tool (uv)' },
  { id: 'python', label: 'Private Python 3.11' },
  { id: 'source', label: 'OpenShorts source' },
  { id: 'packages', label: 'AI and video packages' },
  { id: 'ffmpeg', label: 'FFmpeg' },
  { id: 'models', label: 'Detection models' },
  { id: 'verify', label: 'Self-check' }
]

/** Env every uv / python call shares: everything lives inside the engine folder. */
export function toolEnv(p: EnginePaths): NodeJS.ProcessEnv {
  return {
    ...process.env,
    UV_PYTHON_INSTALL_DIR: p.python,
    UV_CACHE_DIR: join(p.cache, 'uv'),
    UV_PYTHON_PREFERENCE: 'only-managed',
    HF_HOME: join(p.models, 'hf'),
    YOLO_CONFIG_DIR: join(p.models, 'ultralytics'),
    TORCH_HOME: join(p.models, 'torch'),
    MPLCONFIGDIR: join(p.cache, 'mpl'),
    PATH: [p.bin, isWin ? join(p.venv, 'Scripts') : join(p.venv, 'bin'), process.env.PATH].join(isWin ? ';' : ':')
  }
}

export async function readInstalled(p: EnginePaths): Promise<{ commit: string; profile: string } | null> {
  try {
    return JSON.parse(await readFile(p.installed, 'utf8'))
  } catch {
    return null
  }
}

function uvAsset(): string {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'uv-aarch64-apple-darwin.tar.gz' : 'uv-x86_64-apple-darwin.tar.gz'
  if (isWin) return 'uv-x86_64-pc-windows-msvc.zip'
  return 'uv-x86_64-unknown-linux-gnu.tar.gz'
}

/**
 * Install (or repair) the native OpenShorts engine into `p.root`.
 * Each step is skipped when its output already exists, so a failed install resumes where it stopped.
 */
export async function installEngine(
  p: EnginePaths,
  m: Manifest,
  profile: Profile,
  ff: { ffmpeg: string; ffprobe: string },
  patchesFile: string,
  emit: (e: InstallProgress) => void
): Promise<void> {
  const env = toolEnv(p)
  const step = async (id: InstallStepId, fn: (log: LineFn) => Promise<void>): Promise<void> => {
    emit({ step: id, status: 'running' })
    try {
      await fn((line) => emit({ step: id, status: 'running', message: line }))
      emit({ step: id, status: 'done' })
    } catch (err) {
      emit({ step: id, status: 'failed', message: (err as Error).message })
      throw err
    }
  }
  await mkdir(p.bin, { recursive: true })

  await step('uv', async () => {
    if (existsSync(p.uv)) return
    const asset = uvAsset()
    const archive = join(p.cache, asset)
    await download(`https://github.com/astral-sh/uv/releases/download/${m.uv}/${asset}`, archive, (d, t) =>
      emit({ step: 'uv', status: 'running', percent: t ? (d / t) * 100 : undefined })
    )
    // Both archives hold uv at the top level (zip) or in one folder (tar.gz): bsdtar on macOS and Windows 10+ handles both.
    await run('tar', ['-xf', archive, '-C', p.bin, ...(isWin ? [] : ['--strip-components=1'])])
    if (!isWin) await chmod(p.uv, 0o755)
  })

  await step('python', async (log) => {
    await run(p.uv, ['python', 'install', m.python], { env, onLine: log })
  })

  await step('source', async (log) => {
    if (existsSync(join(p.source, 'app.py'))) return
    const archive = join(p.cache, `openshorts-${m.openshorts.commit}.tar.gz`)
    await download(`https://codeload.github.com/${m.openshorts.repo}/tar.gz/${m.openshorts.commit}`, archive, (d) =>
      emit({ step: 'source', status: 'running', message: `${(d / 1e6).toFixed(1)} MB` })
    )
    await mkdir(p.source, { recursive: true })
    await run('tar', ['-xzf', archive, '-C', p.source, '--strip-components=1'], { onLine: log })
    if (isWin) await applyPatches(p.source, patchesFile)
  })

  await step('packages', async (log) => {
    if (!existsSync(p.venvPython)) await run(p.uv, ['venv', p.venv, '--python', m.python], { env, onLine: log })
    const pip = (args: string[]): Promise<string> => run(p.uv, ['pip', 'install', '--python', p.venvPython, ...args], { env, onLine: log })
    const torch = [`torch==${m.torch.torch}`, `torchvision==${m.torch.torchvision}`]
    if (profile.gpu) {
      // OpenShorts' GPU lock is a Linux freeze: torch/triton/nvidia-* there are Linux wheels. On Windows the CUDA
      // torch wheel from the PyTorch index carries its own CUDA runtime; ctranslate2 (whisper) still needs the
      // cuBLAS/cuDNN 12 wheels, whose DLL folders process.ts puts on PATH.
      await pip(['--index-url', 'https://download.pytorch.org/whl/cu128', ...torch])
      const lock = await readFile(join(p.source, 'requirements-gpu.lock'), 'utf8')
      const keep = lock.split('\n').filter((l) => !/^(torch|torchvision|triton|nvidia-)[=\s]/.test(l))
      const cuda12 = lock.split('\n').filter((l) => /^nvidia-(cublas|cudnn)-cu12==/.test(l))
      const winLock = join(p.cache, 'requirements-gpu-windows.lock')
      await writeFile(winLock, [...keep, ...cuda12].join('\n'))
      await pip(['--no-deps', '-r', winLock])
    } else {
      // macOS wheels come from PyPI; Windows/Linux CPU wheels from the PyTorch CPU index (no CUDA download).
      await pip(process.platform === 'darwin' ? torch : ['--index-url', 'https://download.pytorch.org/whl/cpu', ...torch])
      await pip(['--no-deps', '-r', join(p.source, 'requirements-cpu.lock')])
    }
    // Same guard as OpenShorts' Dockerfile: everything requirements.txt asks for must already be pinned.
    await pip(['--no-deps', '-r', join(p.source, 'requirements.txt')])
  })

  await step('ffmpeg', async () => {
    for (const [name, src] of Object.entries(ff)) {
      const dest = join(p.bin, exe(name))
      await copyFile(src, dest)
      if (!isWin) await chmod(dest, 0o755)
    }
  })

  await step('models', async (log) => {
    for (const dir of ['hf', 'ultralytics', 'torch']) await mkdir(join(p.models, dir), { recursive: true })
    await mkdir(join(p.cache, 'mpl'), { recursive: true })
    await run(p.venvPython, ['-c', "from ultralytics import YOLO; YOLO('yolov8n.pt'); print('yolo ok')"], {
      cwd: p.source,
      env,
      onLine: log
    })
  })

  await step('verify', async (log) => {
    const check = [
      'import fastapi, faster_whisper, cv2, mediapipe, ultralytics, scenedetect, torch',
      `print('torch', torch.__version__, 'cuda', torch.cuda.is_available())`,
      ...(profile.gpu ? ["assert torch.cuda.is_available(), 'CUDA is not available to PyTorch'"] : [])
    ].join('\n')
    await run(p.venvPython, ['-c', check], { cwd: p.source, env, onLine: log })
    const s = await stat(join(p.bin, exe('ffmpeg')))
    if (!s.size) throw new Error('ffmpeg missing')
  })

  await writeFile(p.installed, JSON.stringify({ commit: m.openshorts.commit, profile: profile.id, at: new Date().toISOString() }, null, 2))
}

interface Patch {
  file: string
  find: string
  replace: string
  why: string
}

/** Apply text patches; fail loudly when upstream moved the code, so a silent half-patched engine never ships. */
export async function applyPatches(sourceDir: string, patchesFile: string): Promise<void> {
  const patches = JSON.parse(await readFile(patchesFile, 'utf8')) as Patch[]
  for (const patch of patches) {
    const file = join(sourceDir, patch.file)
    const text = await readFile(file, 'utf8')
    if (text.includes(patch.replace)) continue
    if (!text.includes(patch.find)) throw new Error(`Engine patch no longer matches ${patch.file}: ${patch.why}`)
    await writeFile(file, text.replace(patch.find, patch.replace))
  }
}

export async function removeEngine(p: EnginePaths): Promise<void> {
  await rm(p.root, { recursive: true, force: true })
}
