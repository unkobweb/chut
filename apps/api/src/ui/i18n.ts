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
  expires: 'expires in',
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

/** Français — traduit, non relu par un locuteur natif. Voir REVIEW. */
const fr: Messages = {
  tagline: 'dépôt de secret à usage unique · sans compte · sans historique',
  intro: 'Un assistant vous demande un identifiant confidentiel.',
  wants: 'demande',
  unverified: 'Écrit par l’assistant. Cette page ne peut pas le vérifier.',
  inputLabel: 'collez le secret',
  paste: 'coller',
  pasteFailed: 'Votre navigateur a refusé l’accès au presse-papier — collez la valeur vous-même.',
  show: 'afficher',
  hide: 'masquer',
  submit: 'chiffrer et envoyer',
  submitEncrypting: 'chiffrement…',
  submitSending: 'envoi…',
  stepScrambled: 'brouillé dans votre navigateur',
  stepSending: 'envoi de la copie scellée…',
  keepOpen: 'Gardez cet onglet ouvert un instant. Le secret en clair ne quitte jamais cette page.',
  noteEncrypted: 'Brouillé dans votre navigateur — le serveur ne stocke qu’un texte qu’il ne peut pas lire.',
  noteSingleUse: 'Une valeur, une fois — puis ce lien est mort.',
  expires: 'expire dans',
  expired: 'expiré',
  errorEmpty: 'Le champ est vide.',
  errorTooLong: 'C’est trop long pour être envoyé (limite {max} octets).',
  errorGeneric: 'Quelque chose s’est mal passé.',
  failedTitle: 'L’envoi a échoué.',
  failedBody: 'La connexion a lâché avant l’arrivée de la copie scellée. Rien n’a été exposé — le secret n’a jamais quitté cette page en clair. Il est toujours ci-dessous.',
  stillHere: 'votre secret — toujours là',
  tryAgain: 'réessayer',
  retryNote: 'Si ça continue d’échouer, vérifiez votre connexion. Le lien reste valide jusqu’à la fin du compte à rebours.',
  deliveredTitle: 'Transmis, scellé.',
  deliveredBody: 'Le secret est arrivé à destination. L’assistant qui l’a demandé peut maintenant le lire — une fois.',
  deliveredNote: 'Cette page ne sait pas et n’affiche pas ce qui a été envoyé. Vous pouvez fermer cet onglet.',
  brokenTitle: 'Ce lien est incomplet.',
  brokenBody: 'Une partie — celle qui fait le brouillage — a été coupée lors de la copie. Ce n’est pas votre faute, et rien n’a été envoyé.',
  brokenAction: 'Demandez un nouveau lien à la personne qui vous l’a envoyé, ou réessayez en le copiant en entier.',
  expiredTitle: 'Ce lien a expiré.',
  expiredBody: 'Sa fenêtre de validité est close. Rien n’a été envoyé.',
  expiredAction: 'Si vous voulez toujours transmettre le secret, demandez à l’assistant d’en refaire la demande.',
  filledTitle: 'Déjà utilisé.',
  filledBody: 'Quelqu’un a déjà transmis une valeur par ce lien. Chaque lien ne fonctionne qu’une seule fois.',
  filledWarn: 'Si ce n’était pas vous, prévenez la personne qui vous l’a envoyé — quelqu’un d’autre a peut-être vu ce lien.',
  cancelledTitle: 'Demande retirée.',
  cancelledBody: 'L’assistant qui a créé cette demande l’a annulée avant que quoi que ce soit ne parte. Il n’y a rien à faire ici.',
  cancelledNote: 'Vous pouvez fermer cet onglet.',
  notFoundTitle: 'Rien ici.',
  notFoundBody: 'Ce lien ne correspond à aucune demande. Il a peut-être été mal recopié, ou il est si ancien que la demande a été effacée.',
  notFoundAction: 'Si vous en attendiez une, demandez un nouveau lien.',
  indexBlurb: 'Un agent IA demande un secret à son humain via un lien éphémère. Le secret est chiffré dans le navigateur : le serveur ne le voit jamais en clair.',
  indexNothing: 'Il n’y a rien à voir ici sans un lien de demande valide.',
}

