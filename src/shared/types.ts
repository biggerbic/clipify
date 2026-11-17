// Domain types shared by the main process and the renderer.

export type ProfileId = 'mac-arm64' | 'win-nvidia' | 'win-cpu' | 'remote'
export type Platform = 'youtube' | 'instagram' | 'tiktok'

export interface Settings {
  libraryDir: string
  engine: { mode: 'local' | 'remote'; remoteUrl: string; shareEnabled: boolean; sharePort: number }
  claudeModel: string
  descriptionPrompt: string
  creditTemplate: string
  unsplash: { enabled: boolean; query: string }
  launchAtLogin: boolean
  defaultVariants: number
  recipes: Recipe[]
}

export const SECRET_KEYS = [
  'geminiKey',
  'anthropicKey',
  'unsplashKey',
  'twitchClientId',
  'twitchClientSecret',
  'googleClientId',
  'googleClientSecret',
  'metaAppId',
  'metaAppSecret',
  'remoteToken'
] as const
export type SecretKey = (typeof SECRET_KEYS)[number]
/** The renderer only ever learns whether a secret is set, never its value. */
export type SecretsStatus = Record<SecretKey, boolean>

export interface InstallStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'failed'
  percent?: number
  message?: string
}

export interface EngineStatus {
  state: 'not-installed' | 'installing' | 'stopped' | 'starting' | 'ready' | 'error'
  mode: 'local' | 'remote'
  profile?: ProfileId
  profileLabel?: string
  message?: string
  install: InstallStep[]
  share: { enabled: boolean; addresses: string[]; port: number; code?: string }
}

// ---------- Twitch ----------
export interface TwitchClip {
  id: string
  url: string
  embedUrl: string
  broadcasterId: string
  broadcasterName: string
  creatorName: string
  gameId: string
  gameName?: string
  language: string
  title: string
  viewCount: number
  createdAt: string
  thumbnailUrl: string
  duration: number
  isFeatured: boolean
}
export interface TwitchCategory {
  id: string
  name: string
  boxArtUrl: string
}
export interface TwitchChannel {
  id: string
  login: string
  name: string
  avatarUrl?: string
  live?: boolean
  viewerCount?: number
  gameName?: string
}
export interface ClipQuery {
  categoryIds?: string[]
  channelIds?: string[]
  range: '24h' | '7d' | '30d' | 'all'
  minViews?: number
  maxDuration?: number
  language?: string
  featuredOnly?: boolean
  hideUsed?: boolean
  sort: 'views' | 'newest'
}
export interface Saved {
  categories: TwitchCategory[]
  channels: TwitchChannel[]
  /** channelId → credit template override */
  creditOverrides: Record<string, string>
}

// ---------- Generation ----------
/** OpenShorts caption presets (subtitles.CAPTION_PRESETS). */
export const CAPTION_PRESETS = ['default', 'hormozi', 'pill', 'lime', 'oneword', 'clean'] as const
/** A preset plus only the fields the user changed: OpenShorts applies explicit fields on top of the preset. */
export interface CaptionStyle {
  preset: (typeof CAPTION_PRESETS)[number]
  style?: 'classic' | 'karaoke'
  position?: 'top' | 'middle' | 'bottom'
  font_name?: string
  font_size?: number
  font_color?: string
  highlight_color?: string
  border_color?: string
  border_width?: number
  bg_color?: string
  bg_opacity?: number
  effect?: 'none' | 'glow' | 'pop' | 'box' | 'highlight'
  uppercase?: boolean
  reveal?: boolean
  shadow?: number
  max_chars?: number
}
export interface HookStyle {
  style: 'pill' | 'classic' | 'dark' | 'yellow' | 'red' | 'outline' | 'outline_yellow'
  size: 'S' | 'M' | 'L'
  position: 'auto' | 'top' | 'center' | 'bottom'
  font: 'montserrat' | 'anton' | 'serif'
  duration_seconds: number | null
}
export interface Recipe {
  id: string
  name: string
  captions: CaptionStyle | null
  hook: HookStyle | null
}

