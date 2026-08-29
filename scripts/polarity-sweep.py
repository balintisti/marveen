#!/usr/bin/env python3
"""Polarity sweep: invert every single-line `if (...) {` condition in a target
module, one at a time, and run a screen set of specs against each mutation.

    CAUGHT   the screen set went red -> the polarity is pinned
    SURVIVED the screen set stayed green -> CANDIDATE (confirm on the full suite)
    BROKEN   the run never started (syntax) -> NOT MEASURED, not a result

Two limits, stated because a limit in the last paragraph does not limit:
  1. Only the FULL condition is negated. `&&` -> `||` is a different question,
     not measured here.
  2. Multi-line `if (` conditions are NOT MEASURED. The count is printed, so
     "not measured" never reads as "no finding".

A SURVIVED verdict from the screen set is a candidate, never a finding: a distant
spec can catch what the screen set cannot see. CAUGHT is evidence in itself --
a failure cannot disappear in a larger suite.

Usage: python3 scripts/polarity-sweep.py <screen-set-file> <out.tsv> [target.ts]
"""
import re, subprocess, sys, os, collections

SRC = sys.argv[3] if len(sys.argv) > 3 else 'src/web/schedule-runner.ts'
screen = [l.strip() for l in open(sys.argv[1]) if l.strip()]

orig = open(SRC).read()
lines = orig.split('\n')

single = re.compile(r'^(\s*)if \((.+)\) \{$')
multi = re.compile(r'^\s*if \($')
cands = [(i, m.group(1), m.group(2)) for i, l in enumerate(lines) if (m := single.match(l))]
skipped = [i + 1 for i, l in enumerate(lines) if multi.match(l)]

# The loop states its own denominator and first element -- a loop that runs once
# when you expected N is otherwise indistinguishable from a clean result.
print(f"# target ............ {SRC}")
print(f"# candidates ........ {len(cands)}   first=[line {cands[0][0]+1}: {cands[0][2][:60]}]" if cands else "# candidates ........ 0")
print(f"# NOT MEASURED ...... {len(skipped)} multi-line conditions -> {skipped}")
print(f"# screen set ........ {len(screen)} spec files")
print(flush=True)


def run_screen():
    r = subprocess.run(['npx', 'vitest', 'run', *screen],
                       capture_output=True, text=True, timeout=900)
    out = r.stdout + r.stderr
    if 'Test Files' not in out:
        return 'BROKEN', out[-300:]
    return ('CAUGHT' if r.returncode != 0 else 'SURVIVED'), ''


results = []
try:
    for i, indent, cond in cands:
        lines[i] = f'{indent}if (!({cond})) {{'
        open(SRC, 'w').write('\n'.join(lines))
        # Control: the mutation must actually have changed the file. A patch that
        # silently fails to apply produces a verdict that looks exactly like a real one.
        assert open(SRC).read() != orig, f"mutation at line {i+1} did not change the file"
        verdict, extra = run_screen()
        lines[i] = f'{indent}if ({cond}) {{'
        results.append((i + 1, cond, verdict))
        print(f"{i+1:5d}  {verdict:9s}  {cond[:88]}", flush=True)
        if extra:
            print(f"        ^ {extra.strip()[:200]}", flush=True)
finally:
    # Restore from the in-memory original, never `git checkout`: if the tree under
    # test carries uncommitted work, checkout deletes the very thing being measured.
    open(SRC, 'w').write(orig)
    assert open(SRC).read() == orig

print()
print("# SUMMARY:", dict(collections.Counter(v for _, _, v in results)))
with open(sys.argv[2], 'w') as f:
    for ln, cond, v in results:
        f.write(f"{ln}\t{v}\t{cond}\n")
