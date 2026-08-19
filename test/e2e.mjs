/**
 * End-to-end test of the full flow.
 * The browser's role (client-side AES-GCM encryption) is replayed here with
 * Node's WebCrypto, which is the same API the browser exposes.
 *
 * Usage: node test/e2e.mjs  (a server must be running on BASE)
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

/** Reproduces exactly what the form page's JavaScript does. */
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

// ------------------------------------------------------------------ happy path
section('Happy path')

const createRes = await api('/v1/requests', {
  method: 'POST',
  body: JSON.stringify({
    requester: 'Telegram Assistant',
    label: 'Gmail API key',
    purpose: 'Read your last 20 emails to build a daily summary',
    ttl_seconds: 300,
  }),
})
const created = await createRes.json()

check('POST /v1/requests returns 201', createRes.status === 201, `got ${createRes.status}`)
check('a url is returned', typeof created.url === 'string')
check('the encryption key sits in the fragment', created.url.includes('#'))
check('poll_token present', typeof created.poll_token === 'string')
check('encryption_key present', typeof created.encryption_key === 'string')
check('initial status is pending', created.status === 'pending')

const { id, poll_token, encryption_key } = created

// The human opens the page
const pageRes = await fetch(`${BASE}/s/${id}`)
const pageHtml = await pageRes.text()
check('the form page responds 200', pageRes.status === 200)
check('the page shows the requester', pageHtml.includes('Telegram Assistant'))
check('the page shows the purpose', pageHtml.includes('daily summary'))
check(
  'CSP with a nonce is present',
  (pageRes.headers.get('content-security-policy') ?? '').includes('nonce-'),
)
check('the page is not cached', (pageRes.headers.get('cache-control') ?? '').includes('no-store'))
check('the key never appears in the HTML', !pageHtml.includes(encryption_key))

// The agent polls: nothing yet
const pollPending = await api(`/v1/requests/${id}`, { headers: { 'x-poll-token': poll_token } })
const pending = await pollPending.json()
check('polling reports pending', pending.status === 'pending')
check('the page open is counted', pending.opened_count === 1)
check('polling never returns a secret', !JSON.stringify(pending).includes('ciphertext'))

// Revealing too early
const tooEarly = await api(`/v1/requests/${id}/reveal`, {
  method: 'POST',
  body: JSON.stringify({ poll_token, encryption_key }),
})
check('revealing before filling returns 409', tooEarly.status === 409)

