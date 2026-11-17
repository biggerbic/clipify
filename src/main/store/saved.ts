import { join } from 'node:path'
import type { Saved, TwitchCategory, TwitchChannel } from '@shared/types'
import { getSettings } from './settings'
import { readJson, writeJson } from './json'

const EMPTY: Saved = { categories: [], channels: [], creditOverrides: {} }
const file = async (): Promise<string> => join((await getSettings()).libraryDir, 'saved.json')

export async function getSaved(): Promise<Saved> {
  return { ...EMPTY, ...(await readJson<Partial<Saved>>(await file(), {})) }
}
async function put(s: Saved): Promise<Saved> {
  await writeJson(await file(), s)
  return s
}

export async function toggleCategory(c: TwitchCategory): Promise<Saved> {
  const s = await getSaved()
  s.categories = s.categories.some((x) => x.id === c.id) ? s.categories.filter((x) => x.id !== c.id) : [...s.categories, c]
  return put(s)
}
export async function toggleChannel(c: TwitchChannel): Promise<Saved> {
  const s = await getSaved()
  s.channels = s.channels.some((x) => x.id === c.id) ? s.channels.filter((x) => x.id !== c.id) : [...s.channels, { ...c, live: undefined, viewerCount: undefined }]
  return put(s)
}
export async function setCreditOverride(channelId: string, template: string): Promise<Saved> {
  const s = await getSaved()
  if (template.trim()) s.creditOverrides[channelId] = template.trim()
  else delete s.creditOverrides[channelId]
  return put(s)
}
