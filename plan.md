# Clipify — Plan

> Status: **v0.1 built (2026-11-13), waiting for review.** See §18 for what has been verified.
> Last updated: 2026-11-13
> Items marked ⚠ are checked during the M0 spike (§14) before we build on them.

---

## 1. What we're building

Clipify is an open-source (AGPL-3.0) desktop app that runs on **any machine**: macOS (Apple Silicon) and Windows, with or without an NVIDIA GPU. It turns Twitch clips into vertical short-form videos, publishes them, and tracks how they perform.

```
Pick (Twitch) → Generate (OpenShorts, N variants) → Review & edit → Describe (Claude) → Publish / Schedule → Track
```

- Each clip you work on is a **Project**.
- Everything runs and is stored locally. Clipify only talks to outside services for Twitch, YouTube, Instagram, Unsplash and the AI keys (Gemini, Claude).
- **No Docker and no terminal.** All setup happens inside Clipify's Settings (§4).
- **Users:** an internal team. One Google Cloud app and one Meta app are shared by the team, and team accounts are added as testers.

### In scope for v1
- **Library:** Twitch clips by category or channel, popular lists, search, and paste a URL
- **Generate:** 1 clip → N variants (N = 1–5) with OpenShorts running natively on the machine
- **Mini-editor:** Trim / Frame / Captions / Hook, using OpenShorts' edit endpoints
- **Descriptions:** written by Claude from a template prompt, with credits added by code
- **Publishing:** YouTube Shorts and Instagram Reels, using code taken from Postiz. Post now or schedule.
- **TikTok:** download the file, copy the caption, mark as posted manually
- **Home and Dashboard:** engagement statistics (views, likes, comments, shares, followers) with Unsplash backgrounds
- **Hardware:** Mac Apple Silicon, Windows NVIDIA, Windows CPU, and a remote engine (use another machine's GPU)

### Out of scope for v1
- Kick
- TikTok auto-posting and TikTok statistics
- Revenue tracking
- Twitch VOD mode
- Dubbing, AI effects, thumbnails
- Sync between machines
- Linux builds (possible later; OpenShorts' home platform)

---

## 2. Decisions locked

| # | Decision | Why |
|---|---|---|
| D1 | **Electron + TypeScript + React**, built with `electron-vite` and packaged with `electron-builder` | Cross-platform, all npm. |
| D2 | **OpenShorts runs natively. No Docker.** Clipify installs and runs it in its own folder, using a private Python that `uv` manages (§5). | As universal as possible. The user never installs Docker, Python or ffmpeg. |
| D3 | **Pinned OpenShorts commit**, plus **lock files for each platform** and a small **compatibility patch set** for Windows, which we also send upstream as a pull request | The same engine version on every machine. A few parts of OpenShorts only work on Linux and Mac (§5.3). |
| D4 | **Engine profiles are picked automatically by hardware**: mac-arm64, win-nvidia, win-cpu, plus remote | One app for every machine. The profile can be changed in Settings. |
| D5 | **Remote engine**: one Clipify can **share** its engine through an authenticated proxy with a pairing code, and another Clipify connects to it | For example, the Mac uses the Windows PC's GPU. This is safe because OpenShorts has no login of its own. |
| D6 | **Clip as source**: `MIN_SOURCE_SECONDS=0`, one base render per project, cheap variants on top of it | Twitch clips are short. The expensive step runs only once per project. |
| D7 | **The mini-editor uses OpenShorts' own edit endpoints.** We don't build our own render engine. | OpenShorts renders with FFmpeg and already exposes trim, reframe, caption and hook endpoints. |
| D8 | **Publishing code is vendored from Postiz** (AGPL-3.0, YouTube and Instagram providers only). **Clipify is AGPL-3.0.** | Tested OAuth, upload and analytics code without running Postiz's stack. |
| D9 | **Instagram uploads go straight from the local file** (resumable upload through Facebook Login for Business). We add this ourselves, because Postiz only sends Instagram a public `video_url`. | Meta's docs support uploading a local file. Postiz just doesn't use that option (§9.2). |
| D10 | **Scheduling:** YouTube uses its built-in scheduled publish, so posts go out even when the computer is off. Instagram uses Clipify's scheduler, which keeps running in the menu bar or tray, with warnings for missed posts. | Instagram's API has no scheduling. |
| D11 | **TikTok is manual**: Download + Copy caption + "Mark as posted" (optional link to the post) | TikTok won't approve posting from internal team tools. |
| D12 | **Storage:** a folder plus `project.json` for each project; a local **SQLite** file (`better-sqlite3`) for statistics history | Projects stay easy to inspect, and statistics need daily history. |
| D13 | **Files always move over HTTP from the engine** | The same code works for local and remote engines. |
| D14 | **Claude is optional**, turned on with a key in Settings. **Credits and links are always added by code.** | Required credits must appear word-for-word in every post. |
| D15 | **All setup is done in Settings.** Secrets are encrypted with `safeStorage` and never stored in the repo. A **team setup file** shares the setup between teammates. | Easiest possible setup (§4). |
| D16 | **Unsplash backgrounds on Home and Dashboard only** | Your decision. Unsplash's API rules apply (§12.6). |
| D17 | **No revenue tracking.** Engagement only. | Your decision. |

---

## 3. Architecture

```
┌──────────────────────────────── Electron ──────────────────────────────────┐
│ Renderer (React + Tailwind + shadcn/ui)                                     │
│  Home · Dashboard · Library · Projects · Project · Schedule · Settings      │
│        │ typed IPC (preload, contextIsolation on)                           │
│ Main process (Node)                                                         │
│  engine/      EngineInstaller + EngineProcess + EngineShare (proxy)         │
│  openshorts/  OpenShortsClient  → http://127.0.0.1:<port>/api/*             │
│  twitch/      TwitchClient (Helix, app access token)                        │
│  claude/      ClaudeClient (@anthropic-ai/sdk)                              │
│  publish/     youtube/ instagram/  ← vendored from Postiz                   │
│  scheduler/   due posts, missed-post detection, tray                        │
│  stats/       daily collectors → stats.sqlite                               │
│  unsplash/    background photos (hotlinked, attributed)                     │
│  setup/       setup checklist, guided wizards, team setup file              │
│  store/       projects/*/project.json, settings, secrets                    │
│  media/       ffmpeg: thumbnail strips, waveforms, exports                  │
│  jobs/        JobQueue (1 at a time on CPU; 2 on GPU)                       │
└──────────────────────────────────────────────────────────────────────────────┘
        │ spawns + HTTP (127.0.0.1)                     │ optional share proxy
┌───── OpenShorts (native, private Python 3.11) ─────┐   (LAN/Tailscale only,
│ uvicorn app:app · whisper · YOLO/MediaPipe ·        │    pairing-code auth)
│ FFmpeg (bundled) · fonts · models cache             │
└─────────────────────────────────────────────────────┘
```

- All network calls and secrets stay in the main process. The renderer never sees a key or token.
- **Tray mode:** closing the window keeps Clipify running, so scheduled posts and daily statistics keep working. Quit from the tray to stop it.

### Repo layout
```
clipify/
  src/main/{engine,openshorts,twitch,claude,publish/{youtube,instagram},scheduler,stats,unsplash,setup,store,media,jobs}
  src/preload/
  src/renderer/{screens,components,ui,theme}
  engine/
    openshorts.lock.json     pinned commit + download hash
    locks/                   mac-arm64.txt · win-cpu.txt · win-cuda.txt   (uv pip compile)
    patches/                 Windows compatibility patches (also sent upstream)
    fonts.conf.template      fontconfig for the bundled ffmpeg
  resources/bin/<platform>/  uv, ffmpeg, ffprobe   (bundled per platform)
  .env.example               dev-only defaults (no real keys)
  LICENSE (AGPL-3.0) · NOTICE (Postiz AGPL-3.0, OpenShorts MIT, Unsplash attribution)
```

---

## 4. Setup: everything in Settings

On first launch Clipify opens **Settings → Setup**, a checklist. Every step happens inside the app and shows a status (not started / in progress / done / failed + fix). Each step can be skipped and finished later. Re-running or repairing a step is always available.

| # | Step | What the user does | What Clipify does |
|---|---|---|---|
| 1 | **Engine** | Clicks "Install engine" | Detects the hardware, then downloads Python, OpenShorts, its dependencies, ffmpeg and the models, with progress (§5). Starts the engine and checks its health. On NVIDIA, also checks the GPU. |
| 2 | **Gemini key** (required) | Pastes the key, then clicks **Test** | Validates the key, stores it encrypted |
| 3 | **Claude key** (optional) | Pastes the key, picks a model, clicks **Test** | `models.list()` check |
| 4 | **Twitch** | A guided wizard: "Open Twitch developer console" link, then copy the shown redirect URL, then paste Client ID and Secret, then **Test** | Gets an app token and fetches top categories as a test |
| 5 | **YouTube** | Wizard: links to the Google Cloud pages to enable 2 APIs and create a Desktop OAuth client, then paste Client ID and Secret, then **Connect channel** | Loopback sign-in (`127.0.0.1`), then lists the connected channel |
| 6 | **Instagram** | Wizard: create the Meta app, add Facebook Login for Business, add teammates as testers, paste App ID and Secret, then **Connect account** | Sign-in, then checks the account is professional and linked to a Facebook Page, with a clear fix message if not |
| 7 | **Unsplash** (optional) | Pastes the Access Key | Fetches a test photo |
| 8 | **Storage folder** | Picks a folder or keeps the default | Creates the folder structure |

- **Team setup file.** One person does steps 4–7 once, then chooses *Export team setup*. That creates an encrypted file (AES-256-GCM with a passphrase-derived key) holding the developer-app credentials and shared keys. Teammates choose *Import team setup*, enter the passphrase, then click Install engine and Connect for their own accounts. Personal OAuth tokens are never exported.
- **Wizards** show numbered steps with screenshots, copy buttons for redirect URLs and scopes, and deep links to the right console pages. The developer apps themselves have to be created on Google, Meta and Twitch's own websites. That can't be done from inside Clipify, but it happens once per team.
- **No `.env` in normal use.** `.env` is only a developer default when running from source.

---

## 5. Engine: OpenShorts, native, no Docker

### 5.1 What Clipify installs (all inside `<app data>/engine/`, nothing system-wide)
| Piece | How |
|---|---|
| Python 3.11 | `uv python install 3.11`. `uv` is bundled in the app, and the Python is a private copy. |
| OpenShorts source | GitHub tarball at the pinned commit, checked against its hash |
| Python packages | `uv pip sync engine/locks/<profile>.txt`: CPU torch on mac-arm64 and win-cpu, CUDA torch plus `nvidia-*` wheels plus `onnxruntime-gpu` on win-nvidia |
| ffmpeg / ffprobe | Bundled per platform. The build must include libass, fontconfig and, on Windows, NVENC. ⚠ check that the subtitles filter works and that NVENC is present. |
| Fonts | OpenShorts' fonts plus a generated `fonts.conf` (passed through `FONTCONFIG_FILE`), so captions render the same on every machine |
| Models | Whisper and YOLO weights, downloaded on first install into the engine folder's cache (`HF_HOME`, `YOLO_CONFIG_DIR`) |
| Not needed | Node/bgutil/deno (YouTube-download helpers; Twitch doesn't need them) and `osrender` (an optional GPU renderer; OpenShorts falls back to ffmpeg without it) |

Estimated install size: about 2–3 GB on Mac and win-cpu, about 5–6 GB on win-nvidia (CUDA libraries). ⚠ To be measured.

### 5.2 Profiles
| Profile | Chosen when | Key env | Expected speed* |
|---|---|---|---|
| **mac-arm64** | macOS on Apple Silicon | `WHISPER_DEVICE=cpu` | ~1–2 min per 30–60s clip |
| **win-nvidia** | Windows + NVIDIA driver found (`nvidia-smi`) | `WHISPER_MODEL=large-v3-turbo`, `WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE=float16`, `FFMPEG_ENCODER=auto` (NVENC), `TRANSCRIBE_BACKEND=parakeet` | ~10–20 s per clip |
| **win-cpu** | Windows, no NVIDIA | same as mac-arm64 | ~1–2 min per clip |
| **remote** | Connected to another Clipify's shared engine | — | that machine's speed |

\* Estimates. The real numbers are measured in M0.

**Common env:** `MIN_SOURCE_SECONDS=0`, `AUTO_LAYOUT=1`, `MAX_CONCURRENT_JOBS=1` (2 on GPU), `JOB_RETENTION_SECONDS=86400`, `OUTPUT_DIR` and `UPLOAD_DIR` inside the engine folder, and `FFMPEG_REAL_BIN` pointing at the bundled ffmpeg. The Gemini key is passed per request.

**Later (not v1):** Apple GPU (MPS) for YOLO on Mac. That needs OpenShorts changes.

### 5.3 Windows compatibility
OpenShorts is built and tested on Linux. A first read of the code found these parts that don't work on Windows:
- `preexec_fn` in `app.py`, used to lower job priority. Windows doesn't support it.
- `import resource` in `main.py`. That module only exists on Linux and Mac.
- `bin/ffmpeg`, a shell-script wrapper that uses `flock`. On Windows we skip it and call the bundled ffmpeg directly, so the NVENC slot cap is off. That's fine with 1–2 jobs.
- Paths and child-process handling are checked in the spike.

**Plan:** small patches in `engine/patches/`, applied when the engine is installed, and sent upstream to OpenShorts as a pull request so they eventually disappear.
⚠ **Fallback if native Windows needs too much patching:** run the same engine inside **WSL2**. That's still no Docker, uses the same Linux code, and the GPU works through the Windows driver. Clipify would install it from Settings, which needs a one-time admin prompt and a reboot.

### 5.4 Running it
- **Start:** Clipify spawns `python -m uvicorn app:app --host 127.0.0.1 --port <free port>` with the profile env, waits for `GET /health/ready`, and restarts the engine if it crashes (up to 3 times, then shows an error).
- **Stop:** the whole process tree is stopped when the app quits (`tree-kill` on Windows).
- **Logs:** Settings → Engine → Logs, live and searchable, with a copy button.
- **Updates:** a Clipify release can pin a newer OpenShorts commit. *Update engine* installs it into a new folder and switches over only if the health check passes, so the old version stays as a rollback.

### 5.5 Sharing an engine (remote)
- **On the GPU machine:** Settings → Engine → **Share on local network**. This starts an authenticated reverse proxy inside Clipify (not OpenShorts itself) on the LAN or Tailscale address, and shows a **pairing code**.
- **On the other machine:** Settings → Engine → **Use remote engine**, then enter the address and pairing code, then **Test**.
- The proxy rejects public internet addresses, requires the pairing token on every request, and can be revoked at any time.

---

## 6. Library (pick)

### Twitch access
- An **app access token** using the client-credentials flow, with the team's Twitch developer app (set up in §4).
- This covers Get Clips, Get Top Games, Search Categories, Search Channels, Get Streams and Get Users.

### Structure
- **Two main tabs: Categories | Channels.** Twitch calls games "categories". Just Chatting, IRL and Music are categories too, so vlog-type clips belong there.
- Inside each tab:
  - **Popular:** Twitch's top categories, or the top live channels (overall or in a chosen category)
  - **Saved:** your own list, shown in the right-hand list with clip counts
  - **Search:** Twitch's category and channel search
  - **All saved:** a combined feed of everything saved. Twitch's API has no global "all clips" endpoint.
- **Paste URL:** in the Library header **and** on Home. It accepts `clips.twitch.tv/<slug>` and `twitch.tv/<user>/clip/<slug>`.
- **Filters and sorting:**
  - Date range: 24 h / 7 d / 30 d / custom
  - Minimum views
  - Duration
  - Language
  - Featured
  - Hide clips already used in a project
  - Sort by views or newest
- **Clip card:** 16:9 thumbnail, duration, views, channel avatar and name, category, age, and a "used" badge.
- **Selecting a clip** opens a side panel with details, a preview, variant count, generation preset and **Create project**.

⚠ Can the Twitch embed player run inside Electron? The fallback is the thumbnail plus "Open on Twitch".

---

## 7. Generate

1. **Base render** (one OpenShorts job per project):
   ```
   POST /api/process
   { url, acknowledged: true, target_clips: 1,
     clip_min_seconds: max(5, duration-10), clip_max_seconds: duration,
     layouts: "auto", output_format: "vertical",
     captions: false, auto_hook: false }
   ```
   Poll `/api/status/{job}`. Then download the clean base MP4, `metadata.json` and the transcript into the project.
2. **Variants (N):** for each variant recipe, one after another on the same job:
   - `/api/subtitle` with `input_filename=base`
   - `/api/hook` with `input_filename=captioned`
   - download the result to `variants/vN/vN_r1.mp4`
3. **What varies between variants:**
   - hook text (Claude writes N alternatives if a key is set; otherwise OpenShorts' hook is used for all)
   - caption preset
   - hook style
4. **Variant recipes** are saved presets, for example "3× Bold / Karaoke / Minimal". They're editable in Settings → Defaults.
5. **Job queue:** a visible queue drawer. Jobs run one at a time on CPU and two at a time on GPU. A failed job can be retried and shows the engine log lines for it.

⚠ Spike items:
- Does `target_clips:1` on a short clip return (almost) the whole clip?
- Is the base really clean with `captions:false` and `auto_hook:false`?
- Does `input_filename` chaining produce independent files?
- How often does `AUTO_LAYOUT` choose INSET (gameplay on top, facecam below) on real facecam streams?

---

## 8. Review and mini-editor

Each variant has a revision history (r1, r2, …). Every edit creates a new file, and any older revision can be restored.

| Area | OpenShorts endpoint | Controls |
|---|---|---|
| **Timeline / Trim** (bottom panel) | `GET /api/clip/{job}/{i}/edl` → `POST /api/clip/rerender` | Thumbnail track, waveform track and caption track. Segment trim handles, split and delete, snap to words. Undo/redo inside a session. |
| **Frame** | `GET …/scenes` → `POST /api/clip/reframe` | For each scene: drag the crop centre, or turn on stacked mode (gameplay top, facecam bottom). Presets: auto / full / track. |
| **Captions** | `POST /api/subtitle` (`/remove`) | Preset; font, size, colours, outline, background and opacity; classic or karaoke; highlight colour; effect (glow/pop/box); uppercase; reveal; shadow; position; max characters per line; edit transcript words |
| **Hook** | `POST /api/hook` | Text, position (auto avoids faces), size S/M/L, 7 styles, 3 fonts, duration, remove |
| **Description** | Claude (§10) | Text for each platform, with the credit block shown read-only |

- The timeline looks like a multi-track editor, but only segments can be edited. Thumbnail strips and waveforms are made locally with the bundled ffmpeg.
- **v1:** edit, re-render, and the player reloads.
- **v1.1, if re-renders feel slow:** live caption and hook preview with `@remotion/player`, reusing OpenShorts' MIT Remotion compositions.

---

## 9. Publishing (vendored from Postiz)

### 9.1 Developer apps (one-time team setup, done in Settings → Setup)
| Platform | Registered once by the team | Mode | Notes |
|---|---|---|---|
| **YouTube** | Google Cloud project with YouTube Data API v3 and YouTube Analytics API enabled, and an OAuth client of type "Desktop app" | **In production, unverified.** Team members click through Google's "unverified app" warning once. There's a cap of 100 users. | Google's **"Testing"** mode makes sign-ins expire after 7 days. That's why we use "In production". Sign-in uses a loopback redirect (`127.0.0.1`). |
| **Instagram** | Meta app with Facebook Login for Business plus the Instagram permissions | **Development mode**, with teammates added as testers. This avoids App Review. | Every Instagram account must be a **professional account linked to a Facebook Page**. Setup checks this. |
| **Twitch** | Twitch developer app | Client credentials | For the Library only. |

### 9.2 Vendored code
- **Source:** Postiz `libraries/nestjs-libraries/src/integrations/social/{youtube,instagram}.provider.ts`, pinned to a commit.
- **What we keep:** OAuth URL and token exchange, token refresh, publishing, and `analytics()` / `postAnalytics()`.
- **What we change:**
  - NestJS dependencies are swapped for plain functions.
  - **Instagram:** Postiz builds the Reel container with `video_url=<public URL>`. Instagram's servers then download the video from that URL, which can't work for a file on your computer. We change it to Meta's **resumable upload**: create the container with `upload_type=resumable`, then send the local file to `rupload.facebook.com`, then publish. Meta's docs list "a file located on your computer" as a supported source, but only for apps using Facebook Login for Business. That's the route we use.
  - **YouTube scheduled posts** are uploaded right away as `private` with `publishAt` set.
- The Postiz license and commit are credited in `NOTICE` and in the file headers.

### 9.3 Accounts
- Settings → **Accounts**: connect or disconnect YouTube channels and Instagram accounts, see login status and token expiry, and add a manual **TikTok** entry (name and handle) used for tracking manual posts.
- Several accounts per platform are supported.

### 9.4 Publish flow (Project → Publish step)
- **Matrix:** variants × accounts. Tick the cells you want, then edit the text for each platform (pre-filled from §10).
- **Each cell:** Post now or Schedule (date, time, timezone).
- **YouTube:** uploaded right away. A scheduled post is held by YouTube until its time, so the computer can be off.
- **Instagram:** Clipify's scheduler posts it at the scheduled time. Clipify must be running (tray), and the computer must be awake.
- **TikTok cell:** Download MP4, Copy caption, Mark as posted (optional URL).
- **Status per post:** queued → uploading → scheduled → published / failed / missed. Each has a link to the live post and a retry button.
- **Guards:**
  - a warning when the same variant is about to go to the same account twice
  - Instagram's limit of about 100 posts a day per account, read from `content_publishing_limit`
  - YouTube's daily upload quota (about 100 uploads a day per Google project)

### 9.5 Scheduler
- **Source of truth:** `posts[]` in each `project.json`. When the app starts and whenever a project changes, the scheduler builds an in-memory queue of what's due.
- **Missed posts:** if Clipify wasn't running when an Instagram post was due, the post is marked `missed` on the next start, with a system notification and "Post now / Reschedule".
- **Before a post:** a few minutes before an Instagram post is due, Clipify asks the OS to keep the app awake (`powerSaveBlocker`). Settings explains that a sleeping computer still misses posts.
- **Launch at login:** a setting, on by default.

---

## 10. Descriptions (Claude)

**Settings → Defaults:**
- Model: `claude-opus-5-5` by default, `claude-haiku-5-5` as a cheaper option
- Effort: `low`
- A global writing prompt (tone, language, emoji and hashtag style)
- A **credit template** (global, with an override per channel) with variables:
  `{streamer} {streamer_url} {clip_url} {clip_title} {category} {clipper} {date}`

**Call:**
- `@anthropic-ai/sdk`, from the main process
- `client.messages.parse()` with `output_config.format = zodOutputFormat(DescriptionSchema)`
- Refusal fallback set to `fallbacks: "default"`
- Input: clip transcript, OpenShorts title/hook/descriptions, Twitch metadata, the global prompt and per-project notes

**Output:**
```ts
{ youtube:   { title /* ≤100 */, description, tags[] },
  instagram: { caption, hashtags[] },
  tiktok:    { caption, hashtags[] },     // for copy-paste
  hooks?:    string[] }                   // N alternative hook lines (§7)
```

**After the call, in code:**
- Append the credit block.
- Enforce each platform's length limits by shortening the copy, never the credits.
- Remove duplicate hashtags.

**Without a Claude key:** OpenShorts' own title and descriptions are used, plus the credit block.

---

## 11. Home, Dashboard and statistics

### 11.1 Sources
| | YouTube (Analytics API) | Instagram (Graph insights) | TikTok |
|---|---|---|---|
| Per video | views, likes, comments, shares, average view duration, minutes watched (daily history) | views, reach, likes, comments, shares, saves, average watch time | Manual posts are counted. No stats in v1. |
| Per account | subscribers gained and lost (daily), total views | follower count (daily), reach | — |

- **Collector:** runs once a day (and on demand with a Refresh button) for each connected account. It writes snapshots to `stats.sqlite` with the tables `account_daily`, `post_daily` and `posts`. YouTube and Instagram keep history on their side, so days the app was off are filled in afterwards.
- **Every post is linked to its project → clip → channel and category, and to its variant recipe.** That's what makes the insights in §11.4 possible.

### 11.2 Home (the start screen)
A quick overview and a fast way to start work, based on your homepage reference:
- **A large Unsplash photo** with:
  - a greeting and date
  - a headline number (for example "1.2M views this week") in large light type
  - the next scheduled post
- **A right-hand glass panel:**
  - a **Paste Twitch clip URL** field at the top (where the reference has its location search)
  - **saved channels and categories** as quick links (where the reference lists cities)
  - **"Today"**: in the queue, ready to review, scheduled today, needs attention (where the reference shows weather details)
- **A row of recent projects** below the photo (9:16 cards).

### 11.3 Dashboard (statistics)
- A blurred and darkened Unsplash photo as the page backdrop, with glass panels on top.
- **Stat tiles:** Views · Likes · Comments · Shares · Followers gained · Posts published. Each shows the change against the previous period.
- **Period switch:** 7 d / 28 d / 90 d / All
- **A large area chart** of views over time, split by platform, with a toggle for each account.
- **Account switcher tiles** open the **Account page** (the same tiles and chart for one account, plus its top posts and posting calendar).
- **Post detail:** the engagement curve since publishing, the variant recipe used, and the source clip.

### 11.4 Insight cards (on the Dashboard)
1. **Top videos:** 9:16 cards sorted by views, engagement rate or growth speed.
2. **Best channels and categories:** which Twitch sources turn into the best shorts.
3. **Which variant style wins:** average performance by hook style, caption preset and layout.
4. **Early growth:** views per hour in the first 24 h, with a "taking off" badge and notification.
5. **Best time to post:** a day × hour heatmap for each platform.
6. **Funnel:** clips picked → generated → published (TikTok manual included) → passed 10k views.
7. **Engagement rate:** (likes + comments + shares) / views.
8. **Posting consistency:** streaks and gaps per account, plus the next scheduled posts.
9. **Needs attention:** failed or missed posts, expiring logins, daily limits reached.
10. **CSV export** of any table.

---

## 12. Design system

The direction comes from your references: **dark frosted glass, muted teal-black, light thin type, 9:16 media cards and one mint accent.** The layouts in the references come first. Where one doesn't suit the app, we change it and say why.

### 12.1 Tokens
| Token | Value | Use | Contrast on `bg` |
|---|---|---|---|
| `bg` | `#0A1113` | App background | — |
| `surface` | `#121C1F` (glass: `rgba(18,28,31,.72)` + `backdrop-blur(24px)`) | Panels, sheets, top bar | — |
| `raised` | `#1A2629` | Cards, inputs, hover | — |
| `border` | `rgba(255,255,255,.08)` (`.16` on hover or focus) | Hairlines | — |
| `text` | `#EDF3F2` | Primary text | 17.0 : 1 |
| `text-2` | `#A9B7B5` | Secondary text | 9.2 : 1 |
| `text-3` | `#7F8F8D` | Captions, meta (≥ 4.6 : 1 on every surface) | 5.6 : 1 |
| `accent` | `#5FE3C0` (text on it: `#052019`, 10.8 : 1) | Primary actions, active tab, selection, main chart line | 12.0 : 1 |
| `success` / `warning` / `danger` / `info` | `#4ADE80` / `#FBBF24` / `#F87171` / `#7DD3FC` | Status only, always shown with an icon and a label | ≥ 6.9 : 1 |
| Platform series | YouTube `#FF5A52`, Instagram `#E879B9`, TikTok `#7DD3FC` | Chart series, always with a legend and direct labels | — |

- **Glass rule:** blur only on panels, sheets and the top bar, never on every grid card (performance). Glass is never under 72% opaque, so text contrast holds over any photo.
- **Radius:** 10 (inputs, chips) · 16 (cards) · 24 (panels) · full (pills)
- **Spacing:** 4-pt scale (4, 8, 12, 16, 24, 32, 48)
- **Shadow:** `0 8px 32px rgba(0,0,0,.35)` on panels only

### 12.2 Typography (bundled locally, works offline)
- **Outfit** for display and headings: light 300 for big numbers and the Home headline, 400–500 for headings.
- **Inter** for UI and body text, with `tabular-nums` on every statistic.
- **Scale:** Display 48/300 · H1 28/400 · H2 20/500 · H3 16/500 · Body 14/400 (line height 1.5) · Small 13 · Label 12/500 uppercase with +0.04em letter spacing. Nothing below 12 px.

### 12.3 Components
- **Primitives:** shadcn/ui (Radix + Tailwind), themed with the tokens above
- **Icons:** Lucide only, no emoji
- **Charts:** Recharts
- **Player:** native `<video>` with custom controls

**Card types:**
- **9:16 media card:** the title and avatar sit on a bottom gradient scrim, with a status pill top-left and duration top-right
- **16:9 source card:** used in the Library
- **Stat tile:** label, big Outfit number, change against the previous period, mini sparkline
- **Setup step row:** status icon, title, one-line explanation, action button, expandable wizard

**Interaction:**
- Hover lifts the card (border `.16`, −2 px, 150 ms)
- A 2 px accent focus ring that is always visible
- Every icon button has an `aria-label` and a tooltip
- Click targets are at least 32 px (40 px for primary actions)

**Motion:**
- 150–250 ms ease-out
- 40 ms stagger when grids load
- Exits faster than entrances
- Turned off under `prefers-reduced-motion`

### 12.4 App frame (top navigation)
```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ ◆ Clipify   Home   Dashboard   Library   Projects   Schedule     ⌕  ⧉ Queue(2) ● Engine  ⚙ │
├───────────────────────────────────────────────────────────────────────────────────┤
│                                    (screen)                                        │
└───────────────────────────────────────────────────────────────────────────────────┘
```
- **Tabs:** text tabs with a 2 px accent underline on the active tab.
- **Right side of the bar:** global search, the job queue drawer, the engine status dot (ready / busy / installing / off / error, which opens Settings → Engine), and Settings.
- **Before setup is finished,** a slim banner reads "Setup 3/8 done — Continue".

### 12.5 Screens mapped to references
| Screen | Reference | Layout |
|---|---|---|
| **Home** | homepage-example (weather) | Unsplash photo hero on the left (greeting, headline number, next post) with a glass panel on the right (paste URL, saved quick links, "Today" list), and recent projects below. |
| **Dashboard** | account-info + detailed-statistics + statistic-chart | Blurred Unsplash backdrop. Stat tiles across the top (like the clock tiles), a large area chart with the period switch, a right glass panel "Today" (like the task panel), top-video 9:16 cards, then the insight cards. |
| **Library** | library-video-picker + finished-projects | Sub-tabs with filters on the same line, a clip grid, and the right-hand list of saved categories or channels. **Change from the reference:** source cards are **16:9**, because Twitch clips are landscape. |
| **Projects** | finished-projects | A grid of 9:16 cards (first variant), status tabs (All · Generating · Review · Ready · Scheduled · Published), and a right-hand filter list by channel or category. |
| **Generation results** | finished-loading-project-results | Variants appear as tall numbered columns (01, 02, 03…) in a horizontal row, each with its recipe name. |
| **Review / Editor** | editing-example | Header with breadcrumb and step bar (Source · Generate · **Review** · Publish). **Left:** variants and transcript. **Centre:** 9:16 player. **Right:** inspector tabs. **Bottom:** timeline panel. |
| **Publish** | (own) | The variants × accounts matrix, a schedule picker for each cell, and a TikTok column with Download and Copy. |
| **Schedule** | (own) | A week calendar plus a list. Each post shows its status pill and platform icon. |
| **Settings** | (own, no background image) | Section list on the left: Setup · Engine · Keys · Accounts · Defaults · Storage · About. Content on the right. Setup is the checklist from §4. |

### 12.6 Unsplash backgrounds (Home + Dashboard only)
- **Request:** `GET /photos/random?orientation=landscape&content_filter=high&count=10`, with either a topic or query (default: "dark moody landscape", changeable in Settings → Defaults) or a collection ID. The header is `Authorization: Client-ID <Access Key>`. Only the **Access Key** is used. The Application ID and Secret Key aren't needed.
- **Caching:** the photo details are cached locally, and a new set is fetched once a day. That's about 1 API call a day, well under the demo limit of 50 per hour.
- **Unsplash's rules, followed exactly:**
  - Images are **hotlinked** from the returned `urls` (resized with `&w=2400&fit=max`, keeping `ixid`). No re-hosting.
  - When a photo becomes the background, Clipify calls its **`download_location`** (the tracking Unsplash requires).
  - **Attribution** sits bottom-left on both screens: "Photo by [Name] on Unsplash", with links using `utm_source=clipify&utm_medium=referral`.
- **Readability:** a dark gradient scrim plus the 72% glass panels keep text at 4.5:1 or better over any photo.
- **Offline or no key:** a static dark teal gradient. **Settings toggle:** backgrounds on or off.

---

## 13. Data model (local)

```
<app data>/            (~/Library/Application Support/Clipify · %APPDATA%\Clipify)
  settings.json        (no secrets; holds the library folder path)
  secrets.bin          (safeStorage-encrypted: keys, OAuth tokens, dev-app credentials)
  accounts.json        (connected accounts, no tokens)
~/Clipify (Mac) · %USERPROFILE%\Clipify (Windows)   ← library folder, changeable in Settings
  saved.json           saved categories and channels, credit overrides
  presets.json         generation presets, variant recipes, caption/hook presets
  stats.sqlite         account_daily, post_daily, posts
  projects/<date>_<channel>_<slug>/
    project.json
    source/clip.mp4
    base/base.mp4 metadata.json transcript.json
    variants/v1/v1_r1.mp4 …
    thumbs/ waveforms/
<app data>/engine/                                     (Clipify-managed, not user files)
  python/ venv/ openshorts-<commit>/ bin/ models/ output/ uploads/ logs/
```

`project.json`:
```jsonc
{
  "id": "…", "createdAt": "…",
  "status": "generating|review|ready|scheduled|published|failed",
  "clip": { "twitchId": "…", "url": "…", "broadcaster": {"id":"…","login":"…","name":"…"},
            "category": {"id":"…","name":"…"}, "title": "…", "views": 0, "duration": 0,
            "clipper": "…", "createdAt": "…" },
  "engine": { "jobId": "…", "profile": "win-nvidia", "openshortsCommit": "…", "settings": {} },
  "variants": [{
    "id": "v1", "recipe": "bold", "current": "r2",
    "revisions": [{ "id": "r1", "file": "…", "op": "generate|trim|frame|captions|hook", "params": {} }],
    "descriptions": { "youtube": {}, "instagram": {}, "tiktok": {} },
    "posts": [{ "id": "…", "account": "…", "platform": "youtube|instagram|tiktok",
                "mode": "now|scheduled|manual", "scheduledAt": "…", "status": "…",
                "remoteId": "…", "url": null, "error": null }]
  }]
}
```

---

## 14. M0 spike: check before building on it

| # | Check | Status / pass when |
|---|---|---|
| 1 | **Native engine on Mac (arm64):** `uv` + lock + bundled ffmpeg + fonts | A job completes. Captions use the right fonts. |
| 2 | **Native engine on Windows + NVIDIA:** CUDA torch, faster-whisper on CUDA, NVENC, patches applied | The NVIDIA driver works on your PC ✓. Pass: the logs show CUDA whisper and NVENC. If not, use the WSL2 fallback (§5.3). |
| 3 | **Native engine on Windows CPU** | A job completes. |
| 4 | Short-clip settings (§7): `MIN_SOURCE_SECONDS=0`, `target_clips:1`, clean base, `input_filename` chaining | The output length is ≥ 90% of the clip, and variants are independent files. |
| 5 | INSET layout on 5 real facecam clips | The result looks good in at least 4 of 5. |
| 6 | Speed and install size per profile | Real numbers replace the estimates in §5. |
| 7 | Engine sharing: Mac → Windows PC with pairing code | Generate and edit work end to end. |
| 8 | YouTube: Desktop OAuth client, loopback, "In production / unverified" | Expected to work ✓. Pass: a refresh token still works after 8+ days. |
| 9 | Instagram: resumable **local** Reel upload (Facebook Login for Business, Development mode) | Supported by Meta's docs ✓. Pass: a Reel is published from a local file. |
| 10 | Postiz providers ported outside NestJS | YouTube and Instagram upload plus `analytics()` work from plain Node. |
| 11 | YouTube scheduled publish (`private` + `publishAt`) | The video goes live while the computer is off. |
| 12 | YouTube Analytics per-Short daily views | We know the query. |
| 13 | Twitch embed inside Electron | Embed works, or we use the fallback. |

---

## 15. Milestones

| M | Deliverable | Done when |
|---|---|---|
| **M0** | Spike (§14) | Every row has an answer. The plan is adjusted where needed. |
| **M1** | App shell, design tokens, top navigation, Settings with the Setup checklist, team setup file, **EngineInstaller and EngineProcess** for all profiles, Keys | A fresh Mac **and** a fresh Windows NVIDIA PC reach "Engine ready" using only the Settings screen. |
| **M2** | Library: Twitch wizard, Categories and Channels, Popular / Saved / Search / All, Paste URL, filters | Can find a clip in all four ways and create a project from it. |
| **M3** | Generate: JobQueue, base render, N variants, queue drawer, results view | One clip → N playable variants. |
| **M4** | Review editor: timeline/trim, Frame, Captions, Hook, revisions | Every tool produces a new revision, and older revisions can be restored. |
| **M5** | Descriptions: Claude, credit templates, schema output, fallback | Credits are always present and length limits are enforced. |
| **M6** | Accounts and publishing: YouTube and Instagram wizards, vendored providers, Publish matrix, TikTok manual cell | One variant posts to YouTube and Instagram, and another is marked as posted on TikTok. |
| **M7** | Scheduler and tray: YouTube native scheduling, Instagram scheduler, missed posts, launch at login | A scheduled Instagram post goes out from the tray, and a missed one is flagged. |
| **M8** | Home + Dashboard + stats: collectors, stats.sqlite, Unsplash backgrounds, Account and Post pages, insights 1–10 | The numbers match the platforms' own dashboards (within their 48 h delay). |
| **M9** | Engine sharing (remote) plus packaging: `.dmg` (arm64) and Windows NSIS (x64), auto-update, `LICENSE` and `NOTICE` | Installs cleanly on both machines. The Mac can use the Windows engine. |

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| OpenShorts on native Windows needs more than small patches | WSL2 fallback (no Docker, same Linux code, GPU works) installed from Settings. Patches are also sent upstream. |
| The engine download is large (CUDA) and installs can fail | Resumable downloads, hash checks, a "Repair engine" button, and a side-by-side install for updates |
| OpenShorts or Postiz change upstream | Pin both commits, keep all calls in one client module each, re-run the spike checks before upgrading |
| Meta or Google change their policies | The team owns the developer apps. All platform code is isolated in `publish/<platform>/`. |
| Instagram posts are missed when the computer sleeps | YouTube uses native scheduling. For Instagram: tray, launch at login, wake request, missed-post alerts. |
| Unsplash limits or rule changes | About 1 call a day, attribution and download tracking included, falls back to a gradient |
| Reposting other people's streams | The user's responsibility. Credits are always added. |
| Signing: unsigned apps show OS warnings | Internal use is fine at first. Apple Developer ID and Windows code signing come before auto-update on Mac. |

---

## 17. Housekeeping before M1
- The Unsplash keys were saved as **`.env.rtf`**, which is rich text from TextEdit, so the app can't read it. In M1 we create a plain `.env` (only `UNSPLASH_ACCESS_KEY` is needed), add `.gitignore` (covering `.env*`), and delete the `.rtf`. The repo will be public, so keys must never be committed. In the built app, the key is entered in Settings.
- `git init`, AGPL `LICENSE`, `NOTICE`, `.env.example`.

---

## 18. Build status (v0.1, 2026-11-13)

**Verified on this Mac (Apple Silicon, M2 Pro):**
- Native engine install (uv → Python 3.11 → OpenShorts at the pinned commit → packages → ffmpeg → YOLO) and start in about 3 s. No Docker.
- Clip → base render → variants, run end to end in the app: a 23 s Twitch clip took about 65 s of engine time on CPU, plus about 10–20 s per variant.
- Editor: hook, captions, trim (two segments) and framing all re-render. Trim and frame re-render every variant, and revisions r1–r4 can be switched.
- Descriptions without Claude (OpenShorts text + credit line), manual TikTok posting, Schedule, Home, Dashboard (with demo statistics), Settings and Setup.
- Engine lifecycle: it stops when the app quits (SIGINT, with a forced stop after 5 s), and an engine left over from a crash is stopped on the next start.
- The packaged `.app` (unsigned) finds and starts the engine.
- Unit tests: clip links, credit protection, sharing address rules, progress phases, team-file encryption, project status, statistics math.

**Not verified yet (needs keys, accounts or hardware):**
- Twitch Library browsing (needs Twitch app credentials).
- Gemini-driven layout picking (needs a Gemini key; the stand-in model was used for tests).
- Claude descriptions and hooks (needs a Claude key).
- YouTube and Instagram sign-in, upload, scheduling and statistics (needs the team's Google and Meta apps). The code follows Postiz and the platform docs but has not run against the real APIs.
- Windows: the native engine with or without NVIDIA, the Windows patches, and the NSIS installer.
- Engine sharing between two machines.
- Long-term checks: YouTube refresh token after 8+ days, Instagram's 60-day token.
