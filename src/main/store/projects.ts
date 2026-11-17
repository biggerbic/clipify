import { existsSync } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { Project, TwitchClip } from '@shared/types'
import { ctx } from '../context'
import { getSettings } from './settings'
import { readJson, writeJson } from './json'

export async function projectsDir(): Promise<string> {
  return join((await getSettings()).libraryDir, 'projects')
}

export async function projectDir(id: string): Promise<string> {
  const root = await projectsDir()
  const dir = resolve(root, id)
  // ids come from the renderer: never let one escape the projects folder
  if (!dir.startsWith(resolve(root) + sep)) throw new Error('Invalid project id')
  return dir
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'clip'

export async function listProjects(): Promise<Project[]> {
  const root = await projectsDir()
  if (!existsSync(root)) return []
  const out: Project[] = []
  for (const name of await readdir(root)) {
    const p = await readJson<Project | null>(join(root, name, 'project.json'), null)
    if (p) out.push(p)
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getProject(id: string): Promise<Project> {
  const p = await readJson<Project | null>(join(await projectDir(id), 'project.json'), null)
  if (!p) throw new Error('Project not found')
  return p
}

// Serialize writes per project: generation, edits and the scheduler can touch the same file.
const locks = new Map<string, Promise<unknown>>()
export function withProject<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  locks.set(
    id,
    next.catch(() => undefined)
  )
  return next
}

export async function saveProject(p: Project): Promise<Project> {
  p.updatedAt = new Date().toISOString()
  await writeJson(join(await projectDir(p.id), 'project.json'), p)
  ctx.emit({ type: 'project', project: p })
  return p
}

/** Read-modify-write under the project lock. */
export function updateProject(id: string, fn: (p: Project) => void | Promise<void>): Promise<Project> {
  return withProject(id, async () => {
    const p = await getProject(id)
    await fn(p)
    return saveProject(p)
  })
}

export async function createProjectRecord(clip: TwitchClip): Promise<Project> {
  const date = new Date().toISOString().slice(0, 10)
  let id = `${date}_${slug(clip.broadcasterName)}_${slug(clip.title)}`
  const root = await projectsDir()
  for (let n = 2; existsSync(join(root, id)); n++) id = `${date}_${slug(clip.broadcasterName)}_${slug(clip.title)}-${n}`
  await mkdir(join(root, id), { recursive: true })
  const now = new Date().toISOString()
  const project: Project = { id, createdAt: now, updatedAt: now, status: 'generating', clip, notes: '', engine: {}, variants: [] }
  return saveProject(project)
}

export async function deleteProject(id: string): Promise<void> {
  await rm(await projectDir(id), { recursive: true, force: true })
}
