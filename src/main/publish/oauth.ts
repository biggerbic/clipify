import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'

/** Fixed loopback port so the redirect URL shown in the setup wizards never changes. */
export const OAUTH_PORT = 53682
export const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/callback`

export function pkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), state: randomBytes(12).toString('hex') }
}

const page = (title: string, body: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;background:#0A1113;color:#EDF3F2;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="font-weight:400">${title}</h2><p style="color:#A9B7B5">${body}</p></div>`

/**
 * Open the platform's consent page in the system browser and wait for it to redirect back to the
 * loopback server with ?code=… Rejects after 5 minutes or when the user denies access.
 */
export function authorize(authUrl: string, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const handler: Parameters<typeof createServer>[1] = (req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')
      if (url.searchParams.get('state') !== state || !code) {
        res.writeHead(400, { 'content-type': 'text/html' }).end(page('Connection failed', error ?? 'Please try again from Clipify.'))
        finish(new Error(error ? `Access was not granted: ${error}` : 'The sign-in did not complete.'))
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(page('Connected', 'You can close this tab and return to Clipify.'))
      finish(null, code)
    }
    // "localhost" may resolve to IPv4 or IPv6 in the browser: listen on both loopbacks, never on the LAN.
    const v4 = createServer(handler)
    const v6 = createServer(handler)
    const timer = setTimeout(() => finish(new Error('Sign-in timed out after 5 minutes.')), 5 * 60_000)
    let done = false
    function finish(err: Error | null, code?: string): void {
      if (done) return
      done = true
      clearTimeout(timer)
      v4.close()
      v6.close()
      if (err) reject(err)
      else resolve(code!)
    }
    v6.on('error', () => undefined)
    v6.listen(OAUTH_PORT, '::1')
    v4.once('error', () => finish(new Error(`Port ${OAUTH_PORT} is busy, so the sign-in cannot return to Clipify. Close the app using it and retry.`)))
    v4.listen(OAUTH_PORT, '127.0.0.1', () => void shell.openExternal(authUrl))
  })
}
