/**
 * Sanitises the three fields the human actually reads on the form page:
 * requester, label and purpose.
 *
 * These are the only things standing between a human and a bad decision, and an
 * agent under prompt injection controls all three. HTML escaping stops the parser
 * from being fooled; it does nothing about the reader being fooled. A right-to-
 * left override makes a string render in an order it was not written in, and a
 * zero-width space hides a word boundary — neither is caught by escaping `<`.
 *
 * The rule: whitespace is normalised, anything invisible that is not whitespace
 * is refused. Refused rather than stripped, because silently altering the text a
 * human is about to make a trust decision on is its own kind of lie — and the
 * agent gets told, so a broken prompt template surfaces instead of festering.
 *
 * Deliberately NOT refused: U+200C and U+200D (zero-width non-joiner and joiner).
 * They carry meaning in Persian, Arabic and Indic scripts and hold emoji
 * sequences together. Blocking them would break legitimate names for a large part
 * of the world, and they cannot reorder text.
 *
 * Not addressed here: homoglyphs — Cyrillic "а" inside "Gооgle" renders as itself,
 * so no invisible character is involved. That needs confusable-script detection
 * and is tracked separately.
 */

/** Invisible, and not whitespace. Every one of these can deceive a reader. */
const DECEPTIVE = new RegExp(
  [
    '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', // C0 controls, minus tab/LF/CR
    '[\\u007F-\\u009F]', // DEL and C1 controls
    '[\\u200B\\u200E\\u200F]', // zero-width space, LRM, RLM
    '[\\u202A-\\u202E]', // bidi embeddings and overrides
    '[\\u2066-\\u2069]', // bidi isolates
    '[\\u2028\\u2029]', // line and paragraph separators
    '[\\uFEFF]', // byte order mark
  ].join('|'),
)

export interface SanitizeResult {
  ok: boolean
  value: string
  reason?: string
}

export function sanitizeDisplayText(input: string): SanitizeResult {
  // Compose first, so "e" + combining acute and "é" are the same string: what is
  // stored is what renders, and the length limit cannot be gamed with combining
  // marks stacked on a single visible character.
  const normalised = input.normalize('NFC')

  if (DECEPTIVE.test(normalised)) {
    return {
      ok: false,
      value: '',
      reason:
        'contains invisible or text-direction control characters. These can make text ' +
        'render differently from how it is written, and this text is shown to a human ' +
        'deciding whether to trust the request.',
    }
  }

  // Tab, newline and carriage return are genuine whitespace: HTML collapses them
  // anyway, so normalise rather than reject. These fields are single-line.
  return { ok: true, value: normalised.replace(/\s+/gu, ' ').trim() }
}
