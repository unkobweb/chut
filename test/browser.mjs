/**
 * Verification dans un vrai navigateur: c'est le JavaScript de la page qui
 * chiffre, pas le script de test. Produit aussi des captures d'ecran.
 *
 * Usage: node test/browser.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:8787'
const KEY = process.env.API_KEY ?? 'dev_change_me'
const SECRET = 'sk-gmail-b7f2a91c33ed4400bee1'
const OUT = 'screenshots'

mkdirSync(OUT, { recursive: true })

const api = (path, opts = {}) =>
  fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}`, ...opts.headers },
  })

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '\x1b[32mOK\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

const created = await (
  await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({
      requester: 'Assistant Telegram',
      label: 'Cle API Gmail',
      purpose: 'Lire tes 20 derniers mails pour te faire un resume chaque matin',
      ttl_seconds: 900,
    }),
  })
).json()

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
)
const page = await browser.newPage({ viewport: { width: 620, height: 900 } })

const cspViolations = []
page.on('console', (m) => {
  if (/Content Security Policy|Refused to/i.test(m.text())) cspViolations.push(m.text())
})
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

// Ce qui part reellement sur le reseau depuis le navigateur.
let submittedBody = null
page.on('request', (r) => {
  if (r.method() === 'POST' && r.url().includes('/s/')) submittedBody = r.postData()
})

console.log('\n\x1b[1mRendu de la page\x1b[0m')
await page.goto(created.url, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${OUT}/1-formulaire.png`, fullPage: true })

check('titre visible', (await page.textContent('h1')).includes('Cle API Gmail'))
check('motif affiche', (await page.content()).includes('resume chaque matin'))
const countdown = await page.textContent('#countdown')
check('compte a rebours actif', /min|s/.test(countdown), countdown)
check('aucune erreur JS au chargement', pageErrors.length === 0, pageErrors.join(' | '))
check('aucune violation CSP', cspViolations.length === 0, cspViolations.join(' | '))

// La cle du fragment ne doit jamais quitter le navigateur.
const keyLeaked = await page.evaluate(() => {
  const key = location.hash.slice(1)
  return key.length > 0 && document.documentElement.outerHTML.includes(key)
})
check('la cle ne figure pas dans le DOM rendu', !keyLeaked)

console.log('\n\x1b[1mSaisie et chiffrement navigateur\x1b[0m')
await page.fill('#secret', SECRET)
await page.click('#toggle')
await page.screenshot({ path: `${OUT}/2-saisie-masquee.png`, fullPage: true })

await page.click('#submit')
await page.waitForURL(/\/done$/, { timeout: 10_000 })
await page.screenshot({ path: `${OUT}/3-confirmation.png`, fullPage: true })

check('redirection vers la confirmation', page.url().endsWith('/done'))
check('le corps envoye ne contient pas le secret en clair', !String(submittedBody).includes(SECRET))
check('le corps envoye contient bien du chiffre', /"ciphertext"/.test(String(submittedBody)))

console.log('\n\x1b[1mRecuperation par l’agent\x1b[0m')
const revealed = await (
  await api(`/v1/requests/${created.id}/reveal`, {
    method: 'POST',
    body: JSON.stringify({ poll_token: created.poll_token, encryption_key: created.encryption_key }),
  })
).json()
check('le serveur dechiffre ce que le navigateur a chiffre', revealed.secret === SECRET, revealed.error ?? '')

console.log('\n\x1b[1mEtats de fin\x1b[0m')
await page.goto(created.url)
await page.screenshot({ path: `${OUT}/4-lien-consomme.png`, fullPage: true })
check('le lien reutilise affiche un ecran de fin', (await page.textContent('h1')).length > 0)

await browser.close()
console.log(failed === 0 ? '\n\x1b[32mTout est bon.\x1b[0m\n' : `\n\x1b[31m${failed} echec(s).\x1b[0m\n`)
process.exit(failed === 0 ? 0 : 1)
