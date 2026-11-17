import { app, safeStorage } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SECRET_KEYS, type SecretKey, type SecretsStatus } from '@shared/types'
import { ctx } from '../context'

/** Everything sensitive: API keys, developer-app credentials and per-account OAuth tokens. */
interface SecretStore {
  keys: Partial<Record<SecretKey, string>>
  tokens: Record<string, unknown>
}

let cache: SecretStore | null = null
const file = (): string => join(ctx.userData, 'secrets.bin')

// When running from source, .env provides defaults so developers don't retype keys.
const DEV_ENV: Partial<Record<SecretKey, string>> = {
  geminiKey: 'GEMINI_API_KEY',
  anthropicKey: 'ANTHROPIC_API_KEY',
  unsplashKey: 'UNSPLASH_ACCESS_KEY',
  twitchClientId: 'TWITCH_CLIENT_ID',
  twitchClientSecret: 'TWITCH_CLIENT_SECRET'
}

async function load(): Promise<SecretStore> {
  if (cache) return cache
  cache = { keys: {}, tokens: {} }
  if (existsSync(file())) {
    try {
      const raw = await readFile(file())
      cache = JSON.parse(safeStorage.decryptString(raw)) as SecretStore
    } catch {
      ctx.notice('error', 'Stored keys could not be decrypted on this machine. Please enter them again in Settings.')
    }
  }
  return cache
}

async function save(): Promise<void> {
  if (!cache) return
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is not available, so keys cannot be stored safely.')
  await writeFile(file(), safeStorage.encryptString(JSON.stringify(cache)))
}

export async function getSecret(key: SecretKey): Promise<string | undefined> {
  const value = (await load()).keys[key]
  if (value) return value
  const envName = DEV_ENV[key]
  return !app.isPackaged && envName ? process.env[envName] || undefined : undefined
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  const store = await load()
  if (value.trim()) store.keys[key] = value.trim()
  else delete store.keys[key]
  await save()
}

export async function secretsStatus(): Promise<SecretsStatus> {
  const out = {} as SecretsStatus
  for (const key of SECRET_KEYS) out[key] = Boolean(await getSecret(key))
  return out
}

export async function getToken<T>(id: string): Promise<T | undefined> {
  return (await load()).tokens[id] as T | undefined
}

export async function setToken(id: string, value: unknown | undefined): Promise<void> {
  const store = await load()
  if (value === undefined) delete store.tokens[id]
  else store.tokens[id] = value
  await save()
}

/** Keys that a team setup file carries (never personal OAuth tokens). */
export async function exportableKeys(): Promise<Partial<Record<SecretKey, string>>> {
  const out: Partial<Record<SecretKey, string>> = {}
  for (const key of SECRET_KEYS) {
    if (key === 'remoteToken') continue
    const v = await getSecret(key)
    if (v) out[key] = v
  }
  return out
}
