#!/usr/bin/env node
/**
 * chut MCP server (stdio).
 *
 * Four tools that let an agent ask its human for a credential without the
 * credential ever being typed into a chat.
 *
 *   CHUT_URL   the service to talk to. Defaults to the public instance.
 *
 * Note on what the model can see: the tool descriptions below are not
 * documentation, they are the prompt. They are the only thing standing between
 * a correct use of this server and an agent that pastes a revealed key back
 * into the conversation out of helpfulness. They are written for that reader.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ChutError, cancel, createRequest, getState, reveal, waitForFill } from './chut.js'
import { discard, drop, ttlSeconds } from './file-drop.js'

const config = { baseUrl: (process.env.CHUT_URL ?? 'https://chut.sh').replace(/\/+$/, '') }

const server = new McpServer(
  { name: 'chut', version: '0.1.0' },
  {
    instructions:
      'Use chut whenever you need a credential that belongs to the human you are ' +
      'talking to — an API key, an access token, a password, a private key. Never ' +
      'ask them to type one into this conversation: anything typed here is stored ' +
      'in the transcript indefinitely. Send them a chut link instead.',
  },
)

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })
const failure = (s: string) => ({ content: [{ type: 'text' as const, text: s }], isError: true })

/** Every tool funnels its errors through here so the model gets a usable sentence. */
async function guard(fn: () => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>) {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ChutError) return failure(e.hint ? `${e.message}\n\n${e.hint}` : e.message)
    return failure(`Unexpected failure: ${(e as Error).message}`)
  }
}

// ---------------------------------------------------------------------------

