#!/usr/bin/env node
/**
 * Generates a request link and watches it, so the whole round trip can be tried
 * without hand-writing a single HTTP call.
 *
 *   npm run link                 create a link, then wait and show what arrives
 *   npm run link -- --all        one link per page state, to check them visually
 *   npm run link -- --lang fr    append ?lang= to force an interface language
 *
 *   --requester "…"  --label "…"  --purpose "…"  --ttl 900
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// --- config -----------------------------------------------------------------

function loadEnvFile() {
  try {
    const text = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    for (const line of text.split('\n')) {
      const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      if (match?.[1] && !(match[1] in process.env)) {
        process.env[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    /* no .env, fall back to defaults */
  }
}
loadEnvFile()

const BASE = (process.env.BASE_URL ?? 'http://localhost:8787').replace(/\/+$/, '')
const API_KEY = (process.env.API_KEYS ?? 'dev_change_me').split(',')[0].trim()

// --- arguments ---------------------------------------------------------------

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}

const lang = option('lang', null)
const withLang = (url) => (lang ? `${url}${url.includes('#') ? '' : ''}${url.includes('?') ? '&' : '?'}lang=${lang}` : url)

const defaults = {
  requester: option('requester', "Deploy bot — Max's coding assistant"),
  label: option('label', 'Vercel deploy token'),
  purpose: option('purpose', 'To publish the website you asked for. Used once, for that deployment.'),
  ttl_seconds: Number(option('ttl', '900')),
}

// --- terminal ----------------------------------------------------------------

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}

// --- api ---------------------------------------------------------------------

const api = (path, opts = {}) =>
  fetch(BASE + path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
      ...(opts.headers ?? {}),
    },
  })

async function ensureServer() {
  try {
    const res = await fetch(`${BASE}/healthz`)
    if (res.ok) return
  } catch {
    /* falls through */
  }
  console.error(`\n${c.red('No server answering at')} ${BASE}\n`)
  console.error(`Start one in another terminal:\n\n  ${c.cyan('npm start')}\n`)
  process.exit(1)
}

async function create(overrides = {}) {
  const res = await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({ ...defaults, ...overrides }),
  })
  const body = await res.json()
  if (!res.ok) {
    console.error(`\n${c.red('Creation refused')} (${res.status}): ${body.message ?? body.error}\n`)
    if (res.status === 401) {
      console.error(`The key being sent is ${c.dim(API_KEY)} — set API_KEYS in apps/api/.env\n`)
    }
    process.exit(1)
  }
  return body
}

/** Encrypts exactly the way the browser page does, for the states that need a value. */
async function fill(request, value) {
  const b64 = request.encryption_key.replace(/-/g, '+').replace(/_/g, '/')
  const raw = Uint8Array.from(Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64'))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value))
  await fetch(`${BASE}/s/${request.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ciphertext: Buffer.from(ct).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
    }),
  })
}

// --- one link per page state --------------------------------------------------

async function allStates() {
  const rows = []

  const ready = await create()
  rows.push(['ready — the form', withLang(ready.url)])

  const filled = await create()
  await fill(filled, 'sk-already-submitted')
  rows.push(['already used', withLang(`${BASE}/s/${filled.id}`)])

  const cancelled = await create()
  await api(`/v1/requests/${cancelled.id}`, {
    method: 'DELETE',
    headers: { 'x-poll-token': cancelled.poll_token },
  })
  rows.push(['request withdrawn', withLang(`${BASE}/s/${cancelled.id}`)])

  const expiring = await create({ ttl_seconds: 30 })
  rows.push([`expired ${c.dim('(in 30s)')}`, withLang(`${BASE}/s/${expiring.id}`)])

  // The same live request, quoted without its fragment: exactly what happens when
  // a link gets truncated on the way to its human.
  const broken = await create()
  rows.push([`incomplete link ${c.dim('(no #key)')}`, withLang(`${BASE}/s/${broken.id}`)])

  rows.push(['nothing here', withLang(`${BASE}/s/aaaaaaaaaaaaaaaa`)])
  rows.push(['delivered', withLang(`${BASE}/done`)])
  rows.push(['broken-link screen', withLang(`${BASE}/broken`)])
  rows.push(['service index', withLang(`${BASE}/`)])

  console.log(`\n${c.bold('One link per state')}${lang ? c.dim(`  ·  lang=${lang}`) : ''}\n`)
  const width = Math.max(...rows.map(([name]) => name.replace(/\x1b\[[0-9;]*m/g, '').length))
  for (const [name, url] of rows) {
    const pad = ' '.repeat(width - name.replace(/\x1b\[[0-9;]*m/g, '').length)
    console.log(`  ${c.dim(name)}${pad}   ${url}`)
  }
  console.log()
  console.log(c.dim('  The "ready" link above is live: open it and the value lands nowhere in particular.'))
  console.log(c.dim('  Use `npm run link` on its own to watch one through to the end.\n'))
}

// --- create one and watch it through ------------------------------------------

async function watchOne() {
  const request = await create()
  const url = withLang(request.url)

  console.log(`\n${c.bold('Open this, the way your human would:')}\n`)
  console.log(`  ${c.cyan(url)}\n`)
  console.log(c.dim(`  requester  ${defaults.requester}`))
  console.log(c.dim(`  label      ${defaults.label}`))
  console.log(c.dim(`  expires    ${request.expires_in_seconds}s\n`))
  process.stdout.write(c.dim('  waiting…'))

  const started = Date.now()
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500))
    const state = await (
      await api(`/v1/requests/${request.id}`, { headers: { 'x-poll-token': request.poll_token } })
    ).json()

    if (state.status === 'pending') {
      const seen = state.opened_count > 0 ? ` opened ${state.opened_count}×` : ''
      process.stdout.write(`\r  ${c.dim(`waiting… ${Math.round((Date.now() - started) / 1000)}s${seen}`)}   `)
      continue
    }

    if (state.status !== 'filled') {
      console.log(`\r  ${c.red(`ended as "${state.status}"`)}                    \n`)
      return
    }

    const revealed = await (
      await api(`/v1/requests/${request.id}/reveal`, {
        method: 'POST',
        body: JSON.stringify({
          poll_token: request.poll_token,
          encryption_key: request.encryption_key,
        }),
      })
    ).json()

    console.log(`\r  ${c.green('filled')}                              \n`)
    console.log(`  ${c.bold('secret')}      ${revealed.secret}`)
    console.log(c.dim(`  opened      ${state.opened_count}× (browser renders)`))
    console.log(c.dim(`  fetched     ${state.fetched_count}× (raw, crawlers included)`))
    console.log(c.dim(`  from        ${state.filled_from_ip_hash}`))
    console.log(c.dim(`  burned      ${revealed.burned}\n`))

    if (state.opened_count > 1) {
      console.log(`  ${c.red('opened more than once — worth asking your human about')}\n`)
    }
    return
  }
}

await ensureServer()
await (flag('all') ? allStates() : watchOne())
