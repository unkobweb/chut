import { randomBytes } from 'node:crypto'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { config } from './config.js'
import { clientAddress } from './client-ip.js'
import { hashIp } from './crypto.js'
import { effectiveStatus, queries } from './db.js'
import { renderClosed, renderForm, renderSuccess } from './page.js'
import { limitPublic } from './rate-limit.js'

export const pub = new Hono()

// These routes were mounted outside the /v1 group and had no limiter at all.
// Declared before the handlers so it runs ahead of them — in particular ahead of
// the markOpened counter.
pub.use('*', limitPublic)

const nonce = () => randomBytes(16).toString('base64')

function secureHtml(c: Context, html: string, n: string, status: 200 | 404 | 410 = 200) {
  c.header('Content-Type', 'text/html; charset=utf-8')
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('X-Frame-Options', 'DENY')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      `style-src 'nonce-${n}'`,
      `script-src 'nonce-${n}'`,
      "connect-src 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join('; '),
  )
  return c.body(html, status)
}

/**
 * An AES-GCM nonce is 96 bits = 12 bytes = exactly 16 base64 characters. We allow
 * up to 24 so a client using a 16-byte nonce still works, but no further: without
 * an upper bound this field accepted megabytes and wrote them straight to SQLite.
 */
const IV_MIN_CHARS = 16
const IV_MAX_CHARS = 24

/**
 * Hard ceiling on the whole request body, enforced before parsing.
 * Field-level checks are not enough on their own: `c.req.json()` buffers the
 * entire body in memory first, so an unbounded body is a denial of service even
 * if every field is later rejected.
 *
 * Budget: base64 inflates by 4/3, GCM adds a 16-byte tag, plus JSON envelope.
 * Three times the plaintext ceiling leaves comfortable headroom.
 */
const MAX_BODY_BYTES = config.maxSecretBytes * 3

const CLOSED_COPY: Record<string, { title: string; message: string }> = {
  filled: {
    title: 'Already filled',
    message: 'This link already received a value. A chut link is single-use.',
  },
  revealed: {
    title: 'Already used',
    message: 'The value was handed to the agent and this link is now inactive.',
  },
  expired: {
    title: 'Link expired',
    message: 'This link is past its validity window and can no longer receive a value.',
  },
  cancelled: {
    title: 'Request cancelled',
    message: 'The agent cancelled this request before it was filled.',
  },
}

/** The form shown to the human. */
pub.get('/s/:id', (c) => {
  const n = nonce()
  const row = queries.byId.get(c.req.param('id'))
  if (!row) {
    return secureHtml(
      c,
      renderClosed(n, {
        title: 'Link not found',
        message: 'This link does not exist, or it was purged a long time ago.',
      }),
      n,
      404,
    )
  }

  const status = effectiveStatus(row)
  if (status !== 'pending') {
    return secureHtml(c, renderClosed(n, CLOSED_COPY[status]!), n, 410)
  }

  // A fetch, not necessarily a human: this is also what a link-preview crawler
  // does. The open itself is reported by the rendered page (POST /s/:id/opened).
  queries.markFetched.run({ id: row.id })

  return secureHtml(
    c,
    renderForm(n, {
      id: row.id,
      requester: row.requester,
      label: row.label,
      purpose: row.purpose,
      expiresAt: row.expires_at,
      maxBytes: config.maxSecretBytes,
    }),
    n,
  )
})

/** Receives the payload already encrypted by the browser. */
pub.post(
  '/s/:id',
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) =>
      c.json(
        {
          error: 'too_large',
          message: `Request body exceeds ${MAX_BODY_BYTES} bytes.`,
        },
        413,
      ),
  }),
  async (c) => {
    const row = queries.byId.get(c.req.param('id'))
    if (!row) return c.json({ error: 'not_found', message: 'Link not found.' }, 404)

    const status = effectiveStatus(row)
    if (status !== 'pending') {
      return c.json(
        { error: 'not_pending', status, message: CLOSED_COPY[status]?.message ?? 'Inactive link.' },
        409,
      )
    }

    let body: { ciphertext?: unknown; iv?: unknown }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'invalid_request', message: 'Invalid JSON body.' }, 400)
    }

    const { ciphertext, iv } = body
    if (typeof ciphertext !== 'string' || typeof iv !== 'string' || !ciphertext || !iv) {
      return c.json({ error: 'invalid_request', message: '"ciphertext" and "iv" are required.' }, 400)
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext) || !/^[A-Za-z0-9+/]+={0,2}$/.test(iv)) {
      return c.json({ error: 'invalid_request', message: 'Base64 encoding expected.' }, 400)
    }
    if (iv.length < IV_MIN_CHARS || iv.length > IV_MAX_CHARS) {
      return c.json(
        {
          error: 'invalid_request',
          message: `"iv" must be ${IV_MIN_CHARS}-${IV_MAX_CHARS} base64 characters (a 12-byte AES-GCM nonce).`,
        },
        400,
      )
    }
    // +~40% for base64 encoding and the GCM authentication tag.
    if (Buffer.byteLength(ciphertext, 'utf8') > config.maxSecretBytes * 2) {
      return c.json({ error: 'too_large', message: 'Value too long.' }, 413)
    }

    const info = queries.fill.run({
      id: row.id,
      ciphertext,
      iv,
      now: Date.now(),
      ip_hash: hashIp(clientAddress(c), config.ipHashSalt),
      user_agent: (c.req.header('user-agent') ?? '').slice(0, 200) || null,
    })

    // 0 rows changed = somebody else filled it between our read and our write.
    if (info.changes === 0) {
      return c.json({ error: 'not_pending', message: 'This link has just been used.' }, 409)
    }

      c.header('Cache-Control', 'no-store')
      return c.json({ ok: true, id: row.id })
  },
)

/**
 * Beacon fired by the form page once it has rendered in a real browser.
 *
 * This is the whole point of splitting the two counters: Telegram, Slack, Discord
 * and iMessage all fetch a URL server-side to build a preview, and none of them
 * run JavaScript. Counting raw GETs meant the "opened several times" warning
 * fired on every ordinary use until the human stopped reading it.
 *
 * Always answers 204, for any id, existing or not: a different status for a real
 * id would turn this into an existence oracle.
 */
pub.post('/s/:id/opened', (c) => {
  queries.markOpened.run({ id: c.req.param('id'), now: Date.now() })
  c.header('Cache-Control', 'no-store')
  return c.body(null, 204)
})

/**
 * Confirmation shown after a successful submission.
 *
 * Static on purpose: no id in the path, no database lookup, identical response
 * for every caller. The previous /s/:id/done answered anyone holding the link,
 * in any state, and rendered the request label — which is intelligence in itself
 * ("Production database password") — while its 404-vs-200 split doubled as an
 * existence oracle that outlived the request.
 */
pub.get('/done', (c) => {
  const n = nonce()
  return secureHtml(c, renderSuccess(n), n)
})
