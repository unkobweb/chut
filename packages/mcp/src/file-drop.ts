/**
 * Dropping a revealed secret on disk instead of into the conversation.
 *
 * The reason this exists: whatever a tool returns becomes part of the message
 * array sent to the model API, on this turn and every turn after it. A tool
 * that returns a credential has put that credential in the transcript, and no
 * amount of instructing the model to be discreet changes that — the model only
 * controls what it writes, not what it was handed.
 *
 * So hand it a path. The shell reads the file inside a command substitution,
 * the value goes straight from disk into the process being run, and the
 * conversation only ever contains a filename.
 *
 * The trade is explicit: this is the one place in chut where a secret exists in
 * plaintext at rest. It is mode 0600, in the user's own temp directory, on the
 * same machine as the agent, and it is removed on a timer and again when this
 * process dies. Weighed against a value that sits in a transcript indefinitely
 * and is re-sent on every subsequent turn, the file is the smaller exposure —
 * but it is not nothing, which is why reveal_secret still exists for agents
 * that have no shell to read it with.
 */

import { chmodSync, mkdirSync, openSync, rmSync, writeSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const DIR = join(tmpdir(), 'chut')

/**
 * How long a dropped file survives. Short by default; the agent uses it at once.
 * The floor is one second rather than something more comfortable: a value too
 * short to be useful fails immediately and visibly, which is a better failure
 * than silently ignoring what the operator asked for.
 */
export const ttlSeconds = Math.max(
  1,
  Number.parseInt(process.env.CHUT_FILE_TTL_SECONDS ?? '600', 10) || 600,
)

const live = new Map<string, NodeJS.Timeout>()

function forget(path: string) {
  const timer = live.get(path)
  if (timer) {
    clearTimeout(timer)
    live.delete(path)
  }
  try {
    rmSync(path, { force: true })
  } catch {
    /* already gone, or the directory went with it */
  }
}

/**
 * Writes `value` to a fresh 0600 file and returns its path.
 *
 * The file is opened with 'wx' so an existing path is an error rather than an
 * overwrite, and chmod runs immediately after: the mode passed to open() is
 * masked by the process umask, so it cannot be trusted on its own.
 */
export function drop(id: string, value: string): { path: string; expiresInSeconds: number } {
  mkdirSync(DIR, { recursive: true, mode: 0o700 })
  chmodSync(DIR, 0o700)

  const path = join(DIR, `${id}-${randomBytes(4).toString('hex')}.secret`)
  const fd = openSync(path, 'wx', 0o600)
  try {
    chmodSync(path, 0o600)
    writeSync(fd, value) // no trailing newline: some readers pass the value through verbatim
  } finally {
    closeSync(fd)
  }

  const timer = setTimeout(() => forget(path), ttlSeconds * 1000)
  timer.unref() // never hold the process open for a cleanup
  live.set(path, timer)

  return { path, expiresInSeconds: ttlSeconds }
}

/** Removes a dropped file early, once the agent says it is done with it. */
export function discard(path: string): boolean {
  if (!live.has(path)) return false
  forget(path)
  return true
}

export const dropped = () => [...live.keys()]

/**
 * Nothing plaintext outlives this process. `exit` covers the normal end and
 * both signals cover a host shutting the server down, which is how it usually
 * goes; a SIGKILL or a power cut leaves the files, which is what the TTL and
 * the operating system's temp cleanup are for.
 */
let wiring = false
function wipeAll() {
  for (const path of [...live.keys()]) forget(path)
}
if (!wiring) {
  wiring = true
  process.on('exit', wipeAll)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      wipeAll()
      process.exit(0)
    })
  }
}
