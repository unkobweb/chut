# The chut skill

A serving suggestion, and the thing that decides whether chut is used at all.

The MCP server answers *how* an agent asks its human for a credential. Neither it
nor a skill answers *when*, and that turns out to be the harder half.

## Install

**Claude Code** — per project, or `~/.claude/skills/` for all of them:

```bash
mkdir -p .claude/skills && cp -r path/to/chut/skills/chut .claude/skills/
```

**Cowork / Claude Desktop** — the same folder, wherever your skills live.

The skill works on its own: it drives the HTTP API with `curl` and `jq`, so it
needs nothing installed. If [`chut-mcp`](../packages/mcp) is also connected it
uses those tools instead, which is tidier.

## Then add this to your CLAUDE.md

This part is not optional if you want chut to fire on its own. Measurements
below.

```markdown
## Credentials

Reach for a credential the normal way first: an environment variable, a `.env`, a
config file, a CLI that is already logged in. If the value is there, read it and
carry on — that is the common case and nothing below applies.

When it genuinely is not there, do not ask me to paste it in the chat and do not
tell me to add it to a `.env` myself. The first leaves it in the transcript
forever; the second stops the task. Use the `chut` skill instead: it sends me a
one-time link that encrypts the value in my browser, and you read it once.

Notice this at the moment the need appears, not only when I mention it — halfway
through a task counts, and so does a command that has just failed with a 401.
```

## Why both

A skill is selected at the *start* of a turn, from what you typed. Say "deploy
this branch to Vercel" and nothing in that sentence is about credentials — the
need only surfaces later, when the agent tries and gets a 401. By then the skill
list has already been consulted and passed over.

A line in `CLAUDE.md` is in context the whole time, so it is readable at the
moment the need appears rather than only at the moment you asked.

Neither replaces the other. The skill carries the procedure and the rules; the
`CLAUDE.md` line carries the reflex.

## Measured

Twelve realistic prompts, six that should trigger and six near-misses chosen to
be genuinely tricky — "STRIPE_SECRET_KEY is already in my env, run the script",
"there's an API key hardcoded somewhere, grep for it so I can revoke it". Each
run twice against `claude -p` with the skill actually installed.

| | fires when it should | stays quiet when it should |
|---|---|---|
| MCP server alone | 2 / 6 | — |
| Skill alone | 2 / 6 | 6 / 6 |
| Skill + `CLAUDE.md` | **5 / 6** | **6 / 6** |

The one that still never fires: *"run the script that pulls my Stripe invoices"*.
The agent runs it, watches it fail, and reports the failure — reasonably, since
from where it stands the script is simply broken. Worth knowing rather than
papering over.

Rerun it yourself after any edit to the description, because a rewrite that reads
better can easily trigger worse:

```bash
python3 evals/trigger-skill.py             # skill only
python3 evals/trigger-with-claude-md.py    # skill + the standing instruction
```

Both need the `claude` CLI on your PATH. Roughly ten minutes each.
