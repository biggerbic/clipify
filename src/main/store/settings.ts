import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Recipe, Settings } from '@shared/types'
import { ctx } from '../context'
import { readJson, writeJson } from './json'

export const DEFAULT_RECIPES: Recipe[] = [
  {
    id: 'bold',
    name: 'Bold',
    captions: { preset: 'hormozi' },
    hook: { style: 'pill', size: 'M', position: 'auto', font: 'montserrat', duration_seconds: null }
  },
  {
    id: 'clean',
    name: 'Clean',
    captions: { preset: 'clean' },
    hook: { style: 'dark', size: 'S', position: 'auto', font: 'montserrat', duration_seconds: 4 }
  },
  {
    id: 'punchy',
    name: 'Punchy',
    captions: { preset: 'oneword' },
    hook: { style: 'yellow', size: 'L', position: 'auto', font: 'anton', duration_seconds: null }
  },
  {
    id: 'lime',
    name: 'Highlight',
    captions: { preset: 'lime' },
    hook: { style: 'outline', size: 'M', position: 'auto', font: 'anton', duration_seconds: null }
  },
  {
    id: 'classic',
    name: 'Classic',
    captions: { preset: 'default' },
    hook: { style: 'classic', size: 'M', position: 'auto', font: 'serif', duration_seconds: null }
  }
]

export const DEFAULT_SETTINGS: Settings = {
  libraryDir: join(homedir(), 'Clipify'),
  engine: { mode: 'local', remoteUrl: '', shareEnabled: false, sharePort: 8765 },
  claudeModel: 'claude-opus-5-5',
  descriptionPrompt:
    'Write punchy, native-sounding copy for gaming and streaming fans. Lead with the moment, not the streamer. Use 1–2 emojis at most and 3–5 relevant hashtags. English.',
  creditTemplate: '🎮 Clip: {streamer} — {streamer_url}',
  unsplash: { enabled: true, query: 'dark moody landscape' },
  launchAtLogin: true,
  defaultVariants: 3,
  recipes: DEFAULT_RECIPES
}

let cache: Settings | null = null
const file = (): string => join(ctx.userData, 'settings.json')

export async function getSettings(): Promise<Settings> {
  if (!cache) {
    const stored = await readJson<Partial<Settings>>(file(), {})
    cache = { ...DEFAULT_SETTINGS, ...stored, engine: { ...DEFAULT_SETTINGS.engine, ...stored.engine }, unsplash: { ...DEFAULT_SETTINGS.unsplash, ...stored.unsplash } }
  }
  return cache
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  cache = next
  await writeJson(file(), next)
  return next
}
