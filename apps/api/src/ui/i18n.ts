/**
 * Copy for the human-facing pages.
 *
 * English is the source. It is written for someone who does not know what an API
 * key is, and who may be surprised to be here at all — so it names the risk
 * plainly, says what cannot be verified, and repeats that walking away is free.
 *
 * Adding a language means adding one entry to MESSAGES. Nothing else changes.
 */

export interface Messages {
  tagline: string
  intro: string
  wants: string
  unverified: string
  inputLabel: string
  paste: string
  pasteFailed: string
  show: string
  hide: string
  submit: string
  submitEncrypting: string
  submitSending: string
  stepScrambled: string
  stepSending: string
  keepOpen: string
  noteEncrypted: string
  noteSingleUse: string
  expires: string
  expired: string
  errorEmpty: string
  errorTooLong: string
  errorGeneric: string
  failedTitle: string
  failedBody: string
  stillHere: string
  tryAgain: string
  retryNote: string
  deliveredTitle: string
  deliveredBody: string
  deliveredNote: string
  brokenTitle: string
  brokenBody: string
  brokenAction: string
  expiredTitle: string
  expiredBody: string
  expiredAction: string
  filledTitle: string
  filledBody: string
  filledWarn: string
  cancelledTitle: string
  cancelledBody: string
  cancelledNote: string
  notFoundTitle: string
  notFoundBody: string
  notFoundAction: string
  indexBlurb: string
  indexNothing: string
}

const en: Messages = {
  tagline: 'one-time secret drop · no account · no history',
  /** One line. The panel below already says who, what and why, and the
   * "cannot verify" note already says to read it critically — spelling all of
   * that out again pushed the button off the screen. */
  intro: 'An assistant is asking you for a credential.',
  /** Reads as one sentence: <requester> wants <label>. */
  wants: 'wants',
  unverified: 'Written by the assistant. This page cannot verify it.',
  inputLabel: 'paste the secret',
  paste: 'paste',
  pasteFailed: 'Your browser would not let this page read the clipboard — paste it yourself.',
  show: 'show',
  hide: 'hide',
  submit: 'encrypt & send',
  submitEncrypting: 'scrambling…',
  submitSending: 'sending…',
  stepScrambled: 'scrambled in your browser',
  stepSending: 'sending the sealed copy…',
  keepOpen: 'Keep this tab open for a moment. The unscrambled secret never leaves this page.',
  noteEncrypted: 'Scrambled in your browser — the server only stores text it cannot read.',
  noteSingleUse: 'One value, once — then this link is dead.',
  expires: 'expires',
  expired: 'expired',
  errorEmpty: 'The field is empty.',
  errorTooLong: 'That is too long to send (limit {max} bytes).',
  errorGeneric: 'Something went wrong.',
  failedTitle: 'It didn’t send.',
  failedBody:
    'The connection dropped before the sealed copy arrived. Nothing was exposed — the secret never left this page unscrambled. It is still below.',
  stillHere: 'your secret — still here',
  tryAgain: 'try again',
  retryNote:
    'If it keeps failing, check your connection. The link stays valid until the timer above runs out.',
  deliveredTitle: 'Delivered, sealed.',
  deliveredBody:
    'The secret arrived at its destination. The assistant that asked for it can now read it — once.',
  deliveredNote: 'This page doesn’t know or show what was sent. You can close this tab.',
  brokenTitle: 'This link is incomplete.',
  brokenBody:
    'Part of it — the piece that does the scrambling — got cut off when it was copied. That’s not your fault, and nothing was sent.',
  brokenAction: 'Ask whoever sent it for a fresh link, or try copying the whole thing again.',
  expiredTitle: 'This link has expired.',
  expiredBody: 'Its validity window has closed. Nothing was sent.',
  expiredAction: 'If you still want to share the secret, ask the assistant to request it again.',
  filledTitle: 'Already used.',
  filledBody:
    'Someone has already submitted a value through this link. Each link works exactly once.',
  filledWarn:
    'If that wasn’t you, tell whoever sent you here — it may mean someone else saw this link.',
  cancelledTitle: 'Request withdrawn.',
  cancelledBody:
    'The assistant that created this request cancelled it before anything was sent. There’s nothing to do here.',
  cancelledNote: 'You can close this tab.',
  notFoundTitle: 'Nothing here.',
  notFoundBody:
    'This link doesn’t match any request. It may have been mistyped, or it’s so old the request was erased.',
  notFoundAction: 'If you were expecting one, ask for a fresh link.',
  indexBlurb:
    'An AI agent asks its human for a secret through a short-lived link. The secret is encrypted in the browser: the server never sees it in the clear.',
  indexNothing: 'There is nothing to see here without a valid request link.',
}

export const MESSAGES: Record<string, Messages> = { en }

/** Scripts written right to left. The layout mirrors; agent content does not. */
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'yi'])

export interface Locale {
  lang: string
  dir: 'ltr' | 'rtl'
  t: Messages
}

export function resolveLocale(acceptLanguage: string | undefined, override?: string): Locale {
  const wanted: string[] = []

  if (override) wanted.push(override.toLowerCase())

  // Accept-Language, best quality first. Malformed input simply yields nothing.
  if (acceptLanguage) {
    wanted.push(
      ...acceptLanguage
        .split(',')
        .map((part) => {
          const [tag = '', ...params] = part.trim().split(';')
          const q = params.find((p) => p.trim().startsWith('q='))
          return { tag: tag.trim().toLowerCase(), q: q ? Number.parseFloat(q.split('=')[1] ?? '0') : 1 }
        })
        .filter((entry) => entry.tag && Number.isFinite(entry.q))
        .sort((a, b) => b.q - a.q)
        .map((entry) => entry.tag),
    )
  }

  for (const tag of wanted) {
    const base = tag.split('-')[0] ?? ''
    const messages = MESSAGES[tag] ?? MESSAGES[base]
    if (messages) {
      return {
        lang: MESSAGES[tag] ? tag : base,
        dir: RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr',
        t: messages,
      }
    }
  }

  return { lang: 'en', dir: 'ltr', t: en }
}

export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    key in values ? String(values[key]) : whole,
  )
}
