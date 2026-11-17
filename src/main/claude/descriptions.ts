import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type { Descriptions, Project, Variant } from '@shared/types'
import { getSecret } from '../store/secrets'
import { getSettings } from '../store/settings'

const DescriptionSchema = z.object({
  youtube: z.object({ title: z.string(), description: z.string(), tags: z.array(z.string()) }),
  instagram: z.object({ caption: z.string(), hashtags: z.array(z.string()) }),
  tiktok: z.object({ caption: z.string(), hashtags: z.array(z.string()) })
})
const HooksSchema = z.object({ hooks: z.array(z.string()) })

/** Platform limits; copy is shortened, the credit block never is. */
export const LIMITS = { youtubeTitle: 100, youtubeDescription: 5000, instagramCaption: 2200, instagramHashtags: 30, tiktokCaption: 2200 }

async function client(): Promise<Anthropic | null> {
  const key = await getSecret('anthropicKey')
  return key ? new Anthropic({ apiKey: key }) : null
}

async function ask<T>(schema: z.ZodType<T>, system: string, user: string): Promise<T> {
  const c = await client()
  if (!c) throw new Error('No Claude key set.')
  const model = (await getSettings()).claudeModel
  // Server-side refusal fallback is not offered on Haiku.
  const fallback = model.includes('haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
  const res = await c.beta.messages.parse({
    model,
    max_tokens: 4000,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
    ...fallback
  })
  if (res.stop_reason === 'refusal') throw new Error('Claude declined to write this description. Edit it by hand instead.')
  if (!res.parsed_output) throw new Error('Claude returned no usable description.')
  return res.parsed_output as T
}

function context(p: Project): string {
  return [
    `Twitch clip title: ${p.clip.title}`,
    `Streamer: ${p.clip.broadcasterName}`,
    `Category: ${p.clip.gameName ?? 'unknown'}`,
    `Views on Twitch: ${p.clip.viewCount}`,
    p.meta?.title ? `Suggested short title: ${p.meta.title}` : '',
    p.meta?.hook ? `Suggested hook: ${p.meta.hook}` : '',
    p.notes ? `Notes from the editor: ${p.notes}` : '',
    p.meta?.transcript ? `What is said in the clip:\n${p.meta.transcript.slice(0, 6000)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export async function claudeHooks(p: Project, n: number): Promise<string[] | null> {
  if (!(await client())) return null
  const out = await ask(
    HooksSchema,
    'You write on-screen hook lines for vertical gaming/streaming clips: max 8 words, no hashtags, no emojis, in the language of the clip.',
    `${context(p)}\n\nWrite ${n} different hook lines, each a different angle (tension, curiosity, humour, stakes).`
  )
  return out.hooks.slice(0, n)
}

export function renderCredit(template: string, p: Project): string {
  const vars: Record<string, string> = {
    streamer: p.clip.broadcasterName,
    streamer_url: `https://twitch.tv/${p.clip.broadcasterName.toLowerCase()}`,
    clip_url: p.clip.url,
    clip_title: p.clip.title,
    category: p.clip.gameName ?? '',
    clipper: p.clip.creatorName,
    date: p.clip.createdAt.slice(0, 10)
  }
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m).trim()
}

const tag = (h: string): string => '#' + h.replace(/^#+/, '').replace(/\s+/g, '')
const dedupe = (tags: string[]): string[] => [...new Map(tags.map((t) => [tag(t).toLowerCase(), tag(t)])).values()]

function fit(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, '') + '…'
}

/** Assemble the final text per platform: copy + hashtags shortened to fit, credit block appended verbatim. */
export function finalize(d: Omit<Descriptions, 'source'>, credit: string, source: Descriptions['source']): Descriptions {
  const block = credit ? `\n\n${credit}` : ''
  const ig = dedupe(d.instagram.hashtags).slice(0, LIMITS.instagramHashtags)
  const tt = dedupe(d.tiktok.hashtags)
  const join = (caption: string, tags: string[], max: number): string => {
    const tagLine = tags.length ? `\n\n${tags.join(' ')}` : ''
    return fit(caption.trim(), max - block.length - tagLine.length) + tagLine + block
  }
  return {
    youtube: {
      title: fit(d.youtube.title.trim(), LIMITS.youtubeTitle),
      description: fit(d.youtube.description.trim(), LIMITS.youtubeDescription - block.length) + block,
      tags: dedupe(d.youtube.tags).map((t) => t.slice(1))
    },
    instagram: { caption: join(d.instagram.caption, ig, LIMITS.instagramCaption), hashtags: ig },
    tiktok: { caption: join(d.tiktok.caption, tt, LIMITS.tiktokCaption), hashtags: tt },
    source
  }
}

const hashtagsIn = (s = ''): string[] => s.match(/#[\p{L}\p{N}_]+/gu) ?? []
const withoutTags = (s = ''): string => s.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim()

export async function generateDescriptions(p: Project, v: Variant, credit: string): Promise<Descriptions> {
  const settings = await getSettings()
  if (await client()) {
    const d = await ask(
      DescriptionSchema,
      `You write publishing copy for short vertical clips cut from Twitch streams. ${settings.descriptionPrompt}\n` +
        'Never invent facts that are not in the clip context. Do not add credits or links: they are appended automatically. Hashtags go in the hashtag arrays, not in the caption text.',
      `${context(p)}\nOn-screen hook of this variant: ${v.hookText}\n\nWrite the YouTube Shorts title (max 100 characters), description and tags, the Instagram Reels caption and hashtags, and the TikTok caption and hashtags.`
    )
    return finalize(d, credit, 'claude')
  }
  // No Claude key: OpenShorts' own copy.
  const title = p.meta?.title || p.clip.title
  return finalize(
    {
      youtube: { title, description: withoutTags(p.meta?.tiktok || title), tags: hashtagsIn(p.meta?.tiktok) },
      instagram: { caption: withoutTags(p.meta?.instagram || title), hashtags: hashtagsIn(p.meta?.instagram) },
      tiktok: { caption: withoutTags(p.meta?.tiktok || title), hashtags: hashtagsIn(p.meta?.tiktok) }
    },
    credit,
    'openshorts'
  )
}

export async function testClaude(): Promise<string> {
  const c = await client()
  if (!c) throw new Error('No Claude key set.')
  const page = await c.models.list({ limit: 5 })
  return `Connected. ${page.data.length ? 'Models available.' : ''}`
}
