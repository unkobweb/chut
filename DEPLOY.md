# Deploying chut

The service is a single Node process with a SQLite file beside it. It needs one
container and one persistent volume — no database server, no cache, no queue.

## What the image expects

| | |
|---|---|
| Build context | the repository root (`apps/api` is an npm workspace; the lockfile lives above it) |
| Dockerfile | `./Dockerfile` |
| Listening port | `8787` |
| Persistent path | `/app/data` — the SQLite file, its WAL and its shared-memory index |
| Health check | `GET /healthz` |

The container runs as an unprivileged user and owns `/app/data`. Everything else
in the image is read-only in practice.

HSTS is sent by the application itself, but only when `BASE_URL` starts with
`https://` — so a local run never pins `localhost` to https in your browser.
There is nothing to configure at the proxy for it.

## Environment

| Variable | Set it to | Why |
|---|---|---|
| `BASE_URL` | `https://your-domain` | This is the URL written into every link handed to a human. Get it wrong and the links point somewhere else. No trailing slash. |
| `IP_HASH_SALT` | `openssl rand -hex 16` | Raw IPs are never stored, only `sha256(salt:ip)` truncated. Leave the default and those hashes are guessable from a rainbow table of the whole IPv4 space. |
| `TRUST_PROXY_HOPS` | number of proxies in front | See below. This one is easy to get wrong in both directions. |
| `DB_PATH` | `/app/data/chut.db` | Must be inside the volume, or every restart loses the pending requests. |
| `PORT` | `8787` | Only if you remap it. |

Optional: `DEFAULT_TTL_SECONDS` (900), `MAX_TTL_SECONDS` (86400),
`MAX_SECRET_BYTES` (8192), `RATE_LIMIT_PER_MIN` (60, per caller address).

### TRUST_PROXY_HOPS

The service reads the client address from the *end* of `X-Forwarded-For`,
counting back exactly this many hops. Anything the client prepended itself is
discarded.

- `0` — nothing in front. Forwarding headers are ignored entirely.
- `1` — one reverse proxy: a bare Traefik, nginx or Caddy. **This is the Dokploy case.**
- `2` — a CDN in front of that proxy, e.g. Cloudflare with the orange cloud on.

Too low and every caller is seen as the proxy: the rate-limit buckets collapse
into one, and the fingerprint recorded against a fill is identical for everyone.
Too high and you read an entry the client wrote itself, which is the hole this
setting exists to close.

## Dokploy

Create an **Application**, point it at the repository, then:

- **Build Type**: Dockerfile
- **Docker File**: `Dockerfile`
- **Docker Context Path**: `.`

  Both matter. Pointing at `apps/api/Dockerfile` also moves the context to
  `apps/api`, and the build fails on `COPY package.json package-lock.json ./`
  because the lockfile is one level up.

- **Volumes** → add a *Volume Mount*: name `chut-data`, mount path `/app/data`.
- **Environment**: the table above.
- **Domains** → add the domain, container port `8787`, HTTPS on, Let's Encrypt.

Set `TRUST_PROXY_HOPS=1`: Dokploy puts Traefik in front of every application.

## Verifying a deployment

```bash
npm run smoke -- https://your-domain
```

It walks the whole round trip with a throwaway value — create, render, encrypt,
fill, poll, reveal, burn — and checks the security headers on the way. Run it
after every deploy. It leaves one dead row behind and never touches the rate
limiter, so it is safe to point at a live service.

The check worth knowing about is the first one: the returned `url` must start
with your real domain. A wrong `BASE_URL` breaks nothing visible on the server
and every link it hands out.

### The volume

Worth proving once per host, because it is the only production failure here
that is completely silent — an unmounted volume passes every other check, and
only shows up as requests vanishing at a moment nobody connects to a deploy
that happened an hour earlier.

```bash
npm run volume -- https://your-domain   # leaves a marker
# redeploy
npm run volume -- https://your-domain   # says whether it survived
```

The marker is an ordinary pending request with a 24 h TTL, left unfilled. It
holds no secret and expires on its own.

## Backups

The volume holds one SQLite file. It contains ciphertext and metadata, never a
plaintext secret, and a request that has been read is wiped within 30 seconds.
A crash losing the file costs at most the requests currently in flight, so
backups are a convenience, not a safety requirement.

If you want one anyway, `sqlite3 chut.db ".backup /tmp/chut.bak"` is safe on a
live database; copying the file directly while the server is running is not.
