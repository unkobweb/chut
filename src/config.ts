import { createHash } from 'node:crypto'

function env(name: string, fallback?: string): string {
  const v = process.env[name]
  if (v === undefined || v === '') {
    if (fallback === undefined) throw new Error(`Missing environment variable: ${name}`)
    return fallback
  }
  return v
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer`)
  return n
}

const apiKeys = env('API_KEYS', 'dev_change_me')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean)

if (apiKeys.length === 0) throw new Error('API_KEYS cannot be empty')

/** API keys are never held in plaintext, only as SHA-256 digests. */
export const API_KEY_HASHES = new Set(
  apiKeys.map((k) => createHash('sha256').update(k).digest('hex')),
)

export const config = {
  port: envInt('PORT', 8787),
  baseUrl: env('BASE_URL', 'http://localhost:8787').replace(/\/+$/, ''),
  dbPath: env('DB_PATH', './data/chut.db'),
  defaultTtl: envInt('DEFAULT_TTL_SECONDS', 900),
  maxTtl: envInt('MAX_TTL_SECONDS', 86_400),
  maxSecretBytes: envInt('MAX_SECRET_BYTES', 8_192),
  rateLimitPerMin: envInt('RATE_LIMIT_PER_MIN', 60),
  ipHashSalt: env('IP_HASH_SALT', 'change_me_too'),
} as const

export const IS_INSECURE_DEFAULT =
  apiKeys.includes('dev_change_me') || config.ipHashSalt === 'change_me_too'
