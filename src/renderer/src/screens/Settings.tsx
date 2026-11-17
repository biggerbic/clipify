import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  CircleAlert,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  KeyRound,
  Link2,
  ListChecks,
  Plus,
  Power,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  Upload,
  Users,
  Wrench
} from 'lucide-react'
import { CAPTION_PRESETS, type Account, type CaptionStyle, type Recipe, type SecretKey, type SecretsStatus, type Settings, type SetupState } from '@shared/types'
import { api, useLoad } from '@/lib/api'
import { attempt, navigate, toast, useStore, type SettingsSection } from '@/lib/store'
import { cx } from '@/lib/format'
import { Badge, Button, Dialog, Field, Input, Select, Spinner, Switch, Textarea } from '@/ui'
import { PlatformDot } from '@/components/common'

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'setup', label: 'Setup', icon: <ListChecks size={17} /> },
  { id: 'engine', label: 'Engine', icon: <Cpu size={17} /> },
  { id: 'keys', label: 'Keys', icon: <KeyRound size={17} /> },
  { id: 'accounts', label: 'Accounts', icon: <Users size={17} /> },
  { id: 'defaults', label: 'Defaults', icon: <SlidersHorizontal size={17} /> },
  { id: 'storage', label: 'Storage', icon: <HardDrive size={17} /> },
  { id: 'about', label: 'About', icon: <Wrench size={17} /> }
]

export function SettingsScreen({ section = 'setup' }: { section?: SettingsSection }) {
  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 border-r border-line p-4">
        <p className="label px-3 pb-3">Settings</p>
        <nav className="flex flex-col gap-0.5" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => navigate({ name: 'settings', section: s.id })}
              aria-current={section === s.id ? 'page' : undefined}
              className={cx('flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors', section === s.id ? 'bg-raised text-text' : 'text-text-2 hover:bg-raised/60 hover:text-text')}
            >
              <span className={section === s.id ? 'text-accent' : 'text-text-3'}>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-8">
          {section === 'setup' && <SetupSection />}
          {section === 'engine' && <EngineSection />}
          {section === 'keys' && <KeysSection />}
          {section === 'accounts' && <AccountsSection />}
          {section === 'defaults' && <DefaultsSection />}
          {section === 'storage' && <StorageSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  )
}

function Heading({ title, body }: { title: string; body?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-[28px] font-normal">{title}</h1>
      {body && <p className="mt-1 text-text-3">{body}</p>}
    </div>
  )
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
      {children}
      <ExternalLink size={13} aria-hidden />
    </a>
  )
}

function Copyable({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <code className="rounded-md bg-bg px-2 py-0.5 text-[13px] text-text">{text}</code>
      <button className="text-[13px] text-accent hover:underline" onClick={() => void api.copyText(text).then(() => toast('success', 'Copied'))}>
        Copy
      </button>
    </span>
  )
}

/** Masked secret input: shows whether a value is stored, never the value itself. */
function KeyField({ k, label, hint, status, onSaved, test }: { k: SecretKey; label: string; hint?: ReactNode; status: SecretsStatus; onSaved: (s: SecretsStatus) => void; test?: 'gemini' | 'claude' | 'twitch' | 'unsplash' }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const save = async (): Promise<void> => {
    setBusy(true)
    const s = await attempt(() => api.setSecret(k, value))
    if (s) {
      onSaved(s)
      setValue('')
      if (test) setResult(await api.testKey(test))
      else toast('success', `${label} saved`)
    }
    setBusy(false)
  }
  return (
    <Field label={label} hint={hint} error={result && !result.ok ? result.message : null}>
      {(id) => (
        <div className="flex gap-2">
          <Input id={id} type="password" autoComplete="off" placeholder={status[k] ? '•••••••••• stored' : 'Paste here'} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && value && void save()} />
          <Button onClick={() => void save()} disabled={!value} loading={busy}>
            Save
          </Button>
          {test && status[k] && (
            <Button
              variant="ghost"
              onClick={async () => {
                setBusy(true)
                setResult(await api.testKey(test))
                setBusy(false)
              }}
            >
              Test
            </Button>
          )}
          {result?.ok && (
            <span className="flex items-center gap-1 text-[13px] whitespace-nowrap text-success">
              <Check size={14} /> Works
            </span>
          )}
        </div>
      )}
    </Field>
  )
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-sm text-text-2">
          <span className="num mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-raised-2 text-[11px] font-semibold text-text">{i + 1}</span>
          <span className="min-w-0 leading-relaxed">{it}</span>
        </li>
      ))}
    </ol>
  )
}