export type ProjectStatus = 'generating' | 'review' | 'ready' | 'scheduled' | 'published' | 'failed'
export type RevisionOp = 'generate' | 'trim' | 'frame' | 'captions' | 'hook'

export interface Revision {
  id: string
  file: string // relative to the project dir
  op: RevisionOp
  params?: unknown
  createdAt: string
}
export interface Descriptions {
  youtube: { title: string; description: string; tags: string[] }
  instagram: { caption: string; hashtags: string[] }
  tiktok: { caption: string; hashtags: string[] }
  source: 'claude' | 'openshorts'
}
export type PostStatus = 'queued' | 'uploading' | 'scheduled' | 'published' | 'failed' | 'missed' | 'manual'
export interface Post {
  id: string
  accountId: string
  platform: Platform
  mode: 'now' | 'scheduled' | 'manual'
  scheduledAt?: string
  status: PostStatus
  remoteId?: string
  url?: string
  error?: string
  publishedAt?: string
}
export interface Variant {
  id: string
  index: number
  recipeId: string
  recipeName: string
  hookText: string
  captions: CaptionStyle | null
  hook: HookStyle | null
  /** User-corrected caption words (clip-relative ms); dropped when the cut changes. */
  captionWords?: { text: string; startMs: number; endMs: number }[]
  status: 'pending' | 'rendering' | 'ready' | 'failed'
  error?: string
  /** OpenShorts file name of the current revision inside the job (input for the next edit). */
  engineFile?: string
  current?: string
  revisions: Revision[]
  descriptions?: Descriptions
  posts: Post[]
}
export interface Project {
  id: string
  createdAt: string
  updatedAt: string
  status: ProjectStatus
  clip: TwitchClip
  notes: string
  engine: { jobId?: string; profile?: ProfileId; commit?: string; baseFile?: string; error?: string; progress?: string }
  meta?: { title?: string; hook?: string; tiktok?: string; instagram?: string; transcript?: string }
  variants: Variant[]
}

// ---------- Accounts / stats ----------
export interface Account {
  id: string
  platform: Platform
  name: string
  handle?: string
  avatarUrl?: string
  remoteId?: string
  connectedAt: string
  status: 'ok' | 'expired' | 'error' | 'manual'
}
export type Period = '7d' | '28d' | '90d' | 'all'
export interface Totals {
  views: number
  likes: number
  comments: number
  shares: number
  followersGained: number
  posts: number
}
export interface StatsOverview {
  period: Period
  totals: Totals
  previous: Totals
  series: { date: string; youtube: number; instagram: number }[]
  accounts: { account: Account; totals: Totals }[]
  topPosts: TopPost[]
  insights: Insights
  lastCollectedAt?: string
}
export interface TopPost {
  postId: string
  projectId: string
  variantId: string
  platform: Platform
  accountName: string
  title: string
  thumbnail?: string
  url?: string
  views: number
  likes: number
  comments: number
  shares: number
  engagementRate: number
  publishedAt?: string
}
export interface Insights {
  bestSources: { kind: 'channel' | 'category'; name: string; posts: number; avgViews: number }[]
  recipes: { name: string; posts: number; avgViews: number; engagementRate: number }[]
  heatmap: { day: number; hour: number; avgViews: number; posts: number }[]
  funnel: { picked: number; generated: number; published: number; over10k: number }
  needsAttention: { kind: 'failed' | 'missed' | 'expired'; text: string; projectId?: string }[]
  takingOff: TopPost[]
  streaks: { accountName: string; lastPostAt?: string; postsLast7d: number; nextScheduledAt?: string }[]
}

export interface Background {
  url: string
  color?: string
  photographer: string
  photographerUrl: string
  unsplashUrl: string
}

export interface SetupState {
  engine: boolean
  gemini: boolean
  claude: boolean
  twitch: boolean
  youtube: boolean
  instagram: boolean
  unsplash: boolean
  storage: boolean
}

export interface QueueItem {
  projectId: string
  title: string
  state: 'queued' | 'running' | 'done' | 'failed'
  progress?: string
}
