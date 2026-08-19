import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { config } from './config.js'

/** The TCP peer address. The only value in a request no caller can choose. */
export function socketAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

const LOOKS_LIKE_IP = /^[0-9a-fA-F.:[\]]{3,45}$/

/**
 * Resolves the caller's address, honouring forwarding headers only as far as the
 * deployment says it should.
 *
 * X-Forwarded-For is a list the client starts and each proxy appends to, so its
 * leftmost entry is whatever the client felt like writing. Reading it directly —
 * as this service used to — hands the caller the pen: the person filling a slot
 * chose the address later shown to the human as evidence of where the fill came
 * from, and could rotate it to get a fresh rate-limit bucket per request.
 *
 * TRUST_PROXY_HOPS states how many proxies sit in front. With N hops the genuine
 * client is at `chain.length - N`, because each of those N proxies appended the
 * address it actually saw. Anything the client prepended lands to the left of
 * that index and is discarded. A chain shorter than configured means the
 * deployment does not match the configuration, so we fall back to the socket —
 * never to a client-supplied value.
 *
 * Default is 0: no proxy assumed, forwarding headers ignored entirely.
 */
export function clientAddress(c: Context): string {
  const hops = config.trustProxyHops
  if (hops <= 0) return socketAddress(c)

  const chain = (c.req.header('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  const index = chain.length - hops
  const candidate = index >= 0 ? chain[index] : undefined
  if (candidate && LOOKS_LIKE_IP.test(candidate)) return candidate

  // nginx and friends also set X-Real-IP; only meaningful once a proxy is trusted.
  const realIp = c.req.header('x-real-ip')?.trim()
  if (realIp && LOOKS_LIKE_IP.test(realIp)) return realIp

  return socketAddress(c)
}
