import { app, BrowserWindow, Menu, nativeImage, net, protocol, shell, Tray } from 'electron'
import { join, resolve, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { ctx } from './context'
import { registerIpc } from './ipc'
import { engine } from './engine/service'
import { getSettings } from './store/settings'
import { projectDir } from './store/projects'
import { recoverInterrupted } from './jobs/generate'
import { startScheduler } from './publish/publisher'
import { startCollector } from './stats'

if (!app.isPackaged) {
  try {
    process.loadEnvFile(join(app.getAppPath(), '.env'))
  } catch {
    /* no .env: fine */
  }
}

protocol.registerSchemesAsPrivileged([{ scheme: 'clipify-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

let tray: Tray | null = null
let quitting = false

function icon(name: string): Electron.NativeImage {
  const file = join(ctx.resources, 'resources', name)
  return existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty()
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0A1113',
    title: 'Clipify',
    icon: icon('icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 18, y: 20 } } : { titleBarOverlay: { color: '#0A1113', symbolColor: '#A9B7B5', height: 56 } }),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false }
  })
  ctx.win = win
  // Launched at login: stay in the tray until the user opens the window.
  const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin
  win.once('ready-to-show', () => !hidden && win.show())
  // Closing hides to the tray so scheduled posts and statistics keep running.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://')) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function showWindow(): void {
  if (!ctx.win || ctx.win.isDestroyed()) createWindow()
  else {
    ctx.win.show()
    ctx.win.focus()
  }
}

function createTray(): void {
  const img = icon(process.platform === 'darwin' ? 'trayTemplate.png' : 'icon.png').resize({ width: 18, height: 18 })
  if (process.platform === 'darwin') img.setTemplateImage(true)
  tray = new Tray(img)
  tray.setToolTip('Clipify')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Clipify', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit Clipify',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', showWindow)
}

/** Serve project files to the renderer: clipify-media://<projectId>/<relative path>. */
function registerMediaProtocol(): void {
  protocol.handle('clipify-media', async (req) => {
    const url = new URL(req.url)
    const dir = await projectDir(decodeURIComponent(url.hostname))
    const file = resolve(dir, decodeURIComponent(url.pathname.slice(1)))
    if (!file.startsWith(dir + sep) || !existsSync(file)) return new Response('Not found', { status: 404 })
    const range = req.headers.get('range')
    return net.fetch(pathToFileURL(file).toString(), { headers: range ? { range } : {} })
  })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', showWindow)
  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(icon('icon.png'))
    registerIpc()
    registerMediaProtocol()
    createWindow()
    createTray()
    const settings = await getSettings()
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: ['--hidden'] })
    await recoverInterrupted()
    startScheduler()
    startCollector()
    void engine.start().catch(() => undefined)
  })
  app.on('activate', showWindow)
  let engineStopped = false
  app.on('before-quit', (e) => {
    quitting = true
    if (engineStopped) return
    // Wait for the engine (and its job processes) to exit so nothing keeps running after Clipify closes.
    e.preventDefault()
    void engine
      .stop()
      .catch(() => undefined)
      .finally(() => {
        engineStopped = true
        app.quit()
      })
  })
  app.on('window-all-closed', () => {
    /* stay in the tray */
  })
}
