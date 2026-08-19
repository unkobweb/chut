/**
 * Attack suite.
 * Every block reproduces a real attack and MUST fail before its fix lands.
 *
 * Usage: node test/attacks.mjs
 */
import { statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  startServer, startServerOn, api, createRequest, fillRequest, concurrentPost,
  browserEncrypt, BASE, KEY, DB, SALT, check, section, report,
} from './harness.mjs'

/** Mirrors hashIp() server-side: sha256(salt:ip), truncated. */
const expectedIpHash = (ip) =>
  createHash('sha256').update(`${SALT}:${ip}`).digest('hex').slice(0, 16)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const proc = await startServer()

// =============================================================================
section('01 · Reveal race: revealing must be atomic')
// =============================================================================
// The agent reveals once: the secret is destroyed on read. The burn is also the
// intrusion detector — if a thief reads before the agent, the agent gets a 409
// and the incident becomes visible. An attacker firing requests AT THE SAME TIME
// as the legitimate agent must not be able to obtain the secret as well.
{
  const CONCURRENT = 10
  const ROUNDS = 5
  const outcomes = []

  // Several rounds: a race is not won every time, but the expected behaviour
  // ("exactly one winner") must hold in EVERY round.
  for (let round = 0; round < ROUNDS; round++) {
    const SECRET = `sk-live-race-${round}`
    const req = await createRequest({ label: 'Banking key' })
    await fillRequest(req, SECRET)

    const responses = await concurrentPost(
      `/v1/requests/${req.id}/reveal`,
      { poll_token: req.poll_token, encryption_key: req.encryption_key },
      { authorization: `Bearer ${KEY}` },
      CONCURRENT,
    )

    outcomes.push({
      req,
      winners: responses.filter((r) => r.body.secret === SECRET).length,
      rejected: responses.filter((r) => r.status === 409).length,
      leaked: responses.filter((r) => r.status !== 200 && r.body.secret !== undefined).length,
    })
  }

  const worst = Math.max(...outcomes.map((o) => o.winners))
  check(
    `exactly one call gets the secret, across ${ROUNDS} rounds of ${CONCURRENT} simultaneous requests`,
    outcomes.every((o) => o.winners === 1),
    `up to ${worst} calls received the secret in a single round ` +
      `(per round: ${outcomes.map((o) => o.winners).join(', ')})`,
  )
  check(
    'every loser is rejected with 409',
    outcomes.every((o) => o.winners + o.rejected === CONCURRENT),
    `incomplete rounds: ${outcomes.map((o) => `${o.winners}+${o.rejected}`).join(', ')}`,
  )
  check(
    'no non-200 response carries a secret',
    outcomes.every((o) => o.leaked === 0),
  )

  const last = outcomes.at(-1).req
  const after = await (
    await api(`/v1/requests/${last.id}`, { headers: { 'x-poll-token': last.poll_token } })
  ).json()
  check('the request is marked revealed after the race', after.status === 'revealed', after.status)

  const late = await api(`/v1/requests/${last.id}/reveal`, {
    method: 'POST',
    body: JSON.stringify({ poll_token: last.poll_token, encryption_key: last.encryption_key }),
  })
  check('a late reveal is refused', late.status === 409, `got ${late.status}`)
}

