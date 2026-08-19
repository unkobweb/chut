/**
 * Attack suite.
 * Every block reproduces a real attack and MUST fail before its fix lands.
 *
 * Usage: node test/attacks.mjs
 */
import {
  startServer, api, createRequest, fillRequest, concurrentPost, KEY,
  check, section, report,
} from './harness.mjs'

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

report(proc)
