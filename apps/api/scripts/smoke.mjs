#!/usr/bin/env node
/**
 * Smoke test against a deployed instance. Run it after every deploy.
 *
 *   npm run smoke                      against http://localhost:8787
 *   npm run smoke -- https://chut.sh   against production
 *
 * It walks the whole round trip — create, render, encrypt, fill, poll, reveal,
 * burn — with a throwaway value, and leaves one dead row behind. Unlike the test
 * suites it never floods the rate limiter and never asserts on internal state,
 * so it is safe to point at a live service.
 */

const BASE = (process.argv[2] ?? process.env.BASE ?? 'http://localhost:8787').replace(/\/+$/, '')

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    passed++
    console.log(`  \x1b[32mOK\x1b[0m   ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const step = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`)

/** Exactly what the form page's JavaScript does, replayed with Node's WebCrypto. */
async function browserEncrypt(keyB64url, plaintext) {
  const b64 = keyB64url.replace(/-/g, '+').replace(/_/g, '/')
  const raw = Uint8Array.from(Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64'))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return { ciphertext: Buffer.from(ct).toString('base64'), iv: Buffer.from(iv).toString('base64') }
}

/**
 * Node wraps every transport failure in a bare "fetch failed" and hides the
 * useful part — the DNS code, the TLS error, the refused connection — one level
 * down in err.cause. A smoke test that cannot say why it could not connect is
 * worth nothing, so unwrap it here rather than at each call site.
 */
async function http(url, opts = {}) {
  try {
    return await fetch(url, opts)
  } catch (e) {
    const c = e.cause ?? {}
    const code = c.code ?? c.errno ?? ''
    const detail = [code, c.message ?? c.reason ?? e.message].filter(Boolean).join(' · ')
    const err = new Error(`${opts.method ?? 'GET'} ${url}\n         ${detail}`)
    err.code = code
    throw err
  }
}

/** What the transport-level codes actually mean here. */
const DIAGNOSIS = {
  ENOTFOUND: 'the hostname does not resolve from this machine. Almost always a\n         stale negative DNS cache: on macOS,\n           sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder',
  EAI_AGAIN: 'DNS lookup timed out — the resolver, not the service.',
  ECONNREFUSED: 'the host answered but nothing is listening on that port.',
  ETIMEDOUT: 'no answer at all. A firewall between here and there, or the host is down.',
  CERT_HAS_EXPIRED: 'the TLS certificate has expired.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'the certificate chain does not validate — a\n         self-signed certificate, which usually means the reverse proxy never\n         obtained a real one for this domain.',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'a self-signed certificate: the reverse proxy is\n         serving its default, so Let\u2019s Encrypt never issued one for this domain.',
  ERR_TLS_CERT_ALTNAME_INVALID: 'the certificate is valid but for a different\n         hostname than the one requested.',
}

const SECRET = `smoke-test-not-a-real-credential-${Date.now()}`
const BROWSER = { 'user-agent': 'Mozilla/5.0 (smoke test)' }

console.log(`\nchut smoke test → ${BASE}`)

// --- the service is up -------------------------------------------------------
step('1 · reachable')
const health = await http(`${BASE}/healthz`).catch((e) => e)
if (health instanceof Error) {
  console.log(`  \x1b[31mFAIL\x1b[0m ${health.message}`)
  const why = DIAGNOSIS[health.code]
  if (why) console.log(`       \u2192 ${why}`)
  console.log('')
  process.exit(1)
}
const healthBody = await health.json()
check('/healthz answers', health.status === 200 && healthBody.ok === true, JSON.stringify(healthBody))

// --- create ------------------------------------------------------------------
step('2 · an agent creates a request')
const createRes = await http(`${BASE}/v1/requests`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    requester: 'deployment smoke test',
    label: 'nothing real',
    purpose: 'verifying a deployment end to end',
    ttl_seconds: 300,
  }),
})
const created = await createRes.json()
check('201', createRes.status === 201, `${createRes.status} · ${JSON.stringify(created).slice(0, 200)}`)
if (createRes.status !== 201) {
  console.log('\nStopping here: nothing else can run.\n')
  process.exit(1)
}
check(
  'the link points at BASE_URL, not at localhost',
  String(created.url).startsWith(`${BASE}/s/`),
  `${created.url} — BASE_URL does not match the address being tested`,
)

