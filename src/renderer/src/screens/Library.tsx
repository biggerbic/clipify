import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bookmark, BookmarkCheck, Clapperboard, ExternalLink, Eye, Link2, Plus, Radio, Search, Sparkles } from 'lucide-react'
import type { ClipQuery, Recipe, Saved, Settings, TwitchCategory, TwitchChannel, TwitchClip } from '@shared/types'
import { api, useLoad } from '@/lib/api'
import { attempt, navigate, toast, useStore } from '@/lib/store'
import { ago, compact, cx } from '@/lib/format'
import { Badge, Button, Dialog, Empty, Field, Input, Segmented, Select, Spinner, Switch, Tabs } from '@/ui'
import { DurationPill } from '@/components/common'

type Kind = 'categories' | 'channels'
type View = 'popular' | 'saved' | 'search' | 'all'
type Source = { kind: 'category'; item: TwitchCategory } | { kind: 'channel'; item: TwitchChannel } | { kind: 'all' }

const DEFAULT_FILTERS: Omit<ClipQuery, 'categoryIds' | 'channelIds'> = { range: '7d', sort: 'views', hideUsed: false, featuredOnly: false }

export function Library() {
  const [kind, setKind] = useState<Kind>('categories')
  const [view, setView] = useState<View>('popular')
  const [source, setSource] = useState<Source | null>(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [picked, setPicked] = useState<TwitchClip | null>(null)
  const { data: saved, setData: setSaved } = useLoad<Saved>(() => api.saved())
  const { data: status } = useLoad(() => api.secretsStatus())
  const twitchReady = status?.twitchClientId && status?.twitchClientSecret

  useEffect(() => {
    setSource(view === 'all' ? { kind: 'all' } : null)
  }, [kind, view])

  if (status && !twitchReady) {
    return (
      <Empty
        icon={<Clapperboard size={22} />}
        title="Connect Twitch to browse clips"
        body="Add your Twitch app in Settings → Setup. It takes about two minutes and is done once per team."
        action={
          <Button variant="primary" onClick={() => navigate({ name: 'settings', section: 'setup' })}>
            Set up Twitch
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-line px-8 pt-5">
          <div className="flex flex-wrap items-center gap-6">
            <h1 className="font-display text-[28px] font-normal">Library</h1>
            <Tabs value={kind} onChange={setKind} items={[{ value: 'categories', label: 'Categories' }, { value: 'channels', label: 'Channels' }]} />
            <div className="flex-1" />
            <PasteUrl onClip={setPicked} />
          </div>
          <div className="flex flex-wrap items-center gap-3 py-3">
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              items={[
                { value: 'popular', label: 'Popular' },
                { value: 'saved', label: 'Saved' },
                { value: 'search', label: 'Search' },
                { value: 'all', label: 'All saved' }
              ]}
            />
            {source && <Filters value={filters} onChange={setFilters} />}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {source ? (
            <ClipGrid source={source} saved={saved} filters={filters} onBack={view === 'all' ? undefined : () => setSource(null)} onPick={setPicked} onSaved={setSaved} />
          ) : view === 'popular' ? (
            kind === 'categories' ? <PopularCategories onPick={(c) => setSource({ kind: 'category', item: c })} /> : <PopularChannels onPick={(c) => setSource({ kind: 'channel', item: c })} />
          ) : view === 'search' ? (
            <SearchSources kind={kind} onPick={(s) => setSource(s)} />
          ) : (
            <SavedSources kind={kind} saved={saved} onPick={setSource} />
          )}
        </div>
      </div>
      <SavedRail kind={kind} saved={saved} active={source} onPick={(s) => setSource(s)} />
      <CreateProjectDialog clip={picked} onClose={() => setPicked(null)} />
    </div>
  )
}

function PasteUrl({ onClip }: { onClip: (c: TwitchClip) => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async (): Promise<void> => {
    setBusy(true)
    const clip = await attempt(() => api.clipFromUrl(url))
    setBusy(false)
    if (clip) {
      setUrl('')
      onClip(clip)
    }
  }
  return (
    <form
      className="flex w-[420px] max-w-full items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (url) void go()
      }}
    >
      <div className="relative flex-1">
        <Link2 size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-text-3" aria-hidden />
        <Input aria-label="Paste a Twitch clip link" className="pl-9" placeholder="Paste a Twitch clip link" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <Button type="submit" disabled={!url} loading={busy}>
        Open
      </Button>
    </form>
  )
}

function Filters({ value, onChange }: { value: typeof DEFAULT_FILTERS; onChange: (v: typeof DEFAULT_FILTERS) => void }) {
  const set = (p: Partial<typeof DEFAULT_FILTERS>): void => onChange({ ...value, ...p })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Date range" className="h-9 w-32" value={value.range} onChange={(e) => set({ range: e.target.value as ClipQuery['range'] })}>
        <option value="24h">Last 24 h</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="all">All time</option>
      </Select>
      <Select aria-label="Minimum views" className="h-9 w-36" value={value.minViews ?? 0} onChange={(e) => set({ minViews: Number(e.target.value) || undefined })}>
        <option value={0}>Any views</option>
        <option value={1000}>1K+ views</option>
        <option value={10000}>10K+ views</option>
        <option value={100000}>100K+ views</option>
      </Select>
      <Select aria-label="Maximum duration" className="h-9 w-32" value={value.maxDuration ?? 0} onChange={(e) => set({ maxDuration: Number(e.target.value) || undefined })}>
        <option value={0}>Any length</option>
        <option value={15}>≤ 15 s</option>
        <option value={30}>≤ 30 s</option>
        <option value={60}>≤ 60 s</option>
      </Select>
      <Select aria-label="Language" className="h-9 w-32" value={value.language ?? ''} onChange={(e) => set({ language: e.target.value || undefined })}>
        <option value="">Any language</option>
        {['en', 'es', 'de', 'fr', 'pt', 'sv', 'ja', 'ko', 'ru', 'it'].map((l) => (
          <option key={l} value={l}>
            {l.toUpperCase()}
          </option>
        ))}
      </Select>
      <Select aria-label="Sort" className="h-9 w-32" value={value.sort} onChange={(e) => set({ sort: e.target.value as ClipQuery['sort'] })}>
        <option value="views">Most viewed</option>
        <option value="newest">Newest</option>
      </Select>
      <label className="flex h-9 items-center gap-2 px-1 text-[13px] text-text-2">
        <Switch label="Featured only" checked={Boolean(value.featuredOnly)} onChange={(v) => set({ featuredOnly: v })} />
        Featured
      </label>
      <label className="flex h-9 items-center gap-2 px-1 text-[13px] text-text-2">
        <Switch label="Hide clips already used" checked={Boolean(value.hideUsed)} onChange={(v) => set({ hideUsed: v })} />
        Hide used
      </label>
    </div>
  )
}

function CategoryTile({ c, onClick }: { c: TwitchCategory; onClick: () => void }) {
  return (
    <button onClick={onClick} className="lift group flex flex-col gap-2 text-left">
      <div className="aspect-[3/4] overflow-hidden rounded-[14px] border border-line bg-raised">
        <img src={c.boxArtUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      </div>
      <span className="line-clamp-1 text-sm text-text-2 group-hover:text-text">{c.name}</span>
    </button>
  )
}

function ChannelRow({ c, onClick }: { c: TwitchChannel; onClick: () => void }) {
  return (
    <button onClick={onClick} className="panel lift flex items-center gap-3 rounded-[14px] p-3 text-left">
      {c.avatarUrl ? <img src={c.avatarUrl} alt="" className="h-11 w-11 rounded-full" /> : <span className="h-11 w-11 rounded-full bg-raised-2" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{c.name}</span>
        <span className="block truncate text-[13px] text-text-3">{c.gameName}</span>
      </span>
      {c.live && (
        <Badge tone="danger" icon={<Radio size={12} />}>
          {c.viewerCount ? compact(c.viewerCount) : 'Live'}
        </Badge>
      )}
    </button>
  )
}

function PopularCategories({ onPick }: { onPick: (c: TwitchCategory) => void }) {
  const { data, error, loading } = useLoad(() => api.topCategories())
  if (loading) return <GridSkeleton tall />
  if (error) return <Empty title="Couldn't load categories" body={error} />
  return (
    <>
      <p className="label mb-4">Most watched on Twitch right now</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5">
        {data?.map((c) => (
          <CategoryTile key={c.id} c={c} onClick={() => onPick(c)} />
        ))}
      </div>
    </>
  )
}

function PopularChannels({ onPick }: { onPick: (c: TwitchChannel) => void }) {
  const { data, error, loading } = useLoad(() => api.topChannels())
  if (loading) return <GridSkeleton />
  if (error) return <Empty title="Couldn't load channels" body={error} />
  return (
    <>
      <p className="label mb-4">Biggest live channels right now</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {data?.map((c) => (
          <ChannelRow key={c.id} c={c} onClick={() => onPick(c)} />
        ))}
      </div>
    </>
  )
}

function SearchSources({ kind, onPick }: { kind: Kind; onPick: (s: Source) => void }) {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTerm(q), 350)
    return () => clearTimeout(t)
  }, [q])
  const { data, loading } = useLoad<(TwitchCategory | TwitchChannel)[]>(() => (term ? (kind === 'categories' ? api.searchCategories(term) : api.searchChannels(term)) : Promise.resolve([])), [term, kind])
  return (
    <>
      <div className="relative mb-6 max-w-lg">
        <Search size={17} className="absolute top-1/2 left-3 -translate-y-1/2 text-text-3" aria-hidden />
        <Input autoFocus aria-label={`Search ${kind}`} className="h-11 pl-10" placeholder={kind === 'categories' ? 'Search games and categories (e.g. Just Chatting, IRL)' : 'Search streamers'} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {loading && term ? (
        <Spinner />
      ) : kind === 'categories' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5">
          {(data as TwitchCategory[] | undefined)?.map((c) => (
            <CategoryTile key={c.id} c={c} onClick={() => onPick({ kind: 'category', item: c })} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {(data as TwitchChannel[] | undefined)?.map((c) => (
            <ChannelRow key={c.id} c={c} onClick={() => onPick({ kind: 'channel', item: c })} />
          ))}
        </div>
      )}
      {term && !loading && !data?.length && <p className="text-text-3">No results for “{term}”.</p>}
    </>
  )
}

function SavedSources({ kind, saved, onPick }: { kind: Kind; saved?: Saved; onPick: (s: Source) => void }) {
  const list = kind === 'categories' ? saved?.categories : saved?.channels
  if (!list?.length)
    return <Empty icon={<Bookmark size={20} />} title={`No saved ${kind} yet`} body={`Open a ${kind === 'categories' ? 'category' : 'channel'} from Popular or Search and click Save to keep it here.`} />
  return kind === 'categories' ? (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5">
      {saved!.categories.map((c) => (
        <CategoryTile key={c.id} c={c} onClick={() => onPick({ kind: 'category', item: c })} />
      ))}
    </div>
  ) : (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      {saved!.channels.map((c) => (
        <ChannelRow key={c.id} c={c} onClick={() => onPick({ kind: 'channel', item: c })} />
      ))}
    </div>
  )
}

function SavedRail({ kind, saved, active, onPick }: { kind: Kind; saved?: Saved; active: Source | null; onPick: (s: Source) => void }) {
  const items = kind === 'categories' ? (saved?.categories ?? []) : (saved?.channels ?? [])
  const activeId = active && active.kind !== 'all' ? active.item.id : null
  return (
    <aside className="hidden w-64 shrink-0 border-l border-line px-5 py-6 lg:block">
      <p className="label mb-3">Saved {kind}</p>
      {items.length === 0 && <p className="text-[13px] text-text-3">Nothing saved yet.</p>}
      <ul className="flex flex-col gap-0.5">
        {items.map((it) => (
          <li key={it.id}>
            <button
              onClick={() => onPick(kind === 'categories' ? { kind: 'category', item: it as TwitchCategory } : { kind: 'channel', item: it as TwitchChannel })}
              className={cx('flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm transition-colors', activeId === it.id ? 'bg-raised text-text' : 'text-text-3 hover:text-text-2')}
            >
              {activeId === it.id && <span className="h-4 w-0.5 rounded-full bg-accent" />}
              <span className="truncate">{it.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function GridSkeleton({ tall }: { tall?: boolean }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className={cx('skeleton rounded-[14px]', tall ? 'aspect-[3/4]' : 'aspect-video')} />
      ))}
    </div>
  )
}

function ClipGrid({ source, saved, filters, onBack, onPick, onSaved }: { source: Source; saved?: Saved; filters: typeof DEFAULT_FILTERS; onBack?: () => void; onPick: (c: TwitchClip) => void; onSaved: (s: Saved) => void }) {
  const query = useMemo<ClipQuery>(() => {
    if (source.kind === 'category') return { ...filters, categoryIds: [source.item.id] }
    if (source.kind === 'channel') return { ...filters, channelIds: [source.item.id] }
    return { ...filters, categoryIds: saved?.categories.map((c) => c.id), channelIds: saved?.channels.map((c) => c.id) }
  }, [source, filters, saved])
  const version = useStore((s) => s.projectsVersion)
  const { data, error, loading } = useLoad(() => api.clips(query), [JSON.stringify(query)])
  const { data: used } = useLoad(() => api.usedClipIds(), [version])
  const usedSet = new Set(used ?? [])
  const isSaved = source.kind === 'category' ? saved?.categories.some((c) => c.id === source.item.id) : source.kind === 'channel' ? saved?.channels.some((c) => c.id === source.item.id) : false
  const title = source.kind === 'all' ? 'All saved categories and channels' : source.item.name

  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} icon={<ArrowLeft size={16} />}>
            Back
          </Button>
        )}
        <h2 className="font-display text-[22px]">{title}</h2>
        {source.kind !== 'all' && (
          <Button
            size="sm"
            variant={isSaved ? 'secondary' : 'ghost'}
            icon={isSaved ? <BookmarkCheck size={16} className="text-accent" /> : <Bookmark size={16} />}
            onClick={() => void (source.kind === 'category' ? api.toggleSavedCategory(source.item) : api.toggleSavedChannel(source.item)).then(onSaved)}
          >
            {isSaved ? 'Saved' : 'Save'}
          </Button>
        )}
        {source.kind === 'channel' && <CreditOverride channel={source.item} saved={saved} onSaved={onSaved} />}
      </div>
      {source.kind === 'all' && !saved?.categories.length && !saved?.channels.length ? (
        <Empty icon={<Bookmark size={20} />} title="Nothing saved yet" body="Save categories and channels to see all their clips here in one feed." />
      ) : loading ? (
        <GridSkeleton />
      ) : error ? (
        <Empty title="Couldn't load clips" body={error} />
      ) : !data?.length ? (
        <Empty title="No clips match" body="Try a longer date range or fewer filters." />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-5 gap-y-6">
          {data.map((c, i) => (
            <ClipCard key={c.id} clip={c} used={usedSet.has(c.id)} onClick={() => onPick(c)} delay={i} />
          ))}
        </div>
      )}
    </>
  )
}

