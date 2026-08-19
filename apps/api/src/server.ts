import { randomBytes } from 'node:crypto'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { api } from './api.js'
import { IS_INSECURE_DEFAULT, config } from './config.js'
import { startSweeper } from './db.js'
import { openapi } from './openapi.js'
import { resolveLocale } from './ui/i18n.js'
import { IndexPage } from './ui/pages.js'
import { ensureStylesheet } from './ui/styles.js'
import { pub } from './public.js'

const app = new Hono()

/**
 * Deliberately minimal logging: method, path, status, duration.
 * No request body, no headers, no query string — a secret must never be able to
 * land in a log file. The path is normalised so request ids stay out too.
 */
app.use('*', async (c, next) => {
  const started = Date.now()
  await next()
  const path = c.req.path
    .replace(/^\/s\/[^/]+/, '/s/:id')
    .replace(/^\/v1\/requests\/[^/]+/, '/v1/requests/:id')
  console.log(`${c.req.method} ${path} ${c.res.status} ${Date.now() - started}ms`)
})

app.get('/', (c) => {
  const n = randomBytes(16).toString('base64')
  const locale = resolveLocale(c.req.header('accept-language'), c.req.query('lang'))
  c.header('Content-Type', 'text/html; charset=utf-8')
  c.header('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${n}'`)
  return c.body(IndexPage(n, locale, config.baseUrl))
})

app.get('/healthz', (c) => c.json({ ok: true, service: 'chut', version: '0.1.0' }))
app.get('/openapi.json', (c) => c.json(openapi))

app.route('/v1', api)
app.route('/', pub)

app.notFound((c) => c.json({ error: 'not_found' }, 404))

app.onError((err, c) => {
  console.error(`Unhandled error: ${err.message}`)
  return c.json({ error: 'internal_error', message: 'Internal error.' }, 500)
})

ensureStylesheet()
startSweeper()

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`chut is listening on http://localhost:${info.port}  (public: ${config.baseUrl})`)
  if (IS_INSECURE_DEFAULT) {
    console.warn(
      '\n  WARNING: default values detected (API_KEYS and/or IP_HASH_SALT).\n' +
        '  Do not deploy as-is. See .env.example.\n',
    )
  }
  if (config.baseUrl.startsWith('http://') && !config.baseUrl.includes('localhost')) {
    console.warn(
      '  WARNING: BASE_URL is not HTTPS. The encryption key travels inside the URL:\n' +
        '  serve this behind TLS in production.\n',
    )
  }
})
