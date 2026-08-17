/**
 * Test de bout en bout du flux complet.
 * Le role du navigateur (chiffrement AES-GCM cote client) est rejoue ici avec
 * la WebCrypto de Node, qui est la meme API que celle du navigateur.
 *
 * Usage: node test/e2e.mjs  (le serveur doit tourner sur BASE)
 */

const BASE = process.env.BASE ?? 'http://localhost:8787'
const KEY = process.env.API_KEY ?? 'dev_change_me'

let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  \x1b[32mOK\x1b[0m   ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

const api = (path, opts = {}) =>
  fetch(BASE + path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
      ...(opts.headers ?? {}),
    },
  })

/** Reproduit exactement ce que fait le JavaScript de la page de saisie. */
async function browserEncrypt(keyB64url, plaintext) {
  const b64 = keyB64url.replace(/-/g, '+').replace(/_/g, '/')
  const raw = Uint8Array.from(Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64'))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return {
    ciphertext: Buffer.from(ct).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
  }
}

const SECRET = 'sk-live-7f3a9c2e41b8d605aa1e_TEST'

// ---------------------------------------------------------------- flux nominal
section('Flux nominal')

const createRes = await api('/v1/requests', {
  method: 'POST',
  body: JSON.stringify({
    requester: 'Assistant Telegram',
    label: 'Cle API Gmail',
    purpose: 'Lire tes 20 derniers mails pour en faire un resume quotidien',
    ttl_seconds: 300,
  }),
})
const created = await createRes.json()

check('POST /v1/requests renvoie 201', createRes.status === 201, `recu ${createRes.status}`)
check('une url est renvoyee', typeof created.url === 'string')
check('la cle de chiffrement est dans le fragment', created.url.includes('#'))
check('poll_token present', typeof created.poll_token === 'string')
check('encryption_key present', typeof created.encryption_key === 'string')
check('statut initial = pending', created.status === 'pending')

const { id, poll_token, encryption_key } = created

// L'humain ouvre la page
const pageRes = await fetch(`${BASE}/s/${id}`)
const pageHtml = await pageRes.text()
check('la page de saisie repond 200', pageRes.status === 200)
check('la page affiche le demandeur', pageHtml.includes('Assistant Telegram'))
check('la page affiche le motif', pageHtml.includes('resume quotidien'))
check(
  'CSP avec nonce presente',
  (pageRes.headers.get('content-security-policy') ?? '').includes('nonce-'),
)
check('page non mise en cache', (pageRes.headers.get('cache-control') ?? '').includes('no-store'))
check('la cle n’apparait pas dans le HTML', !pageHtml.includes(encryption_key))

// L'agent sonde : rien encore
const pollPending = await api(`/v1/requests/${id}`, { headers: { 'x-poll-token': poll_token } })
const pending = await pollPending.json()
check('le sondage montre pending', pending.status === 'pending')
check('l’ouverture de la page est comptee', pending.opened_count === 1)
check('le sondage ne renvoie aucun secret', !JSON.stringify(pending).includes('ciphertext'))

// Reveler trop tot
const tooEarly = await api(`/v1/requests/${id}/reveal`, {
  method: 'POST',
  body: JSON.stringify({ poll_token, encryption_key }),
})
check('reveler avant remplissage renvoie 409', tooEarly.status === 409)

// Le navigateur chiffre puis envoie
const payload = await browserEncrypt(encryption_key, SECRET)
const fillRes = await fetch(`${BASE}/s/${id}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (test)' },
  body: JSON.stringify(payload),
})
check('le remplissage est accepte', fillRes.status === 200, `recu ${fillRes.status}`)

const pollFilled = await api(`/v1/requests/${id}`, { headers: { 'x-poll-token': poll_token } })
const filled = await pollFilled.json()
check('le sondage montre filled', filled.status === 'filled')
check('l’horodatage de remplissage est present', typeof filled.filled_at === 'string')
check('l’empreinte IP est enregistree', typeof filled.filled_from_ip_hash === 'string')
check('l’IP n’est pas stockee en clair', !String(filled.filled_from_ip_hash).includes('.'))

// L'agent revele
const revealRes = await api(`/v1/requests/${id}/reveal`, {
  method: 'POST',
  body: JSON.stringify({ poll_token, encryption_key }),
})
const revealed = await revealRes.json()
check('la revelation reussit', revealRes.status === 200, JSON.stringify(revealed))
check('le secret dechiffre est identique a l’original', revealed.secret === SECRET)
check('le secret est marque brule', revealed.burned === true)

// Deuxieme revelation impossible
const secondReveal = await api(`/v1/requests/${id}/reveal`, {
  method: 'POST',
  body: JSON.stringify({ poll_token, encryption_key }),
})
check('la seconde revelation est refusee', secondReveal.status === 409)

// Le lien est mort
const deadPage = await fetch(`${BASE}/s/${id}`)
check('le lien ne repond plus 200', deadPage.status === 410)

// ---------------------------------------------------------------- controles d'acces
section("Controles d'acces")

const c2 = await (
  await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({ requester: 'Bot', label: 'Token' }),
  })
).json()

const noAuth = await fetch(`${BASE}/v1/requests/${c2.id}`)
check('sans cle API : 401', noAuth.status === 401)

const badKey = await fetch(`${BASE}/v1/requests/${c2.id}`, {
  headers: { authorization: 'Bearer mauvaise_cle', 'x-poll-token': c2.poll_token },
})
check('mauvaise cle API : 401', badKey.status === 401)

const noToken = await api(`/v1/requests/${c2.id}`)
check('sans poll_token : 403', noToken.status === 403)

const badToken = await api(`/v1/requests/${c2.id}`, { headers: { 'x-poll-token': 'nope' } })
check('mauvais poll_token : 403', badToken.status === 403)

// Un lecteur du chat peut remplir, mais pas lire.
const injected = await browserEncrypt(c2.encryption_key, 'cle-de-lattaquant')
await fetch(`${BASE}/s/${c2.id}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(injected),
})
const stealAttempt = await api(`/v1/requests/${c2.id}/reveal`, {
  method: 'POST',
  body: JSON.stringify({ poll_token: 'devine', encryption_key: c2.encryption_key }),
})
check(
  'quelqu’un qui a le lien ne peut pas lire le secret (poll_token requis)',
  stealAttempt.status === 403,
)

