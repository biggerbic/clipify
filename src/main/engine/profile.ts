import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export type ProfileId = 'mac-arm64' | 'win-nvidia' | 'win-cpu' | 'remote'

export interface Profile {
  id: ProfileId
  label: string
  gpu: boolean
  /** Env OpenShorts reads (see plan §5.2). */
  env: Record<string, string>
}

const COMMON = {
  MIN_SOURCE_SECONDS: '0',
  AUTO_LAYOUT: '1',
  JOB_RETENTION_SECONDS: '86400',
  PYTHONUNBUFFERED: '1',
  PYTHONIOENCODING: 'utf-8'
}

export const PROFILES: Record<Exclude<ProfileId, 'remote'>, Profile> = {
  'mac-arm64': {
    id: 'mac-arm64',
    label: 'Mac · Apple Silicon (CPU)',
    gpu: false,
    env: { ...COMMON, WHISPER_DEVICE: 'cpu', MAX_CONCURRENT_JOBS: '1', FFMPEG_ENCODER: 'libx264' }
  },
  'win-cpu': {
    id: 'win-cpu',
    label: 'Windows (CPU)',
    gpu: false,
    env: { ...COMMON, WHISPER_DEVICE: 'cpu', MAX_CONCURRENT_JOBS: '1', FFMPEG_ENCODER: 'libx264' }
  },
  'win-nvidia': {
    id: 'win-nvidia',
    label: 'Windows · NVIDIA GPU',
    gpu: true,
    env: {
      ...COMMON,
      WHISPER_MODEL: 'large-v3-turbo',
      WHISPER_DEVICE: 'cuda',
      WHISPER_COMPUTE: 'float16',
      FFMPEG_ENCODER: 'auto',
      TRANSCRIBE_BACKEND: 'parakeet',
      ASR_GPU_CONCURRENCY: '1',
      MAX_CONCURRENT_JOBS: '2'
    }
  }
}

async function hasNvidiaGpu(): Promise<boolean> {
  try {
    const { stdout } = await promisify(execFile)('nvidia-smi', ['-L'], { timeout: 5000, windowsHide: true })
    return /GPU \d+:/.test(stdout)
  } catch {
    return false
  }
}

/** The local profile this machine should run. Throws on hardware v1 does not support. */
export async function detectProfile(): Promise<Profile> {
  if (process.platform === 'darwin' && process.arch === 'arm64') return PROFILES['mac-arm64']
  if (process.platform === 'win32' && process.arch === 'x64') {
    return (await hasNvidiaGpu()) ? PROFILES['win-nvidia'] : PROFILES['win-cpu']
  }
  throw new Error(`Clipify's local engine supports Apple Silicon Macs and 64-bit Windows. This machine is ${process.platform}/${process.arch}: use a remote engine instead.`)
}
