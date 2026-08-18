import { type Context, Hono } from 'hono'
import { rateLimit, requireApiKey } from './auth.js'
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

export const api = new Hono()

api.use('*', requireApiKey)
api.use('*', rateLimit)

const MAX_TEXT = { requester: 80, label: 120, purpose: 400 } as const

function badRequest(c: Context, message: string) {
  return c.json({ error: 'invalid_request', message }, 400)
}

/** Vue publique d'une demande: jamais de secret, jamais de hash de token. */
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
 * L'agent cree un emplacement vide et recupere le lien a transmettre a son humain.
 */
api.post('/requests', async (c) => {
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return badRequest(c, 'Corps JSON invalide.')
  }

  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label) return badRequest(c, 'Le champ "label" est requis (ce que tu demandes).')
  if (label.length > MAX_TEXT.label)
    return badRequest(c, `"label" est limite a ${MAX_TEXT.label} caracteres.`)

  const requester = typeof body.requester === 'string' ? body.requester.trim() : ''
  if (!requester)
    return badRequest(c, 'Le champ "requester" est requis (qui demande, vu par l\'humain).')
  if (requester.length > MAX_TEXT.requester)
    return badRequest(c, `"requester" est limite a ${MAX_TEXT.requester} caracteres.`)

  const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : ''
  if (purpose.length > MAX_TEXT.purpose)
    return badRequest(c, `"purpose" est limite a ${MAX_TEXT.purpose} caracteres.`)

  let ttl = config.defaultTtl
  if (body.ttl_seconds !== undefined) {
    if (typeof body.ttl_seconds !== 'number' || !Number.isFinite(body.ttl_seconds))
      return badRequest(c, '"ttl_seconds" doit etre un nombre.')
    ttl = Math.floor(body.ttl_seconds)
    if (ttl < 30 || ttl > config.maxTtl)
      return badRequest(c, `"ttl_seconds" doit etre entre 30 et ${config.maxTtl}.`)
  }

  const burnOnReveal = body.burn_on_reveal === undefined ? true : body.burn_on_reveal === true

  const now = Date.now()
  const id = newRequestId()
  const pollToken = randomToken()
  // Cette cle n'est jamais persistee: elle part dans le fragment d'URL et dans
  // cette reponse. Sans elle, le contenu chiffre en base est inexploitable.
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
      // Le fragment (#) n'est jamais transmis au serveur par le navigateur.
      url: `${config.baseUrl}/s/${id}#${encryptionKey}`,
      poll_token: pollToken,
      encryption_key: encryptionKey,
      _note:
        'Transmets "url" a ton humain. Garde "poll_token" et "encryption_key" pour toi: les deux sont necessaires pour lire le secret.',
    },
    201,
  )
})

/**
 * Le poll_token prouve que l'appelant est bien l'agent qui a cree la demande.
 * La cle API seule ne suffit pas: elle peut couvrir plusieurs agents.
 */
function authorizeRow(
  c: Context,
  row: RequestRow,
  bodyToken?: string,
) {
  if (!safeEqualHex(row.api_key_hash, c.get('apiKeyHash'))) return 'not_found' as const

  const provided = c.req.header('x-poll-token') ?? bodyToken ?? c.req.query('poll_token') ?? ''
  if (!provided || !safeEqualHex(row.poll_token_hash, sha256(provided))) return 'forbidden' as const

  return 'ok' as const
}

/**
 * GET /v1/requests/:id
 * Sondage par l'agent. Ne renvoie jamais le secret.
 */
api.get('/requests/:id', (c) => {
  const row = queries.byId.get(c.req.param('id'))
  if (!row) return c.json({ error: 'not_found' }, 404)

  const verdict = authorizeRow(c, row)
  if (verdict === 'not_found') return c.json({ error: 'not_found' }, 404)
  if (verdict === 'forbidden')
    return c.json(
      { error: 'forbidden', message: 'poll_token manquant ou invalide (en-tete X-Poll-Token).' },
      403,
    )

  return c.json(serialize(row))
})

/**
 * POST /v1/requests/:id/reveal
 * Rend le secret en clair a l'agent, une seule fois par defaut.
 */
api.post('/requests/:id/reveal', async (c) => {
  let body: Record<string, unknown> = {}
  try {
    const text = await c.req.text()
    if (text) body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return badRequest(c, 'Corps JSON invalide.')
  }
  const row = queries.byId.get(c.req.param('id'))
  if (!row) return c.json({ error: 'not_found' }, 404)

  const verdict = authorizeRow(c, row, typeof body.poll_token === 'string' ? body.poll_token : undefined)
  if (verdict === 'not_found') return c.json({ error: 'not_found' }, 404)
  if (verdict === 'forbidden')
    return c.json({ error: 'forbidden', message: 'poll_token manquant ou invalide.' }, 403)

  const now = Date.now()
  const status = effectiveStatus(row, now)
  if (status !== 'filled') {
    return c.json(
      {
        error: 'not_filled',
        status,
        message:
          status === 'pending'
            ? "L'humain n'a pas encore rempli le formulaire."
            : `Impossible de reveler une demande dans l'etat "${status}".`,
      },
      409,
    )
  }

  const key = typeof body.encryption_key === 'string' ? body.encryption_key : ''
  if (!key) return badRequest(c, 'Le champ "encryption_key" est requis (recu a la creation).')

  let secret: string
  try {
    secret = await decryptSecret(key, row.ciphertext!, row.iv!)
  } catch {
    return c.json(
      {
        error: 'decryption_failed',
        message: 'Dechiffrement impossible: encryption_key incorrecte ou donnees alterees.',
      },
      400,
    )
  }

  // Le dechiffrement a lieu AVANT toute ecriture : une encryption_key erronee
  // repart en 400 sans detruire le secret de l'agent legitime.
  //
  // Ensuite, l'UPDATE conditionnel EST la course. Plusieurs appels simultanes ont
  // pu lire la meme ligne et dechiffrer en memoire, mais un seul verra changes===1.
  // Les autres repartent en 409 — ce qui preserve le burn comme detecteur
  // d'intrusion : un voleur qui court a cote de l'agent ne peut plus obtenir le
  // secret « en plus » de lui sans que l'un des deux voie un 409.
  if (row.burn_on_reveal === 1) {
    const claim = queries.burn.run({ id: row.id, now })
    if (claim.changes === 0) {
      return c.json(
        {
          error: 'not_filled',
          status: 'revealed',
          message: 'Ce secret vient d’etre revele par un autre appel. Il n’est plus disponible.',
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

/** DELETE /v1/requests/:id — annulation immediate, le contenu chiffre est efface. */
api.delete('/requests/:id', (c) => {
  const row = queries.byId.get(c.req.param('id'))
  if (!row) return c.json({ error: 'not_found' }, 404)

  const verdict = authorizeRow(c, row)
  if (verdict === 'not_found') return c.json({ error: 'not_found' }, 404)
  if (verdict === 'forbidden')
    return c.json({ error: 'forbidden', message: 'poll_token manquant ou invalide.' }, 403)

  queries.cancel.run({ id: row.id })
  return c.json(serialize(queries.byId.get(row.id)!))
})
