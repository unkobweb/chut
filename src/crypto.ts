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

/** Identifiant de demande: court, lisible, sans caractere ambigu. */
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

/** Comparaison a temps constant de deux chaines hexadecimales de meme longueur. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/**
 * Dechiffre ce que le navigateur a chiffre en AES-GCM 256.
 * La cle vient de l'agent (fragment d'URL), jamais du stockage: une copie
 * de la base de donnees seule ne permet pas de lire les secrets.
 */
export async function decryptSecret(
  keyB64url: string,
  ciphertextB64: string,
  ivB64: string,
): Promise<string> {
  const keyBytes = fromB64url(keyB64url)
  if (keyBytes.length !== 32) throw new Error('Cle invalide: 32 octets attendus')

  const key = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(ivB64, 'base64') },
    key,
    Buffer.from(ciphertextB64, 'base64'),
  )
  return new TextDecoder().decode(plain)
}

/** Cle AES-256 destinee au fragment d'URL. Le serveur ne la conserve jamais. */
export function newEncryptionKey(): string {
  return b64url(randomBytes(32))
}

export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 16)
}
