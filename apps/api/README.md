# @chut/api

The service: HTTP API, the page a human fills in, and the OpenAPI spec.
See the [repository root](../../README.md) for what chut is and how the pieces fit.

**Your AI agent needs an API key. It stops asking for it in the chat.**

The agent calls `POST /v1/requests`, gets a link, and hands it to you. You open the
link, paste your key, and the agent reads it once. The value never sits in your
Telegram, Discord or Slack history.

The secret is **encrypted in your browser** before it is sent: the server never sees
it in plaintext, and a copy of the database alone is not enough to read it.

> v1. One tool: the secret request. The rest of the suite comes later — see [ROADMAP.md](../../ROADMAP.md).

---

## The flow

```
  Agent                          chut                          Human
    │                             │                             │
    │ POST /v1/requests           │                             │
    │────────────────────────────>│                             │
    │  { url, poll_token,         │                             │
    │    encryption_key }         │                             │
    │<────────────────────────────│                             │
    │                             │                             │
    │  "open this link"           │                             │
    │─────────────────────────────────────────────────────────> │
    │                             │  GET /s/:id#key             │
    │                             │<────────────────────────────│
    │                             │  POST /s/:id  (ciphertext)  │
    │                             │<────────────────────────────│
    │ GET /v1/requests/:id        │                             │
    │────────────────────────────>│                             │
    │  status: filled             │                             │
    │<────────────────────────────│                             │
    │ POST /v1/requests/:id/reveal│                             │
    │────────────────────────────>│                             │
    │  { secret }   then destroyed│                             │
    │<────────────────────────────│                             │
```

---

## Getting started

```bash
npm install
cp .env.example .env

# Generate a real salt
node -e "console.log('IP_HASH_SALT=' + require('crypto').randomBytes(16).toString('hex'))"

npm start          # http://localhost:8787
```

Tests:

```bash
npm test                      # 48 assertions on the flow and access control
node test/attacks.mjs         # attack suite — one case per audit finding
node test/browser.mjs         # replays the journey in a real Chromium + screenshots
```

---

## Usage

**1. The agent creates the request**

```bash
curl -X POST http://localhost:8787/v1/requests \
  -H "Content-Type: application/json" \
  -d '{
    "requester": "Telegram Assistant",
    "label": "Gmail API key",
    "purpose": "Read your last 20 emails to send you a summary every morning",
    "ttl_seconds": 900
  }'
```

```json
{
  "id": "k3mq7rz2xp9wd4nb",
  "status": "pending",
  "url": "http://localhost:8787/s/k3mq7rz2xp9wd4nb#Xy7f...",
  "poll_token": "aB3x...",
  "encryption_key": "Xy7f...",
  "expires_in_seconds": 900
}
```

The agent sends **`url`** to its human. It keeps `poll_token` and `encryption_key`:
both are required to read the secret, and **neither should ever be shown to the user**.

**2. The agent polls**

```bash
curl http://localhost:8787/v1/requests/k3mq7rz2xp9wd4nb \
  -H "X-Poll-Token: aB3x..."
```

`status` moves from `pending` to `filled`. The response also carries `filled_at`,
`filled_from_ip_hash` and two distinct counters:

- `opened_count` — pages that actually rendered in a browser. Warn on this.
- `fetched_count` — raw HTTP fetches, link-preview crawlers included. Telegram,
  Slack, Discord and iMessage all fetch a shared URL to build a preview, so this
  is above zero before your human clicks anything. Keep it for forensics, never
  warn on it.

**3. The agent reveals, at the last moment**

```bash
curl -X POST http://localhost:8787/v1/requests/k3mq7rz2xp9wd4nb/reveal \
  -H "Content-Type: application/json" \
  -d '{"poll_token": "aB3x...", "encryption_key": "Xy7f..."}'
```

```json
{ "secret": "AIzaSy...", "burned": true }
```

By default the secret is **destroyed immediately after this read**. Call it only
when you are about to use it. Pass `burn_on_reveal: false` at creation to keep the
secret readable until it expires.

---

## Trying it by hand

```bash
npm run link                 # create a link, then wait and show what arrives
npm run link -- --all        # one link per page state, to check them visually
npm run link -- --lang fr    # force an interface language
```

`npm run link` prints a URL, then watches it. Open it the way your human would,
paste something, and the terminal shows the value arriving along with
`opened_count`, the filling fingerprint, and whether the secret was burned — the
whole round trip without writing a single HTTP call.

`--all` prints one link per state (ready, already used, withdrawn, expiring,
incomplete, not found, delivered, broken, index), which is the quickest way to
look over every screen after changing the page.

Customise with `--requester`, `--label`, `--purpose` and `--ttl`.

