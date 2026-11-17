import { contextBridge, ipcRenderer } from 'electron'
import type { ApiEvent } from '@shared/api'

/** The only surface the renderer gets: invoke a named API call, or listen to main-process events. */
contextBridge.exposeInMainWorld('clipify', {
  invoke: (method: string, ...args: unknown[]) => ipcRenderer.invoke(`clipify:${method}`, ...args),
  on: (cb: (e: ApiEvent) => void) => {
    const listener = (_: unknown, e: ApiEvent): void => cb(e)
    ipcRenderer.on('clipify:event', listener)
    return () => ipcRenderer.removeListener('clipify:event', listener)
  },
  platform: process.platform
})