function StepRow({ done, title, body, open, onToggle, children, optional }: { done: boolean; title: string; body: string; open: boolean; onToggle: () => void; children: ReactNode; optional?: boolean }) {
  return (
    <div className={cx('panel overflow-hidden rounded-[16px] transition-colors', open && 'border-line-strong')}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-4 p-4 text-left">
        <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full border', done ? 'border-success/40 bg-success/15 text-success' : 'border-line-strong text-text-3')}>
          {done ? <Check size={15} /> : <span className="h-1.5 w-1.5 rounded-full bg-text-3" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-medium">
            {title} {optional && <Badge>Optional</Badge>}
          </span>
          <span className="block text-[13px] text-text-3">{body}</span>
        </span>
        <ChevronDown size={18} className={cx('text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-line p-5">{children}</div>}
    </div>
  )
}

function SetupSection() {
  const engine = useStore((s) => s.engine)
  const { data: state, reload } = useLoad<SetupState>(() => api.setupState(), [engine?.state])
  const { data: status, setData: setStatus } = useLoad<SecretsStatus>(() => api.secretsStatus())
  const { data: settings, setData: setSettings } = useLoad<Settings>(() => api.getSettings())
  const { data: accounts, setData: setAccounts } = useLoad<Account[]>(() => api.accounts())
  const [open, setOpen] = useState<string | null>(null)
  const [team, setTeam] = useState<'import' | 'export' | null>(null)
  useEffect(() => {
    if (state && open === null) setOpen((Object.entries(state).find(([, v]) => !v)?.[0] as string) ?? '')
  }, [state, open])
  if (!state || !status || !settings || !accounts) return <Spinner />
  const done = Object.values(state).filter(Boolean).length
  const toggle = (id: string) => () => setOpen(open === id ? '' : id)
  const saved = (s: SecretsStatus): void => {
    setStatus(s)
    reload()
  }
  const connect = async (platform: 'youtube' | 'instagram'): Promise<void> => {
    const list = await attempt(() => api.connectAccount(platform), 'Account connected')
    if (list) {
      setAccounts(list)
      reload()
    }
  }

  return (
    <>
      <Heading title="Setup" body={`${done} of 8 steps done. Everything Clipify needs is set up here, no terminal required.`} />
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-[16px] border border-dashed border-line-strong p-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Team setup file</p>
          <p className="text-[13px] text-text-3">One person sets up the developer apps once, exports them, and teammates import the file. Personal logins are never included.</p>
        </div>
        <Button icon={<Download size={16} />} onClick={() => setTeam('import')}>
          Import
        </Button>
        <Button icon={<Upload size={16} />} onClick={() => setTeam('export')}>
          Export
        </Button>
      </div>
      <TeamDialog mode={team} onClose={() => setTeam(null)} onImported={() => void api.secretsStatus().then(saved)} />

      <div className="flex flex-col gap-3">
        <StepRow done={state.engine} title="Video engine" body="Installs OpenShorts and its AI models inside Clipify. No Docker needed." open={open === 'engine'} onToggle={toggle('engine')}>
          <EngineInstallPanel />
        </StepRow>

        <StepRow done={state.gemini} title="Gemini key" body="OpenShorts uses Gemini to pick layouts (gameplay + facecam) and moments." open={open === 'gemini'} onToggle={toggle('gemini')}>
          <div className="flex flex-col gap-4">
            <Steps items={[<>Open <Ext href="https://aistudio.google.com/app/apikey">Google AI Studio → API keys</Ext> and create a key.</>, 'Paste it below and save.']} />
            <KeyField k="geminiKey" label="Gemini API key" status={status} onSaved={saved} test="gemini" />
          </div>
        </StepRow>

        <StepRow done={state.claude} optional title="Claude key" body="Writes descriptions and hook lines for each variant. Without it, OpenShorts' own text is used." open={open === 'claude'} onToggle={toggle('claude')}>
          <div className="flex flex-col gap-4">
            <Steps items={[<>Open the <Ext href="https://console.anthropic.com/settings/keys">Claude Console → API keys</Ext> and create a key.</>, 'Paste it below and save.']} />
            <KeyField k="anthropicKey" label="Claude API key" status={status} onSaved={saved} test="claude" />
            <Field label="Model">
              {(id) => (
                <Select id={id} value={settings.claudeModel} onChange={(e) => void api.setSettings({ claudeModel: e.target.value }).then(setSettings)}>
                  <option value="claude-opus-5-5">Claude Opus 5.5 (best writing)</option>
                  <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (balanced)</option>
                  <option value="claude-haiku-5-5">Claude Haiku 5.5 (cheapest)</option>
                </Select>
              )}
            </Field>
          </div>
        </StepRow>

        <StepRow done={state.twitch} title="Twitch" body="Lets the Library browse clips by category and channel." open={open === 'twitch'} onToggle={toggle('twitch')}>
          <div className="flex flex-col gap-4">
            <Steps
              items={[
                <>
                  Open the <Ext href="https://dev.twitch.tv/console/apps">Twitch developer console</Ext> and choose <b>Register Your Application</b>.
                </>,
                <>
                  Any name (e.g. “Clipify Team”). OAuth Redirect URL: <Copyable text="http://localhost" />. Category: Application Integration. Client type: Confidential.
                </>,
                <>Open <b>Manage</b>, copy the Client ID, then click <b>New Secret</b> and copy it.</>
              ]}
            />
            <KeyField k="twitchClientId" label="Client ID" status={status} onSaved={saved} />
            <KeyField k="twitchClientSecret" label="Client Secret" status={status} onSaved={saved} test="twitch" />
          </div>
        </StepRow>

        <StepRow done={state.youtube} title="YouTube" body="Publish Shorts and read their statistics. One Google app per team." open={open === 'youtube'} onToggle={toggle('youtube')}>
          <div className="flex flex-col gap-4">
            <Steps
              items={[
                <>
                  In <Ext href="https://console.cloud.google.com/projectcreate">Google Cloud</Ext>, create a project (e.g. “Clipify”).
                </>,
                <>
                  Enable <Ext href="https://console.cloud.google.com/apis/library/youtube.googleapis.com">YouTube Data API v3</Ext> and <Ext href="https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com">YouTube Analytics API</Ext>.
                </>,
                <>
                  Open <Ext href="https://console.cloud.google.com/auth/overview">Google Auth Platform</Ext>: audience <b>External</b>, then <b>Publish app</b> so it is “In production”. (In “Testing” mode logins expire every 7 days.)
                </>,
                <>Under Data access add the scopes youtube.upload, youtube.readonly and yt-analytics.readonly.</>,
                <>
                  Under Clients choose <b>Create client → Desktop app</b>, then copy the Client ID and Secret.
                </>,
                <>Save them below and click Connect channel. Google warns that the app is unverified: choose Advanced → Continue. That's expected for your own team app.</>
              ]}
            />
            <KeyField k="googleClientId" label="Google Client ID" status={status} onSaved={saved} />
            <KeyField k="googleClientSecret" label="Google Client Secret" status={status} onSaved={saved} />
            <ConnectedList accounts={accounts} platform="youtube" />
            <div>
              <Button variant="primary" disabled={!status.googleClientId || !status.googleClientSecret} onClick={() => void connect('youtube')} icon={<Link2 size={16} />}>
                Connect channel
              </Button>
            </div>
          </div>
        </StepRow>

        <StepRow done={state.instagram} title="Instagram" body="Publish Reels from local files and read their statistics. One Meta app per team." open={open === 'instagram'} onToggle={toggle('instagram')}>
          <div className="flex flex-col gap-4">
            <Steps
              items={[
                <>Every Instagram account must be a <b>Professional</b> (Business or Creator) account linked to a <b>Facebook Page</b>.</>,
                <>
                  In <Ext href="https://developers.facebook.com/apps">Meta for Developers</Ext> create an app (type: Business) and add <b>Facebook Login for Business</b>.
                </>,
                <>
                  In Facebook Login settings, add the redirect URI <Copyable text="http://localhost:53682/callback" />.
                </>,
                <>Under App roles, add each teammate as Tester or Developer. Keep the app in Development mode: no App Review needed.</>,
                <>From App settings → Basic, copy the App ID and App Secret.</>,
                <>Save them below, click Connect account and pick the Facebook Page(s) linked to your Instagram account(s).</>
              ]}
            />
            <KeyField k="metaAppId" label="Meta App ID" status={status} onSaved={saved} />
            <KeyField k="metaAppSecret" label="Meta App Secret" status={status} onSaved={saved} />
            <ConnectedList accounts={accounts} platform="instagram" />
            <div>
              <Button variant="primary" disabled={!status.metaAppId || !status.metaAppSecret} onClick={() => void connect('instagram')} icon={<Link2 size={16} />}>
                Connect account
              </Button>
            </div>
          </div>
        </StepRow>

        <StepRow done={state.unsplash} optional title="Unsplash" body="Background photos on Home and Dashboard." open={open === 'unsplash'} onToggle={toggle('unsplash')}>
          <div className="flex flex-col gap-4">
            <Steps items={[<>Create an app at <Ext href="https://unsplash.com/oauth/applications">unsplash.com/oauth/applications</Ext>.</>, 'Copy the Access Key (the Secret Key is not needed).']} />
            <KeyField k="unsplashKey" label="Unsplash Access Key" status={status} onSaved={saved} test="unsplash" />
          </div>
        </StepRow>

        <StepRow done={state.storage} title="Storage folder" body={settings.libraryDir} open={open === 'storage'} onToggle={toggle('storage')}>
          <StorageSection compact />
        </StepRow>
      </div>
    </>
  )
}

function ConnectedList({ accounts, platform }: { accounts: Account[]; platform: 'youtube' | 'instagram' }) {
  const mine = accounts.filter((a) => a.platform === platform && a.status !== 'manual')
  if (!mine.length) return null
  return (
    <ul className="flex flex-col gap-2">
      {mine.map((a) => (
        <li key={a.id} className="flex items-center gap-3 rounded-[12px] bg-raised p-2.5">
          {a.avatarUrl ? <img src={a.avatarUrl} alt="" className="h-8 w-8 rounded-full" /> : <span className="h-8 w-8 rounded-full bg-raised-2" />}
          <span className="flex-1 text-sm">
            {a.name} <span className="text-text-3">{a.handle}</span>
          </span>
          <Badge tone={a.status === 'ok' ? 'success' : 'danger'}>{a.status === 'ok' ? 'Connected' : 'Reconnect'}</Badge>
        </li>
      ))}
    </ul>
  )
}

function TeamDialog({ mode, onClose, onImported }: { mode: 'import' | 'export' | null; onClose: () => void; onImported: () => void }) {
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setPass(''), [mode])
  const go = async (): Promise<void> => {
    setBusy(true)
    if (mode === 'export') {
      const r = await attempt(() => api.exportTeamSetup(pass))
      if (r?.ok) {
        toast('success', 'Team setup file saved. Share the passphrase separately.')
        onClose()
      }
    } else {
      const r = await attempt(() => api.importTeamSetup(pass))
      if (r?.ok) {
        toast('success', r.message)
        onImported()
        onClose()
      }
    }
    setBusy(false)
  }
  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(o) => !o && onClose()}
      title={mode === 'export' ? 'Export team setup' : 'Import team setup'}
      description={mode === 'export' ? 'Saves the developer-app credentials and shared keys, encrypted with a passphrase.' : 'Choose the .clipify file a teammate exported and enter its passphrase.'}
    >
      <div className="flex flex-col gap-4">
        <Field label="Passphrase" hint={mode === 'export' ? 'At least 8 characters. Send it to teammates over a different channel than the file.' : undefined}>
          {(id) => <Input id={id} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={pass.length < (mode === 'export' ? 8 : 1)} loading={busy} onClick={() => void go()}>
            {mode === 'export' ? 'Choose where to save' : 'Choose file'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function EngineInstallPanel() {
  const engine = useStore((s) => s.engine)
  if (!engine) return <Spinner />
  if (engine.mode === 'remote')
    return (
      <p className="text-sm text-text-2">
        Using a remote engine at <b>{engine.profileLabel}</b>. Manage it under Engine.
      </p>
    )
  const installing = engine.state === 'installing'
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="accent">{engine.profileLabel ?? 'Detecting hardware…'}</Badge>
        <span className="text-[13px] text-text-3">About 2–3 GB on Mac and Windows CPU, about 5–6 GB with an NVIDIA GPU.</span>
      </div>
      {(installing || engine.install.some((s) => s.status !== 'pending')) && <InstallSteps />}
      {engine.state === 'error' && <p className="flex items-start gap-2 text-sm text-danger"><CircleAlert size={16} className="mt-0.5 shrink-0" />{engine.message}</p>}
      <div className="flex gap-2">
        {engine.state === 'not-installed' && (
          <Button variant="primary" onClick={() => void api.engineInstall()} icon={<Download size={16} />}>
            Install engine
          </Button>
        )}
        {engine.state === 'error' && (
          <Button variant="primary" onClick={() => void api.engineRepair()} icon={<RotateCcw size={16} />}>
            Repair engine
          </Button>
        )}
        {engine.state === 'ready' && <Badge tone="success" icon={<Check size={12} />}>Installed and running</Badge>}
        {engine.state === 'stopped' && (
          <Button onClick={() => void api.engineStart()} icon={<Power size={16} />}>
            Start engine
          </Button>
        )}
      </div>
    </div>
  )
}

function InstallSteps() {
  const engine = useStore((s) => s.engine)
  return (
    <ul className="flex flex-col gap-2 rounded-[12px] bg-bg/60 p-3">
      {engine?.install.map((s) => (
        <li key={s.id} className="flex items-center gap-3 text-sm">
          <span className="w-5">
            {s.status === 'done' ? <Check size={16} className="text-success" /> : s.status === 'running' ? <Spinner size={15} /> : s.status === 'failed' ? <CircleAlert size={16} className="text-danger" /> : <span className="block h-1.5 w-1.5 translate-x-1.5 rounded-full bg-text-3" />}
          </span>
          <span className={cx('w-48 shrink-0', s.status === 'pending' ? 'text-text-3' : 'text-text')}>{s.label}</span>
          <span className="num min-w-0 flex-1 truncate text-xs text-text-3">{s.status === 'running' ? (s.percent !== undefined ? `${s.percent.toFixed(0)}%` : s.message) : s.status === 'failed' ? s.message : ''}</span>
        </li>
      ))}
    </ul>
  )
}

function EngineSection() {
  const engine = useStore((s) => s.engine)
  const [logs, setLogs] = useState<string[]>([])
  const [remoteUrl, setRemoteUrl] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const load = (): void => void api.engineLogs().then(setLogs)
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [logs.length])
  if (!engine) return <Spinner />
  return (
    <>
      <Heading title="Engine" body="OpenShorts runs on this computer, or on another Clipify on your network that shares its engine." />
      <section className="panel mb-6 rounded-[16px] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-display text-lg">{engine.mode === 'remote' ? 'Remote engine' : (engine.profileLabel ?? 'This computer')}</span>
          <Badge tone={engine.state === 'ready' ? 'success' : engine.state === 'error' ? 'danger' : 'neutral'}>{engine.state.replace('-', ' ')}</Badge>
          <div className="flex-1" />
          {engine.mode === 'local' && engine.state === 'ready' && (
            <Button size="sm" onClick={() => void api.engineStop()} icon={<Power size={15} />}>
              Stop
            </Button>
          )}
          {engine.mode === 'local' && engine.state === 'stopped' && (
            <Button size="sm" onClick={() => void api.engineStart()} icon={<Power size={15} />}>
              Start
            </Button>
          )}
          {engine.mode === 'local' && engine.state !== 'installing' && engine.state !== 'not-installed' && (
            <Button size="sm" variant="ghost" onClick={() => void api.engineRepair()} icon={<RotateCcw size={15} />}>
              Repair
            </Button>
          )}
        </div>
        {engine.message && <p className="mt-3 text-sm text-danger">{engine.message}</p>}
        {engine.mode === 'local' && (engine.state === 'installing' || engine.state === 'not-installed') && (
          <div className="mt-4">
            <EngineInstallPanel />
          </div>
        )}
      </section>

      {engine.mode === 'local' && (
        <section className="panel mb-6 rounded-[16px] p-5">
          <div className="flex items-center gap-3">
            <Share2 size={18} className="text-text-3" />
            <div className="flex-1">
              <p className="font-medium">Share this engine on the local network</p>
              <p className="text-[13px] text-text-3">Lets another Clipify (for example a Mac) use this computer's engine and GPU. Only local-network and Tailscale addresses are accepted.</p>
            </div>
            <Switch label="Share engine" checked={engine.share.enabled} onChange={(v) => void attempt(() => api.engineShare(v))} disabled={engine.state !== 'ready'} />
          </div>
          {engine.share.enabled && (
            <div className="mt-4 grid grid-cols-2 gap-4 rounded-[12px] bg-bg/60 p-4">
              <div>
                <p className="label mb-1">Address</p>
                {engine.share.addresses.map((a) => (
                  <Copyable key={a} text={`${a}:${engine.share.port}`} />
                ))}
              </div>
              <div>
                <p className="label mb-1">Pairing code</p>
                {engine.share.code && <Copyable text={engine.share.code} />}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="panel mb-6 rounded-[16px] p-5">
        <p className="font-medium">{engine.mode === 'remote' ? 'Connected to a remote engine' : 'Use another computer’s engine'}</p>
        {engine.mode === 'remote' ? (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-sm text-text-2">{engine.profileLabel}</span>
            <Button size="sm" onClick={() => void api.engineUseLocal()}>
              Switch back to this computer
            </Button>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Field label="Address">{(id) => <Input id={id} placeholder="192.168.1.20:8765" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} />}</Field>
            <Field label="Pairing code">{(id) => <Input id={id} placeholder="ABCD-EFGH-IJKL" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
            <Button
              loading={busy}
              disabled={!remoteUrl || !code}
              onClick={async () => {
                setBusy(true)
                const r = await api.engineUseRemote(remoteUrl, code)
                toast(r.ok ? 'success' : 'error', r.message)
                setBusy(false)
              }}
            >
              Connect
            </Button>
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <p className="label">Engine log</p>
          <button className="text-[13px] text-accent hover:underline" onClick={() => void api.copyText(logs.join('\n')).then(() => toast('success', 'Log copied'))}>
            Copy log
          </button>
        </div>
        <pre ref={logRef} className="h-72 overflow-auto rounded-[12px] border border-line bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-text-2 select-text">
          {logs.length ? logs.join('\n') : 'No output yet.'}
        </pre>
      </section>
    </>
  )
}

function KeysSection() {
  const { data: status, setData } = useLoad<SecretsStatus>(() => api.secretsStatus())
  if (!status) return <Spinner />
  const keys: { k: SecretKey; label: string; test?: 'gemini' | 'claude' | 'twitch' | 'unsplash' }[] = [
    { k: 'geminiKey', label: 'Gemini API key', test: 'gemini' },
    { k: 'anthropicKey', label: 'Claude API key', test: 'claude' },
    { k: 'twitchClientId', label: 'Twitch Client ID' },
    { k: 'twitchClientSecret', label: 'Twitch Client Secret', test: 'twitch' },
    { k: 'googleClientId', label: 'Google Client ID' },
    { k: 'googleClientSecret', label: 'Google Client Secret' },
    { k: 'metaAppId', label: 'Meta App ID' },
    { k: 'metaAppSecret', label: 'Meta App Secret' },
    { k: 'unsplashKey', label: 'Unsplash Access Key', test: 'unsplash' }
  ]
  return (
    <>
      <Heading title="Keys" body="Stored encrypted by your operating system (Keychain on Mac, DPAPI on Windows). Clear a field and save to remove a key." />
      <div className="flex flex-col gap-5">
        {keys.map((x) => (
          <KeyField key={x.k} k={x.k} label={x.label} status={status} onSaved={setData} test={x.test} />
        ))}
      </div>
    </>
  )
}

function AccountsSection() {
  const { data: accounts, setData } = useLoad<Account[]>(() => api.accounts())
  const [manual, setManual] = useState(false)
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  if (!accounts) return <Spinner />
  return (
    <>
      <Heading title="Accounts" body="Where Clipify publishes. TikTok accounts are tracked manually: you download the video and post it yourself." />
      <div className="mb-6 flex flex-wrap gap-2">
        <Button icon={<Plus size={16} />} onClick={() => void attempt(() => api.connectAccount('youtube'), 'YouTube channel connected').then((l) => l && setData(l))}>
          YouTube channel
        </Button>
        <Button icon={<Plus size={16} />} onClick={() => void attempt(() => api.connectAccount('instagram'), 'Instagram connected').then((l) => l && setData(l))}>
          Instagram account
        </Button>
        <Button icon={<Plus size={16} />} onClick={() => setManual(true)}>
          TikTok (manual)
        </Button>
      </div>
      {accounts.length === 0 ? (
        <p className="text-text-3">No accounts yet. Connecting YouTube or Instagram needs the developer app from Setup first.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.map((a) => (
            <li key={a.id} className="panel flex items-center gap-4 rounded-[14px] p-3.5">
              {a.avatarUrl ? <img src={a.avatarUrl} alt="" className="h-10 w-10 rounded-full" /> : <span className="grid h-10 w-10 place-items-center rounded-full bg-raised-2 text-text-3">{a.name.slice(0, 1).toUpperCase()}</span>}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{a.name}</p>
                <p className="flex items-center gap-2 text-[13px] text-text-3">
                  <PlatformDot platform={a.platform} withLabel /> {a.handle}
                </p>
              </div>
              <Badge tone={a.status === 'ok' ? 'success' : a.status === 'manual' ? 'neutral' : 'danger'}>{a.status === 'ok' ? 'Connected' : a.status === 'manual' ? 'Manual' : a.status === 'expired' ? 'Login expired' : 'Error'}</Badge>
              {(a.status === 'expired' || a.status === 'error') && a.platform !== 'tiktok' && (
                <Button size="sm" onClick={() => void attempt(() => api.connectAccount(a.platform as 'youtube' | 'instagram'), 'Reconnected').then((l) => l && setData(l))}>
                  Reconnect
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => confirm(`Disconnect ${a.name}? Posts already published stay online.`) && void api.disconnectAccount(a.id).then(setData)}>
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={manual} onOpenChange={setManual} title="Add TikTok account" description="Used to track which videos you posted to TikTok manually.">
        <div className="flex flex-col gap-4">
          <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Main gaming account" />}</Field>
          <Field label="Handle">{(id) => <Input id={id} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@clipify" />}</Field>
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={!name && !handle}
              onClick={() =>
                void api.addManualAccount('tiktok', name, handle).then((l) => {
                  setData(l)
                  setManual(false)
                  setName('')
                  setHandle('')
                })
              }
            >
              Add account
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}

function DefaultsSection() {
  const { data: s, setData } = useLoad<Settings>(() => api.getSettings())
  const [draft, setDraft] = useState<Settings | null>(null)
  useEffect(() => setDraft(s ?? null), [s])
  if (!draft) return <Spinner />
  const patch = (p: Partial<Settings>): void => setDraft({ ...draft, ...p })
  const save = async (): Promise<void> => {
    const next = await attempt(() => api.setSettings(draft), 'Defaults saved')
    if (next) setData(next)
  }
  const setRecipe = (i: number, r: Partial<Recipe>): void => patch({ recipes: draft.recipes.map((x, j) => (j === i ? { ...x, ...r } : x)) })
  return (
    <>
      <Heading title="Defaults" body="What new projects start with. Every project can still be adjusted in the editor." />
      <div className="flex flex-col gap-6">
        <Field label="Variants per clip" hint="How many versions Clipify makes from one clip (1–5).">
          {(id) => (
            <Select id={id} value={draft.defaultVariants} onChange={(e) => patch({ defaultVariants: Number(e.target.value) })} className="w-40">
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div>
          <p className="mb-2 text-[13px] font-medium text-text-2">Variant recipes</p>
          <div className="flex flex-col gap-2">
            {draft.recipes.map((r, i) => (
              <div key={r.id} className="panel grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 rounded-[14px] p-3">
                <Input aria-label="Recipe name" value={r.name} onChange={(e) => setRecipe(i, { name: e.target.value })} />
                <Select aria-label="Caption preset" value={r.captions?.preset ?? 'none'} onChange={(e) => setRecipe(i, { captions: e.target.value === 'none' ? null : { preset: e.target.value as CaptionStyle['preset'] } })}>
                  <option value="none">No captions</option>
                  {CAPTION_PRESETS.map((p) => (
                    <option key={p} value={p}>
                      Captions: {p}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Hook style" value={r.hook?.style ?? 'none'} onChange={(e) => setRecipe(i, { hook: e.target.value === 'none' ? null : { ...(r.hook ?? { size: 'M', position: 'auto', font: 'montserrat', duration_seconds: null }), style: e.target.value as NonNullable<Recipe['hook']>['style'] } })}>
                  <option value="none">No hook</option>
                  {['pill', 'classic', 'dark', 'yellow', 'red', 'outline', 'outline_yellow'].map((st) => (
                    <option key={st} value={st}>
                      Hook: {st.replace('_', ' ')}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Hook size" value={r.hook?.size ?? 'M'} disabled={!r.hook} onChange={(e) => r.hook && setRecipe(i, { hook: { ...r.hook, size: e.target.value as 'S' | 'M' | 'L' } })}>
                  <option value="S">Hook size S</option>
                  <option value="M">Hook size M</option>
                  <option value="L">Hook size L</option>
                </Select>
              </div>
            ))}
          </div>
        </div>

        <Field label="Description style (Claude)" hint="Tone, language, emoji and hashtag rules for every description.">
          {(id) => <Textarea id={id} value={draft.descriptionPrompt} onChange={(e) => patch({ descriptionPrompt: e.target.value })} />}
        </Field>
        <Field label="Credit line" hint={<>Added word-for-word to every post. Variables: {'{streamer} {streamer_url} {clip_url} {clip_title} {category} {clipper} {date}'}. Per-channel overrides live in the Library.</>}>
          {(id) => <Input id={id} value={draft.creditTemplate} onChange={(e) => patch({ creditTemplate: e.target.value })} />}
        </Field>

        <div className="panel flex flex-col gap-4 rounded-[14px] p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="font-medium">Background photos</p>
              <p className="text-[13px] text-text-3">Unsplash photos on Home and Dashboard. Needs an Unsplash key.</p>
            </div>
            <Switch label="Background photos" checked={draft.unsplash.enabled} onChange={(v) => patch({ unsplash: { ...draft.unsplash, enabled: v } })} />
          </div>
          <Field label="Photo theme">{(id) => <Input id={id} value={draft.unsplash.query} onChange={(e) => patch({ unsplash: { ...draft.unsplash, query: e.target.value } })} />}</Field>
        </div>

        <div className="panel flex items-center gap-3 rounded-[14px] p-4">
          <div className="flex-1">
            <p className="font-medium">Start Clipify at login</p>
            <p className="text-[13px] text-text-3">Runs quietly in the menu bar or tray so scheduled Instagram posts and statistics keep working.</p>
          </div>
          <Switch label="Start at login" checked={draft.launchAtLogin} onChange={(v) => patch({ launchAtLogin: v })} />
        </div>

        <div className="flex justify-end">
          <Button variant="primary" onClick={() => void save()}>
            Save defaults
          </Button>
        </div>
      </div>
    </>
  )
}

function StorageSection({ compact }: { compact?: boolean }) {
  const { data: s, setData } = useLoad<Settings>(() => api.getSettings())
  if (!s) return <Spinner />
  return (
    <>
      {!compact && <Heading title="Storage" body="Projects, videos and statistics live in this folder. Engine files are kept in Clipify's own app data." />}
      <div className="flex items-center gap-3">
        <code className="min-w-0 flex-1 truncate rounded-[10px] border border-line bg-raised px-3 py-2.5 text-[13px]">{s.libraryDir}</code>
        <Button icon={<FolderOpen size={16} />} onClick={() => void api.chooseLibraryDir().then(setData)}>
          Change
        </Button>
      </div>
      {!compact && <p className="mt-3 text-[13px] text-text-3">Changing the folder doesn't move existing projects. Move them yourself if you want to keep them visible.</p>}
    </>
  )
}

function AboutSection() {
  return (
    <>
      <Heading title="About Clipify" />
      <div className="flex flex-col gap-3 text-sm text-text-2">
        <p>Clipify is open source under the GNU AGPL-3.0.</p>
        <p>
          Video processing by <Ext href="https://github.com/mutonby/openshorts">OpenShorts</Ext> (MIT). YouTube and Instagram publishing adapted from <Ext href="https://github.com/gitroomhq/postiz-app">Postiz</Ext> (AGPL-3.0). Background photos from <Ext href="https://unsplash.com/?utm_source=clipify&utm_medium=referral">Unsplash</Ext>.
        </p>
        <p>Clip rights are your responsibility. Clipify always adds the credit line you configure.</p>
      </div>
    </>
  )
}
