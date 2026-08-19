# chut

**Your AI agent needs an API key. It stops asking for it in the chat.**

The agent creates a request, gets a short-lived link, and hands it to you. You open
the link, paste your key, and the agent reads it once. The value never sits in your
Telegram, Discord or Slack history.

The secret is **encrypted in your browser** before it is sent: the server never sees
it in plaintext, and a copy of the database alone is not enough to read it.

```
  Agent  ──create──▶  chut  ◀──paste──  Human
         ◀──read once──
```

## Repository map

| Path | What it is |
|---|---|
| [`apps/api`](apps/api) | The service: HTTP API, the page the human fills in, OpenAPI spec |
| `apps/web` | Landing page and docs — not built yet |
| `packages/mcp` | MCP server, so agents can call chut as a tool — not built yet |

One product, several surfaces. They share an auth model, a threat model and a
release cycle, so they share a repository: a security fix ships once instead of
being copied N times and forgotten in one of them.

## Quick start

```bash
npm install
cp apps/api/.env.example apps/api/.env

# Generate a real API key and a real salt
node -e "console.log('API_KEYS=' + require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log('IP_HASH_SALT=' + require('crypto').randomBytes(16).toString('hex'))"

npm start          # http://localhost:8787
```

```bash
npm test               # flow and access control
npm run test:attacks   # one case per audit finding
npm run test:browser   # the whole journey in a real Chromium
```

Try it the way a human would, without writing any HTTP by hand:

```bash
npm run link                 # create a link, then wait and show what arrives
npm run link -- --all        # one link per page state, to check them visually
```

## Security

The threat model — what is protected, what is not, and why — lives in
[`apps/api/README.md`](apps/api/README.md#what-this-protects-and-what-it-does-not).

An adversarial review produced 11 findings. All are closed, each with a test that
failed before the fix and passes after; `apps/api/test/attacks.mjs` keeps them
closed. What remains deliberately open is written down in [ROADMAP.md](ROADMAP.md)
rather than left implicit.

## License

MIT
