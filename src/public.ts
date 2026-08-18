import { randomBytes } from 'node:crypto'
import { type Context, Hono } from 'hono'
import { config } from './config.js'
import { hashIp } from './crypto.js'
import { effectiveStatus, queries } from './db.js'
import { renderClosed, renderForm, renderSuccess } from './page.js'

export const pub = new Hono()

const nonce = () => randomBytes(16).toString('base64')

function secureHtml(
  c: Context,
  html: string,
  n: string,
  status: 200 | 404 | 410 = 200,
) {
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

function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return c.req.header('x-real-ip') ?? 'unknown'
}

const CLOSED_COPY: Record<string, { title: string; message: string }> = {
  filled: {
    title: 'Deja rempli',
    message: 'Ce lien a deja recu une valeur. Un lien chut ne sert qu’une fois.',
  },
  revealed: {
    title: 'Deja utilise',
    message: 'La valeur a ete transmise a l’agent et ce lien est desormais inactif.',
  },
  expired: {
    title: 'Lien expire',
    message: 'Ce lien a depasse sa duree de validite et ne peut plus recevoir de valeur.',
  },
  cancelled: {
    title: 'Demande annulee',
    message: 'L’agent a annule cette demande avant qu’elle ne soit remplie.',
  },
}

/** Page de saisie presentee a l'humain. */
pub.get('/s/:id', (c) => {
  const n = nonce()
  const row = queries.byId.get(c.req.param('id'))
  if (!row) {
    return secureHtml(
      c,
      renderClosed(n, {
        title: 'Lien introuvable',
        message: 'Ce lien n’existe pas, ou il a ete purge depuis longtemps.',
      }),
      n,
      404,
    )
  }

  const status = effectiveStatus(row)
  if (status !== 'pending') {
    return secureHtml(c, renderClosed(n, CLOSED_COPY[status]!), n, 410)
  }

  // Trace d'ouverture: l'agent peut la lire et signaler un lien ouvert plusieurs fois.
  queries.markOpened.run({ id: row.id, now: Date.now() })

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

/** Reception du contenu deja chiffre par le navigateur. */
pub.post('/s/:id', async (c) => {
  const row = queries.byId.get(c.req.param('id'))
  if (!row) return c.json({ error: 'not_found', message: 'Lien introuvable.' }, 404)

  const status = effectiveStatus(row)
  if (status !== 'pending') {
    return c.json(
      { error: 'not_pending', status, message: CLOSED_COPY[status]?.message ?? 'Lien inactif.' },
      409,
    )
  }

  let body: { ciphertext?: unknown; iv?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'invalid_request', message: 'Corps JSON invalide.' }, 400)
  }

  const { ciphertext, iv } = body
  if (typeof ciphertext !== 'string' || typeof iv !== 'string' || !ciphertext || !iv) {
    return c.json({ error: 'invalid_request', message: '"ciphertext" et "iv" sont requis.' }, 400)
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext) || !/^[A-Za-z0-9+/]+={0,2}$/.test(iv)) {
    return c.json({ error: 'invalid_request', message: 'Encodage base64 attendu.' }, 400)
  }
  // +~40% pour l'encodage base64 et le tag d'authentification GCM.
  if (Buffer.byteLength(ciphertext, 'utf8') > config.maxSecretBytes * 2) {
    return c.json({ error: 'too_large', message: 'Valeur trop longue.' }, 413)
  }

  const info = queries.fill.run({
    id: row.id,
    ciphertext,
    iv,
    now: Date.now(),
    ip_hash: hashIp(clientIp(c), config.ipHashSalt),
    user_agent: (c.req.header('user-agent') ?? '').slice(0, 200) || null,
  })

  // 0 ligne modifiee = quelqu'un d'autre a rempli entre la lecture et l'ecriture.
  if (info.changes === 0) {
    return c.json({ error: 'not_pending', message: 'Ce lien vient d’etre utilise.' }, 409)
  }

  c.header('Cache-Control', 'no-store')
  return c.json({ ok: true, id: row.id })
})

/** Confirmation apres envoi. */
pub.get('/s/:id/done', (c) => {
  const n = nonce()
  const row = queries.byId.get(c.req.param('id'))
  if (!row) {
    return secureHtml(
      c,
      renderClosed(n, { title: 'Lien introuvable', message: 'Ce lien n’existe pas.' }),
      n,
      404,
    )
  }
  return secureHtml(c, renderSuccess(n, row.label), n)
})
