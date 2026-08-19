import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Child } from 'hono/jsx'
import type { Locale } from './i18n.js'

/**
 * Tailwind output, compiled by `npm run build:css` and inlined.
 *
 * Inlined rather than served as a file on purpose: the whole page must arrive in
 * a single request. Someone opens this from a chat app on mobile data with a
 * countdown running — a second round trip for a stylesheet is a second chance to
 * fail.
 */
const CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'styles.generated.css')

let cachedCss: string | null = null
function styles(): string {
  if (cachedCss === null) {
    try {
      cachedCss = readFileSync(CSS_PATH, 'utf8')
    } catch {
      throw new Error(
        `Stylesheet not found at ${CSS_PATH}. Run "npm run build:css" before starting the server.`,
      )
    }
  }
  return cachedCss
}

export function Layout({
  title,
  nonce,
  locale,
  children,
  script,
}: {
  title: string
  nonce: string
  locale: Locale
  children: Child
  script?: string
}) {
  return (
    <html lang={locale.lang} dir={locale.dir}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex,nofollow,noarchive" />
        <meta name="referrer" content="no-referrer" />
        <title>{title}</title>
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: styles() }} />
      </head>
      <body class="font-sans antialiased">
        <main class="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-6 sm:px-6">
          {children}
        </main>
        {script ? <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} /> : null}
      </body>
    </html>
  )
}

export function render(node: unknown): string {
  return `<!doctype html>${String(node)}`
}
