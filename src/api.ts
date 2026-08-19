import { type Context, Hono } from 'hono'
import { requireApiKey } from './auth.js'
import { config } from './config.js'
import {
  decryptSecret,
  newEncryptionKey,
  newRequestId,
  randomToken,
  safeEqualHex,
  sha256,
} from './crypto.js'
import { effectiveStatus, queries, type RequestRow } from './db.js'
import { limitApiByIp, limitApiByKey } from './rate-limit.js'

export const api = new Hono()

// Order matters. The IP limiter runs FIRST so that failed authentication is
// counted: mounted after requireApiKey, a 401 short-circuits before the counter
// and API keys can be brute-forced at network speed.
api.use('*', limitApiByIp)
api.use('*', requireApiKey)
api.use('*', limitApiByKey)

const MAX_TEXT = { requester: 80, label: 120, purpose: 400 } as const

function badRequest(c: Context, message: string) {
  return c.json({ error: 'invalid_request', message }, 400)
}

/** Public view of a request: never a secret, never a token hash. */
function serialize(row: RequestRow, now = Date.now()) {
  const status = effectiveStatus(row, now)
  return {
    id: row.id,
    status,
    requester: row.requester,
    label: row.label,
    purpose: row.purpose,
    url: `${config.baseUrl}/s/${row.id}`,
    created_at: new Date(row.created_at).toISOString(),
    expires_at: new Date(row.expires_at).toISOString(),
    expires_in_seconds: Math.max(0, Math.round((row.expires_at - now) / 1000)),
    burn_on_reveal: row.burn_on_reveal === 1,
    opened_count: row.opened_count,
    first_opened_at: row.first_opened_at ? new Date(row.first_opened_at).toISOString() : null,
    filled_at: row.filled_at ? new Date(row.filled_at).toISOString() : null,
    filled_from_ip_hash: row.filled_ip_hash,
    filled_user_agent: row.filled_user_agent,
    revealed_at: row.revealed_at ? new Date(row.revealed_at).toISOString() : null,
  }
}

/**
 * POST /v1/requests
 * The agent creates an empty slot and gets back the link to hand to its human.
 */
api.post('/requests', async (c) => {
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return badRequest(c, 'Invalid JSON body.')
  }

  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label) return badRequest(c, 'Field "label" is required (what you are asking for).')
  if (label.length > MAX_TEXT.label)
    return badRequest(c, `"label" is limited to ${MAX_TEXT.label} characters.`)

  const requester = typeof body.requester === 'string' ? body.requester.trim() : ''
  if (!requester)
    return badRequest(c, 'Field "requester" is required (who is asking, as the human sees it).')
  if (requester.length > MAX_TEXT.requester)
    return badRequest(c, `"requester" is limited to ${MAX_TEXT.requester} characters.`)

  const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : ''
  if (purpose.length > MAX_TEXT.purpose)
    return badRequest(c, `"purpose" is limited to ${MAX_TEXT.purpose} characters.`)

  let ttl = config.defaultTtl
  if (body.ttl_seconds !== undefined) {
    if (typeof body.ttl_seconds !== 'number' || !Number.isFinite(body.ttl_seconds))
      return badRequest(c, '"ttl_seconds" must be a number.')
    ttl = Math.floor(body.ttl_seconds)
    if (ttl < 30 || ttl > config.maxTtl)
      return badRequest(c, `"ttl_seconds" must be between 30 and ${config.maxTtl}.`)
  }

  // Fail closed, in both directions.
  //
  // Absent or null means "use the default", and the default is protection ON —
  // a serialiser that emits null for an unset optional field must not end up
  // disabling single-use.
  //
  // Anything else has to be a strict boolean. The previous test was
  // `body.burn_on_reveal === true`, so "true", 1 or [] all fell through to false:
  // a caller who spelled the option out believed they were turning protection on
  // and turned it off. A security control must never be disabled by an input the
  // caller did not mean as "off" — when the intent is unclear, refuse.
  let burnOnReveal = true
  if (body.burn_on_reveal !== undefined && body.burn_on_reveal !== null) {
    if (typeof body.burn_on_reveal !== 'boolean') {
      return badRequest(
        c,
        '"burn_on_reveal" must be a boolean (true or false), not a string or a number.',
      )
    }
    burnOnReveal = body.burn_on_reveal
  }

  const now = Date.now()
  const id = newRequestId()
  const pollToken = randomToken()
  // Never persisted: it goes into the URL fragment and into this response only.
  // Without it, the ciphertext stored in the database is unusable.
  const encryptionKey = newEncryptionKey()

  queries.insert.run({
    id,
    api_key_hash: c.get('apiKeyHash'),
    poll_token_hash: sha256(pollToken),
    requester,
    label,
    purpose: purpose || null,
    burn_on_reveal: burnOnReveal ? 1 : 0,
    created_at: now,
    expires_at: now + ttl * 1000,
  })

  const row = queries.byId.get(id)!
  return c.json(
    {
      ...serialize(row, now),
      // Browsers never send the fragment (#) to the server.
      url: `${config.baseUrl}/s/${id}#${encryptionKey}`,
      poll_token: pollToken,
      encryption_key: encryptionKey,
      _note:
        'Hand "url" to your human. Keep "poll_token" and "encryption_key" to yourself: both are required to read the secret.',
    },
    201,
  )
})

