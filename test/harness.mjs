/**
 * Harnais des tests d'attaque : demarre un serveur isole avec une base neuve,
 * pour que chaque execution parte du meme etat.
 */
import { spawn, execSync } from 'node:child_process'
import { rmSync, mkdirSync } from 'node:fs'

export const PORT = 8801
export const BASE = `http://localhost:${PORT}`
export const KEY = 'cle_de_test_principale'
export const KEY2 = 'cle_de_test_secondaire'
export const SALT = 'sel_de_test'
const DB = process.env.ATTACK_DB ?? './data/attacks.db'

export async function startServer(extraEnv = {}) {
  // Un serveur oublie d'une execution precedente repondrait a notre place, avec
  // une autre configuration : on libere le port avant toute chose.
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
      // Volontairement tres haut : la limitation de debit a son propre test,
      // sur un serveur dedie. Ailleurs elle ne doit pas polluer les mesures.
      RATE_LIMIT_PER_MIN: '100000',
      ...extraEnv,
    },
    stdio: 'ignore',
  })

  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error(`le serveur s'est arrete (code ${proc.exitCode})`)
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return proc
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  proc.kill()
  throw new Error('le serveur n’a pas demarre')
}

// --- petits utilitaires partages -------------------------------------------

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
      body: JSON.stringify({ requester: 'Agent de test', label: 'Cle API', ...body }),
    },
    key,
  ).then((r) => r.json())

/** Reproduit le chiffrement que fait le navigateur. */
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

// --- rapport ----------------------------------------------------------------

let passed = 0
let failed = 0
const failures = []

export function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      \x1b[31m→ ${detail}\x1b[0m` : ''}`)
  }
}

export function section(title) {
  console.log(`\n\x1b[1m\x1b[36m${title}\x1b[0m`)
}

export function report(proc) {
  proc.kill()
  const verdict = failed === 0 ? '\x1b[32mTOUT PASSE\x1b[0m' : `\x1b[31m${failed} ECHEC(S)\x1b[0m`
  console.log(`\n${verdict} — ${passed} reussis, ${failed} echoues\n`)
  process.exit(failed === 0 ? 0 : 1)
}

// --- concurrence reelle ------------------------------------------------------

import http from 'node:http'

/**
 * Envoie N requetes POST identiques sur N sockets DISTINCTES, ecrites dans le
 * meme tour de boucle. `fetch` mutualise les connexions et serialise les envois,
 * ce qui masque les conditions de course : il faut du http brut avec agent:false.
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
            agent: false, // une socket neuve par requete
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
