import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, utimesSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The stylesheet is generated from the JSX by Tailwind and inlined into every
 * page: the whole document must arrive in one request, because someone opens
 * this from a chat app on mobile data with a countdown running.
 *
 * Generated output is not committed, which used to mean a design change could
 * land in the repository while the CSS on someone's disk stayed hours old — the
 * markup asking for classes that no longer existed in the stylesheet, and no
 * error anywhere to say so. So the file is rebuilt whenever it is older than the
 * sources it came from, rather than expecting anyone to remember.
 *
 * In a production image the CLI is not installed (devDependency, and the build
 * stage bakes the stylesheet in). There, a present file is used as-is and a
 * missing one is a hard failure — silently serving an unstyled credential form
 * would be worse than not starting.
 */
const UI_DIR = dirname(fileURLToPath(import.meta.url))
const OUTPUT = join(UI_DIR, 'styles.generated.css')
const INPUT = join(UI_DIR, 'theme.css')
const CLI = join(UI_DIR, '..', '..', '..', '..', 'node_modules', '.bin', 'tailwindcss')

/** Newest mtime among the files Tailwind reads. */
function newestSourceMtime(): number {
  let newest = 0
  for (const name of readdirSync(UI_DIR)) {
    if (name === 'styles.generated.css') continue
    if (!/\.(tsx?|css)$/.test(name)) continue
    newest = Math.max(newest, statSync(join(UI_DIR, name)).mtimeMs)
  }
  return newest
}

function isStale(): boolean {
  if (!existsSync(OUTPUT)) return true
  return statSync(OUTPUT).mtimeMs < newestSourceMtime()
}

let cached: string | null = null

export function ensureStylesheet(): void {
  if (!isStale()) return

  if (!existsSync(CLI)) {
    if (existsSync(OUTPUT)) {
      console.warn('  Stylesheet looks stale and the Tailwind CLI is absent; using it as-is.')
      return
    }
    throw new Error(
      `No stylesheet at ${OUTPUT} and no Tailwind CLI to build one.\n` +
        '  Run "npm run build:css" from apps/api.',
    )
  }

  const started = Date.now()
  execFileSync(CLI, ['-i', INPUT, '-o', OUTPUT, '--minify'], { stdio: 'pipe' })

  // Tailwind skips the write when the output would be byte-identical, leaving the
  // old mtime behind — so the file still looks stale and every start rebuilds it.
  // Stamp it ourselves: the mark means "checked against these sources", which is
  // the question actually being asked.
  const now = new Date()
  utimesSync(OUTPUT, now, now)

  cached = null
  console.log(`  Stylesheet rebuilt in ${Date.now() - started}ms (sources were newer).`)
}

export function stylesheet(): string {
  if (cached === null) cached = readFileSync(OUTPUT, 'utf8')
  return cached
}
