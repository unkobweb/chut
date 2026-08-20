/**
 * Drives the MCP server the way a real host does — a child process, JSON-RPC
 * over stdio, the official client — against a real chut instance.
 *
 *   CHUT_URL=http://localhost:8787 node test/protocol.mjs
 *
 * The assertions that matter are not "the tools work". They are the ones that
 * check what leaks: a transcript is a durable artefact, and every string these
 * tools return is a string that ends up in one.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const CHUT = (process.env.CHUT_URL ?? 'http://localhost:8787').replace(/\/+$/, '')

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
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`)

/** The human's browser: encrypt with the key from the fragment, then submit. */
async function fillAsHuman(url, plaintext) {
  const [page, keyB64url] = url.split('#')
  const b64 = keyB64url.replace(/-/g, '+').replace(/_/g, '/')
  const raw = Uint8Array.from(Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64'))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  const res = await fetch(page, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: CHUT, 'user-agent': 'Mozilla/5.0 (test)' },
    body: JSON.stringify({
      ciphertext: Buffer.from(ct).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
    }),
  })
  if (res.status !== 200) throw new Error(`fill failed: ${res.status} ${await res.text()}`)
}

const flatten = (result) => (result.content ?? []).map((c) => c.text ?? '').join('\n')

// -----------------------------------------------------------------------------
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', 'src/server.ts'],
  env: { ...process.env, CHUT_URL: CHUT, CHUT_FILE_TTL_SECONDS: '2' },
  stderr: 'pipe',
})
const client = new Client({ name: 'chut-protocol-test', version: '0.1.0' })
await client.connect(transport)

const SECRET = `sk-live-protocol-test-${Date.now()}`
let failure = null

