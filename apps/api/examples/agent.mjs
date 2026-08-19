/**
 * Minimal agent-side client: ask your human for a secret, then use it.
 *
 *   node examples/agent.mjs
 *
 * Copy this into your Telegram bot / n8n flow / custom loop.
 */

const BASE = process.env.CHUT_URL ?? 'http://localhost:8787'

/**
 * Creates a request. Returns the URL to show the human, plus the tokens to keep secret.
 */
export async function askHuman({ requester, label, purpose, ttlSeconds = 900 }) {
  const res = await fetch(`${BASE}/v1/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requester, label, purpose, ttl_seconds: ttlSeconds }),
  })
  if (!res.ok) throw new Error(`chut: request creation refused (${res.status})`)
  return res.json()
}

/**
 * Polls until the human has filled the form, or until the request expires.
 * Returns the request, or null if it was never filled.
 */
export async function waitForFill({ id, poll_token }, { intervalMs = 3000 } = {}) {
  for (;;) {
    const res = await fetch(`${BASE}/v1/requests/${id}`, {
      headers: { 'x-poll-token': poll_token },
    })
    const req = await res.json()

    if (req.status === 'filled') return req
    if (req.status !== 'pending') return null

    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

/** Reads the secret. It is destroyed right after: only call this when you are about to use it. */
export async function reveal({ id, poll_token, encryption_key }) {
  const res = await fetch(`${BASE}/v1/requests/${id}/reveal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ poll_token, encryption_key }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`chut: reveal failed (${data.error})`)
  return data.secret
}

// --- example usage --------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const req = await askHuman({
    requester: 'Telegram Assistant',
    label: 'Gmail API key',
    purpose: 'Read your last 20 emails to send you a summary every morning',
    ttlSeconds: 600,
  })

  // This is the only line that reaches the user.
  console.log(`\nI need your Gmail API key. Paste it here, the link expires in 10 min:`)
  console.log(`${req.url}\n`)

  console.log('Waiting...')
  const filled = await waitForFill(req)

  if (!filled) {
    console.log('Nobody filled the link in time.')
    process.exit(0)
  }

  // Signal worth surfacing: a link opened more than once deserves a question.
  if (filled.opened_count > 1) {
    console.log(`Heads up: this link was opened ${filled.opened_count} times. Was that you?`)
  }

  const secret = await reveal({ ...req })
  console.log(`Received (${secret.length} characters). Using it now; it is already destroyed.`)
  // ... use `secret` here, without ever echoing it back to the user.
}