// Mauvaise cle de chiffrement -> echec du dechiffrement
const wrongKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
const wrongKeyRes = await api(`/v1/requests/${c2.id}/reveal`, {
  method: 'POST',
  body: JSON.stringify({ poll_token: c2.poll_token, encryption_key: wrongKey }),
})
check('mauvaise cle de chiffrement : 400', wrongKeyRes.status === 400)

// ---------------------------------------------------------------- usage unique
section('Usage unique et cycle de vie')

const c3 = await (
  await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({ requester: 'Bot', label: 'Token' }),
  })
).json()
const p3 = await browserEncrypt(c3.encryption_key, 'valeur')
const first = await fetch(`${BASE}/s/${c3.id}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(p3),
})
const second = await fetch(`${BASE}/s/${c3.id}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(p3),
})
check('premier remplissage accepte', first.status === 200)
check('second remplissage refuse', second.status === 409)

// burn_on_reveal: false -> relisible jusqu'a expiration
const c3b = await (
  await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({ requester: 'Bot', label: 'Token', burn_on_reveal: false }),
  })
).json()
const p3b = await browserEncrypt(c3b.encryption_key, 'valeur-persistante')
await fetch(`${BASE}/s/${c3b.id}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(p3b),
})
const r1 = await (
  await api(`/v1/requests/${c3b.id}/reveal`, {
    method: 'POST',
    body: JSON.stringify({ poll_token: c3b.poll_token, encryption_key: c3b.encryption_key }),
  })
).json()
const r2res = await api(`/v1/requests/${c3b.id}/reveal`, {
  method: 'POST',
  body: JSON.stringify({ poll_token: c3b.poll_token, encryption_key: c3b.encryption_key }),
})
const r2 = await r2res.json()
check('sans burn : premiere lecture ok', r1.secret === 'valeur-persistante')
check('sans burn : non marque brule', r1.burned === false)
check('sans burn : seconde lecture encore possible', r2res.status === 200 && r2.secret === 'valeur-persistante', JSON.stringify(r2))

// Annulation
const c4 = await (
  await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({ requester: 'Bot', label: 'Token' }),
  })
).json()
const cancelled = await api(`/v1/requests/${c4.id}`, {
  method: 'DELETE',
  headers: { 'x-poll-token': c4.poll_token },
})
check('annulation acceptee', cancelled.status === 200)
const cancelledPage = await fetch(`${BASE}/s/${c4.id}`)
check('la page annulee repond 410', cancelledPage.status === 410)

// Expiration
const c5 = await (
  await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({ requester: 'Bot', label: 'Token', ttl_seconds: 30 }),
  })
).json()
check('TTL minimum accepte', typeof c5.id === 'string')
const badTtl = await api('/v1/requests', {
  method: 'POST',
  body: JSON.stringify({ requester: 'Bot', label: 'Token', ttl_seconds: 5 }),
})
check('TTL trop court refuse', badTtl.status === 400)

// ---------------------------------------------------------------- validation
section('Validation des entrees')

const noLabel = await api('/v1/requests', {
  method: 'POST',
  body: JSON.stringify({ requester: 'Bot' }),
})
check('label manquant : 400', noLabel.status === 400)

const noRequester = await api('/v1/requests', {
  method: 'POST',
  body: JSON.stringify({ label: 'Token' }),
})
check('requester manquant : 400', noRequester.status === 400)

const xss = await (
  await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({ requester: '<script>alert(1)</script>', label: 'Token' }),
  })
).json()
const xssPage = await (await fetch(`${BASE}/s/${xss.id}`)).text()
check('le HTML injecte est echappe', !xssPage.includes('<script>alert(1)</script>'))
check('la valeur echappee est bien affichee', xssPage.includes('&lt;script&gt;'))

const notFound = await fetch(`${BASE}/s/inexistant`)
check('lien inconnu : 404', notFound.status === 404)

const spec = await (await fetch(`${BASE}/openapi.json`)).json()
check('openapi.json est servi', spec.openapi === '3.1.0')
check('la spec declare les 3 chemins', Object.keys(spec.paths).length >= 3)

// ----------------------------------------------------------------
console.log(`\n\x1b[1m${passed} reussis, ${failed} echoues\x1b[0m\n`)
process.exit(failed === 0 ? 0 : 1)
