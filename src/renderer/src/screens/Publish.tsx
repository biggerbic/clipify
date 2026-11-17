import { useMemo, useState } from 'react'
import { CalendarClock, Check, Copy, Download, ExternalLink, RotateCcw, Send, X } from 'lucide-react'
import type { PublishTarget } from '@shared/api'
import type { Account, Project, Variant } from '@shared/types'
import { api, useLoad } from '@/lib/api'
import { attempt, navigate, toast } from '@/lib/store'
import { cx, dateTime } from '@/lib/format'
import { Button, Dialog, Empty, Field, Input, Segmented, Spinner } from '@/ui'
import { PLATFORM_LABEL, PlatformDot, PostStatusBadge, VideoThumb } from '@/components/common'
import { variantMedia } from './Project'

const localInput = (d: Date): string => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16)

export function Publish({ project, onProject }: { project: Project; onProject: (p: Project) => void }) {
  const { data: accounts } = useLoad<Account[]>(() => api.accounts())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'now' | 'scheduled'>('now')
  const [when, setWhen] = useState(localInput(new Date(Date.now() + 3 * 36e5)))
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState<{ v: Variant; account: Account } | null>(null)
  const variants = project.variants.filter((v) => v.revisions.length)
  const auto = (accounts ?? []).filter((a) => a.platform !== 'tiktok' && a.status !== 'manual')
  const tiktok = (accounts ?? []).filter((a) => a.platform === 'tiktok')
  const key = (v: string, a: string): string => `${v}|${a}`
  const toggle = (k: string): void => setSelected((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])))
  const duplicates = useMemo(
    () => [...selected].filter((k) => {
      const [vid, aid] = k.split('|')
      return project.variants.find((v) => v.id === vid)?.posts.some((p) => p.accountId === aid && p.status !== 'failed' && p.status !== 'missed')
    }),
    [selected, project]
  )

  if (!accounts) return <div className="p-8"><Spinner /></div>
  if (!accounts.length)
    return (
      <Empty
        icon={<Send size={20} />}
        title="Connect an account to publish"
        body="Connect YouTube and Instagram in Settings → Accounts, or add a TikTok account to track manual posts."
        action={
          <Button variant="primary" onClick={() => navigate({ name: 'settings', section: 'accounts' })}>
            Open Accounts
          </Button>
        }
      />
    )

  const publish = async (): Promise<void> => {
    const at = mode === 'scheduled' ? new Date(when) : null
    if (at && at.getTime() < Date.now() + 2 * 6e4) return toast('error', 'Pick a time at least a few minutes from now.')
    setBusy(true)
    const byVariant = new Map<string, PublishTarget[]>()
    for (const k of selected) {
      const [vid, aid] = k.split('|')
      const acc = accounts.find((a) => a.id === aid)!
      byVariant.set(vid, [...(byVariant.get(vid) ?? []), { accountId: aid, platform: acc.platform, mode, scheduledAt: at?.toISOString() }])
    }
    let last: Project | undefined
    for (const [vid, targets] of byVariant) last = await attempt(() => api.publish(project.id, vid, targets))
    if (last) {
      onProject(last)
      toast('success', mode === 'now' ? 'Publishing started. Status updates below.' : 'Scheduled.')
      setSelected(new Set())
    }
    setBusy(false)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
        <h2 className="mb-1 font-display text-[22px]">Publish</h2>
        <p className="mb-5 text-text-3">Tick where each variant should go. Variants without saved text get descriptions written automatically. TikTok is posted by hand: download the video and copy the caption.</p>
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-bg py-2 pr-4 text-left font-normal text-text-3">Variant</th>
              {[...auto, ...tiktok].map((a) => (
                <th key={a.id} className="px-3 py-2 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <PlatformDot platform={a.platform} />
                    <span className="max-w-[140px] truncate text-text-2">{a.name}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.id} className="align-top">
                <td className="sticky left-0 z-10 border-t border-line bg-bg py-3 pr-4">
                  <div className="flex items-center gap-3">
                    <VideoThumb src={variantMedia(project, v)} className="aspect-[9/16] w-12 rounded-lg" />
                    <div className="min-w-0">
                      <p className="truncate">
                        {String(v.index).padStart(2, '0')} · {v.recipeName}
                      </p>
                      <p className="max-w-[220px] truncate text-[13px] text-text-3">{v.descriptions?.youtube.title ?? 'Text written on publish'}</p>
                    </div>
                  </div>
                </td>
                {auto.map((a) => {
                  const k = key(v.id, a.id)
                  const posts = v.posts.filter((p) => p.accountId === a.id)
                  return (
                    <td key={a.id} className="border-t border-line px-3 py-3">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="checkbox" checked={selected.has(k)} onChange={() => toggle(k)} className="h-4 w-4 accent-[var(--color-accent)]" aria-label={`Publish variant ${v.index} to ${a.name}`} />
                        <span className="text-[13px] text-text-3">{posts.length ? `${posts.length} post${posts.length > 1 ? 's' : ''}` : 'Select'}</span>
                      </label>
                    </td>
                  )
                })}
                {tiktok.map((a) => (
                  <td key={a.id} className="border-t border-line px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => void attempt(() => api.exportVariant(project.id, v.id)).then((r) => r?.ok && toast('success', 'Video saved'))}>
                        Video
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Copy size={14} />}
                        onClick={async () => {
                          const text = v.descriptions?.tiktok.caption ?? (await api.generateDescriptions(project.id, v.id)).tiktok.caption
                          await api.copyText(text)
                          toast('success', 'Caption copied')
                        }}
                      >
                        Caption
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Check size={14} />} onClick={() => setManual({ v, account: a })}>
                        Posted
                      </Button>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mt-10 mb-3 font-display text-lg">Posts</h3>
        <PostList project={project} accounts={accounts} onProject={onProject} />
      </div>

      <div className="glass flex shrink-0 flex-wrap items-center gap-4 border-x-0 border-b-0 px-8 py-4">
        <Segmented label="When" value={mode} onChange={setMode} items={[{ value: 'now', label: 'Post now' }, { value: 'scheduled', label: 'Schedule' }]} />
        {mode === 'scheduled' && (
          <label className="flex items-center gap-2 text-sm text-text-2">
            <CalendarClock size={16} aria-hidden />
            <input type="datetime-local" value={when} min={localInput(new Date())} onChange={(e) => setWhen(e.target.value)} className="h-10 rounded-[10px] border border-line bg-raised px-3 text-text [color-scheme:dark] focus:border-accent focus:outline-none" aria-label="Publish time" />
          </label>
        )}
        {mode === 'scheduled' && <span className="max-w-sm text-[13px] text-text-3">YouTube publishes on its own. Instagram posts go out from Clipify, so keep it running in the {navigator.platform.startsWith('Mac') ? 'menu bar' : 'tray'}.</span>}
        <div className="flex-1" />
        {duplicates.length > 0 && <span className="text-[13px] text-warning">{duplicates.length} selection{duplicates.length > 1 ? 's were' : ' was'} already posted to that account</span>}
        <Button variant="primary" size="lg" disabled={!selected.size} loading={busy} onClick={() => void publish()} icon={<Send size={16} />}>
          {mode === 'now' ? 'Publish' : 'Schedule'} {selected.size ? `(${selected.size})` : ''}
        </Button>
      </div>

      <Dialog open={Boolean(manual)} onOpenChange={(o) => !o && setManual(null)} title="Mark as posted on TikTok" description="Optional: paste the link to the TikTok post so you can open it later.">
        <ManualForm
          onSave={async (url) => {
            if (!manual) return
            const p = await attempt(() => api.markPosted(project.id, manual.v.id, manual.account.id, url), 'Marked as posted')
            if (p) onProject(p)
            setManual(null)
          }}
        />
      </Dialog>
    </div>
  )
}

function ManualForm({ onSave }: { onSave: (url: string) => void }) {
  const [url, setUrl] = useState('')
  return (
    <div className="flex flex-col gap-4">
      <Field label="TikTok link">{(id) => <Input id={id} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.tiktok.com/@you/video/…" />}</Field>
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => onSave(url)}>
          Mark as posted
        </Button>
      </div>
    </div>
  )
}

function PostList({ project, accounts, onProject }: { project: Project; accounts: Account[]; onProject: (p: Project) => void }) {
  const rows = project.variants.flatMap((v) => v.posts.map((post) => ({ v, post }))).sort((a, b) => (b.post.scheduledAt ?? b.post.publishedAt ?? '').localeCompare(a.post.scheduledAt ?? a.post.publishedAt ?? ''))
  if (!rows.length) return <p className="text-text-3">Nothing published yet.</p>
  return (
    <ul className="flex flex-col gap-2">
      {rows.map(({ v, post }) => {
        const acc = accounts.find((a) => a.id === post.accountId)
        return (
          <li key={post.id} className="panel flex items-center gap-4 rounded-[14px] p-3">
            <PlatformDot platform={post.platform} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {acc?.name ?? PLATFORM_LABEL[post.platform]} · variant {String(v.index).padStart(2, '0')} ({v.recipeName})
              </p>
              <p className={cx('truncate text-[13px]', post.error ? 'text-danger' : 'text-text-3')}>{post.error ?? (post.scheduledAt && post.status === 'scheduled' ? `Goes live ${dateTime(post.scheduledAt)}` : dateTime(post.publishedAt))}</p>
            </div>
            <PostStatusBadge status={post.status} />
            {post.url && (
              <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
                Open <ExternalLink size={13} />
              </a>
            )}
            {(post.status === 'failed' || post.status === 'missed') && (
              <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => void attempt(() => api.retryPost(project.id, v.id, post.id)).then((p) => p && onProject(p))}>
                Post now
              </Button>
            )}
            {(post.status === 'scheduled' || post.status === 'failed' || post.status === 'missed') && !(post.platform === 'youtube' && post.remoteId) && (
              <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => void attempt(() => api.cancelPost(project.id, v.id, post.id)).then((p) => p && onProject(p))}>
                Remove
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
