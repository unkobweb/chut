#!/usr/bin/env python3
"""Does the description make Claude reach for the skill? One process per run,
killed as soon as the Skill tool call appears, since that is the whole signal."""
import json, os, subprocess, sys, tempfile, shutil
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.join(HERE, '..', 'chut')

SKILL_SRC = sys.argv[1] if len(sys.argv) > 1 else SKILL
EVALS = json.load(open(os.path.join(HERE, 'trigger.json')))
RUNS = int(os.environ.get('RUNS', '2'))
MODEL = 'claude-opus-5'

def one(args):
    query, idx = args
    root = tempfile.mkdtemp(prefix='trig-')
    try:
        dest = os.path.join(root, '.claude', 'skills', 'chut')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copytree(SKILL_SRC, dest)
        env = {k: v for k, v in os.environ.items() if k != 'CLAUDECODE'}
        p = subprocess.Popen(
            ['claude', '-p', query, '--model', MODEL,
             '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=root, env=env, text=True)
        triggered = False
        try:
            for line in p.stdout:
                try: e = json.loads(line)
                except Exception: continue
                if e.get('type') == 'assistant':
                    for c in e['message'].get('content', []):
                        if c.get('type') == 'tool_use' and c.get('name') == 'Skill':
                            if c.get('input', {}).get('skill') == 'chut':
                                triggered = True
                if triggered: break
        finally:
            p.kill(); p.wait()
        return triggered
    finally:
        shutil.rmtree(root, ignore_errors=True)

jobs = [(e['query'], i) for e in EVALS for i in range(RUNS)]
with ThreadPoolExecutor(max_workers=6) as pool:
    flat = list(pool.map(one, jobs))

ok = 0
print()
for n, e in enumerate(EVALS):
    hits = sum(flat[n * RUNS:(n + 1) * RUNS])
    rate = hits / RUNS
    good = (rate >= 0.5) == e['should_trigger']
    ok += good
    want = 'should    ' if e['should_trigger'] else 'should NOT'
    print(f"{'ok  ' if good else 'FAIL'}  {want}  {hits}/{RUNS}   {e['query'][:70]}")
print(f"\n{ok}/{len(EVALS)} correct\n")
