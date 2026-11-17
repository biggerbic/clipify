// Dev helper: drive the built Electron app with Playwright and save screenshots.
// usage: node scripts/ui.mjs <outDir> [steps.json]
//   steps: [{ "nav": "Dashboard" } | { "click": "text=…" } | { "fill": [selector, value] } | { "wait": ms } | { "shot": "name" } | { "eval": "js" }]
import { _electron as electron } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'out/shots'
const steps = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : [{ wait: 2500 }, { shot: 'home' }]
mkdirSync(outDir, { recursive: true })

const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, CLIPIFY_TEST: '1' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined)
const errors = []
win.on('pageerror', (e) => errors.push(String(e)))
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await win.waitForLoadState('domcontentloaded')
for (const s of steps) {
  if (s.nav) await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: s.nav, exact: true }).click()
  if (s.click) await win.locator(s.click).first().click({ timeout: 15000 })
  if (s.fill) await win.locator(s.fill[0]).first().fill(s.fill[1])
  if (s.press) await win.keyboard.press(s.press)
  if (s.wait) await win.waitForTimeout(s.wait)
  if (s.waitFor) await win.locator(s.waitFor).first().waitFor({ timeout: s.timeout ?? 30000 })
  if (s.eval) console.log('eval:', JSON.stringify(await win.evaluate(s.eval)))
  if (s.shot) {
    await win.screenshot({ path: join(outDir, `${s.shot}.png`) })
    console.log('shot', s.shot)
  }
}
if (errors.length) console.log('RENDERER ERRORS:\n' + errors.slice(0, 20).join('\n'))
await app.close()
