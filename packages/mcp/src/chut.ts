/**
 * The chut HTTP client, plus the in-process vault.
 *
 * The vault is the reason this file exists. Creating a request returns three
 * things: an id, a poll_token and an encryption_key. The last two together are
 * what lets anyone read the secret — so if they were handed back to the model
 * they would land in the transcript, and holding the transcript would be enough
 * to steal the credential.
 *
 * They stay here instead, in the server's own memory, keyed by id. The model
 * only ever handles the id and the URL. The URL does carry the encryption key
 * in its fragment, because the human's browser needs it, but the encryption key
 * alone reveals nothing: the API refuses to read a request without the
 * poll_token, which never leaves this process.
 */

export interface ChutConfig {
  baseUrl: string
}

interface Held {
  pollToken: string
  encryptionKey: string
  label: string
  createdAt: number
}

const vault = new Map<string, Held>()

/**
 * Ids this process has finished with, and how.
 *
 * The credentials are dropped the moment they stop being useful, but the id is
 * remembered — otherwise a second read looks exactly like an id from another
 * session, and the model is told to create a new request when what it needs to
 * hear is that the value was already read and destroyed. Two different
 * situations that lead to two different next actions.
 */
const spent = new Map<string, 'revealed' | 'cancelled'>()

/** Thrown for anything the model should be told about rather than crash on. */
export class ChutError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message)
  }
}

async function call(
  config: ChutConfig,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  let res: Response
  try {
    res = await fetch(config.baseUrl + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause ?? {}
    throw new ChutError(
      `Cannot reach the chut service at ${config.baseUrl}: ${cause.code ?? ''} ${cause.message ?? (e as Error).message}`.trim(),
      'The service may be down, or CHUT_URL may be wrong.',
    )
  }

  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    throw new ChutError(`The chut service answered ${res.status} with a body that is not JSON.`)
  }
  return { status: res.status, body }
}

export interface CreatedRequest {
  id: string
  url: string
  label: string
  expiresInSeconds: number
}

export async function createRequest(
  config: ChutConfig,
  input: { requester: string; label: string; purpose?: string; ttlSeconds?: number },
): Promise<CreatedRequest> {
  const { status, body } = await call(config, '/v1/requests', {
    method: 'POST',
    body: JSON.stringify({
      requester: input.requester,
      label: input.label,
      ...(input.purpose ? { purpose: input.purpose } : {}),
      ...(input.ttlSeconds ? { ttl_seconds: input.ttlSeconds } : {}),
    }),
  })

  if (status !== 201) {
    throw new ChutError(
      `chut refused to create the request (${status}): ${String(body.message ?? body.error ?? '')}`,
    )
  }

  const id = String(body.id)
  vault.set(id, {
    pollToken: String(body.poll_token),
    encryptionKey: String(body.encryption_key),
    label: input.label,
    createdAt: Date.now(),
  })

  return {
    id,
    url: String(body.url),
    label: input.label,
    expiresInSeconds: Number(body.expires_in_seconds ?? 0),
  }
}

function held(id: string): Held {
  const entry = vault.get(id)
  if (entry) return entry

  const outcome = spent.get(id)
  if (outcome === 'revealed') {
    throw new ChutError(
      `Request "${id}" was already read once, and reading a secret destroys it.`,
      'If you need the value again, ask the human for a new one with ask_human_for_secret.',
    )
  }
  if (outcome === 'cancelled') {
    throw new ChutError(
      `Request "${id}" was cancelled, so its link no longer works.`,
      'Create a new request if you still need the credential.',
    )
  }

  throw new ChutError(
    `No request with id "${id}" was created by this session.`,
    'Its credentials live only in this process and are lost when it restarts. Create a new request.',
  )
}

export interface RequestState {
  id: string
  status: 'pending' | 'filled' | 'revealed' | 'expired' | 'cancelled'
  label: string
  openedCount: number
  fetchedCount: number
  filledAt: string | null
  filledFromIpHash: string | null
  expiresAt: string | null
}

export async function getState(config: ChutConfig, id: string): Promise<RequestState> {
  const entry = held(id)
  const { status, body } = await call(config, `/v1/requests/${encodeURIComponent(id)}`, {
    headers: { 'x-poll-token': entry.pollToken },
  })

  if (status === 404) throw new ChutError(`Request "${id}" no longer exists on the service.`)
  if (status !== 200) {
    throw new ChutError(`chut answered ${status}: ${String(body.message ?? body.error ?? '')}`)
  }

  return {
    id,
    status: body.status as RequestState['status'],
    label: entry.label,
    openedCount: Number(body.opened_count ?? 0),
    fetchedCount: Number(body.fetched_count ?? 0),
    filledAt: (body.filled_at as string | null) ?? null,
    filledFromIpHash: (body.filled_from_ip_hash as string | null) ?? null,
    expiresAt: (body.expires_at as string | null) ?? null,
  }
}

/**
 * Polls until the request leaves `pending`, or until the budget runs out.
 * Returns whatever state it ended on; the caller decides what that means.
 */
export async function waitForFill(
  config: ChutConfig,
  id: string,
  waitSeconds: number,
): Promise<RequestState> {
  const deadline = Date.now() + waitSeconds * 1000
  for (;;) {
    const state = await getState(config, id)
    if (state.status !== 'pending') return state
    if (Date.now() >= deadline) return state
    await new Promise((r) => setTimeout(r, Math.min(2000, Math.max(250, deadline - Date.now()))))
  }
}

export async function reveal(config: ChutConfig, id: string): Promise<{ secret: string; burned: boolean }> {
  const entry = held(id)
  const { status, body } = await call(config, `/v1/requests/${encodeURIComponent(id)}/reveal`, {
    method: 'POST',
    body: JSON.stringify({ poll_token: entry.pollToken, encryption_key: entry.encryptionKey }),
  })

  if (status === 409) {
    throw new ChutError(
      `Nothing to read: the request is "${String(body.status ?? 'not filled')}".`,
      body.status === 'revealed'
        ? 'It was already read once, and a secret is destroyed on first read.'
        : 'Wait for the human to fill the form — check_secret_request will tell you when.',
    )
  }
  if (status !== 200) {
    throw new ChutError(`chut answered ${status}: ${String(body.message ?? body.error ?? '')}`)
  }

  // The credentials have done their job and the ciphertext is gone server-side,
  // so drop them — but remember the id, so a second attempt gets told what
  // actually happened rather than that this session never knew it.
  if (body.burned === true) {
    vault.delete(id)
    spent.set(id, 'revealed')
  }
  return { secret: String(body.secret), burned: body.burned === true }
}

export async function cancel(config: ChutConfig, id: string): Promise<void> {
  const entry = held(id)
  const { status, body } = await call(config, `/v1/requests/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-poll-token': entry.pollToken },
  })
  if (status !== 200) {
    throw new ChutError(`chut answered ${status}: ${String(body.message ?? body.error ?? '')}`)
  }
  vault.delete(id)
  spent.set(id, 'cancelled')
}

/** Test seam: lets the protocol suite prove the vault is actually per-process. */
export const __vaultSize = () => vault.size