// The browser encrypts, then sends
const payload = await browserEncrypt(encryption_key, SECRET)
const fillRes = await fetch(`${BASE}/s/${id}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (test)' },
  body: JSON.stringify(payload),
})
check('the fill is accepted', fillRes.status === 200, `got ${fillRes.status}`)

const pollFilled = await api(`/v1/requests/${id}`, { headers: { 'x-poll-token': poll_token } })
const filled = await pollFilled.json()
check('polling reports filled', filled.status === 'filled')
check('the fill timestamp is present', typeof filled.filled_at === 'string')
check('the IP fingerprint is recorded', typeof filled.filled_from_ip_hash === 'string')
check('the raw IP is never stored', !String(filled.filled_from_ip_hash).includes('.'))

// The agent reveals
const revealRes = await api(`/v1/requests/${id}/reveal`, {
  method: 'POST',
  body: JSON.stringify({ poll_token, encryption_key }),
})
const revealed = await revealRes.json()
check('the reveal succeeds', revealRes.status === 200, JSON.stringify(revealed))
check('the decrypted secret matches the original', revealed.secret === SECRET)
check('the secret is marked burned', revealed.burned === true)

// A second reveal is impossible
const secondReveal = await api(`/v1/requests/${id}/reveal`, {
  method: 'POST',
  body: JSON.stringify({ poll_token, encryption_key }),
})
check('the second reveal is refused', secondReveal.status === 409)

// The link is dead
const deadPage = await fetch(`${BASE}/s/${id}`)
check('the link no longer answers 200', deadPage.status === 410)

// --------------------------------------------------------------- access control
section('Access control')

const c2 = await (
  await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({ requester: 'Bot', label: 'Token' }),
  })
).json()

const noAuth = await fetch(`${BASE}/v1/requests/${c2.id}`)
check('no API key: 401', noAuth.status === 401)

const badKey = await fetch(`${BASE}/v1/requests/${c2.id}`, {
  headers: { authorization: 'Bearer mauvaise_cle', 'x-poll-token': c2.poll_token },
})
check('wrong API key: 401', badKey.status === 401)

const noToken = await api(`/v1/requests/${c2.id}`)
check('no poll_token: 403', noToken.status === 403)

const badToken = await api(`/v1/requests/${c2.id}`, { headers: { 'x-poll-token': 'nope' } })
check('wrong poll_token: 403', badToken.status === 403)

// Someone reading the chat can fill the slot, but cannot read it.
const injected = await browserEncrypt(c2.encryption_key, 'attacker-supplied-key')
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
  'holding the link is not enough to read the secret (poll_token required)',
  stealAttempt.status === 403,
)

// Wrong encryption key -> decryption failure
const wrongKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
const wrongKeyRes = await api(`/v1/requests/${c2.id}/reveal`, {
  method: 'POST',
  body: JSON.stringify({ poll_token: c2.poll_token, encryption_key: wrongKey }),
})
check('wrong encryption key: 400', wrongKeyRes.status === 400)

// ------------------------------------------------------------ single use
section('Single use and lifecycle')

const c3 = await (
  await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({ requester: 'Bot', label: 'Token' }),
  })
).json()
const p3 = await browserEncrypt(c3.encryption_key, 'value')
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
check('first fill accepted', first.status === 200)
check('second fill refused', second.status === 409)

// burn_on_reveal: false -> readable again until expiry
const c3b = await (
  await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({ requester: 'Bot', label: 'Token', burn_on_reveal: false }),
  })
).json()
const p3b = await browserEncrypt(c3b.encryption_key, 'persistent-value')
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
check('without burn: first read works', r1.secret === 'persistent-value')
check('without burn: not marked burned', r1.burned === false)
check('without burn: a second read still works', r2res.status === 200 && r2.secret === 'persistent-value', JSON.stringify(r2))

// Cancellation
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
check('cancellation accepted', cancelled.status === 200)
const cancelledPage = await fetch(`${BASE}/s/${c4.id}`)
check('a cancelled page responds 410', cancelledPage.status === 410)

// Expiry
const c5 = await (
  await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({ requester: 'Bot', label: 'Token', ttl_seconds: 30 }),
  })
).json()
check('minimum TTL accepted', typeof c5.id === 'string')
const badTtl = await api('/v1/requests', {
  method: 'POST',
  body: JSON.stringify({ requester: 'Bot', label: 'Token', ttl_seconds: 5 }),
})
check('too-short TTL refused', badTtl.status === 400)

// -------------------------------------------------------------- validation
section('Input validation')

const noLabel = await api('/v1/requests', {
  method: 'POST',
  body: JSON.stringify({ requester: 'Bot' }),
})
check('missing label: 400', noLabel.status === 400)

const noRequester = await api('/v1/requests', {
  method: 'POST',
  body: JSON.stringify({ label: 'Token' }),
})
check('missing requester: 400', noRequester.status === 400)

const xss = await (
  await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({ requester: '<script>alert(1)</script>', label: 'Token' }),
  })
).json()
const xssPage = await (await fetch(`${BASE}/s/${xss.id}`)).text()
check('injected HTML is escaped', !xssPage.includes('<script>alert(1)</script>'))
check('the escaped value is still rendered', xssPage.includes('&lt;script&gt;'))

const notFound = await fetch(`${BASE}/s/inexistant`)
check('unknown link: 404', notFound.status === 404)

const spec = await (await fetch(`${BASE}/openapi.json`)).json()
check('openapi.json is served', spec.openapi === '3.1.0')
check('the spec declares all three paths', Object.keys(spec.paths).length >= 3)

// ----------------------------------------------------------------
console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`)
process.exit(failed === 0 ? 0 : 1)
