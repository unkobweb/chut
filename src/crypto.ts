import { createHash, randomBytes, timingSafeEqual, webcrypto } from 'node:crypto'

const subtle = webcrypto.subtle

export function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64url')
}

export function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url')
}

export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes))
}

/**
 * Request id: short, readable, free of look-alike characters.
 * The alphabet has exactly 32 entries and 256 % 32 === 0, so the modulo
 * introduces no bias. Do not extend the alphabet without revisiting that.
 */
export function newRequestId(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const raw = randomBytes(16)
  let out = ''
  for (const byte of raw) out += alphabet[byte % alphabet.length]
  return out
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** Constant-time comparison of two hex strings of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/**
 * Decrypts what the browser encrypted with AES-GCM 256.
 * The key comes from the agent (URL fragment), never from storage: a database
 * dump on its own is not enough to read any secret.
 */
export async function decryptSecret(
  keyB64url: string,
  ciphertextB64: string,
  ivB64: string,
): Promise<string> {
  const keyBytes = fromB64url(keyB64url)
  if (keyBytes.length !== 32) throw new Error('Invalid key: expected 32 bytes')

  const key = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(ivB64, 'base64') },
    key,
    Buffer.from(ciphertextB64, 'base64'),
  )
  return new TextDecoder().decode(plain)
}

/** AES-256 key destined for the URL fragment. The server never persists it. */
export function newEncryptionKey(): string {
  return b64url(randomBytes(32))
}

export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 16)
}