/** Español — traducido, sin revisión de un hablante nativo. Ver REVIEW. */
const es: Messages = {
  tagline: 'entrega de secreto de un solo uso · sin cuenta · sin historial',
  intro: 'Un asistente te pide una credencial.',
  wants: 'quiere',
  unverified: 'Escrito por el asistente. Esta página no puede verificarlo.',
  inputLabel: 'pega el secreto',
  paste: 'pegar',
  pasteFailed: 'Tu navegador no permitió leer el portapapeles — pégalo tú mismo.',
  show: 'mostrar',
  hide: 'ocultar',
  submit: 'cifrar y enviar',
  submitEncrypting: 'cifrando…',
  submitSending: 'enviando…',
  stepScrambled: 'cifrado en tu navegador',
  stepSending: 'enviando la copia sellada…',
  keepOpen: 'Mantén esta pestaña abierta un momento. El secreto sin cifrar nunca sale de esta página.',
  noteEncrypted: 'Cifrado en tu navegador — el servidor solo guarda un texto que no puede leer.',
  noteSingleUse: 'Un valor, una vez — y este enlace muere.',
  expires: 'expira en',
  expired: 'expirado',
  errorEmpty: 'El campo está vacío.',
  errorTooLong: 'Es demasiado largo para enviarlo (límite {max} bytes).',
  errorGeneric: 'Algo salió mal.',
  failedTitle: 'No se envió.',
  failedBody: 'La conexión se cortó antes de que llegara la copia sellada. No se expuso nada — el secreto nunca salió de esta página sin cifrar. Sigue abajo.',
  stillHere: 'tu secreto — sigue aquí',
  tryAgain: 'reintentar',
  retryNote: 'Si sigue fallando, revisa tu conexión. El enlace sigue válido hasta que se agote el tiempo de arriba.',
  deliveredTitle: 'Entregado, sellado.',
  deliveredBody: 'El secreto llegó a su destino. El asistente que lo pidió ya puede leerlo — una vez.',
  deliveredNote: 'Esta página no sabe ni muestra qué se envió. Puedes cerrar esta pestaña.',
  brokenTitle: 'Este enlace está incompleto.',
  brokenBody: 'Le falta la parte que hace el cifrado, que se cortó al copiarlo. No es culpa tuya, y no se envió nada.',
  brokenAction: 'Pide un enlace nuevo a quien te lo envió, o intenta copiarlo entero otra vez.',
  expiredTitle: 'Este enlace ha expirado.',
  expiredBody: 'Su ventana de validez se cerró. No se envió nada.',
  expiredAction: 'Si aún quieres compartir el secreto, pídele al asistente que lo solicite de nuevo.',
  filledTitle: 'Ya se usó.',
  filledBody: 'Alguien ya envió un valor por este enlace. Cada enlace funciona exactamente una vez.',
  filledWarn: 'Si no fuiste tú, avisa a quien te lo envió — puede que alguien más haya visto este enlace.',
  cancelledTitle: 'Solicitud retirada.',
  cancelledBody: 'El asistente que creó esta solicitud la canceló antes de que se enviara nada. Aquí no hay nada que hacer.',
  cancelledNote: 'Puedes cerrar esta pestaña.',
  notFoundTitle: 'Aquí no hay nada.',
  notFoundBody: 'Este enlace no corresponde a ninguna solicitud. Puede que se haya escrito mal, o que sea tan antiguo que ya se borró.',
  notFoundAction: 'Si esperabas una, pide un enlace nuevo.',
  indexBlurb: 'Un agente de IA le pide un secreto a su humano mediante un enlace efímero. El secreto se cifra en el navegador: el servidor nunca lo ve en claro.',
  indexNothing: 'Aquí no hay nada que ver sin un enlace de solicitud válido.',
}

