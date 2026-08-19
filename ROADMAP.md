# Roadmap

## Next up

### RTL has never been exercised
The layout mirrors for Arabic, Persian and Hebrew, and the mockups showed it
working — but no Arabic translation shipped, so nothing has actually rendered
right to left outside a design file. The first RTL language added is also a test
of code nobody has run.

### ~~i18n for the human-facing page~~ — done for four languages
English, French, Spanish and German. Only the English has been read by anyone;
`REVIEW` in `i18n.ts` records that rather than letting it be assumed. Adding a
language is one entry in `MESSAGES`, and the `Messages` interface makes a missing
string a compile error — but a *stale* one is invisible, so walk `REVIEW` when the
English changes.

### superseded — original i18n plan
The form is the only screen a non-technical person ever sees, and it is the screen
where they decide whether to trust the request. Showing it in a language they do
not read defeats the purpose of the warning box.

Plan: detect `Accept-Language`, allow a `?lang=` override, fall back to English.
Translations live as plain objects (no framework); the agent may also pin a locale
at creation time via a `locale` field, since it usually knows its human's language.

### Close the remaining audit findings
An adversarial review found 11 issues. Each gets a failing test first, then the fix.

Closed: reveal race, unbounded `iv` and request body, unauthenticated `/done`
leaking the label, rate limiting that covered neither failed auth nor the public
routes, `burn_on_reveal` failing open on non-boolean input, blindly trusted
forwarding headers, `poll_token` accepted from the query string, and link-preview
crawlers inflating `opened_count`, cross-site writes to the fill endpoint, and
non-object JSON bodies reaching the error handler as a 500.

Open: unfiltered Unicode control characters in agent-supplied text.

## Later

### Proxy mode
Today the revealed secret enters the agent's context window, so it can reach the
model provider's logs. In proxy mode the agent keeps only a handle and asks the
service to perform the HTTP call with the credential injected server-side. The
model never sees the value. This is the last structural hole in the threat model.

### OAuth providers
A text field works for API keys, but Gmail and friends need OAuth. The link would
become "connect your Gmail" rather than "paste your key", with the refresh token
held server-side and the agent holding a handle.

### The rest of the suite
Same lifecycle (created -> pending -> filled -> consumed), different payload:
human-in-the-loop approval, ephemeral file upload, generic form. When the second
tool lands, the shared substrate gets extracted into a `core` package that every
tool depends on, so a security fix is released once rather than copied N times.