// =============================================================================
section('02 · Unbounded fields: one request must not be able to bloat the database')
// =============================================================================
// POST /s/:id is unauthenticated by design — anyone holding the link can fill it.
// So every byte it accepts has to be bounded. The size check only covered
// `ciphertext`; `iv` was validated for base64 alphabet but not for length, and no
// body limit was mounted, so the whole payload was buffered in memory and written
// to SQLite. A 12-byte IV is 16 base64 characters: anything beyond that is abuse.
{
  const before = statSync(DB).size

  // 2.1 — a giant iv
  const bloat = await createRequest()
  const hugeIv = await fetch(`${BASE}/s/${bloat.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ciphertext: 'AAAA', iv: 'A'.repeat(5_000_000) }),
  })
  await sleep(300)
  const afterIv = statSync(DB).size

  check(
    'an oversized iv is refused',
    hugeIv.status === 413 || hugeIv.status === 400,
    `got ${hugeIv.status}`,
  )
  check(
    'the database did not grow',
    afterIv - before < 200_000,
    `grew by ${((afterIv - before) / 1e6).toFixed(1)} MB after a single request`,
  )

  const stillPending = await (
    await api(`/v1/requests/${bloat.id}`, { headers: { 'x-poll-token': bloat.poll_token } })
  ).json()
  check(
    'a refused fill does not consume the link',
    stillPending.status === 'pending',
    stillPending.status,
  )

  // 2.2 — a giant ciphertext
  const bloat2 = await createRequest()
  const hugeCt = await fetch(`${BASE}/s/${bloat2.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ciphertext: 'A'.repeat(5_000_000), iv: 'AAAAAAAAAAAAAAAA' }),
  })
  check('an oversized ciphertext is refused', hugeCt.status === 413, `got ${hugeCt.status}`)

  // 2.3 — a body far past the limit must die before being parsed into memory
  const bloat3 = await createRequest()
  const hugeBody = await fetch(`${BASE}/s/${bloat3.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"padding":"' + 'A'.repeat(10_000_000) + '","ciphertext":"AAAA","iv":"AAAA"}',
  }).catch(() => ({ status: 0 }))
  check('an oversized body is refused', hugeBody.status === 413, `got ${hugeBody.status}`)

  // 2.4 — the legitimate path must keep working
  const ok = await createRequest()
  const filled = await fillRequest(ok, 'sk-a-perfectly-normal-secret')
  check('a normal fill still succeeds', filled.status === 200, `got ${filled.status}`)

  const revealed = await (
    await api(`/v1/requests/${ok.id}/reveal`, {
      method: 'POST',
      body: JSON.stringify({ poll_token: ok.poll_token, encryption_key: ok.encryption_key }),
    })
  ).json()
  check(
    'and the secret still round-trips intact',
    revealed.secret === 'sk-a-perfectly-normal-secret',
    revealed.error ?? '',
  )
}

// =============================================================================
section('03 · Confirmation page: no unauthenticated leak, no existence oracle')
// =============================================================================
// The threat model states that someone who reads the link in the chat cannot
// learn the secret. That held — but /s/:id/done answered any caller, with no
// poll_token and no API key, in any state, and rendered the request label. A
// label like "Production database password" is intelligence on its own. The
// 404-vs-200 split also turned the endpoint into an existence oracle that
// outlived the request itself.
{
  const LABEL = 'Production database password'
  const req = await createRequest({ label: LABEL, purpose: 'Nightly backup rotation' })

  const beforeFill = await fetch(`${BASE}/s/${req.id}/done`)
  const beforeBody = await beforeFill.text()
  check(
    'the confirmation page does not leak the label before filling',
    !beforeBody.includes(LABEL),
    `status ${beforeFill.status}, label found in body`,
  )

  await fillRequest(req, 'sk-leak-check')

  const afterFill = await fetch(`${BASE}/s/${req.id}/done`)
  check(
    'the confirmation page does not leak the label after filling',
    !(await afterFill.text()).includes(LABEL),
  )

  await api(`/v1/requests/${req.id}/reveal`, {
    method: 'POST',
    body: JSON.stringify({ poll_token: req.poll_token, encryption_key: req.encryption_key }),
  })

  const afterBurn = await fetch(`${BASE}/s/${req.id}/done`)
  check(
    'the label is still not exposed once the secret is burned',
    !(await afterBurn.text()).includes(LABEL),
  )

  // The purpose field is just as sensitive: it describes what the key unlocks.
  const purposeLeak = await fetch(`${BASE}/s/${req.id}/done`)
  check(
    'the purpose is not exposed either',
    !(await purposeLeak.text()).includes('Nightly backup rotation'),
  )

  // An unauthenticated caller must not be able to tell a real id from a fake one.
  const real = await fetch(`${BASE}/s/${req.id}/done`)
  const fake = await fetch(`${BASE}/s/aaaaaaaaaaaaaaaa/done`)
  check(
    'a valid and an invalid id are indistinguishable',
    real.status === fake.status,
    `valid -> ${real.status}, invalid -> ${fake.status}`,
  )

  // The form page itself must never expose the label once the link is consumed.
  const consumedForm = await fetch(`${BASE}/s/${req.id}`)
  check(
    'the consumed form page does not expose the label',
    !(await consumedForm.text()).includes(LABEL),
  )

  // A human who just submitted still deserves a confirmation screen.
  const generic = await fetch(`${BASE}/done`)
  const genericBody = await generic.text()
  check('a confirmation screen is still served', generic.status === 200, `got ${generic.status}`)
  check(
    'and it carries nothing about any particular request',
    !genericBody.includes(LABEL) && !genericBody.includes(req.id),
  )
}

// =============================================================================
section('04 · Rate limiting must cover failed auth and public routes')
// =============================================================================
// The limiter was mounted after requireApiKey and keyed on the API key hash, so a
// 401 never reached it: API keys could be brute-forced without any throttling.
// The public /s/:id routes were mounted outside the /v1 group entirely and had no
// limiter at all — which let an attacker flood opened_count and drown the very
// signal the agent uses to warn its human about a suspicious link.
{
  const LIMIT = 10
  const burstOn = (base) => (path, opts = {}, n = LIMIT * 4) =>
    Promise.all(Array.from({ length: n }, () => fetch(base + path, opts).then((r) => r.status)))

  // --- server A: public reads, then failed auth ---------------------------
  // Order matters here: a saturated /v1 bucket would make the opened_count read
  // fail with a 429, so the brute-force burst has to come last.
  const a = await startServerOn(8802, { RATE_LIMIT_PER_MIN: String(LIMIT) })
  const burstA = burstOn(a.base)
  try {
    const created = await (
      await fetch(`${a.base}/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ requester: 'Bot', label: 'Key' }),
      })
    ).json()

    const opens = await burstA(`/s/${created.id}`, {}, LIMIT * 6)
    check(
      'the public form page is rate limited',
      opens.filter((s) => s === 429).length > 0,
      `${opens.filter((s) => s === 200).length} x 200, 0 x 429`,
    )
    check(
      'a throttled response carries Retry-After',
      opens.includes(429) &&
        (await fetch(`${a.base}/s/${created.id}`)).headers.get('retry-after') !== null,
    )

    const state = await (
      await fetch(`${a.base}/v1/requests/${created.id}`, {
        headers: { authorization: `Bearer ${KEY}`, 'x-poll-token': created.poll_token },
      })
    ).json()
    check(
      'opened_count cannot be inflated at will',
      typeof state.opened_count === 'number' && state.opened_count <= LIMIT + 1,
      `opened_count reached ${state.opened_count} — the tamper signal is drownable`,
    )

    const badKeys = await burstA(
      '/v1/requests',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer wrong_key' },
        body: '{}',
      },
      LIMIT * 8,
    )
    check(
      'failed authentication is rate limited',
      badKeys.filter((s) => s === 429).length > 0,
      `${badKeys.filter((s) => s === 401).length} x 401, 0 x 429 — unlimited guessing`,
    )
  } finally {
    a.proc.kill()
  }

  // --- server B: the write endpoint, on a fresh bucket ---------------------
  // A separate server on purpose: reusing server A, the fill burst would be
  // rejected by the bucket the read burst already saturated, and the assertion
  // would pass even if POST were not covered at all.
  const b = await startServerOn(8803, { RATE_LIMIT_PER_MIN: String(LIMIT) })
  try {
    const created = await (
      await fetch(`${b.base}/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ requester: 'Bot', label: 'Key' }),
      })
    ).json()
    const fills = await burstOn(b.base)(`/s/${created.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ciphertext: 'AAAA', iv: 'AAAAAAAAAAAAAAAA' }),
    })
    check(
      'the public fill endpoint is rate limited',
      fills.filter((s) => s === 429).length > 0,
      'no 429 across a burst of fills',
    )
  } finally {
    b.proc.kill()
  }

  // --- server C: ordinary traffic must not notice any of this --------------
  const c = await startServerOn(8804, { RATE_LIMIT_PER_MIN: '1000' })
  try {
    const req = await (
      await fetch(`${c.base}/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ requester: 'Bot', label: 'Key' }),
      })
    ).json()
    const page = await fetch(`${c.base}/s/${req.id}`)
    check('normal traffic is untouched by the limiter', page.status === 200, `got ${page.status}`)
    const poll = await fetch(`${c.base}/v1/requests/${req.id}`, {
      headers: { authorization: `Bearer ${KEY}`, 'x-poll-token': req.poll_token },
    })
    check('and polling still works', poll.status === 200, `got ${poll.status}`)
  } finally {
    c.proc.kill()
  }
}

// =============================================================================
section('05 · burn_on_reveal must never fail open')
// =============================================================================
// `body.burn_on_reveal === true` meant anything that was not the strict boolean
// fell through to false. A client serialising "true" or 1 — routine in bash, n8n
// or a form post — believed it was switching single-use ON and switched it OFF.
// The worst kind of bug: it fires precisely on the caller who was being careful.
{
  // 5.1 — the secure default holds when the field is absent or null
  for (const [payload, description] of [
    [{}, 'omitted'],
    [{ burn_on_reveal: null }, 'null'],
  ]) {
    const req = await createRequest(payload)
    check(
      `burn is ON when the field is ${description}`,
      req.burn_on_reveal === true,
      `got ${JSON.stringify(req.burn_on_reveal)}`,
    )
  }

  // 5.2 — anything that is not a strict boolean is refused outright
  for (const value of ['true', 'false', 1, 0, [], {}, 'yes']) {
    const res = await api('/v1/requests', {
      method: 'POST',
      body: JSON.stringify({ requester: 'Bot', label: 'Key', burn_on_reveal: value }),
    })
    const body = await res.json()
    check(
      `burn_on_reveal: ${JSON.stringify(value)} is rejected`,
      res.status === 400,
      `got ${res.status}, request created with burn=${JSON.stringify(body.burn_on_reveal)}`,
    )
  }

  // 5.3 — the two legitimate booleans still work, and actually drive behaviour.
  // Checking the echoed flag is not enough: what matters is whether the secret
  // is really destroyed.
  const burning = await createRequest({ burn_on_reveal: true })
  await fillRequest(burning, 'sk-should-burn')
  const reveal = (r) =>
    api(`/v1/requests/${r.id}/reveal`, {
      method: 'POST',
      body: JSON.stringify({ poll_token: r.poll_token, encryption_key: r.encryption_key }),
    })

  const firstBurn = await reveal(burning)
  const secondBurn = await reveal(burning)
  check('burn_on_reveal: true still reads once', firstBurn.status === 200)
  check(
    'and the secret is genuinely destroyed',
    secondBurn.status === 409,
    `second read returned ${secondBurn.status}`,
  )

  const keeping = await createRequest({ burn_on_reveal: false })
  await fillRequest(keeping, 'sk-should-persist')
  const firstKeep = await reveal(keeping)
  const secondKeep = await reveal(keeping)
  check('burn_on_reveal: false is still honoured', firstKeep.status === 200)
  check(
    'and the secret stays readable until expiry',
    secondKeep.status === 200 && (await secondKeep.json()).secret === 'sk-should-persist',
  )
}

// =============================================================================
section('06 · X-Forwarded-For must not be believed by default')
// =============================================================================
// filled_from_ip_hash is half of the tamper detection: the agent surfaces it so
// its human can notice a fill coming from somewhere unexpected. It was derived
// from X-Forwarded-For with no notion of a trusted proxy, so the person filling
// the slot chose the address that would be shown to the very human they were
// impersonating. Evidence written by the party it is supposed to incriminate.
{
  const fillWithHeaders = async (base, headers) => {
    const created = await (
      await fetch(`${base}/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ requester: 'Bot', label: 'Key' }),
      })
    ).json()
    await fetch(`${base}/s/${created.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ ciphertext: 'AAAAAAAAAAAA', iv: 'AAAAAAAAAAAAAAAA' }),
    })
    const state = await (
      await fetch(`${base}/v1/requests/${created.id}`, {
        headers: { authorization: `Bearer ${KEY}`, 'x-poll-token': created.poll_token },
      })
    ).json()
    return state.filled_from_ip_hash
  }

  // --- default posture: no proxy, the header is worthless -------------------
  const direct = await startServerOn(8805, { RATE_LIMIT_PER_MIN: '1000' })
  try {
    const forged = await fillWithHeaders(direct.base, { 'x-forwarded-for': '8.8.8.8' })
    const forgedTwice = await fillWithHeaders(direct.base, { 'x-forwarded-for': '1.2.3.4' })
    const honest = await fillWithHeaders(direct.base, {})

    check(
      'a forged X-Forwarded-For does not become the recorded address',
      forged !== expectedIpHash('8.8.8.8'),
      'the attacker picked the address shown to the human',
    )
    check(
      'two forged headers from the same machine yield the same fingerprint',
      forged === forgedTwice && forged === honest,
      `got ${forged}, ${forgedTwice}, ${honest} — the fingerprint follows the header`,
    )
    check('a fingerprint is still recorded', typeof honest === 'string' && honest.length === 16)

    // X-Real-IP is the same class of claim and must not be believed either.
    const realIpForged = await fillWithHeaders(direct.base, { 'x-real-ip': '8.8.8.8' })
    check(
      'X-Real-IP is not believed either',
      realIpForged !== expectedIpHash('8.8.8.8'),
    )
  } finally {
    direct.proc.kill()
  }

  // --- behind one trusted proxy: the header is used, but only as far as told -
  const proxied = await startServerOn(8806, {
    RATE_LIMIT_PER_MIN: '1000',
    TRUST_PROXY_HOPS: '1',
  })
  try {
    const client = await fillWithHeaders(proxied.base, { 'x-forwarded-for': '203.0.113.7' })
    check(
      'with one trusted hop, the forwarded client address is honoured',
      client === expectedIpHash('203.0.113.7'),
      `got ${client}, expected ${expectedIpHash('203.0.113.7')}`,
    )

    // The client controls what it sends; the proxy appends the address it saw.
    // Entries the client prepended must be discarded, not read as the origin.
    const prepended = await fillWithHeaders(proxied.base, {
      'x-forwarded-for': '9.9.9.9, 203.0.113.7',
    })
    check(
      'entries prepended by the client are ignored',
      prepended === expectedIpHash('203.0.113.7'),
      `got ${prepended} — the client-injected entry was read as the origin`,
    )

    // A chain shorter than the configured trust means something is off.
    // Falling back to the socket is the safe answer, never a client-supplied value.
    const empty = await fillWithHeaders(proxied.base, { 'x-forwarded-for': '' })
    check(
      'a missing chain falls back to the socket address',
      empty !== expectedIpHash('') && typeof empty === 'string',
    )
  } finally {
    proxied.proc.kill()
  }

  // --- the rate limiter must not be evadable by rotating the header ----------
  const limited = await startServerOn(8807, { RATE_LIMIT_PER_MIN: '10' })
  try {
    const statuses = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        fetch(`${limited.base}/v1/requests`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer wrong_key',
            'x-forwarded-for': `10.0.0.${i}`,
          },
          body: '{}',
        }).then((r) => r.status),
      ),
    )
    check(
      'rotating X-Forwarded-For does not hand out fresh rate-limit buckets',
      statuses.filter((s) => s === 429).length > 0,
      'every request got its own bucket by changing a header',
    )
  } finally {
    limited.proc.kill()
  }
}

// =============================================================================
section('07 · poll_token must never travel in a URL')
// =============================================================================
// authorizeRow accepted the token from c.req.query('poll_token'). A URL is the
// one part of a request that gets written down everywhere: the access logs of
// every proxy, CDN and load balancer on the path, browser history, referrer
// headers. This service goes to some length to keep secrets out of its own logs
// and then offered a door where the credential rides in the URL - into logs it
// does not control.
{
  const srv = await startServerOn(8808, { RATE_LIMIT_PER_MIN: '1000' })
  try {
    const create = async () =>
      (
        await fetch(`${srv.base}/v1/requests`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
          body: JSON.stringify({ requester: 'Bot', label: 'Key' }),
        })
      ).json()

    const req = await create()

    // 7.1 — the query string must not authenticate anything
    const viaQuery = await fetch(
      `${srv.base}/v1/requests/${req.id}?poll_token=${encodeURIComponent(req.poll_token)}`,
      { headers: { authorization: `Bearer ${KEY}` } },
    )
    check(
      'a poll_token in the query string does not authorise the call',
      viaQuery.status !== 200,
      `got 200 — the credential travelled in the URL and was accepted`,
    )

    const body = await viaQuery.json()
    check(
      'and the error says where the token belongs',
      typeof body.message === 'string' && /header/i.test(body.message),
      JSON.stringify(body),
    )

    // 7.2 — the supported channels still work
    const viaHeader = await fetch(`${srv.base}/v1/requests/${req.id}`, {
      headers: { authorization: `Bearer ${KEY}`, 'x-poll-token': req.poll_token },
    })
    check('the X-Poll-Token header still works', viaHeader.status === 200, `got ${viaHeader.status}`)

    const filled = await create()
    await fetch(`${srv.base}/s/${filled.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(await browserEncrypt(filled.encryption_key, 'sk-body-channel')),
    })
    const viaBody = await fetch(`${srv.base}/v1/requests/${filled.id}/reveal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        poll_token: filled.poll_token,
        encryption_key: filled.encryption_key,
      }),
    })
    check(
      'the JSON body channel still works for reveal',
      viaBody.status === 200 && (await viaBody.json()).secret === 'sk-body-channel',
    )

    // 7.3 — a wrong token in the right place is still a plain 403
    const wrong = await fetch(`${srv.base}/v1/requests/${req.id}`, {
      headers: { authorization: `Bearer ${KEY}`, 'x-poll-token': 'not-the-token' },
    })
    check('a wrong token in the header is still refused', wrong.status === 403, `got ${wrong.status}`)

    // 7.4 — and our own access log must never contain a token, even when a
    // careless client insists on putting one in the URL
    const log = srv.readLog()
    check(
      'the service access log contains no poll_token',
      !log.includes(req.poll_token) && !log.includes('poll_token='),
      'a token was found in the server log',
    )
  } finally {
    srv.proc.kill()
  }
}

report(proc)
