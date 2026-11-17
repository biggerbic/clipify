import { createServer, request, type Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'

/** Private LAN ranges, Tailscale (100.64/10) and loopback: the only callers a shared engine accepts. */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.replace(/^::ffff:/, '')
  if (a === '::1' || a === '127.0.0.1' || a.startsWith('127.')) return true
  if (a.startsWith('10.') || a.startsWith('192.168.')) return true
  const [o1, o2] = a.split('.').map(Number)
  if (o1 === 172 && o2 >= 16 && o2 <= 31) return true
  if (o1 === 100 && o2 >= 64 && o2 <= 127) return true
  if (/^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a)) return true
  return false
}

let server: Server | null = null
let code = ''
let port = 0

/** Pairing code shown on the sharing machine: short enough to type, long enough not to guess. */
function newCode(): string {
  return randomBytes(9).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X').match(/.{1,4}/g)!.join('-')
}

function authorized(header: string | string[] | undefined): boolean {
  const given = Buffer.from(String(header ?? ''))
  const expected = Buffer.from(code)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Reverse proxy in front of the local engine: OpenShorts itself has no login, so it never listens beyond 127.0.0.1. */
export async function startShare(listenPort: number, engineUrl: string): Promise<void> {
  stopShare()
  code = newCode()
  port = listenPort
  const target = new URL(engineUrl)
  server = createServer((req, res) => {
    if (!isPrivateAddress(req.socket.remoteAddress ?? '')) {
      res.writeHead(403).end('Only local-network and Tailscale addresses may use this engine.')
      return
    }
    if (!authorized(req.headers['x-clipify-token'])) {
      res.writeHead(401).end('Pairing code required.')
      return
    }
    const headers = { ...req.headers, host: target.host }
    delete (headers as Record<string, unknown>)['x-clipify-token']
    const upstream = request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    })
    upstream.on('error', () => res.writeHead(502).end('Engine unavailable.'))
    req.pipe(upstream)
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(listenPort, '0.0.0.0', () => resolve())
  })
}

export function stopShare(): void {
  server?.close()
  server = null
  code = ''
}

export function shareInfo(): { enabled: boolean; addresses: string[]; port: number; code?: string } {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal && isPrivateAddress(n.address))
    .map((n) => n!.address)
  return { enabled: Boolean(server), addresses, port: port || 8765, code: server ? code : undefined }
}
