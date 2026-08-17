import type { Context, Next } from 'hono'
import { API_KEY_HASHES, config } from './config.js'
import { sha256 } from './crypto.js'

declare module 'hono' {
  interface ContextVariableMap {
    apiKeyHash: string
  }
}

/** Bearer token -> SHA-256 compare contre la liste configuree. */
export async function requireApiKey(c: Context, next: Next) {
  const header = c.req.header('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match?.[1]) {
    return c.json(
      { error: 'unauthorized', message: 'En-tete Authorization: Bearer <api_key> requis.' },
      401,
    )
  }

  const hash = sha256(match[1])
  if (!API_KEY_HASHES.has(hash)) {
    return c.json({ error: 'unauthorized', message: 'Cle API inconnue.' }, 401)
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
        message: `Limite de ${config.rateLimitPerMin} demandes par minute atteinte.`,
        retry_after_seconds: retryAfter,
      },
      429,
    )
  }

  bucket.count += 1
  await next()
}

/** Evite que la map grossisse indefiniment sur un service qui tourne longtemps. */
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
}, 300_000).unref()
