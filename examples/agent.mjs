/**
 * Client minimal cote agent : demander un secret a son humain et l'utiliser.
 *
 *   node examples/agent.mjs
 *
 * A recopier dans ton bot Telegram / n8n / boucle maison.
 */

const BASE = process.env.HANDOFF_URL ?? 'http://localhost:8787'
const API_KEY = process.env.HANDOFF_API_KEY ?? 'dev_change_me'

/**
 * Cree une demande. Renvoie l'URL a montrer a l'humain et les jetons a garder secrets.
 */
export async function askHuman({ requester, label, purpose, ttlSeconds = 900 }) {
  const res = await fetch(`${BASE}/v1/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ requester, label, purpose, ttl_seconds: ttlSeconds }),
  })
  if (!res.ok) throw new Error(`handoff: creation refusee (${res.status})`)
  return res.json()
}

/**
 * Sonde jusqu'a ce que l'humain ait rempli, ou jusqu'a expiration.
 * Renvoie la demande, ou null si elle n'a jamais ete remplie.
 */
export async function waitForFill({ id, poll_token }, { intervalMs = 3000 } = {}) {
  for (;;) {
    const res = await fetch(`${BASE}/v1/requests/${id}`, {
      headers: { authorization: `Bearer ${API_KEY}`, 'x-poll-token': poll_token },
    })
    const req = await res.json()

    if (req.status === 'filled') return req
    if (req.status !== 'pending') return null

    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

/** Lit le secret. Il est detruit juste apres : n'appelle ceci qu'au moment de t'en servir. */
export async function reveal({ id, poll_token, encryption_key }) {
  const res = await fetch(`${BASE}/v1/requests/${id}/reveal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ poll_token, encryption_key }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`handoff: revelation impossible (${data.error})`)
  return data.secret
}

// --- exemple d'usage ---------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const req = await askHuman({
    requester: 'Assistant Telegram',
    label: 'Cle API Gmail',
    purpose: 'Lire tes 20 derniers mails pour te faire un resume chaque matin',
    ttlSeconds: 600,
  })

  // Seule cette ligne part vers l'utilisateur.
  console.log(`\nJ'ai besoin de ta cle API Gmail. Colle-la ici, le lien expire dans 10 min :`)
  console.log(`${req.url}\n`)

  console.log('En attente...')
  const filled = await waitForFill(req)

  if (!filled) {
    console.log('Personne n’a rempli le lien a temps.')
    process.exit(0)
  }

  // Signal a remonter a l'humain : un lien ouvert plusieurs fois merite une question.
  if (filled.opened_count > 1) {
    console.log(`Attention : ce lien a ete ouvert ${filled.opened_count} fois. C'etait bien toi ?`)
  }

  const secret = await reveal({ ...req })
  console.log(`Recu (${secret.length} caracteres). Je m'en sers maintenant, il est deja detruit.`)
  // ... utiliser `secret` ici, sans jamais le reafficher a l'utilisateur.
}
