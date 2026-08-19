import type { Context } from 'hono'

export type JsonObject = Record<string, unknown>

/**
 * Reads a request body that must be a JSON object.
 *
 * `await c.req.json()` returns null for the literal body `null`, and a TypeScript
 * cast to Record<string, unknown> does nothing at runtime — so the first property
 * access threw and the request ended as a 500. A try/catch around the parse does
 * not help: parsing succeeded, it is the *shape* of the result that was wrong.
 *
 * Arrays and primitives are refused for the same reason: `[].label` is undefined
 * rather than an error, so they would slip through validation as "field missing"
 * and mask a caller sending something structurally wrong.
 *
 * Returns the object, or the Response to send back. Callers check with
 * `instanceof Response`, so a new rejection case cannot be forgotten at a call
 * site the way a status enum can.
 */
export async function readJsonObject(
  c: Context,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): Promise<JsonObject | Response> {
  let raw: string
  try {
    raw = await c.req.text()
  } catch {
    return c.json({ error: 'invalid_request', message: 'Could not read the request body.' }, 400)
  }

  if (raw.trim() === '') {
    if (allowEmpty) return {}
    return c.json({ error: 'invalid_request', message: 'A JSON object body is required.' }, 400)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return c.json({ error: 'invalid_request', message: 'Invalid JSON body.' }, 400)
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return c.json(
      {
        error: 'invalid_request',
        message: 'The request body must be a JSON object.',
      },
      400,
    )
  }

  return parsed as JsonObject
}
