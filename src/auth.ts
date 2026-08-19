import type { Context, Next } from 'hono'
import { API_KEY_HASHES } from './config.js'
import { sha256 } from './crypto.js'

declare module 'hono' {
  interface ContextVariableMap {
    apiKeyHash: string
  }
}

/** Bearer token -> SHA-256 compared against the configured set. */
export async function requireApiKey(c: Context, next: Next) {
  const header = c.req.header('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match?.[1]) {
    return c.json(
      { error: 'unauthorized', message: 'Authorization: Bearer <api_key> header is required.' },
      401,
    )
  }

  const hash = sha256(match[1])
  if (!API_KEY_HASHES.has(hash)) {
    return c.json({ error: 'unauthorized', message: 'Unknown API key.' }, 401)
  }

  c.set('apiKeyHash', hash)
  await next()
}
