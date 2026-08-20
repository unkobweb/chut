---
name: chut
description: "Ask a human for a credential — an API key, access token, password, or private key — through a one-time, browser-encrypted link instead of having them type it into the conversation. Use this skill at the START of any task that will need a secret the user holds and you do not: calling a third-party API, deploying to a host, pushing to a repository, connecting to a database, wiring up a webhook or an integration, or running a script that authenticates against a service. Check the environment first — if the credential is already there, carry on without this skill. Use it the moment you would otherwise ask them to paste a key in chat or to add one to a .env file, and whenever a command fails with 401 or 403 for want of a credential. Use it too when the user says they are about to give you a key. Anything pasted into a conversation stays in its history for as long as the history exists, and is re-sent to the model on every subsequent turn; this keeps it out."
version: 0.1.0
author: unkobweb
license: MIT
metadata:
  hermes:
    tags:
      - Security
      - Credentials
      - API keys
      - Secrets
---

# chut

An AI agent that needs its human's credential has, until now, had two bad
options: have them paste it into the chat, where it stays forever, or refuse to
help. chut is the third: the agent creates a request, the human opens a
short-lived link, and their **browser** encrypts the value before anything is
sent. The server only ever stores ciphertext, and destroys it after one read.

Service: `https://chut.sh`

## Before reaching for it

Most of the time the credential is already available, and creating a link would
be noise. Check, in this order:

1. **The environment.** `env | grep -i <service>`, or read the variable directly.
2. **Project files.** `.env`, `.env.local`, a config file, a credentials file the
   tool in question already knows about — `~/.aws/credentials`, `gh auth status`,
   `stripe config --list`.
3. **The tool's own auth.** Many CLIs are already logged in. `gh`, `aws`, `gcloud`,
   `stripe`, `vercel` and friends will tell you.

Only when the value genuinely is not there does chut apply. And only for things
that are actually secret: a project id, an account number, a public key or a
region is not a credential, and asking for one through a one-time link is
theatre that trains people to click links.

## When it does apply

The moment to recognise is the one where you are about to write a sentence like:

- "Please paste your API key here and I'll continue."
- "Add `STRIPE_SECRET_KEY=...` to your `.env` and let me know when it's done."
- "You'll need to set `GITHUB_TOKEN` first."
- "I can't run this without your database password."

Every one of those either puts a secret in the transcript or stops the task.
Send a link instead — it is faster for them than editing a file, and the value
never touches the conversation.

Also use it when they announce one: "I'll give you my key", "let me get you a
token". Do not let them paste it. Send the link first.

## How

### If the chut MCP server is available

You will see tools named `ask_human_for_secret`, `check_secret_request`,
`reveal_secret_to_file`, `reveal_secret`, `discard_secret_file` and
`cancel_secret_request`. Use them; they handle the credentials for you. Their
descriptions cover the details.

### Otherwise, three HTTP calls

**1. Create the request.**

```bash
curl -s -X POST https://chut.sh/v1/requests \
  -H 'content-type: application/json' \
  -d '{
    "requester": "<your name, honestly — e.g. Claude Code>",
    "label": "<what you need, in their words — e.g. GitHub personal access token>",
    "purpose": "<why, and what you will do with it>",
    "ttl_seconds": 900
  }'
```

You get back `{ id, url, poll_token, encryption_key }`.

Keep `poll_token` and `encryption_key` out of anything you say. Together they
read the secret, so a transcript containing them is a transcript worth stealing.
Write them to a file and read them back when you need them:

```bash
curl -s -X POST https://chut.sh/v1/requests -H 'content-type: application/json' \
  -d '{"requester":"Claude Code","label":"GitHub token","ttl_seconds":900}' \
  > /tmp/chut-req.json && chmod 600 /tmp/chut-req.json
jq -r .url /tmp/chut-req.json          # this is the only part you show
```

**2. Show the human the `url`, exactly as returned.**

Character for character, including everything after the `#`. That fragment is
the encryption key; the page cannot decrypt anything without it and will say so.
Do not shorten it, do not hide it behind link text, do not "tidy" it.

Then wait. Poll every few seconds:

```bash
curl -s https://chut.sh/v1/requests/$(jq -r .id /tmp/chut-req.json) \
  -H "x-poll-token: $(jq -r .poll_token /tmp/chut-req.json)" | jq -r .status
```

`pending` → keep waiting. `filled` → go on. `expired` or `cancelled` → tell them
and offer a fresh link.

**3. Read it, straight into a file.**

```bash
curl -s -X POST https://chut.sh/v1/requests/$(jq -r .id /tmp/chut-req.json)/reveal \
  -H 'content-type: application/json' \
  -d "$(jq -c '{poll_token, encryption_key}' /tmp/chut-req.json)" \
  | jq -j .secret > /tmp/chut-secret && chmod 600 /tmp/chut-secret
```

The redirect matters: nothing is printed, so nothing enters the conversation.
Then use it inside the command that needs it, never on its own:

```bash
curl -H "Authorization: Bearer $(cat /tmp/chut-secret)" https://api.github.com/user
GITHUB_TOKEN="$(cat /tmp/chut-secret)" gh repo list
```

Delete both files when you are done:

```bash
rm -f /tmp/chut-secret /tmp/chut-req.json
```

Reading destroys the secret server-side. If you need it again, ask again.

## The rules that carry the weight

**Never print the value.** Not to confirm it arrived, not to show what you
received, not in a summary of what you did. If you want to reassure them, say
what you did with it — "authenticated as `alexandre`" — not what it was.

**Never read the secret file on its own.** No `cat /tmp/chut-secret`, no `echo`,
no opening it with a file-reading tool, not even once to check the write worked.
Output goes into the conversation, which is the whole thing you were avoiding,
and the write already succeeded or you would have seen an error.

**Be truthful in `requester`.** The human is deciding whether to trust the
request, and it is the only thing they have to go on. Use your own name. Naming
a company you are not is how a phishing page reads, and the page deliberately
gives you no logo and no styling for exactly that reason.

**Say why in `purpose`.** A request with no reason is one a careful person
should refuse, and you want them refusing the ones that deserve it.

## If they are hesitant

Someone who was not expecting this is right to be careful, and the correct
answer is not reassurance. Tell them plainly that closing the tab costs nothing,
that the link expires on its own, and that you will find another way — then find
one. A person who learns to trust a page like this because an assistant pushed
them is a person who will trust the next one, which will be hostile.
