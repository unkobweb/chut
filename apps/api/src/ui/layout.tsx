import type { Child } from 'hono/jsx'
import type { Locale } from './i18n.js'
import { stylesheet } from './styles.js'

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
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: stylesheet() }} />
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