function ClipCard({ clip, used, onClick, delay }: { clip: TwitchClip; used: boolean; onClick: () => void; delay: number }) {
  return (
    <button onClick={onClick} className="rise group flex flex-col gap-2.5 text-left" style={{ animationDelay: `${Math.min(delay, 12) * 40}ms` }}>
      <div className="lift relative aspect-video overflow-hidden rounded-[14px] border border-line bg-raised">
        <img src={clip.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        <div className="absolute top-2 left-2 flex gap-1.5">
          {used && <Badge tone="accent">Used</Badge>}
          {clip.isFeatured && <Badge tone="warning" icon={<Sparkles size={11} />}>Featured</Badge>}
        </div>
        <div className="absolute right-2 bottom-2">
          <DurationPill seconds={clip.duration} />
        </div>
        <div className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink">
            <Plus size={16} /> Create project
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-[15px] leading-snug text-text">{clip.title}</p>
        <p className="mt-1 flex items-center gap-2 text-[13px] text-text-3">
          <span className="truncate text-text-2">{clip.broadcasterName}</span>
          <span aria-hidden>·</span>
          <span className="num flex items-center gap-1">
            <Eye size={13} aria-hidden /> {compact(clip.viewCount)}
          </span>
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap">{ago(clip.createdAt)}</span>
        </p>
        {clip.gameName && <p className="mt-0.5 truncate text-[13px] text-text-3">{clip.gameName}</p>}
      </div>
    </button>
  )
}

function CreditOverride({ channel, saved, onSaved }: { channel: TwitchChannel; saved?: Saved; onSaved: (s: Saved) => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  useEffect(() => setValue(saved?.creditOverrides[channel.id] ?? ''), [saved, channel.id])
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {saved?.creditOverrides[channel.id] ? 'Custom credit ✓' : 'Custom credit'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={`Credit line for ${channel.name}`} description="Replaces the default credit line on every post made from this channel's clips. Leave empty to use the default.">
        <div className="flex flex-col gap-4">
          <Field label="Credit line" hint="Variables: {streamer} {streamer_url} {clip_url} {clip_title} {category} {clipper} {date}">
            {(id) => <Input id={id} value={value} onChange={(e) => setValue(e.target.value)} placeholder="🎮 Clip: {streamer} — {streamer_url} · Sponsored by …" />}
          </Field>
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={() =>
                void api.setCreditOverride(channel.id, value).then((s) => {
                  onSaved(s)
                  setOpen(false)
                  toast('success', 'Credit line saved')
                })
              }
            >
              Save
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}

export function CreateProjectDialog({ clip, onClose }: { clip: TwitchClip | null; onClose: () => void }) {
  const { data: settings } = useLoad<Settings>(() => api.getSettings())
  const [count, setCount] = useState(3)
  const [recipes, setRecipes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (settings) {
      setCount(settings.defaultVariants)
      setRecipes(settings.recipes.slice(0, settings.defaultVariants).map((r) => r.id))
    }
  }, [settings, clip])
  const toggle = (r: Recipe): void => {
    setRecipes((cur) => (cur.includes(r.id) ? cur.filter((x) => x !== r.id) : [...cur, r.id].slice(-count)))
  }
  const create = async (): Promise<void> => {
    if (!clip) return
    setBusy(true)
    const p = await attempt(() => api.createProject(clip, count, recipes))
    setBusy(false)
    if (p) {
      onClose()
      navigate({ name: 'project', id: p.id })
    }
  }
  const embeddable = location.protocol.startsWith('http')
  return (
    <Dialog open={Boolean(clip)} onOpenChange={(o) => !o && onClose()} title="Create project" wide>
      {clip && settings && (
        <div className="grid grid-cols-[1.3fr_1fr] gap-6">
          <div className="flex flex-col gap-3">
            <div className="aspect-video overflow-hidden rounded-[14px] border border-line bg-black">
              {embeddable ? (
                <iframe title="Clip preview" src={`https://clips.twitch.tv/embed?clip=${encodeURIComponent(clip.id)}&parent=${location.hostname}&autoplay=false`} className="h-full w-full" allowFullScreen />
              ) : (
                <img src={clip.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <p className="text-[15px]">{clip.title}</p>
            <p className="text-[13px] text-text-3">
              {clip.broadcasterName} · {clip.gameName} · {compact(clip.viewCount)} views · clipped by {clip.creatorName}
            </p>
            <a href={clip.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
              Open on Twitch <ExternalLink size={13} />
            </a>
          </div>
          <div className="flex flex-col gap-5">
            <Field label="Variants" hint="Each variant gets its own captions and hook style.">
              {(id) => (
                <Select
                  id={id}
                  value={count}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setCount(n)
                    setRecipes((cur) => [...cur, ...settings.recipes.map((r) => r.id).filter((x) => !cur.includes(x))].slice(0, n))
                  }}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? 'variant' : 'variants'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div>
              <p className="mb-2 text-[13px] font-medium text-text-2">Styles</p>
              <div className="flex flex-wrap gap-2">
                {settings.recipes.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => toggle(r)}
                    aria-pressed={recipes.includes(r.id)}
                    className={cx('h-9 rounded-full border px-3.5 text-[13px] transition-colors', recipes.includes(r.id) ? 'border-accent bg-accent/12 text-accent' : 'border-line text-text-2 hover:border-line-strong')}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[13px] text-text-3">
                {recipes.length}/{count} chosen{recipes.length < count ? ', the rest are filled from your defaults.' : '.'}
              </p>
            </div>
            <div className="mt-auto flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={() => void create()}>
                Create project
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}
