import { type Context, Hono } from 'hono'
import { readJsonObject } from './body.js'
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
import { sanitizeDisplayText } from './text.js'
import { limitApiByIp } from './rate-limit.js'

export const api = new Hono()

// Creating a request is open: no account, no key. The poll_token handed back at
// creation is what authorises everything afterwards, so this limiter is the only
// thing bounding how many requests one address can make.
api.use('*', limitApiByIp)

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
    fetched_count: row.fetched_count,
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
  const body = await readJsonObject(c)
  if (body instanceof Response) return body

  // These three are the only text a human reads before deciding to trust the
  // request, and an agent under prompt injection controls all of them.
  const readText = (field: 'requester' | 'label' | 'purpose') => {
    const raw = typeof body[field] === 'string' ? (body[field] as string) : ''
    const result = sanitizeDisplayText(raw)
    if (!result.ok) return badRequest(c, `"${field}" ${result.reason}`)
    if (result.value.length > MAX_TEXT[field])
      return badRequest(c, `"${field}" is limited to ${MAX_TEXT[field]} characters.`)
    return result.value
  }

  const label = readText('label')
  if (typeof label !== 'string') return label
  if (!label) return badRequest(c, 'Field "label" is required (what you are asking for).')

  const requester = readText('requester')
  if (typeof requester !== 'string') return requester
  if (!requester)
    return badRequest(c, 'Field "requester" is required (who is asking, as the human sees it).')

  const purpose = readText('purpose')
  if (typeof purpose !== 'string') return purpose

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
 * The poll_token proves the caller is the agent that created the request. It is
 * 32 random bytes, returned once, stored hashed — guessing it is not a strategy.
 *
 * Accepted from the X-Poll-Token header or, for reveal, the JSON body — never
 * from the query string. A URL is the one part of a request that gets written
 * down everywhere it passes: the access logs of every proxy, CDN and load
 * balancer on the way, plus browser history and referrer headers. This service
 * keeps its own logs free of secrets; accepting a credential in the URL would
 * hand it to logs it does not control.
 *
 * Returns the response to send, or null when the caller is authorised.
 */
function authorize(c: Context, row: RequestRow, bodyToken?: string): Response | null {
  if (c.req.query('poll_token') !== undefined) {
    return c.json(
      {
        error: 'token_in_url',
        message:
          'poll_token must not be sent in the query string: URLs are recorded by proxies, ' +
          'CDNs and browser history. Send it in the X-Poll-Token header instead. Treat the ' +
          'token you just put in a URL as compromised and create a new request.',
      },
      400,
    )
  }

  const provided = c.req.header('x-poll-token') ?? bodyToken ?? ''
  if (!provided || !safeEqualHex(row.poll_token_hash, sha256(provided))) {
    return c.json(
      { error: 'forbidden', message: 'Missing or invalid poll_token (X-Poll-Token header).' },
      403,
    )
  }

  return null
}

/**
 * GET /v1/requests/:id
 * Polled by the agent. Never returns the secret.
 */
api.get('/requests/:id', (c) => {
  const row = queries.byId.get(c.req.param('id'))
  if (!row) return c.json({ error: 'not_found' }, 404)

  const denied = authorize(c, row)
  if (denied) return denied

  return c.json(serialize(row))
})

/**
 * POST /v1/requests/:id/reveal
 * Returns the plaintext secret to the agent, once by default.
 */
api.post('/requests/:id/reveal', async (c) => {
  // Empty is allowed here: the poll_token may travel in the X-Poll-Token header.
  const body = await readJsonObject(c, { allowEmpty: true })
  if (body instanceof Response) return body

  const row = queries.byId.get(c.req.param('id'))
  if (!row) return c.json({ error: 'not_found' }, 404)

  const denied = authorize(c, row, typeof body.poll_token === 'string' ? body.poll_token : undefined)
  if (denied) return denied

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

  const denied = authorize(c, row)
  if (denied) return denied

  queries.cancel.run({ id: row.id })
  return c.json(serialize(queries.byId.get(row.id)!))
})