server.registerTool(
  'ask_human_for_secret',
  {
    title: 'Ask your human for a secret',
    description:
      'Ask the human you are talking to for a credential — an API key, an access ' +
      'token, a password, a private key — without it ever being typed into this ' +
      'conversation.\n\n' +
      'Returns a link. Show that link to the human exactly as returned, character ' +
      'for character, including everything after the "#". The part after the "#" is ' +
      'the encryption key; a link without it is useless and the page will say so. ' +
      'Do not shorten it, do not wrap it in link text, do not "tidy" it.\n\n' +
      'The human opens the link, pastes the value, and their browser encrypts it ' +
      'before anything is sent. Then call check_secret_request, and reveal_secret ' +
      'once it is filled.\n\n' +
      'Reach for this instead of asking in chat every time. A credential typed into ' +
      'a conversation stays in its history for as long as the history exists.',
    inputSchema: {
      requester: z
        .string()
        .min(1)
        .max(80)
        .describe(
          'Who is asking, as the human will read it. Use your own name or your ' +
            'product name — "Deploy bot", "Claude Code", "Alex\'s research assistant". ' +
            'Be truthful: this is what they will judge the request on, and claiming ' +
            'to be a company you are not is how a phishing page reads.',
        ),
      label: z
        .string()
        .min(1)
        .max(120)
        .describe(
          'What you are asking for, in the human\'s words rather than yours. ' +
            '"Gmail API key", "GitHub personal access token", "Stripe secret key".',
        ),
      purpose: z
        .string()
        .max(400)
        .optional()
        .describe(
          'Why you need it and what you will do with it. Optional, but a request ' +
            'with no reason is one a careful person should refuse.',
        ),
      ttl_seconds: z
        .number()
        .int()
        .min(30)
        .max(86_400)
        .optional()
        .describe('How long the link stays valid. Defaults to 15 minutes.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ requester, label, purpose, ttl_seconds }) =>
    guard(async () => {
      const created = await createRequest(config, {
        requester,
        label,
        ...(purpose !== undefined ? { purpose } : {}),
        ...(ttl_seconds !== undefined ? { ttlSeconds: ttl_seconds } : {}),
      })
      const minutes = Math.round(created.expiresInSeconds / 60)
      return text(
        `Ready. Show this link to the human, exactly as it is:\n\n` +
          `${created.url}\n\n` +
          `It expires in ${minutes} minute${minutes === 1 ? '' : 's'} and accepts one value, once.\n` +
          `Request id: ${created.id}\n\n` +
          `Next: call check_secret_request with that id and a wait_seconds of 60 or ` +
          `more, so you find out as soon as they have filled it in.`,
      )
    }),
)

// ---------------------------------------------------------------------------

server.registerTool(
  'check_secret_request',
  {
    title: 'Check whether the human has answered',
    description:
      'Report where a secret request stands. Never returns the secret itself.\n\n' +
      'Pass wait_seconds to wait instead of polling in a loop: the call returns as ' +
      'soon as the human submits, or when the budget runs out, whichever comes first. ' +
      'One waiting call is better than twenty immediate ones.',
    inputSchema: {
      id: z.string().min(1).describe('The request id returned by ask_human_for_secret.'),
      wait_seconds: z
        .number()
        .int()
        .min(0)
        .max(120)
        .optional()
        .describe(
          'How long to wait for the human before answering. 0 answers immediately. ' +
            'Prefer 60 or more; a person reading a message and finding a credential ' +
            'takes minutes, not seconds.',
        ),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ id, wait_seconds }) =>
    guard(async () => {
      const state = wait_seconds ? await waitForFill(config, id, wait_seconds) : await getState(config, id)

      if (state.status === 'filled') {
        return text(
          `Filled. When you are ready to use the value, call reveal_secret_to_file ` +
            `if you will use it from a shell command — that keeps it out of this ` +
            `conversation entirely — or reveal_secret otherwise. Either way it is ` +
            `destroyed on the first read, so read it at the moment you need it rather ` +
            `than in advance.` +
            (state.openedCount > 1
              ? `\n\nWorth mentioning to your human: the page was opened ${state.openedCount} ` +
                `times before it was filled. That is usually harmless — a preview, a ` +
                `reopened tab — but it is the only tamper signal this service has.`
              : ''),
        )
      }

      if (state.status === 'pending') {
        return text(
          `Still waiting. The page has been opened ${state.openedCount} time${state.openedCount === 1 ? '' : 's'}.` +
            (state.openedCount === 0
              ? ` The human has not opened the link yet — it may be worth checking they received it.`
              : ` Call again with wait_seconds to keep waiting.`),
        )
      }

      const why: Record<string, string> = {
        revealed: 'The secret was already read, and reading destroys it.',
        expired: 'The link expired before it was filled. Create a new request.',
        cancelled: 'The request was cancelled.',
      }
      return text(`Status: ${state.status}. ${why[state.status] ?? ''}`.trim())
    }),
)

// ---------------------------------------------------------------------------

server.registerTool(
  'reveal_secret',
  {
    title: 'Read the secret, once',
    description:
      'Return the value the human submitted, in the clear, as text in this ' +
      'conversation. Reading destroys it: the ciphertext is erased server-side and a ' +
      'second call will fail.\n\n' +
      'If you are going to use the credential from a shell command, use ' +
      'reveal_secret_to_file instead — it hands you a path rather than the value, so ' +
      'nothing sensitive enters this conversation at all. Only use this tool when you ' +
      'genuinely need the characters, for instance to pass them to an API you are ' +
      'calling from your own code with no shell involved.\n\n' +
      'Call this at the moment you are about to use the value, not before. Then ' +
      'use it and let it go:\n' +
      '  - do not repeat it back to the human — they gave it to you precisely so it ' +
      'would not appear in this conversation;\n' +
      '  - do not write it to a file, a config, a commit or a log;\n' +
      '  - do not include it in a summary of what you did.\n\n' +
      'If you need it again later, ask for it again.',
    inputSchema: {
      id: z.string().min(1).describe('The request id returned by ask_human_for_secret.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  async ({ id }) =>
    guard(async () => {
      const { secret, burned } = await reveal(config, id)
      return text(
        `${secret}\n\n` +
          (burned
            ? '(Destroyed. This value cannot be read again — use it now, and do not repeat it in your reply.)'
            : '(Still readable until it expires. Do not repeat it in your reply.)'),
      )
    }),
)

// ---------------------------------------------------------------------------

server.registerTool(
  'reveal_secret_to_file',
  {
    title: 'Read the secret into a file, without seeing it',
    description:
      'Read the secret and write it to a private file, returning only the path. ' +
      'The value never enters this conversation.\n\n' +
      'Prefer this over reveal_secret whenever you will use the credential from a ' +
      'shell command, which is most of the time. Read the file inside the command ' +
      'that needs it:\n\n' +
      '  curl -H "Authorization: Bearer $(cat <path>)" https://api.example.com/v1/me\n' +
      '  STRIPE_API_KEY="$(cat <path>)" stripe customers list\n' +
      '  git push https://x-access-token:$(cat <path>)@github.com/owner/repo\n\n' +
      'Never read the file on its own — no `cat <path>`, no `echo`, no opening it ' +
      'with a file-reading tool, not even to check it worked. Anything you print ' +
      'lands in this conversation, which is the exact thing this tool exists to ' +
      'avoid, and the write already succeeded or you would have got an error.\n\n' +
      'Reading destroys the secret on the server: a second call will fail. The file ' +
      'is readable only by you, is removed automatically, and can be removed sooner ' +
      'with discard_secret_file once you are done.',
    inputSchema: {
      id: z.string().min(1).describe('The request id returned by ask_human_for_secret.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  async ({ id }) =>
    guard(async () => {
      const { secret } = await reveal(config, id)
      const { path, expiresInSeconds } = drop(id, secret)
      const minutes = Math.round(expiresInSeconds / 60)
      return text(
        `${path}\n\n` +
          `The value is in that file and nowhere in this conversation. Use it inside ` +
          `a command — "$(cat ${path})" — and do not print it.\n` +
          `Readable only by you, removed in ${minutes} minute${minutes === 1 ? '' : 's'} ` +
          `or when this server stops. Call discard_secret_file when you are done.`,
      )
    }),
)

// ---------------------------------------------------------------------------

server.registerTool(
  'discard_secret_file',
  {
    title: 'Delete a secret file early',
    description:
      'Delete a file created by reveal_secret_to_file, as soon as you have finished ' +
      'using it. It would be removed on its own eventually; doing it now shortens ' +
      'the window in which a plaintext credential exists on disk.',
    inputSchema: {
      path: z.string().min(1).describe('The path returned by reveal_secret_to_file.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  async ({ path }) =>
    guard(async () =>
      text(
        discard(path)
          ? 'Deleted.'
          : 'Nothing to delete: that path was not created by this server, or it is already gone.',
      ),
    ),
)

// ---------------------------------------------------------------------------

server.registerTool(
  'cancel_secret_request',
  {
    title: 'Withdraw a request',
    description:
      'Withdraw a request you no longer need, so the link stops working immediately ' +
      'rather than sitting live until it expires. Use it when you asked by mistake, ' +
      'when the human said no, or when you found another way.',
    inputSchema: {
      id: z.string().min(1).describe('The request id returned by ask_human_for_secret.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  async ({ id }) =>
    guard(async () => {
      await cancel(config, id)
      return text('Cancelled. The link is dead; tell the human they can ignore it.')
    }),
)

// ---------------------------------------------------------------------------

const transport = new StdioServerTransport()
await server.connect(transport)

// stdout is the protocol channel. Anything written there that is not a JSON-RPC
// frame corrupts the stream, so diagnostics go to stderr, always.
process.stderr.write(`chut mcp ready · ${config.baseUrl} · file drops expire after ${ttlSeconds}s\n`)
