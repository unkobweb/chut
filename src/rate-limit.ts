import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context, Next } from 'hono'
import { config } from './config.js'

/**
 * Fixed-window counters, in memory.
 *
 * Deliberately not keyed on anything the caller controls. The peer address comes
 * from the TCP socket, not from a header: an attacker cannot rotate it by sending
 * a different X-Forwarded-For.
 *
 * Known limitation: behind a reverse proxy every request shares the proxy's
 * address, so the per-IP buckets collapse into one. Configuring a trusted proxy
 * hop count is handled separately, together with the forgeable filled_ip_hash.
 *
 * Also in-memory: counters reset on restart and are not shared across instances.
 * That is acceptable for a single-container deployment and wants Redis beyond it.
 */
const buckets = new Map<string, { count: number; resetAt: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
}, 300_000).unref()

/** The TCP peer address. Unspoofable, unlike any header. */
export function peerAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

interface RateLimitOptions {
  /** Namespace, so two limiters never share a bucket. */
  scope: string
  max: number
  windowMs?: number
  /** Defaults to the peer address. */
  keyOf?: (c: Context) => string
  message: string
}

export function createRateLimit({
  scope,
  max,
  windowMs = 60_000,
  keyOf = (c) => `ip:${peerAddress(c)}`,
  message,
}: RateLimitOptions) {
  return async function rateLimitMiddleware(c: Context, next: Next) {
    const key = `${scope}|${keyOf(c)}`
    const now = Date.now()
    const bucket = buckets.get(key)

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      await next()
      return
    }

    if (bucket.count >= max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000)
      c.header('Retry-After', String(retryAfter))
      return c.json({ error: 'rate_limited', message, retry_after_seconds: retryAfter }, 429)
    }

    bucket.count += 1
    await next()
  }
}

/**
 * Guards the authenticated API *before* the key is checked, so a failed
 * authentication is counted. Mounted after requireApiKey — as it was — a 401
 * returns before ever reaching the counter, and API keys can be guessed as fast
 * as the network allows.
 *
 * Budget is wider than the per-key one: several agents legitimately share an
 * outbound address.
 */
export const limitApiByIp = createRateLimit({
  scope: 'v1-ip',
  max: config.rateLimitPerMin * 3,
  message: 'Too many requests from this address.',
})

/** Per-API-key budget, applied once the caller is authenticated. */
export const limitApiByKey = createRateLimit({
  scope: 'v1-key',
  max: config.rateLimitPerMin,
  keyOf: (c) => `key:${c.get('apiKeyHash')}`,
  message: `Rate limit of ${config.rateLimitPerMin} requests per minute reached.`,
})

/**
 * Guards the unauthenticated pages. Without this, anyone holding a link can
 * hammer it — which does not steal anything, but inflates opened_count until the
 * "this link was opened several times" warning is pure noise. A detection signal
 * anyone can drown is not a detection signal.
 */
export const limitPublic = createRateLimit({
  scope: 'public-ip',
  max: config.rateLimitPerMin,
  message: 'Too many requests. Slow down and try again shortly.',
})
