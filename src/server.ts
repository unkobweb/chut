import { randomBytes } from 'node:crypto'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { api } from './api.js'
import { IS_INSECURE_DEFAULT, config } from './config.js'
import { startSweeper } from './db.js'
import { openapi } from './openapi.js'
import { renderIndex } from './page.js'
import { pub } from './public.js'

const app = new Hono()

/**
 * Journalisation volontairement minimale: methode, chemin, statut, duree.
 * Ni corps de requete, ni en-tetes, ni query string — un secret ne doit jamais
 * pouvoir atterrir dans un fichier de log.
 */
app.use('*', async (c, next) => {
  const started = Date.now()
  await next()
  const path = c.req.path.replace(/^\/s\/[^/]+/, '/s/:id').replace(/^\/v1\/requests\/[^/]+/, '/v1/requests/:id')
  console.log(`${c.req.method} ${path} ${c.res.status} ${Date.now() - started}ms`)
})

app.get('/', (c) => {
  const n = randomBytes(16).toString('base64')
  c.header('Content-Type', 'text/html; charset=utf-8')
  c.header('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${n}'`)
  return c.body(renderIndex(n))
})

app.get('/healthz', (c) => c.json({ ok: true, service: 'chut', version: '0.1.0' }))
app.get('/openapi.json', (c) => c.json(openapi))

app.route('/v1', api)
app.route('/', pub)

app.notFound((c) => c.json({ error: 'not_found' }, 404))

app.onError((err, c) => {
  console.error(`Erreur non geree: ${err.message}`)
  return c.json({ error: 'internal_error', message: 'Erreur interne.' }, 500)
})

startSweeper()

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`chut ecoute sur http://localhost:${info.port}  (public: ${config.baseUrl})`)
  if (IS_INSECURE_DEFAULT) {
    console.warn(
      '\n  ATTENTION: valeurs par defaut detectees (API_KEYS et/ou IP_HASH_SALT).\n' +
        '  Ne deploie pas en l\'etat. Voir .env.example.\n',
    )
  }
  if (config.baseUrl.startsWith('http://') && !config.baseUrl.includes('localhost')) {
    console.warn(
      "  ATTENTION: BASE_URL n'est pas en HTTPS. La cle de chiffrement circule dans l'URL:\n" +
        '  sers ce service derriere TLS en production.\n',
    )
  }
})
