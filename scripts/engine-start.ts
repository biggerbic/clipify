import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { enginePaths, type Manifest } from '../src/main/engine/installer'
import { detectProfile } from '../src/main/engine/profile'
import { startEngine, stopEngine } from '../src/main/engine/process'

const root = join(homedir(), 'Library/Application Support/Clipify/engine')
const m = JSON.parse(readFileSync('engine/manifest.json', 'utf8')) as Manifest
const p = enginePaths(root, m)
const t0 = Date.now()
const eng = await startEngine(p, await detectProfile(), (l) => process.env.VERBOSE && console.log('  |', l))
console.log('READY', eng.url, `${((Date.now() - t0) / 1000).toFixed(1)}s`)
const cfg = await (await fetch(eng.url + '/api/config')).json()
console.log('config keys', Object.keys(cfg).slice(0, 15).join(','))
if (process.argv[2] === 'hold') { console.log('holding; ctrl-c to stop'); await new Promise(() => {}) }
stopEngine(eng.child)
console.log('stopped')