try {
  // ---------------------------------------------------------------- discovery
  section('Discovery')
  const { tools } = await client.listTools()
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
  const expected = [
    'ask_human_for_secret', 'check_secret_request', 'reveal_secret',
    'reveal_secret_to_file', 'discard_secret_file', 'cancel_secret_request',
  ]
  check('all four tools are advertised', expected.every((n) => n in byName), tools.map((t) => t.name).join(', '))
  check(
    'every tool carries a description',
    tools.every((t) => (t.description ?? '').length > 40),
    tools.filter((t) => (t.description ?? '').length <= 40).map((t) => t.name).join(', '),
  )
  check(
    'reveal_secret tells the model not to echo the value',
    /do not repeat it back/i.test(byName.reveal_secret?.description ?? ''),
    'the description is the only thing stopping an agent from pasting it into its reply',
  )
  check(
    'ask_human_for_secret insists on the fragment',
    /after the "#"/.test(byName.ask_human_for_secret?.description ?? ''),
    'a link copied without its fragment cannot decrypt anything',
  )
  check(
    'reveal_secret_to_file forbids reading the file on its own',
    /never read the file on its own/i.test(byName.reveal_secret_to_file?.description ?? ''),
    'an agent that cats the file to check it worked has undone the whole point',
  )
  check(
    'reveal_secret points at the file variant first',
    /reveal_secret_to_file instead/.test(byName.reveal_secret?.description ?? ''),
    'left to itself a model takes the tool whose name matches its intent',
  )

  // ------------------------------------------------------------------- create
  section('Asking')
  const asked = await client.callTool({ name: 'ask_human_for_secret', arguments: {
    requester: 'protocol test',
    label: 'Gmail API key',
    purpose: 'Exercising the MCP server end to end.',
    ttl_seconds: 300,
  } })
  const askedText = flatten(asked)
  check('the call succeeds', asked.isError !== true, askedText.slice(0, 200))

  const url = /https?:\/\/\S+#\S+/.exec(askedText)?.[0]
  const id = /Request id: (\S+)/.exec(askedText)?.[1]
  check('a complete link is returned', !!url, askedText.slice(0, 200))
  check('the id is stated so the model can use it', !!id)

  // ------------------------------------------------------------------ leakage
  // The whole point of the vault. The URL carries the encryption key because the
  // browser needs it; the poll_token must never appear anywhere at all, because
  // key + token together are enough to read the secret.
  section('What reaches the transcript')
  const direct = await (
    await fetch(`${CHUT}/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requester: 'raw', label: 'raw' }),
    })
  ).json()
  check(
    'the bare API hands out a poll_token',
    typeof direct.poll_token === 'string',
    'if this fails the next assertion proves nothing',
  )
  check(
    'the MCP tool does not',
    !/poll[_-]?token/i.test(askedText),
    'the model would be holding half of what it takes to steal the secret',
  )
  check(
    'and never names the encryption key as such',
    !/encryption[_-]?key/i.test(askedText),
    'naming it invites the model to repeat it separately from the URL',
  )

  // -------------------------------------------------------------------- waiting
  section('Waiting')
  const early = await client.callTool({ name: 'check_secret_request', arguments: { id } })
  check('an unfilled request reads as waiting', /still waiting/i.test(flatten(early)), flatten(early).slice(0, 160))
  check('and says nobody has opened it', /not opened the link yet/i.test(flatten(early)))

  const startedAt = Date.now()
  const waiting = client.callTool({ name: 'check_secret_request', arguments: { id, wait_seconds: 30 } })
  setTimeout(() => { fillAsHuman(url, SECRET).catch((e) => { failure = e }) }, 1500)
  const filled = flatten(await waiting)
  const waited = Date.now() - startedAt
  if (failure) throw failure
  check('waiting returns as soon as the human answers', /filled/i.test(filled), filled.slice(0, 160))
  check('and does not sit out the whole budget', waited < 20_000, `waited ${Math.round(waited / 1000)}s of 30`)
  check('the wait never returns the secret', !filled.includes(SECRET))

  // -------------------------------------------------------------------- reveal
  section('Revealing')
  const revealed = await client.callTool({ name: 'reveal_secret', arguments: { id } })
  const revealedText = flatten(revealed)
  check('the value survives the round trip', revealedText.includes(SECRET), revealedText.slice(0, 160))
  check('and is reported as destroyed', /destroyed/i.test(revealedText))
  check('with the instruction not to echo it', /do not repeat it/i.test(revealedText))

  const secondRead = await client.callTool({ name: 'reveal_secret', arguments: { id } })
  check('a second read fails', secondRead.isError === true, flatten(secondRead).slice(0, 160))
  check(
    'and explains why in a sentence the model can act on',
    /already read once/i.test(flatten(secondRead)),
    flatten(secondRead).slice(0, 160),
  )

  // ---------------------------------------------------------------- the vault
  section('The vault is per-process')
  const foreign = await client.callTool({ name: 'reveal_secret', arguments: { id: direct.id } })
  check(
    'a request this process did not create cannot be read',
    foreign.isError === true,
    'the model could otherwise reveal any id it guessed or was told',
  )
  check(
    'and the refusal explains the boundary',
    /created by this session/i.test(flatten(foreign)),
    flatten(foreign).slice(0, 160),
  )

  // -------------------------------------------------------------------- cancel
  section('Cancelling')
  const toCancel = await client.callTool({ name: 'ask_human_for_secret', arguments: {
    requester: 'protocol test', label: 'Token to withdraw' } })
  const cancelId = /Request id: (\S+)/.exec(flatten(toCancel))?.[1]
  const cancelUrl = /https?:\/\/\S+#\S+/.exec(flatten(toCancel))?.[0]
  const cancelled = await client.callTool({ name: 'cancel_secret_request', arguments: { id: cancelId } })
  check('cancelling succeeds', cancelled.isError !== true, flatten(cancelled).slice(0, 160))
  const afterCancel = await client.callTool({ name: 'reveal_secret', arguments: { id: cancelId } })
  check(
    'reading a cancelled request says it was cancelled',
    afterCancel.isError === true && /was cancelled/i.test(flatten(afterCancel)),
    flatten(afterCancel).slice(0, 160),
  )
  check(
    'and the link really is dead',
    (await fetch(cancelUrl.split('#')[0])).status === 410,
    'the page still answers 200 after a cancellation',
  )

  // ---------------------------------------------------------- the file variant
  // The whole reason this tool exists: a tool result is transcript, so the
  // value has to leave by another door.
  section('Revealing into a file')
  const second = await client.callTool({ name: 'ask_human_for_secret', arguments: {
    requester: 'protocol test', label: 'Key read into a file' } })
  const secondId = /Request id: (\S+)/.exec(flatten(second))?.[1]
  const secondUrl = /https?:\/\/\S+#\S+/.exec(flatten(second))?.[0]
  const FILE_SECRET = `sk-live-file-variant-${Date.now()}`
  await fillAsHuman(secondUrl, FILE_SECRET)

  const dropped = await client.callTool({ name: 'reveal_secret_to_file', arguments: { id: secondId } })
  const droppedText = flatten(dropped)
  check('the call succeeds', dropped.isError !== true, droppedText.slice(0, 200))
  check(
    'the secret is NOT in the tool result',
    !droppedText.includes(FILE_SECRET),
    'this is the entire point of the tool',
  )

  const path = /^(\/\S+\.secret)/m.exec(droppedText)?.[1]
  check('a path is returned', !!path, droppedText.slice(0, 200))
  check(
    'the file holds the secret, byte for byte',
    readFileSync(path, 'utf8') === FILE_SECRET,
    'trailing newlines break credentials passed through verbatim',
  )
  check(
    'and is readable by nobody else',
    (statSync(path).mode & 0o777) === 0o600,
    `mode ${(statSync(path).mode & 0o777).toString(8)} — a shared temp directory is world-readable`,
  )

  const discarded = await client.callTool({ name: 'discard_secret_file', arguments: { path } })
  check('it can be discarded early', /deleted/i.test(flatten(discarded)), flatten(discarded).slice(0, 120))
  check('and really is gone', !existsSync(path))
  const again2 = await client.callTool({ name: 'discard_secret_file', arguments: { path } })
  check('discarding twice is not an error', again2.isError !== true)
  check(
    'a path this server did not create is refused',
    /not created by this server/i.test(
      flatten(await client.callTool({ name: 'discard_secret_file', arguments: { path: '/etc/passwd' } })),
    ),
    'the tool must not be a way to delete arbitrary files',
  )

  // The TTL is set to 2s by the runner, so this is a real expiry, not a mock.
  const third = await client.callTool({ name: 'ask_human_for_secret', arguments: {
    requester: 'protocol test', label: 'Key that should evaporate' } })
  const thirdId = /Request id: (\S+)/.exec(flatten(third))?.[1]
  await fillAsHuman(/https?:\/\/\S+#\S+/.exec(flatten(third))[0], 'sk-evaporates')
  const expiring = flatten(await client.callTool({ name: 'reveal_secret_to_file', arguments: { id: thirdId } }))
  const expiringPath = /^(\/\S+\.secret)/m.exec(expiring)?.[1]
  check('the file is there right after the drop', existsSync(expiringPath))
  await new Promise((r) => setTimeout(r, 3500))
  check(
    'and removes itself once its time is up',
    !existsSync(expiringPath),
    'a plaintext credential left on disk indefinitely is worse than the transcript',
  )

  // ------------------------------------------------------------------- errors
  section('Failure modes')
  const unknown = await client.callTool({ name: 'check_secret_request', arguments: { id: 'nope' } })
  check('an unknown id is an error, not a crash', unknown.isError === true)
  check('the server is still alive afterwards', (await client.listTools()).tools.length === 6)
} finally {
  await client.close()
}

// -----------------------------------------------------------------------------
// A separate server, because the assertion is about what its death leaves behind.
section('Nothing plaintext outlives the process')
{
  const t2 = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/server.ts'],
    env: { ...process.env, CHUT_URL: CHUT, CHUT_FILE_TTL_SECONDS: '600' },
    stderr: 'pipe',
  })
  const c2 = new Client({ name: 'chut-shutdown-test', version: '0.1.0' })
  await c2.connect(t2)

  const req = await c2.callTool({ name: 'ask_human_for_secret', arguments: {
    requester: 'shutdown test', label: 'Key left behind' } })
  const rid = /Request id: (\S+)/.exec(flatten(req))?.[1]
  await fillAsHuman(/https?:\/\/\S+#\S+/.exec(flatten(req))[0], 'sk-should-not-survive')
  const dropText = flatten(await c2.callTool({ name: 'reveal_secret_to_file', arguments: { id: rid } }))
  const leftover = /^(\/\S+\.secret)/m.exec(dropText)?.[1]
  check('the file exists while the server runs', existsSync(leftover))

  await c2.close()
  await new Promise((r) => setTimeout(r, 1500))
  check(
    'and is gone once the server stops',
    !existsSync(leftover),
    'a ten-minute TTL is no comfort if the host restarts the server every session',
  )
}

console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`)
process.exit(failed === 0 ? 0 : 1)
