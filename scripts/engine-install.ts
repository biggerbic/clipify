// Dev helper: install the native engine outside Electron (same code path the Settings screen uses).
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { enginePaths, installEngine, type Manifest } from '../src/main/engine/installer'
import { detectProfile } from '../src/main/engine/profile'

const require = createRequire(import.meta.url)
const root = process.argv[2] ?? join(homedir(), 'Library/Application Support/Clipify/engine')
const manifest = JSON.parse(readFileSync('engine/manifest.json', 'utf8')) as Manifest
const profile = await detectProfile()
const p = enginePaths(root, manifest)
console.log('profile', profile.id, 'root', root)
let last = ''
await installEngine(p, manifest, profile, { ffmpeg: require('ffmpeg-static'), ffprobe: require('ffprobe-static').path }, 'engine/patches/windows.json', (e) => {
  const line = `[${e.step}] ${e.status}${e.percent ? ` ${e.percent.toFixed(0)}%` : ''}${e.message ? ' ' + e.message : ''}`
  if (e.percent !== undefined && line.slice(0, 20) === last.slice(0, 20) && Math.round(e.percent) % 10) return
  last = line
  console.log(line)
})
console.log('ENGINE INSTALLED')