## Wiring an agent

The spec is served at `/openapi.json` and written to be loaded as-is as a tool
definition. The `description` fields are written for the model, not for a human.

A system-prompt fragment that works well:

```
Never ask for an API key, token or password directly in the conversation.
When you need a secret:
  1. call createSecretRequest with requester, label and purpose (be specific about
     purpose — the human reads it to decide)
  2. give the user ONLY the "url" field, never poll_token or encryption_key
  3. poll getSecretRequest until status == "filled"
  4. only call revealSecret at the exact moment you are going to use the secret:
     it is destroyed on read
  5. if opened_count > 1, warn the user that the link was opened several times
Never echo a revealed secret back in your reply.
```

---

## What this protects, and what it does not

Worth being blunt: on a tool like this, that is the part that matters.

**Protected**

- **The conversation history.** The secret never travels through Telegram, Discord
  or Slack. That is the main win, and it is a real one: a chat is persistent,
  synced, backed up and searchable, while this link lives fifteen minutes.
- **The server, and a database leak.** The browser encrypts with AES-GCM 256 using a
  key that lives in the URL `#` fragment — and a fragment is never sent to the
  server. A copy of the database contains only unusable ciphertext.
- **The logs.** Only method, normalised path, status and duration are recorded. No
  body, no headers, no query string.
- **Theft by someone reading the chat.** Revealing requires the `poll_token`, which
  only the agent holds. Someone who sees the link in the conversation cannot read
  the secret.
- **Reuse.** A link accepts one value, once. A secret is read once, and the reveal
  is atomic under concurrency.

**Not protected**

- **The agent's context.** Once revealed, the secret is in the model's context
  window, and therefore possibly in the provider's logs. This is the structural
  limit of v1; proxy mode closes it (see [ROADMAP.md](../../ROADMAP.md)).
- **Not strict zero-knowledge.** The server generates the key and sees it again at
  reveal time. It never stores it, but it does pass through memory twice.
- **Injection.** Someone who reads the link before you can fill the slot with
  *their* value, and your agent would then work against the attacker's account.
  That is why `opened_count`, `filled_at` and `filled_from_ip_hash` are exposed —
  the agent should watch them and warn.
- **A compromised agent.** An agent hit by prompt injection can create a
  legitimate-looking link. The page pins requester, label and purpose at creation
  time and the warning box is hard-coded, but nothing replaces human vigilance.
- **The human's machine.** Keyloggers, clipboard sniffers, malicious extensions:
  out of scope.

**Treat the URL as a bearer token.** It contains the decryption key. Short TTL,
single use, and **HTTPS is mandatory in production** — the server warns on startup
if `BASE_URL` is not `https://`.

### Security posture

An adversarial review of this codebase produced 11 findings. They are tracked in
[ROADMAP.md](../../ROADMAP.md) and closed one at a time, each with a test that fails
before the fix and passes after. Do not run this in production until they are all
closed.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Listening port |
| `BASE_URL` | `http://localhost:8787` | Public URL, the one embedded in the link |
| `DB_PATH` | `./data/chut.db` | SQLite file |
| `DEFAULT_TTL_SECONDS` | `900` | Default lifetime |
| `MAX_TTL_SECONDS` | `86400` | Ceiling |
| `MAX_SECRET_BYTES` | `8192` | Maximum value size |
| `RATE_LIMIT_PER_MIN` | `60` | Requests per minute per caller address |
| `IP_HASH_SALT` | — | Salt for hashing IPs (raw IPs are never stored) |
| `TRUST_PROXY_HOPS` | `0` | Number of trusted reverse proxies in front. `0` ignores forwarding headers |

A sweep every 30 s wipes the ciphertext of expired requests and permanently deletes
rows that finished more than 7 days ago.

---

## Deployment

The Dockerfile is at the repository root, and so is the build context — this is
a workspace, so npm needs to see the lockfile above `apps/`.

```bash
# from the repository root
docker build -t chut .
docker run -d --name chut -p 8787:8787 \
  -e BASE_URL=https://chut.example.com \
  -e IP_HASH_SALT=$(openssl rand -hex 16) \
  -v chut-data:/app/data \
  chut
```

Put it behind a TLS-terminating reverse proxy, and set `TRUST_PROXY_HOPS` to the
number of proxies in front of it — one for a single nginx or Caddy, two if a CDN
sits ahead of that.

Getting this wrong fails in one direction or the other. Too low and every caller
shares the proxy's address: rate-limit buckets collapse into one and the filling
fingerprint is identical for everyone. Too high and you read an entry the client
wrote itself, which is exactly the hole this setting closes.

---

## License

MIT
