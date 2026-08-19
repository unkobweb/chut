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
| `reveal_secret` | Returns the value, once. Reading destroys it. |
| `cancel_secret_request` | Kills the link early. |

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

So the honest summary is: **the revealed secret does reach the model**, because
the model has to use it. What does not reach it is the ability to read that
secret again, or to read anyone else's.

The vault is per-process and in memory only. Restart the server and the ids it
was holding become unreadable — which is a property, not a limitation: an
abandoned request expires on its own without anything on disk to leak.

## Development

```bash
npm run dev                                  # stdio server against https://chut.sh
CHUT_URL=http://localhost:8787 npm test      # 27 assertions over the real protocol
```

The test suite drives the server as a child process over JSON-RPC with the
official MCP client, against a running chut. Its point is not that the tools
work; it is that nothing reaches a tool result that should not be in a
transcript.
