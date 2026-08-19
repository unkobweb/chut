import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from './config.js'

mkdirSync(dirname(config.dbPath), { recursive: true })

export const db = new Database(config.dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS requests (
  id               TEXT PRIMARY KEY,
  api_key_hash     TEXT NOT NULL,
  poll_token_hash  TEXT NOT NULL,

  requester        TEXT NOT NULL,
  label            TEXT NOT NULL,
  purpose          TEXT,

  status           TEXT NOT NULL CHECK (status IN ('pending','filled','revealed','expired','cancelled')),
  burn_on_reveal   INTEGER NOT NULL DEFAULT 1,

  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,

  opened_count     INTEGER NOT NULL DEFAULT 0,
  first_opened_at  INTEGER,
  filled_at        INTEGER,
  filled_ip_hash   TEXT,
  filled_user_agent TEXT,
  revealed_at      INTEGER,

  ciphertext       TEXT,
  iv               TEXT
);

CREATE INDEX IF NOT EXISTS idx_requests_expires ON requests (expires_at);
CREATE INDEX IF NOT EXISTS idx_requests_status  ON requests (status);
`)

export interface RequestRow {
  id: string
  api_key_hash: string
  poll_token_hash: string
  requester: string
  label: string
  purpose: string | null
  status: 'pending' | 'filled' | 'revealed' | 'expired' | 'cancelled'
  burn_on_reveal: number
  created_at: number
  expires_at: number
  opened_count: number
  first_opened_at: number | null
  filled_at: number | null
  filled_ip_hash: string | null
  filled_user_agent: string | null
  revealed_at: number | null
  ciphertext: string | null
  iv: string | null
}

export const queries = {
  insert: db.prepare(`
    INSERT INTO requests (
      id, api_key_hash, poll_token_hash, requester, label, purpose,
      status, burn_on_reveal, created_at, expires_at
    ) VALUES (
      @id, @api_key_hash, @poll_token_hash, @requester, @label, @purpose,
      'pending', @burn_on_reveal, @created_at, @expires_at
    )
  `),

  byId: db.prepare<[string], RequestRow>(`SELECT * FROM requests WHERE id = ?`),

  markOpened: db.prepare(`
    UPDATE requests
       SET opened_count = opened_count + 1,
           first_opened_at = COALESCE(first_opened_at, @now)
     WHERE id = @id
  `),

  /**
   * The `status = 'pending'` guard is what makes filling single-use under
   * concurrency. Callers must check `info.changes`, not a prior read.
   */
  fill: db.prepare(`
    UPDATE requests
       SET status = 'filled',
           ciphertext = @ciphertext,
           iv = @iv,
           filled_at = @now,
           filled_ip_hash = @ip_hash,
           filled_user_agent = @user_agent
     WHERE id = @id AND status = 'pending'
  `),

  /**
   * burn_on_reveal = false: record the read but keep the request 'filled', so it
   * stays readable until expiry (useful when an agent restarts mid-task).
   */
  markRevealed: db.prepare(`
    UPDATE requests SET revealed_at = COALESCE(revealed_at, @now)
     WHERE id = @id AND status = 'filled'
  `),

  /**
   * The `status = 'filled'` guard is not decorative: it is what arbitrates the
   * race. SQLite guarantees a single concurrent UPDATE will touch the row, so
   * exactly one caller sees changes === 1 and earns the right to return the
   * secret. Without it, N concurrent reveals all succeed and the burn stops
   * working as an intrusion detector.
   */
  burn: db.prepare(`
    UPDATE requests
       SET status = 'revealed', revealed_at = @now, ciphertext = NULL, iv = NULL
     WHERE id = @id AND status = 'filled'
  `),

  cancel: db.prepare(`
    UPDATE requests
       SET status = 'cancelled', ciphertext = NULL, iv = NULL
     WHERE id = @id AND status IN ('pending','filled')
  `),

  /** Wipes ciphertext of expired requests. Metadata is kept for auditing. */
  expireStale: db.prepare(`
    UPDATE requests
       SET status = 'expired', ciphertext = NULL, iv = NULL
     WHERE expires_at <= @now AND status IN ('pending','filled')
  `),

  /** Permanently removes rows that finished long ago. */
  purgeOld: db.prepare(`
    DELETE FROM requests
     WHERE status IN ('revealed','expired','cancelled') AND expires_at <= @cutoff
  `),
}

/**
 * An expired request stays 'pending' in the database until the next sweep, so we
 * correct it on read. Correctness comes from here, not from the sweeper.
 */
export function effectiveStatus(row: RequestRow, now = Date.now()): RequestRow['status'] {
  if ((row.status === 'pending' || row.status === 'filled') && row.expires_at <= now) return 'expired'
  return row.status
}

export function startSweeper(intervalMs = 30_000): NodeJS.Timeout {
  const sweep = () => {
    const now = Date.now()
    queries.expireStale.run({ now })
    queries.purgeOld.run({ cutoff: now - 7 * 24 * 60 * 60 * 1000 })
  }
  sweep()
  const timer = setInterval(sweep, intervalMs)
  timer.unref()
  return timer
}
