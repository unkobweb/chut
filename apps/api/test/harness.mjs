/**
 * Shared harness for the attack suite: boots an isolated server on its own port
 * with a fresh database, so every run starts from the exact same state.
 */
import { spawn, execSync } from 'node:child_process'
import { rmSync, mkdirSync, openSync, readFileSync, existsSync } from 'node:fs'
import http from 'node:http'

export const PORT = 8801
export const BASE = `http://localhost:${PORT}`
export const KEY = 'primary_test_key'
export const KEY2 = 'secondary_test_key'
export const SALT = 'test_salt'
export const DB = process.env.ATTACK_DB ?? './data/attacks.db'

/**
 * Boots a second, independently configured server on its own port. Used by
 * sections that need policy values the shared server deliberately neutralises
 * (rate limiting, for instance).
 */
export async function startServerOn(port, extraEnv = {}) {
  try { execSync(`fuser -k ${port}/tcp 2>/dev/null || true`) } catch {}
  await new Promise((r) => setTimeout(r, 300))

  const db = `./data/attacks-${port}.db`
  mkdirSync('./data', { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(db + suffix) } catch {}
  }

  const base = `http://localhost:${port}`
  const logPath = `./data/server-${port}.log`
  try { rmSync(logPath) } catch {}
  const logFd = openSync(logPath, 'a')

  const proc = spawn('npx', ['tsx', 'src/server.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      BASE_URL: base,
      DB_PATH: db,
      API_KEYS: `${KEY},${KEY2}`,
      IP_HASH_SALT: SALT,
      ...extraEnv,
    },
    stdio: ['ignore', logFd, logFd],
  })

  const readLog = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '')

  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error(`server exited (code ${proc.exitCode})`)
    try {
      if ((await fetch(`${base}/healthz`)).ok) return { proc, base, readLog }
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  proc.kill()
  throw new Error(`server did not start on ${port}`)
}

export async function startServer(extraEnv = {}) {
  // A forgotten server from a previous run would answer in our place with a
  // different configuration: free the port before anything else.
  try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`) } catch {}
  await new Promise((r) => setTimeout(r, 300))

  mkdirSync('./data', { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix) } catch {}
  }

  const proc = spawn('npx', ['tsx', 'src/server.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      BASE_URL: BASE,
      DB_PATH: DB,
      API_KEYS: `${KEY},${KEY2}`,
      IP_HASH_SALT: SALT,
      // Deliberately very high: rate limiting has its own test on a dedicated
      // server. Everywhere else it must not pollute the measurements.
      RATE_LIMIT_PER_MIN: '100000',
      ...extraEnv,
    },
    stdio: 'ignore',
  })

  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error(`server exited (code ${proc.exitCode})`)
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return proc
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  proc.kill()
  throw new Error('server did not start')
}

// --- shared helpers ---------------------------------------------------------

export const api = (path, opts = {}, key = KEY) =>
  fetch(BASE + path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      ...(opts.headers ?? {}),
    },
  })

export const createRequest = (body = {}, key = KEY) =>
  api(
    '/v1/requests',
    {
      method: 'POST',
      body: JSON.stringify({ requester: 'Test agent', label: 'API key', ...body }),
    },
    key,
  ).then((r) => r.json())

/** Reproduces exactly what the browser page does when encrypting. */
export async function browserEncrypt(keyB64url, plaintext) {
  const b64 = keyB64url.replace(/-/g, '+').replace(/_/g, '/')
  const raw = Uint8Array.from(Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64'))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return { ciphertext: Buffer.from(ct).toString('base64'), iv: Buffer.from(iv).toString('base64') }
}

export async function fillRequest(created, value, headers = {}) {
  return fetch(`${BASE}/s/${created.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(await browserEncrypt(created.encryption_key, value)),
  })
}

// --- real concurrency -------------------------------------------------------

/**
 * Fires N identical POSTs on N DISTINCT sockets, written in the same tick.
 * `fetch` pools connections and serialises the writes, which hides race
 * conditions entirely — raw http with agent:false is required here.
 */
export function concurrentPost(path, body, headers = {}, n = 10) {
  const payload = JSON.stringify(body)
  return Promise.all(
    Array.from({ length: n }, () =>
      new Promise((resolve) => {
        const req = http.request(
          {
            host: 'localhost',
            port: PORT,
            path,
            method: 'POST',
            agent: false, // a fresh socket per request
            headers: {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(payload),
              ...headers,
            },
          },
          (res) => {
            let data = ''
            res.on('data', (c) => (data += c))
            res.on('end', () => {
              let parsed = {}
              try { parsed = JSON.parse(data) } catch {}
              resolve({ status: res.statusCode, body: parsed })
            })
          },
        )
        req.on('error', () => resolve({ status: 0, body: {} }))
        req.end(payload)
      }),
    ),
  )
}

// --- reporting --------------------------------------------------------------

let passed = 0
let failed = 0

export function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      \x1b[31m→ ${detail}\x1b[0m` : ''}`)
  }
}

export function section(title) {
  console.log(`\n\x1b[1m\x1b[36m${title}\x1b[0m`)
}

export function report(proc) {
  proc.kill()
  const verdict = failed === 0 ? '\x1b[32mALL PASSING\x1b[0m' : `\x1b[31m${failed} FAILING\x1b[0m`
  console.log(`\n${verdict} — ${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}