// A browser sends the origin of the page it is on, which is whatever BASE_URL
// says. Deriving it from the returned link rather than from BASE keeps the rest
// of the run meaningful when BASE_URL is the thing that is wrong: one clear
// failure above instead of six consequential ones below.
const pageOrigin = (() => {
  try { return new URL(created.url).origin } catch { return BASE }
})()
check('the encryption key sits in the fragment', String(created.url).includes('#'))
check('poll_token and encryption_key came back', !!created.poll_token && !!created.encryption_key)

// --- the page ----------------------------------------------------------------
step('3 · the page a human lands on')
const page = await http(`${BASE}/s/${created.id}`, { headers: BROWSER })
const html = await page.text()
check('200', page.status === 200, String(page.status))
check('the requester is rendered', html.includes('deployment smoke test'))
check('the encryption key never reached the server', !html.includes(created.encryption_key))
check('CSP carries a per-response nonce', (page.headers.get('content-security-policy') ?? '').includes('nonce-'))
check('the page is not cacheable', (page.headers.get('cache-control') ?? '').includes('no-store'))
check('the stylesheet is inlined — one request, no CDN', html.includes('<style'))
if (BASE.startsWith('https://')) {
  check(
    'HSTS is set',
    !!page.headers.get('strict-transport-security'),
    'missing — add it at the reverse proxy',
  )
}

// --- fill --------------------------------------------------------------------
step('4 · the human fills it in')
const fill = await http(`${BASE}/s/${created.id}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: pageOrigin, ...BROWSER },
  body: JSON.stringify(await browserEncrypt(created.encryption_key, SECRET)),
})
check('the ciphertext is accepted', fill.status === 200, `${fill.status} · ${(await fill.text()).slice(0, 200)}`)

// --- poll --------------------------------------------------------------------
step('5 · the agent polls')
const state = await (
  await http(`${BASE}/v1/requests/${created.id}`, { headers: { 'x-poll-token': created.poll_token } })
).json()
check('status is filled', state.status === 'filled', JSON.stringify(state).slice(0, 200))
check(
  'the filling address is stored as a hash, never raw',
  typeof state.filled_from_ip_hash === 'string' && !state.filled_from_ip_hash.includes('.'),
  String(state.filled_from_ip_hash),
)


// --- reveal ------------------------------------------------------------------
step('6 · the agent reveals, once')
const revealed = await (
  await http(`${BASE}/v1/requests/${created.id}/reveal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ poll_token: created.poll_token, encryption_key: created.encryption_key }),
  })
).json()
check('the value survives the round trip', revealed.secret === SECRET, JSON.stringify(revealed).slice(0, 200))
check('and is reported as burned', revealed.burned === true)

const again = await http(`${BASE}/v1/requests/${created.id}/reveal`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ poll_token: created.poll_token, encryption_key: created.encryption_key }),
})
check('a second reveal is refused', again.status === 409, String(again.status))
check('the link is dead', (await http(`${BASE}/s/${created.id}`)).status === 410)

// --- access control ----------------------------------------------------------
step('7 · holding the link is not enough')
check('no poll_token: 403', (await http(`${BASE}/v1/requests/${created.id}`)).status === 403)
check(
  'wrong poll_token: 403',
  (await http(`${BASE}/v1/requests/${created.id}`, { headers: { 'x-poll-token': 'nope' } })).status === 403,
)
check('an unknown link: 404', (await http(`${BASE}/s/definitelynotarealid`)).status === 404)

// -----------------------------------------------------------------------------
const colour = failed === 0 ? '\x1b[32m' : '\x1b[31m'
console.log(`\n${colour}${passed} passed, ${failed} failed\x1b[0m\n`)
process.exit(failed === 0 ? 0 : 1)
