import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dialog } from 'electron'
import { SECRET_KEYS, type SecretKey } from '@shared/types'
import { exportableKeys, setSecret } from '../store/secrets'

const MAGIC = 'clipify-team-setup-v1'

/** AES-256-GCM with a scrypt key from the passphrase. Output: JSON {magic, salt, iv, tag, data} (base64). */
export function sealTeamSetup(keys: Partial<Record<SecretKey, string>>, passphrase: string): string {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(passphrase, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(keys), 'utf8'), cipher.final()])
  return JSON.stringify({ magic: MAGIC, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })
}

export function openTeamSetup(text: string, passphrase: string): Partial<Record<SecretKey, string>> {
  const f = JSON.parse(text) as { magic: string; salt: string; iv: string; tag: string; data: string }
  if (f.magic !== MAGIC) throw new Error('This is not a Clipify team setup file.')
  const key = scryptSync(passphrase, Buffer.from(f.salt, 'base64'), 32)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(f.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(f.tag, 'base64'))
  try {
    const plain = Buffer.concat([decipher.update(Buffer.from(f.data, 'base64')), decipher.final()]).toString('utf8')
    return JSON.parse(plain)
  } catch {
    throw new Error('Wrong passphrase, or the file was changed.')
  }
}

export async function exportTeamSetup(passphrase: string): Promise<{ ok: boolean; path?: string }> {
  if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.')
  const res = await dialog.showSaveDialog({ defaultPath: 'clipify-team-setup.clipify', filters: [{ name: 'Clipify team setup', extensions: ['clipify'] }] })
  if (res.canceled || !res.filePath) return { ok: false }
  await writeFile(res.filePath, sealTeamSetup(await exportableKeys(), passphrase))
  return { ok: true, path: res.filePath }
}

export async function importTeamSetup(passphrase: string): Promise<{ ok: boolean; message: string }> {
  const res = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Clipify team setup', extensions: ['clipify'] }] })
  if (res.canceled || !res.filePaths[0]) return { ok: false, message: 'Cancelled.' }
  const keys = openTeamSetup(await readFile(res.filePaths[0], 'utf8'), passphrase)
  let n = 0
  for (const k of SECRET_KEYS) {
    const v = keys[k]
    if (v && k !== 'remoteToken') {
      await setSecret(k, v)
      n++
    }
  }
  return { ok: true, message: `Imported ${n} keys and app credentials.` }
}
