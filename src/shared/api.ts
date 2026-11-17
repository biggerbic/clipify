import type {
  Account,
  Background,
  CaptionStyle,
  ClipQuery,
  Descriptions,
  EngineStatus,
  HookStyle,
  Period,
  Platform,
  Project,
  QueueItem,
  Saved,
  SecretKey,
  SecretsStatus,
  Settings,
  SetupState,
  StatsOverview,
  TwitchCategory,
  TwitchChannel,
  TwitchClip
} from './types'

/** Caption word, clip-relative milliseconds (OpenShorts' transcript shape). */
export interface CaptionWord {
  text: string
  startMs: number
  endMs: number
}
export interface Edl {
  segments: { start: number; end: number }[]
  words: { w: string; s: number; e: number }[]
  duration: number
  sourceDuration: number
  limits: { max_segments: number; min_segment_seconds: number; max_total_seconds: number }
}
export interface Scene {
  index: number
  start: number
  end: number
  thumbnail?: string
  crop?: number | { top: number; bottom: number }
}
export interface PublishTarget {
  accountId: string
  platform: Platform
  mode: 'now' | 'scheduled'
  scheduledAt?: string
}

/** Every IPC call the renderer can make. Implemented in src/main/ipc.ts. */
export interface Api {
  // settings & secrets
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  secretsStatus(): Promise<SecretsStatus>
  setSecret(key: SecretKey, value: string): Promise<SecretsStatus>
  testKey(kind: 'gemini' | 'claude' | 'twitch' | 'unsplash'): Promise<{ ok: boolean; message: string }>
  setupState(): Promise<SetupState>
  exportTeamSetup(passphrase: string): Promise<{ ok: boolean; path?: string }>
  importTeamSetup(passphrase: string): Promise<{ ok: boolean; message: string }>
  chooseLibraryDir(): Promise<Settings>

  // engine
  engineStatus(): Promise<EngineStatus>
  engineInstall(): Promise<void>
  engineStart(): Promise<void>
  engineStop(): Promise<void>
  engineRepair(): Promise<void>
  engineLogs(): Promise<string[]>
  engineUseRemote(url: string, code: string): Promise<{ ok: boolean; message: string }>
  engineUseLocal(): Promise<void>
  engineShare(enabled: boolean): Promise<EngineStatus>

  // twitch
  topCategories(): Promise<TwitchCategory[]>
  searchCategories(q: string): Promise<TwitchCategory[]>
  searchChannels(q: string): Promise<TwitchChannel[]>
  topChannels(categoryId?: string): Promise<TwitchChannel[]>
  clips(q: ClipQuery): Promise<TwitchClip[]>
  clipFromUrl(url: string): Promise<TwitchClip>
  saved(): Promise<Saved>
  toggleSavedCategory(c: TwitchCategory): Promise<Saved>
  toggleSavedChannel(c: TwitchChannel): Promise<Saved>
  setCreditOverride(channelId: string, template: string): Promise<Saved>
  usedClipIds(): Promise<string[]>

  // projects
  listProjects(): Promise<Project[]>
  getProject(id: string): Promise<Project>
  createProject(clip: TwitchClip, variantCount: number, recipeIds: string[]): Promise<Project>
  deleteProject(id: string): Promise<void>
  retryProject(id: string): Promise<void>
  queue(): Promise<QueueItem[]>
  mediaUrl(projectId: string, file: string): Promise<string>

  // editor
  edl(projectId: string, variantId: string): Promise<Edl>
  trim(projectId: string, variantId: string, segments: { start: number; end: number }[]): Promise<Project>
  scenes(projectId: string, variantId: string): Promise<Scene[]>
  reframe(projectId: string, variantId: string, overrides: Record<string, number | { top: number; bottom: number }>): Promise<Project>
  setCaptions(projectId: string, variantId: string, style: CaptionStyle | null, words?: CaptionWord[]): Promise<Project>
  captionWords(projectId: string, variantId: string): Promise<CaptionWord[]>
  setHook(projectId: string, variantId: string, text: string, style: HookStyle | null): Promise<Project>
  setRevision(projectId: string, variantId: string, revisionId: string): Promise<Project>
  timelineStrip(projectId: string, variantId: string): Promise<{ thumbs: string[]; peaks: number[] }>

  // descriptions
  generateDescriptions(projectId: string, variantId: string): Promise<Descriptions>
  saveDescriptions(projectId: string, variantId: string, d: Descriptions): Promise<Project>
  creditBlock(projectId: string): Promise<string>

  // accounts & publishing
  accounts(): Promise<Account[]>
  connectAccount(platform: 'youtube' | 'instagram'): Promise<Account[]>
  addManualAccount(platform: Platform, name: string, handle: string): Promise<Account[]>
  disconnectAccount(id: string): Promise<Account[]>
  publish(projectId: string, variantId: string, targets: PublishTarget[]): Promise<Project>
  markPosted(projectId: string, variantId: string, accountId: string, url?: string): Promise<Project>
  retryPost(projectId: string, variantId: string, postId: string): Promise<Project>
  cancelPost(projectId: string, variantId: string, postId: string): Promise<Project>
  exportVariant(projectId: string, variantId: string): Promise<{ ok: boolean; path?: string }>
  copyText(text: string): Promise<void>
  openExternal(url: string): Promise<void>

  // stats & home
  statsOverview(period: Period, accountId?: string): Promise<StatsOverview>
  collectStats(): Promise<void>
  exportCsv(kind: 'posts' | 'accounts', period: Period): Promise<{ ok: boolean; path?: string }>
  background(screen: 'home' | 'dashboard'): Promise<Background | null>
}

export type ApiEvent =
  | { type: 'engine'; status: EngineStatus }
  | { type: 'project'; project: Project }
  | { type: 'queue'; items: QueueItem[] }
  | { type: 'notice'; level: 'info' | 'success' | 'error'; text: string }

export type ApiMethod = keyof Api
