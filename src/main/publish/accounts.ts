import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { Account, Platform } from '@shared/types'
import { ctx } from '../context'
import { readJson, writeJson } from '../store/json'
import { getSecret, getToken, setToken } from '../store/secrets'
import * as yt from './youtube/provider'
import * as ig from './instagram/provider'

const file = (): string => join(ctx.userData, 'accounts.json')

export async function listAccounts(): Promise<Account[]> {
  return readJson<Account[]>(file(), [])
}
async function saveAccounts(list: Account[]): Promise<Account[]> {
  await writeJson(file(), list)
  return list
}
async function upsert(acc: Account): Promise<Account[]> {
  const list = (await listAccounts()).filter((a) => a.id !== acc.id)
  return saveAccounts([...list, acc])
}

async function ytApp(): Promise<yt.YtApp> {
  const clientId = await getSecret('googleClientId')
  const clientSecret = await getSecret('googleClientSecret')
  if (!clientId || !clientSecret) throw new Error('Add your Google app (Client ID and Secret) in Settings → Setup → YouTube first.')
  return { clientId, clientSecret }
}
async function metaApp(): Promise<ig.MetaApp> {
  const appId = await getSecret('metaAppId')
  const appSecret = await getSecret('metaAppSecret')
  if (!appId || !appSecret) throw new Error('Add your Meta app (App ID and Secret) in Settings → Setup → Instagram first.')
  return { appId, appSecret }
}

export async function connect(platform: 'youtube' | 'instagram'): Promise<Account[]> {
  const now = new Date().toISOString()
  if (platform === 'youtube') {
    const { tokens, channel } = await yt.connect(await ytApp())
    const id = `yt_${channel.id}`
    await setToken(id, tokens)
    return upsert({ id, platform, name: channel.title, handle: channel.handle, avatarUrl: channel.avatar, remoteId: channel.id, connectedAt: now, status: 'ok' })
  }
  const found = await ig.connect(await metaApp())
  let list: Account[] = []
  for (const a of found) {
    const id = `ig_${a.igUserId}`
    await setToken(id, a)
    list = await upsert({ id, platform, name: a.name, handle: `@${a.username}`, avatarUrl: a.avatar, remoteId: a.igUserId, connectedAt: now, status: 'ok' })
  }
  return list
}

export async function addManual(platform: Platform, name: string, handle: string): Promise<Account[]> {
  const id = `${platform.slice(0, 2)}_manual_${randomBytes(4).toString('hex')}`
  return upsert({ id, platform, name: name.trim() || handle.trim(), handle: handle.trim(), connectedAt: new Date().toISOString(), status: 'manual' })
}

export async function disconnect(id: string): Promise<Account[]> {
  await setToken(id, undefined)
  return saveAccounts((await listAccounts()).filter((a) => a.id !== id))
}

export async function markStatus(id: string, status: Account['status']): Promise<void> {
  const list = await listAccounts()
  const a = list.find((x) => x.id === id)
  if (a && a.status !== status) {
    a.status = status
    await saveAccounts(list)
  }
}

/** A valid YouTube access token for an account (refreshed and persisted when needed). */
export async function youtubeAccess(accountId: string): Promise<string> {
  const tokens = await getToken<yt.YtTokens>(accountId)
  if (!tokens) throw new Error('This YouTube account is not connected.')
  try {
    const next = await yt.fresh(await ytApp(), tokens)
    if (next !== tokens) await setToken(accountId, next)
    return next.accessToken
  } catch (err) {
    await markStatus(accountId, 'expired')
    throw err
  }
}

export async function instagramAccount(accountId: string): Promise<ig.IgAccount> {
  const acc = await getToken<ig.IgAccount>(accountId)
  if (!acc) throw new Error('This Instagram account is not connected.')
  if (acc.expiresAt < Date.now()) {
    await markStatus(accountId, 'expired')
    throw new Error('Instagram login expired. Reconnect the account in Settings → Accounts.')
  }
  return acc
}
