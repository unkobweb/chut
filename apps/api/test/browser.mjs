/**
 * Verification in a real browser: the page's own JavaScript does the encrypting,
 * not the test script. Also produces screenshots.
 *
 * Usage: node test/browser.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import Database from 'better-sqlite3'

const BASE = process.env.BASE ?? 'http://localhost:8787'
const SECRET = 'sk-gmail-b7f2a91c33ed4400bee1'
const OUT = 'screenshots'

mkdirSync(OUT, { recursive: true })

const api = (path, opts = {}) =>
  fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...opts.headers },
  })

let failed = 0
const check = (name, ok, detail = '') => {
  // Detail is diagnostic: only useful when something failed.
  const suffix = !ok && detail ? ` — ${detail}` : ''
  console.log(`  ${ok ? '\x1b[32mOK\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'} ${name}${suffix}`)
  if (!ok) failed++
}

const created = await (
  await api('/v1/requests', {
    method: 'POST',
    body: JSON.stringify({
      requester: 'Telegram Assistant',
      label: 'Gmail API key',
      purpose: 'Read your last 20 emails to send you a summary every morning',
      ttl_seconds: 900 }) })
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

// What actually goes over the wire from the browser.
let submittedBody = null
page.on('request', (r) => {
  if (r.method() === 'POST' && r.url().includes('/s/')) submittedBody = r.postData()
})

console.log('\n\x1b[1mPage rendering\x1b[0m')
await page.goto(created.url, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${OUT}/1-form.png`, fullPage: true })

check('the page has a document heading', (await page.textContent('h1')).length > 20)
check(
  'the request panel names what is being asked for',
  (await page.content()).includes('Gmail API key'),
)
check(
  'and says the page cannot verify it',
  (await page.content()).includes('cannot verify'),
)
check('purpose is shown', (await page.content()).includes('summary every morning'))
const countdown = await page.textContent('#countdown')
// The countdown now renders as m:ss in tabular figures, terminal style.
check('countdown is running', /^\d+:\d{2}$/.test(countdown.trim()), countdown)
check('no JS error on load', pageErrors.length === 0, pageErrors.join(' | '))
check('no CSP violation', cspViolations.length === 0, cspViolations.join(' | '))

// The beacon is what makes opened_count mean anything. If it never fires, the
// counter sits at zero forever and the tamper signal is dead in the other
// direction — silently, which is worse than crying wolf.
await page.waitForTimeout(500)
const counters = await (
  await api(`/v1/requests/${created.id}`, { headers: { 'x-poll-token': created.poll_token } })
).json()
check(
  'a real browser render reports exactly one open',
  counters.opened_count === 1,
  `opened_count is ${counters.opened_count} — the beacon did not fire`,
)
check(
  'and the raw fetch is counted separately',
  counters.fetched_count >= 1,
  `fetched_count is ${counters.fetched_count}`,
)

// The fragment key must never leave the browser.
const keyLeaked = await page.evaluate(() => {
  const key = location.hash.slice(1)
  return key.length > 0 && document.documentElement.outerHTML.includes(key)
})
check('the key is absent from the rendered DOM', !keyLeaked)

console.log('\n\x1b[1mInput and in-browser encryption\x1b[0m')
await page.fill('#secret', SECRET)
await page.click('#toggle')
await page.screenshot({ path: `${OUT}/2-masked-input.png`, fullPage: true })

await page.click('#submit')
await page.waitForURL(/\/done$/, { timeout: 10_000 })
await page.screenshot({ path: `${OUT}/3-confirmation.png`, fullPage: true })

check('redirects to the confirmation page', page.url().endsWith('/done'))
check(
  'the confirmation URL carries neither the id nor the key',
  !page.url().includes(created.id) && !page.url().includes('#'),
  page.url(),
)
check('the request body carries no plaintext secret', !String(submittedBody).includes(SECRET))
check('the request body does carry ciphertext', /"ciphertext"/.test(String(submittedBody)))

console.log('\n\x1b[1mAgent retrieval\x1b[0m')
const revealed = await (
  await api(`/v1/requests/${created.id}/reveal`, {
    method: 'POST',
    body: JSON.stringify({ poll_token: created.poll_token, encryption_key: created.encryption_key }) })
).json()
check('the server decrypts what the browser encrypted', revealed.secret === SECRET, revealed.error ?? '')

console.log('\n\x1b[1mTerminal states\x1b[0m')
await page.goto(created.url)
await page.screenshot({ path: `${OUT}/4-consumed-link.png`, fullPage: true })
check('a reused link shows a terminal screen', (await page.textContent('h1')).length > 0)

// --- expiry bar ------------------------------------------------------------
// The bar derived its total from Date.now() at load, so it restarted full on
// every refresh however little time was left — the one thing it exists to show.
// Aged in the database rather than by waiting, so the check is instant.
console.log('\n\x1b[1mExpiry bar\x1b[0m')
{
  const aged = await (
    await api('/v1/requests', {
      method: 'POST',
      body: JSON.stringify({ requester: 'Bot', label: 'Key', ttl_seconds: 900 }) })
  ).json()

  // Must be the same file the server under test is using.
  const db = new Database(process.env.DB_PATH ?? './data/chut.db')
  const readBar = async (elapsedRatio) => {
    const now = Date.now()
    const span = 900_000
    db.prepare('UPDATE requests SET created_at = ?, expires_at = ? WHERE id = ?').run(
      now - span * elapsedRatio,
      now + span * (1 - elapsedRatio),
      aged.id,
    )
    const view = await browser.newPage()
    await view.goto(aged.url, { waitUntil: 'networkidle' })
    await view.waitForTimeout(300)
    const bar = await view.textContent('#countdown-bar')
    await view.close()
    return [...bar].filter((ch) => ch === '\u2593').length
  }

  const fresh = await readBar(0)
  const half = await readBar(0.5)
  const nearly = await readBar(0.9)
  db.close()

  check('a fresh link shows a full bar', fresh === 16, `${fresh}/16`)
  check(
    'a link half spent shows about half a bar',
    Math.abs(half - 8) <= 1,
    `${half}/16 after half the window — the bar ignores elapsed time`,
  )
  check('a nearly expired link shows a nearly empty bar', nearly <= 3, `${nearly}/16`)
}

// --- cross-site arrival ------------------------------------------------------
// A human reaches this link by clicking it in Telegram web, Slack or an email
// client, so the navigation is legitimately Sec-Fetch-Site: cross-site. Blocking
// cross-site *writes* must not block cross-site *arrivals* — that would reject
// the exact journey the service exists for.
console.log('\n\x1b[1mCross-site arrival\x1b[0m')
{
  const fresh = await (
    await api('/v1/requests', {
      method: 'POST',
      body: JSON.stringify({ requester: 'Telegram Assistant', label: 'Stripe key' }) })
  ).json()

  // A different origin: distinct host, so a genuine cross-site navigation.
  const referrer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><a id="go" href="${fresh.url}">open</a>`)
  })
  await new Promise((r) => referrer.listen(8899, '127.0.0.1', r))

  try {
    const visitor = await browser.newPage()
    const sentHeaders = []
    visitor.on('request', (r) => {
      if (r.url().startsWith(BASE) && r.method() === 'POST') sentHeaders.push(r.headers())
    })

    await visitor.goto('http://127.0.0.1:8899/')
    await visitor.click('#go')
    await visitor.waitForLoadState('networkidle')

    check(
      'a cross-site click still reaches the form',
      (await visitor.content()).includes('Stripe key'),
      visitor.url(),
    )

    await visitor.fill('#secret', 'sk-arrived-from-elsewhere')
    await visitor.click('#submit')
    await visitor.waitForURL(/\/done$/, { timeout: 10_000 })
    check('and can still submit from there', visitor.url().endsWith('/done'))

    const posted = await (
      await api(`/v1/requests/${fresh.id}/reveal`, {
        method: 'POST',
        body: JSON.stringify({
          poll_token: fresh.poll_token,
          encryption_key: fresh.encryption_key }) })
    ).json()
    check(
      'the secret arrives intact after a cross-site journey',
      posted.secret === 'sk-arrived-from-elsewhere',
      posted.error ?? '',
    )

    const state = await (
      await api(`/v1/requests/${fresh.id}`, { headers: { 'x-poll-token': fresh.poll_token } })
    ).json()
    check('and the open beacon still fired', state.opened_count === 1, `opened_count ${state.opened_count}`)

    await visitor.close()
  } finally {
    await new Promise((r) => referrer.close(r))
  }
}

await browser.close()
console.log(failed === 0 ? '\n\x1b[32mAll good.\x1b[0m\n' : `\n\x1b[31m${failed} failure(s).\x1b[0m\n`)
process.exit(failed === 0 ? 0 : 1)
