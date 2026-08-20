# chut-mcp

An MCP server that lets an AI agent ask its human for a credential without the
credential ever being typed into a conversation.

The agent calls a tool, gets a link, and shows it to its human. The human pastes
their key into a page that encrypts it in their browser. The agent reads it once,
at the moment it needs it, and the server destroys it.

## Install

Nothing to install ahead of time — `npx` fetches it on first use.

**Claude Code**

```bash
claude mcp add chut -- npx -y chut-mcp
```

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "chut": { "command": "npx", "args": ["-y", "chut-mcp"] }
  }
}
```

**Cursor** — `.cursor/mcp.json`, same shape.

Point it at your own instance with `CHUT_URL`:

```json
{
  "mcpServers": {
    "chut": {
      "command": "npx",
      "args": ["-y", "chut-mcp"],
      "env": { "CHUT_URL": "https://chut.example.com" }
    }
  }
}
```

Defaults to `https://chut.sh`.

## The tools

| Tool | What it does |
|---|---|
| `ask_human_for_secret` | Creates the request. Returns a link to show the human, and an id. |
| `check_secret_request` | Reports whether it has been filled. Takes `wait_seconds` so the agent waits instead of polling. Never returns the secret. |
| `reveal_secret_to_file` | Reads the value into a private file and returns **the path**. The value never enters the conversation. |
| `reveal_secret` | Returns the value itself, as text. For agents with no shell. |
| `discard_secret_file` | Deletes a dropped file early. |
| `cancel_secret_request` | Kills the link early. |

Reading destroys the secret either way: the ciphertext is erased server-side and
a second read fails.

## What the model never sees

Creating a request through the HTTP API hands back three things: an `id`, a
`poll_token` and an `encryption_key`. The last two together are what reads the
secret.

This server keeps both in its own memory, keyed by id, and returns neither. The
model handles the id and the link, nothing else.

That matters because the transcript is a durable artefact — it goes to the model
API, it is stored by the host, it may be logged. The link inside it does carry
the encryption key in its fragment, since the human's browser needs it, but the
encryption key alone reads nothing: the service refuses without the `poll_token`,
and the `poll_token` never leaves this process.

### The secret itself

`reveal_secret` returns the value as text, and a tool result *is* the transcript
— it goes into the message array sent to the model API on that turn and every
turn after it. No wording in a tool description changes that: a description
controls what the model writes, not what it was handed.

So `reveal_secret_to_file` writes the value to a file and returns the path. The
agent reads it inside the command that needs it:

```bash
curl -H "Authorization: Bearer $(cat /tmp/chut/…secret)" https://api.example.com/v1/me
STRIPE_API_KEY="$(cat /tmp/chut/…secret)" stripe customers list
git push https://x-access-token:$(cat /tmp/chut/…secret)@github.com/owner/repo
```

The conversation contains a filename. The value goes from disk into the process
that needs it and nowhere else.

The trade is explicit, and it is the only place in chut where a secret exists in
plaintext at rest: mode `0600`, in the user's own temp directory, on the same
machine as the agent, removed on a timer (`CHUT_FILE_TTL_SECONDS`, 10 minutes by
default), on `discard_secret_file`, and again when the server stops. Weighed
against a value that sits in a transcript indefinitely and is re-sent on every
subsequent turn, the file is the smaller exposure — but it is not nothing.

`reveal_secret` stays for agents with no shell to read a file with: a bot calling
an API from its own Python, where the only channel available is the context.

The vault is per-process and in memory only. Restart the server and the ids it
was holding become unreadable — which is a property, not a limitation: an
abandoned request expires on its own without anything on disk to leak.

## Development

```bash
npm run dev                                  # stdio server against https://chut.sh
CHUT_URL=http://localhost:8787 npm test      # 42 assertions over the real protocol
```

The test suite drives the server as a child process over JSON-RPC with the
official MCP client, against a running chut. Its point is not that the tools
work; it is that nothing reaches a tool result that should not be in a
transcript.
