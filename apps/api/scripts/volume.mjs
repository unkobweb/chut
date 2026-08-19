#!/usr/bin/env node
/**
 * Proves that the data volume actually survives a redeploy.
 *
 *   npm run volume -- https://chut.sh     # 1. before: leaves a marker
 *   # redeploy
 *   npm run volume -- https://chut.sh     # 2. after: says whether it survived
 *
 * This is the one production failure that is completely silent. An unmounted or
 * misconfigured volume passes every other check: the service is healthy, links
 * are created, secrets round-trip. It only shows up as requests vanishing
 * mid-flight at a moment nobody connects to a deployment that happened an hour
 * earlier — and by then the human on the other end has already pasted a
 * credential into a link that no longer exists.
 *
 * The marker is a real pending request with a long TTL, left unfilled. It holds
 * no secret: only a label, and the tokens needed to read its own status.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = (process.argv[2] ?? process.env.BASE ?? 'http://localhost:8787').replace(/\/+$/, '')
const STATE = resolve(process.cwd(), '.volume-check.json')

const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}

async function http(url, opts = {}) {
  try {
    return await fetch(url, opts)
  } catch (e) {
    const cause = e.cause ?? {}
    console.error(`\n${c.red('cannot reach')} ${url}\n  ${cause.code ?? ''} ${cause.message ?? e.message}\n`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------- phase 2
if (existsSync(STATE)) {
  const prev = JSON.parse(readFileSync(STATE, 'utf8'))

  if (prev.base !== BASE) {
    console.error(
      `\n${c.red('The marker was left on a different service.')}\n` +
        `  marker: ${prev.base}\n  now:    ${BASE}\n\n` +
        `Delete ${c.cyan('.volume-check.json')} to start over.\n`,
    )
    process.exit(1)
  }

  const res = await http(`${BASE}/v1/requests/${prev.id}`, { headers: { 'x-poll-token': prev.poll_token } })

  if (res.status === 200) {
    const body = await res.json()
    const age = Math.round((Date.now() - new Date(prev.at).getTime()) / 1000)
    console.log(
      `\n${c.green('The volume holds.')}\n\n` +
        `  The request created ${age}s ago is still there, status ${c.bold(body.status)}.\n` +
        `  ${c.dim('It will expire on its own; nothing to clean up.')}\n`,
    )
    writeFileSync(STATE, JSON.stringify({ ...prev, verified: true }, null, 2))
    process.exit(0)
  }

  if (res.status === 404) {
    console.log(
      `\n${c.red('The volume is NOT persistent.')}\n\n` +
        `  The request is gone: the database was recreated empty.\n\n` +
        `  Every deploy silently drops the requests in flight — a human who is\n` +
        `  filling a link at that moment gets a dead page after pasting.\n\n` +
        `  Check that ${c.cyan('/app/data')} is a named volume, not a bind mount into the\n` +
        `  container filesystem, and that ${c.cyan('DB_PATH')} points inside it.\n`,
    )
    process.exit(1)
  }

  console.log(`\n${c.red('Unexpected answer')} ${res.status}: ${(await res.text()).slice(0, 300)}\n`)
  process.exit(1)
}

// ---------------------------------------------------------------- phase 1
const res = await http(`${BASE}/v1/requests`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    requester: 'volume check',
    label: 'marker — never filled',
    purpose: 'Left here on purpose to see whether it survives a redeploy.',
    ttl_seconds: 86_400,
  }),
})

if (res.status !== 201) {
  console.error(`\n${c.red('Could not create the marker')} (${res.status}): ${(await res.text()).slice(0, 300)}\n`)
  process.exit(1)
}

const created = await res.json()
writeFileSync(
  STATE,
  JSON.stringify({ base: BASE, id: created.id, poll_token: created.poll_token, at: new Date().toISOString() }, null, 2),
)

console.log(
  `\n${c.bold('Marker left on')} ${BASE}\n\n` +
    `  Now redeploy, then run the same command again:\n\n` +
    `    ${c.cyan(`npm run volume -- ${BASE}`)}\n`,
)
