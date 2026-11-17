import { spawn, type SpawnOptions } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export type LineFn = (line: string) => void

/** Run a command, stream its output line by line, reject on a non-zero exit. */
export function run(cmd: string, args: string[], opts: SpawnOptions & { onLine?: LineFn } = {}): Promise<string> {
  const { onLine, ...spawnOpts } = opts
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...spawnOpts, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const tail: string[] = []
    const feed = (buf: Buffer): void => {
      for (const line of buf.toString().split(/\r?\n/)) {
        if (!line.trim()) continue
        tail.push(line)
        if (tail.length > 60) tail.shift()
        onLine?.(line)
      }
    }
    child.stdout?.on('data', feed)
    child.stderr?.on('data', feed)
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(tail.join('\n')) : reject(new Error(`${cmd} exited with ${code}\n${tail.slice(-15).join('\n')}`))
    )
  })
}

/** Download a URL to a file (written to .part first, so a broken download never looks finished). */
export async function download(url: string, dest: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let done = 0
  const body = Readable.fromWeb(res.body as never)
  body.on('data', (chunk: Buffer) => {
    done += chunk.length
    onProgress?.(done, total)
  })
  // shortcut: no resume on a dropped connection, the step is simply retried; add Range resume if installs fail on slow links
  await pipeline(body, createWriteStream(dest + '.part'))
  await rename(dest + '.part', dest)
}
