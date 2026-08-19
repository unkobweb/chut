import type { Context, Next } from 'hono'
import { config } from './config.js'

const EXPECTED_ORIGIN = new URL(config.baseUrl).origin

/**
 * Blocks cross-site writes.
 *
 * Applied to state-changing POSTs only — never to the page itself. A top-level
 * navigation arriving from Telegram, Slack or an email client is legitimately
 * `Sec-Fetch-Site: cross-site`, and refusing it would reject the very journey
 * this service exists to support.
 *
 * Two independent checks, because either header can be absent:
 *
 * - `Sec-Fetch-Site` is set by the browser and cannot be forged by page script.
 *   `none` means a direct navigation or address-bar entry.
 * - `Origin` is sent by every browser on a cross-origin POST. Its absence
 *   therefore means the caller is not a cross-site browser context at all — a
 *   curl invocation, an agent, a script — which is allowed, since such a caller
 *   is not being manipulated into acting on someone else's behalf.
 *
 * `same-site` (a sibling subdomain) is not accepted: nothing legitimate here
 * comes from one, and a foothold on a neighbouring host is a realistic way in.
 */
export async function rejectCrossSite(c: Context, next: Next) {
  const site = c.req.header('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    return c.json(
      {
        error: 'cross_site_blocked',
        message: 'Cross-site requests cannot fill or touch a request slot.',
      },
      403,
    )
  }

  const origin = c.req.header('origin')
  if (origin && origin !== EXPECTED_ORIGIN) {
    return c.json(
      {
        error: 'cross_site_blocked',
        message: `Origin ${origin} is not allowed to act on this service.`,
      },
      403,
    )
  }

  await next()
}

/**
 * Requires a JSON content type.
 *
 * Not pedantry: `text/plain`, `application/x-www-form-urlencoded` and
 * `multipart/form-data` are the three types a browser can send cross-origin
 * *without* a preflight. Insisting on `application/json` forces any cross-origin
 * caller through an OPTIONS preflight, and since this service answers no CORS
 * headers at all, that preflight fails and the browser never sends the request.
 * The Origin check above is then defence in depth rather than the only wall.
 */
export async function requireJsonBody(c: Context, next: Next) {
  const contentType = (c.req.header('content-type') ?? '').toLowerCase()
  if (!contentType.startsWith('application/json')) {
    return c.json(
      {
        error: 'unsupported_media_type',
        message: 'Content-Type must be application/json.',
      },
      415,
    )
  }
  await next()
}