/** Deutsch — übersetzt, nicht von Muttersprachlern geprüft. Siehe REVIEW. */
const de: Messages = {
  tagline: 'einmalige Geheimnisübergabe · kein Konto · kein Verlauf',
  intro: 'Ein Assistent bittet Sie um einen Zugangsschlüssel.',
  wants: 'möchte',
  unverified: 'Vom Assistenten verfasst. Diese Seite kann es nicht überprüfen.',
  inputLabel: 'Geheimnis einfügen',
  paste: 'einfügen',
  pasteFailed: 'Ihr Browser hat den Zugriff auf die Zwischenablage verweigert — fügen Sie es selbst ein.',
  show: 'zeigen',
  hide: 'verbergen',
  submit: 'verschlüsseln & senden',
  submitEncrypting: 'verschlüsseln…',
  submitSending: 'senden…',
  stepScrambled: 'in Ihrem Browser verschlüsselt',
  stepSending: 'versiegelte Kopie wird gesendet…',
  keepOpen: 'Lassen Sie diesen Tab kurz offen. Das unverschlüsselte Geheimnis verlässt diese Seite nie.',
  noteEncrypted: 'In Ihrem Browser verschlüsselt — der Server speichert nur Text, den er nicht lesen kann.',
  noteSingleUse: 'Ein Wert, einmal — danach ist dieser Link tot.',
  expires: 'läuft ab in',
  expired: 'abgelaufen',
  errorEmpty: 'Das Feld ist leer.',
  errorTooLong: 'Das ist zu lang zum Senden (Grenze {max} Bytes).',
  errorGeneric: 'Etwas ist schiefgelaufen.',
  failedTitle: 'Es wurde nicht gesendet.',
  failedBody: 'Die Verbindung brach ab, bevor die versiegelte Kopie ankam. Nichts wurde preisgegeben — das Geheimnis hat diese Seite nie unverschlüsselt verlassen. Es steht noch unten.',
  stillHere: 'Ihr Geheimnis — noch da',
  tryAgain: 'erneut versuchen',
  retryNote: 'Wenn es weiter fehlschlägt, prüfen Sie Ihre Verbindung. Der Link bleibt gültig, bis die Zeit oben abgelaufen ist.',
  deliveredTitle: 'Zugestellt, versiegelt.',
  deliveredBody: 'Das Geheimnis ist angekommen. Der Assistent, der danach gefragt hat, kann es jetzt lesen — einmal.',
  deliveredNote: 'Diese Seite weiß nicht und zeigt nicht, was gesendet wurde. Sie können diesen Tab schließen.',
  brokenTitle: 'Dieser Link ist unvollständig.',
  brokenBody: 'Der Teil, der verschlüsselt, wurde beim Kopieren abgeschnitten. Das ist nicht Ihre Schuld, und es wurde nichts gesendet.',
  brokenAction: 'Bitten Sie um einen neuen Link, oder kopieren Sie den ganzen noch einmal.',
  expiredTitle: 'Dieser Link ist abgelaufen.',
  expiredBody: 'Sein Gültigkeitsfenster ist geschlossen. Es wurde nichts gesendet.',
  expiredAction: 'Wenn Sie das Geheimnis noch teilen möchten, bitten Sie den Assistenten, erneut danach zu fragen.',
  filledTitle: 'Bereits benutzt.',
  filledBody: 'Über diesen Link wurde bereits ein Wert gesendet. Jeder Link funktioniert genau einmal.',
  filledWarn: 'Wenn Sie das nicht waren, sagen Sie es der Person, die ihn geschickt hat — vielleicht hat jemand anderes diesen Link gesehen.',
  cancelledTitle: 'Anfrage zurückgezogen.',
  cancelledBody: 'Der Assistent, der diese Anfrage erstellt hat, hat sie abgebrochen, bevor etwas gesendet wurde. Hier gibt es nichts zu tun.',
  cancelledNote: 'Sie können diesen Tab schließen.',
  notFoundTitle: 'Hier ist nichts.',
  notFoundBody: 'Dieser Link gehört zu keiner Anfrage. Vielleicht wurde er falsch übertragen, oder er ist so alt, dass die Anfrage gelöscht wurde.',
  notFoundAction: 'Wenn Sie eine erwartet haben, bitten Sie um einen neuen Link.',
  indexBlurb: 'Ein KI-Agent bittet seinen Menschen über einen kurzlebigen Link um ein Geheimnis. Das Geheimnis wird im Browser verschlüsselt: der Server sieht es nie im Klartext.',
  indexNothing: 'Ohne gültigen Anfrage-Link gibt es hier nichts zu sehen.',
}

export const MESSAGES: Record<string, Messages> = { en, fr, es, de }

/**
 * Who has actually read each translation end to end.
 *
 * Recorded rather than assumed. This page is where someone decides whether to
 * hand over a credential, and the English was written with some care — "scrambled"
 * instead of "encrypted", "this page cannot verify it" rather than a reassurance.
 * A literal translation loses exactly the part that matters, and a translation
 * nobody has read is a claim we should not make silently.
 *
 * A stale translation is the worse failure: the English can change and leave a
 * comforting sentence behind that no longer describes what the page does. When
 * you touch the English, walk this list.
 */
export const REVIEW: Record<string, { reviewedBy: string | null; note?: string }> = {
  en: { reviewedBy: 'source' },
  fr: { reviewedBy: null, note: 'Machine-written. Tone not checked by a native speaker.' },
  es: { reviewedBy: null, note: 'Machine-written. Tone not checked by a native speaker.' },
  de: { reviewedBy: null, note: 'Machine-written. Tone not checked by a native speaker.' },
}

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
