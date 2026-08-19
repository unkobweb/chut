/**
 * Attack suite.
 * Every block reproduces a real attack and MUST fail before its fix lands.
 *
 * Usage: node test/attacks.mjs
 */
import { statSync } from 'node:fs'
import {
  startServer, api, createRequest, fillRequest, concurrentPost, BASE, KEY, DB,
  check, section, report,
} from './harness.mjs'

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

report(proc)
