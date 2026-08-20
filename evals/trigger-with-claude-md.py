#!/usr/bin/env python3
"""Skill + a standing line in CLAUDE.md. The line is always in context, so it is
readable at the moment the need appears rather than only at turn one."""
import json, os, subprocess, sys, tempfile, shutil
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.join(HERE, '..', 'chut')

ALL = json.load(open(os.path.join(HERE, 'trigger.json')))
EVALS = [e for e in ALL if e['should_trigger']] + [e for e in ALL if not e['should_trigger']][:3]
RUNS = 2
CLAUDE_MD = """# Project notes

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
"""

def one(args):
    query, _ = args
    root = tempfile.mkdtemp(prefix='mdtrig-')
    try:
        dest = os.path.join(root, '.claude', 'skills', 'chut')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copytree(SKILL, dest)
        with open(os.path.join(root, 'CLAUDE.md'), 'w') as f:
            f.write(CLAUDE_MD)
        env = {k: v for k, v in os.environ.items() if k != 'CLAUDECODE'}
        p = subprocess.Popen(
            ['claude', '-p', query, '--model', 'claude-opus-5',
             '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
             '--dangerously-skip-permissions'],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=root, env=env, text=True)
        hit = False
        try:
            for line in p.stdout:
                try: e = json.loads(line)
                except Exception: continue
                if e.get('type') == 'assistant':
                    for c in e['message'].get('content', []):
                        if c.get('type') == 'tool_use':
                            blob = c.get('name', '') + json.dumps(c.get('input', {}))
                            if c.get('name') == 'Skill' and c.get('input', {}).get('skill') == 'chut':
                                hit = True
                            if 'chut.sh/v1/requests' in blob:
                                hit = True
                if hit: break
        finally:
            p.kill(); p.wait()
        return hit
    finally:
        shutil.rmtree(root, ignore_errors=True)

jobs = [(e['query'], i) for e in EVALS for i in range(RUNS)]
with ThreadPoolExecutor(max_workers=6) as pool:
    flat = list(pool.map(one, jobs))
print()
ok = 0
for n, e in enumerate(EVALS):
    hits = sum(flat[n*RUNS:(n+1)*RUNS])
    good = (hits >= 1) == e['should_trigger']
    ok += good
    want = 'should    ' if e['should_trigger'] else 'should NOT'
    print(f"{'ok  ' if good else 'FAIL'}  {want}  {hits}/{RUNS}   {e['query'][:66]}")
print(f"\n{ok}/{len(EVALS)} correct\n")
