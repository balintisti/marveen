#!/usr/bin/env python3
"""Which shared files between two branches need a BEHAVIOUR measurement?

WHY THIS EXISTS (2026-08-23). Two branches touching the same file, with git
reporting no conflict, is not one situation but TWO -- and they carry very
different risk. Jarvis drew the line while checking my branches:

  DISZJUNKT hunks  -- the two edits are in different regions. The structure of
                      the merge already answers the question.
  ATFEDO hunks     -- the edits are in the SAME region and git merged them
                      anyway. Nothing is red, nothing is reported, and the
                      combined behaviour is simply unknown.

Measured that evening, all four with the same tool:
  src/db.ts, web/app.js            disjoint  -> structure was enough
  src/heartbeat.ts                 OVERLAP   -> needed a real merge + tests
  scripts/agent-msg.sh             OVERLAP   -> needed the merged file run

From the outside all four look identical: "shared file, no conflict". Telling
them apart by eye means reading two diffs and comparing line ranges by hand,
which is exactly the kind of check that gets skipped at one in the morning.

EXIT STATUS IS THE POINT: 1 when at least one file merges CLEANLY but has
overlapping hunks -- the silent class. A conflict is loud and needs no help
from this tool; the quiet case is what it exists to surface.

Usage:  merge-overlap.py <ref-a> <ref-b> [--base <ref>] [--quiet]
        default base: git merge-base <ref-a> <ref-b>
"""
import re
import subprocess
import sys

HUNK = re.compile(r'^@@ -(\d+)(?:,(\d+))? ', re.M)


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True).stdout


def touched(base, ref):
    return {l for l in git('diff', '--name-only', f'{base}...{ref}').split('\n') if l}


def hunks(base, ref, path):
    """Line ranges IN THE BASE that this branch rewrites."""
    out = []
    for m in HUNK.finditer(git('diff', f'{base}...{ref}', '--', path)):
        start = int(m.group(1))
        length = int(m.group(2) or 1)
        # A pure insertion reports length 0 at the line BEFORE the insert; treat
        # it as a one-line span so an insertion into a region someone else
        # rewrote still counts as touching it. Missing that would put the
        # riskiest edit of all -- a line added in the middle of a rewrite -- in
        # the "disjoint" column.
        out.append((start, start + max(length, 1) - 1))
    return out


def overlaps(a, b):
    return [(x, y) for x in a for y in b if x[0] <= y[1] and y[0] <= x[1]]


def conflicting(ref_a, ref_b):
    p = subprocess.run(['git', 'merge-tree', '--write-tree', ref_a, ref_b],
                       capture_output=True, text=True)
    return {l.split('in ')[-1] for l in p.stdout.split('\n') if l.startswith('CONFLICT')}


def main():
    # Parse --base by POSITION AFTER THE FLAG, not by counting the leftovers.
    # The first version took `args[2]` and happened to work only because the
    # base was always passed last; one reordered call would have silently used
    # a branch name as the base and reported nonsense with a straight face.
    argv = sys.argv[1:]
    base_opt = None
    positional = []
    i = 0
    while i < len(argv):
        if argv[i] == '--base' and i + 1 < len(argv):
            base_opt = argv[i + 1]
            i += 2
            continue
        if not argv[i].startswith('--'):
            positional.append(argv[i])
        i += 1
    if len(positional) < 2:
        print('usage: merge-overlap.py <ref-a> <ref-b> [--base <ref>] [--quiet]')
        return 2
    ref_a, ref_b = positional[0], positional[1]
    base = base_opt or git('merge-base', ref_a, ref_b).strip()
    if not base:
        print(f'NEM MERHETO: nincs kozos os {ref_a} es {ref_b} kozott')
        return 2
    quiet = '--quiet' in sys.argv

    shared = sorted(touched(base, ref_a) & touched(base, ref_b))
    conf = conflicting(ref_a, ref_b)
    risky = []

    if not quiet:
        print(f'bazis: {base[:12]}   kozos fajl: {len(shared)}')
    for path in shared:
        ha, hb = hunks(base, ref_a, path), hunks(base, ref_b, path)
        ov = overlaps(ha, hb)
        if path in conf:
            verdict = 'KONFLIKTUS (hangos, a git jelzi)'
        elif ov:
            verdict = f'ATFEDO -- VISELKEDES-MERES KELL ({len(ov)} atfedo hunk-par)'
            risky.append(path)
        else:
            verdict = 'diszjunkt -- a szerkezet eleg'
        if not quiet:
            print(f'  {path}')
            print(f'     {verdict}')
            if ov:
                for x, y in ov[:4]:
                    print(f'       {ref_a}:{x[0]}-{x[1]}  x  {ref_b}:{y[0]}-{y[1]}')

    # An empty sweep must not read as a pass: say when there was nothing to look
    # at, rather than printing a clean bill of health for zero files.
    if not shared and not quiet:
        print('  NINCS kozos fajl -- ez NEM azt jelenti, hogy a merge biztonsagos,')
        print('  csak azt, hogy ennek a meronek nem volt mit merni.')
    if risky and not quiet:
        print(f'\nVISELKEDES-MERES KELL {len(risky)} fajlra: {", ".join(risky)}')
    return 1 if risky else 0


if __name__ == '__main__':
    sys.exit(main())
