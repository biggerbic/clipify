import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { ApiEvent } from '@shared/api'

/** Process-wide state of the main process. */
export const ctx = {
  win: null as BrowserWindow | null,
  get userData(): string {
    return app.getPath('userData')
  },
  /** Bundled read-only files (engine manifest, patches). */
  get resources(): string {
    return app.isPackaged ? process.resourcesPath : join(app.getAppPath())
  },
  emit(event: ApiEvent): void {
    if (ctx.win && !ctx.win.isDestroyed()) ctx.win.webContents.send('clipify:event', event)
  },
  notice(level: 'info' | 'success' | 'error', text: string): void {
    ctx.emit({ type: 'notice', level, text })
  }
}
