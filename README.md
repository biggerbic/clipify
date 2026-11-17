# Clipify

Turn Twitch clips into vertical shorts, publish them to YouTube and Instagram, and track how they perform. Desktop app for macOS (Apple Silicon) and Windows (with or without an NVIDIA GPU).

```
Pick (Twitch) → Generate (OpenShorts, N variants) → Review & edit → Describe (Claude) → Publish / Schedule → Track
```

Everything runs locally. Video processing uses [OpenShorts](https://github.com/mutonby/openshorts), which Clipify installs and runs natively, without Docker. All setup happens in **Settings → Setup**; see [plan.md](plan.md) for the full design.

## Run from source

```bash
npm install
npm run dev
```

Optional developer defaults go in `.env` (see `.env.example`). The built app never reads `.env`; users enter keys in Settings.

## Build installers

```bash
npm run dist:mac   # Apple Silicon .dmg (unsigned unless a Developer ID is configured)
npm run dist:win   # Windows x64 NSIS installer (build on Windows)
```

## Tests

```bash
npm run typecheck
npm test
```

Dev scripts in `scripts/`:

| Script | What it does |
|---|---|
| `npm run engine:install` | Installs the native engine outside the app (same code path as Settings → Setup) |
| `scripts/e2e-generate.ts` | One Twitch clip → base render → captions → hook, against the real engine |
| `scripts/llm-stub.mjs` | Local stand-in for the moment picker, for engine tests without a Gemini key |
| `scripts/ui.mjs` | Drives the built app with Playwright and saves screenshots |
| `scripts/make-icons.py` | Regenerates the app and tray icons |

## Layout

```
src/main/       Electron main process: engine, OpenShorts client, Twitch, Claude, publishing, scheduler, stats
src/preload/    The single IPC bridge exposed to the renderer
src/renderer/   React UI (Tailwind, design tokens in theme/index.css)
src/shared/     Types and the IPC API shared by both sides
engine/         Pinned OpenShorts commit + Windows patches
```

## License

AGPL-3.0. YouTube and Instagram publishing is adapted from Postiz (AGPL-3.0); see [NOTICE](NOTICE).
