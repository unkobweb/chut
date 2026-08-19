import type { Context, Next } from 'hono'
import { clientAddress } from './client-ip.js'
import { config } from './config.js'

/**
 * Fixed-window counters, in memory.
 *
 * Deliberately not keyed on anything the caller controls. The address comes from
 * the TCP socket, or from the forwarding chain only as far as TRUST_PROXY_HOPS
 * says it may be believed — so an attacker cannot mint a fresh bucket per request
 * by rotating X-Forwarded-For.
 *
 * Also in-memory: counters reset on restart and are not shared across instances.
 * That is acceptable for a single-container deployment and wants Redis beyond it.
 */
const buckets = new Map<string, { count: number; resetAt: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
}, 300_000).unref()

interface RateLimitOptions {
  /** Namespace, so two limiters never share a bucket. */
  scope: string
  max: number
  windowMs?: number
  /** Defaults to the resolved client address. */
  keyOf?: (c: Context) => string
  message: string
}

export function createRateLimit({
  scope,
  max,
  windowMs = 60_000,
  keyOf = (c) => `ip:${clientAddress(c)}`,
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
 * Guards request creation. Creating is open — there is no account and no key —
 * so this is the only thing standing between the service and someone deciding to
 * make a few thousand pages on it.
 */
export const limitApiByIp = createRateLimit({
  scope: 'v1-ip',
  max: config.rateLimitPerMin * 3,
  message: 'Too many requests from this address.',
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
