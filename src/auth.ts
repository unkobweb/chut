import type { Context, Next } from 'hono'
import { API_KEY_HASHES, config } from './config.js'
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

const buckets = new Map<string, { count: number; resetAt: number }>()

export async function rateLimit(c: Context, next: Next) {
  const key = c.get('apiKeyHash') ?? 'anonymous'
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 })
    await next()
    return
  }

  if (bucket.count >= config.rateLimitPerMin) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000)
    c.header('Retry-After', String(retryAfter))
    return c.json(
      {
        error: 'rate_limited',
        message: `Rate limit of ${config.rateLimitPerMin} requests per minute reached.`,
        retry_after_seconds: retryAfter,
      },
      429,
    )
  }

  bucket.count += 1
  await next()
}

/** Keeps the map from growing without bound on a long-running server. */
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
}, 300_000).unref()
