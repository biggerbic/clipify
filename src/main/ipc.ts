import { clipboard, dialog, ipcMain, shell } from 'electron'
import { copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Api } from '@shared/api'
import type { SetupState } from '@shared/types'
import { engine } from './engine/service'
import { getSettings, setSettings } from './store/settings'
import { getSecret, secretsStatus, setSecret } from './store/secrets'
import { getSaved, setCreditOverride, toggleCategory, toggleChannel } from './store/saved'
import { deleteProject, getProject, listProjects, updateProject } from './store/projects'
import * as twitch from './twitch/client'
import { createProject, queueItems, retryProject } from './jobs/generate'
import * as editor from './jobs/editor'
import { generateDescriptions, testClaude } from './claude/descriptions'
import * as accounts from './publish/accounts'
import { cancelPost, creditFor, deriveStatus, markPosted, publish, retryPost } from './publish/publisher'
import { collect, exportCsv, statsOverview } from './stats'
import { background, testUnsplash } from './unsplash'
import { exportTeamSetup, importTeamSetup } from './setup/team'

export const mediaUrl = (projectId: string, file: string): string => `clipify-media://${encodeURIComponent(projectId)}/${file.split('\\').join('/')}`

async function testGemini(): Promise<string> {
  const key = await getSecret('geminiKey')
  if (!key) throw new Error('No Gemini key set.')
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`)
  if (!res.ok) throw new Error(res.status === 400 || res.status === 403 ? 'Google rejected this key.' : `Google answered ${res.status}.`)
  return 'Key works.'
}

async function setupState(): Promise<SetupState> {
  const s = await secretsStatus()
  const accs = await accounts.listAccounts()
  const st = await engine.getStatus()
  return {
    engine: st.mode === 'remote' || (st.state !== 'not-installed' && st.state !== 'installing'),
    gemini: s.geminiKey,
    claude: s.anthropicKey,
    twitch: s.twitchClientId && s.twitchClientSecret,
    youtube: accs.some((a) => a.platform === 'youtube' && a.status !== 'manual'),
    instagram: accs.some((a) => a.platform === 'instagram' && a.status !== 'manual'),
    unsplash: s.unsplashKey,
    storage: existsSync((await getSettings()).libraryDir)
  }
}

const api: Api = {
  getSettings,
  setSettings,
  secretsStatus,
  async setSecret(key, value) {
    await setSecret(key, value)
    return secretsStatus()
  },
  async testKey(kind) {
    try {
      const message = await { gemini: testGemini, claude: testClaude, twitch: twitch.testTwitch, unsplash: testUnsplash }[kind]()
      return { ok: true, message }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  },
  setupState,
  exportTeamSetup,
  importTeamSetup,
  async chooseLibraryDir() {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || !res.filePaths[0]) return getSettings()
    return setSettings({ libraryDir: res.filePaths[0] })
  },

  engineStatus: () => engine.getStatus(),
  async engineInstall() {
    void engine.install().catch(() => undefined) // progress arrives as events
  },
  engineStart: () => engine.start(),
  engineStop: () => engine.stop(),
  async engineRepair() {
    void engine.repair().catch(() => undefined)
  },
  async engineLogs() {
    return engine.getLogs()
  },
  engineUseRemote: (url, code) => engine.useRemote(url, code),
  engineUseLocal: () => engine.useLocal(),
  engineShare: (enabled) => engine.share(enabled),

  topCategories: () => twitch.topCategories(),
  searchCategories: (q) => twitch.searchCategories(q),
  searchChannels: (q) => twitch.searchChannels(q),
  topChannels: (id) => twitch.topChannels(id),
  async clips(q) {
    const used = new Set((await listProjects()).map((p) => p.clip.id))
    return twitch.clips(q, used)
  },
  clipFromUrl: (url) => twitch.clipFromUrl(url),
  saved: getSaved,
  toggleSavedCategory: toggleCategory,
  toggleSavedChannel: toggleChannel,
  setCreditOverride,
  async usedClipIds() {
    return (await listProjects()).map((p) => p.clip.id)
  },

  listProjects,
  getProject,
  createProject,
  deleteProject,
  retryProject,
  async queue() {
    return queueItems()
  },
  async mediaUrl(projectId, file) {
    return mediaUrl(projectId, file)
  },

  edl: (projectId) => editor.edl(projectId),
  trim: (projectId, _variantId, segments) => editor.trim(projectId, segments),
  scenes: (projectId) => editor.scenes(projectId),
  reframe: (projectId, _variantId, overrides) => editor.reframe(projectId, overrides),
  setCaptions: (projectId, variantId, style, words) => editor.setCaptions(projectId, variantId, style, words),
  captionWords: (projectId, variantId) => editor.captionWords(projectId, variantId),
  setHook: (projectId, variantId, text, style) => editor.setHook(projectId, variantId, text, style),
  setRevision: (projectId, variantId, revisionId) => editor.setRevision(projectId, variantId, revisionId),
  timelineStrip: (projectId, variantId) => editor.timelineStrip(projectId, variantId),

  async generateDescriptions(projectId, variantId) {
    const p = await getProject(projectId)
    const v = p.variants.find((x) => x.id === variantId)
    if (!v) throw new Error('Variant not found')
    return generateDescriptions(p, v, await creditFor(p))
  },
  saveDescriptions(projectId, variantId, d) {
    return updateProject(projectId, (p) => {
      p.variants.find((v) => v.id === variantId)!.descriptions = d
      p.status = deriveStatus(p)
    })
  },
  async creditBlock(projectId) {
    return creditFor(await getProject(projectId))
  },

  accounts: () => accounts.listAccounts(),
  connectAccount: (platform) => accounts.connect(platform),
  addManualAccount: (platform, name, handle) => accounts.addManual(platform, name, handle),
  disconnectAccount: (id) => accounts.disconnect(id),
  publish,
  markPosted,
  retryPost,
  cancelPost,
  async exportVariant(projectId, variantId) {
    const p = await getProject(projectId)
    const src = await editor.currentFile(projectId, variantId)
    const name = `${p.clip.broadcasterName}-${p.clip.title}`.replace(/[^\w-]+/g, '_').slice(0, 60)
    const res = await dialog.showSaveDialog({ defaultPath: `${name}-${variantId}.mp4`, filters: [{ name: 'Video', extensions: ['mp4'] }] })
    if (res.canceled || !res.filePath) return { ok: false }
    await copyFile(src, res.filePath)
    return { ok: true, path: res.filePath }
  },
  async copyText(text) {
    clipboard.writeText(text)
  },
  async openExternal(url) {
    if (/^https?:\/\//.test(url)) await shell.openExternal(url)
  },

  statsOverview: (period, accountId) => statsOverview(period, accountId),
  collectStats: () => collect(),
  exportCsv,
  background
}

/** Renderer errors arrive as plain messages (Electron strips custom error data). */
export function registerIpc(): void {
  for (const [name, fn] of Object.entries(api)) {
    ipcMain.handle(`clipify:${name}`, async (_e, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args))
  }
}