/**
 * The poll_token proves the caller is the agent that created the request.
 * The API key alone is not enough: it may cover several agents.
 */
function authorizeRow(c: Context, row: RequestRow, bodyToken?: string) {
  if (!safeEqualHex(row.api_key_hash, c.get('apiKeyHash'))) return 'not_found' as const

  const provided = c.req.header('x-poll-token') ?? bodyToken ?? c.req.query('poll_token') ?? ''
  if (!provided || !safeEqualHex(row.poll_token_hash, sha256(provided))) return 'forbidden' as const

  return 'ok' as const
}

/**
 * GET /v1/requests/:id
 * Polled by the agent. Never returns the secret.
 */
api.get('/requests/:id', (c) => {
  const row = queries.byId.get(c.req.param('id'))
  if (!row) return c.json({ error: 'not_found' }, 404)

  const verdict = authorizeRow(c, row)
  if (verdict === 'not_found') return c.json({ error: 'not_found' }, 404)
  if (verdict === 'forbidden')
    return c.json(
      { error: 'forbidden', message: 'Missing or invalid poll_token (X-Poll-Token header).' },
      403,
    )

  return c.json(serialize(row))
})

/**
 * POST /v1/requests/:id/reveal
 * Returns the plaintext secret to the agent, once by default.
 */
api.post('/requests/:id/reveal', async (c) => {
  let body: Record<string, unknown> = {}
  try {
    const text = await c.req.text()
    if (text) body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return badRequest(c, 'Invalid JSON body.')
  }
  const row = queries.byId.get(c.req.param('id'))
  if (!row) return c.json({ error: 'not_found' }, 404)

  const verdict = authorizeRow(
    c,
    row,
    typeof body.poll_token === 'string' ? body.poll_token : undefined,
  )
  if (verdict === 'not_found') return c.json({ error: 'not_found' }, 404)
  if (verdict === 'forbidden')
    return c.json({ error: 'forbidden', message: 'Missing or invalid poll_token.' }, 403)

  const now = Date.now()
  const status = effectiveStatus(row, now)
  if (status !== 'filled') {
    return c.json(
      {
        error: 'not_filled',
        status,
        message:
          status === 'pending'
            ? 'The human has not filled the form yet.'
            : `Cannot reveal a request in state "${status}".`,
      },
      409,
    )
  }

  const key = typeof body.encryption_key === 'string' ? body.encryption_key : ''
  if (!key) return badRequest(c, 'Field "encryption_key" is required (received on creation).')

  let secret: string
  try {
    secret = await decryptSecret(key, row.ciphertext!, row.iv!)
  } catch {
    return c.json(
      {
        error: 'decryption_failed',
        message: 'Decryption failed: wrong encryption_key or tampered data.',
      },
      400,
    )
  }

  // Decryption happens BEFORE any write: a wrong encryption_key returns 400
  // without destroying the legitimate agent's secret.
  //
  // The conditional UPDATE below IS the race. Several concurrent calls may have
  // read the same row and decrypted in memory, but only one sees changes === 1.
  // The others get a 409 — which preserves the burn as an intrusion detector: a
  // thief racing alongside the agent can no longer obtain the secret *in
  // addition to* the agent without one of the two seeing a 409.
  if (row.burn_on_reveal === 1) {
    const claim = queries.burn.run({ id: row.id, now })
    if (claim.changes === 0) {
      return c.json(
        {
          error: 'not_filled',
          status: 'revealed',
          message: 'This secret was just revealed by another call. It is no longer available.',
        },
        409,
      )
    }
  } else {
    queries.markRevealed.run({ id: row.id, now })
  }

  return c.json({
    id: row.id,
    label: row.label,
    secret,
    filled_at: row.filled_at ? new Date(row.filled_at).toISOString() : null,
    filled_from_ip_hash: row.filled_ip_hash,
    burned: row.burn_on_reveal === 1,
  })
})

/** DELETE /v1/requests/:id — cancels immediately and wipes the ciphertext. */
api.delete('/requests/:id', (c) => {
  const row = queries.byId.get(c.req.param('id'))
  if (!row) return c.json({ error: 'not_found' }, 404)

  const verdict = authorizeRow(c, row)
  if (verdict === 'not_found') return c.json({ error: 'not_found' }, 404)
  if (verdict === 'forbidden')
    return c.json({ error: 'forbidden', message: 'Missing or invalid poll_token.' }, 403)

  queries.cancel.run({ id: row.id })
  return c.json(serialize(queries.byId.get(row.id)!))
})
