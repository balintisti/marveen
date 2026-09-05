#!/usr/bin/env python3
"""TRIM ONE INDEX LINE'S PROSE UNDER THE LOCK, WITHOUT LOSING A REFERENCE.

Card 4b94fefa (second door). The overflow refusal in `memory-index-add.py` names TWO ways
out: trimming hooks, and `--evict`. `--evict` did not exist until today. Trimming existed
only as ADVICE -- measured 2026-09-05: exactly ONE script writes MEMORY.md under an flock
(memory-index-add.py) and ZERO trim it. So anyone following the advice hand-edited a file
six agents share, bypassing the only lock, which is the lost-update bug that lock exists to
prevent. It is not theoretical: headroom went 240 -> 1 in twenty minutes that afternoon, so
the write rate was high while the advice was being followed.

THE SPLIT, and it is the whole design (marveen, 2026-09-05):

    the TOOL keeps ..... the LOCK and the VERIFICATION   -- mechanical, and only a tool can
    the HUMAN keeps .... WHICH line and WHAT it should say -- editorial, and never a tool's

So this does not choose, shorten, or summarise anything. The caller supplies the replacement
text; this refuses to write it if it would cost a reference.

THE INVARIANT: the `.md` reference set is IDENTICAL before and after. Cut prose, never `.md`.
That is didi's rule, and it is the ONLY thing standing between a trim and a silent deletion:
the longest lines are long BECAUSE they are consolidated, and their extra references sit at
the END -- exactly where a careless trim cuts. A naive pass over the ten longest would drop
eight memories AS A FORMATTING CHANGE, with nothing about it looking like a removal.

Both directions of the difference are reported, not just "they differ": a reference LOST is a
memory dropped, a reference GAINED is a consolidation wearing a trim's clothes, and the two
need different answers.

WHAT IT REFUSES, deliberately:
  - a replacement whose reference set differs in either direction
  - a replacement that is not SHORTER (this recovers characters; a same-length reword is an
    editorial edit with no caller today, and pretending otherwise is how a tool grows a
    capability nobody asked for)
  - a selector matching zero or more than one index line (ambiguity is not a trim target)

NOT COVERED: adding a reference to a line -- CONSOLIDATION -- is the documented answer to the
LINE ceiling and is a different operation with the opposite invariant. It has no tool either.

Usage:
    memory-index-trim.py <selector.md> <newtext-file>   # '-' reads the new line from stdin
    memory-index-trim.py --check <selector.md>          # show the line and its refs, write nothing
"""
import fcntl
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# IMPORTED, NOT COPIED. MEM/INDEX/LIMIT/LINE_LIMIT live in the add script; a second copy
# drifts, and a trim tool measuring a stale ceiling is worse than no trim tool. The module
# has a __main__ guard, so importing it runs nothing.
_spec = importlib.util.spec_from_file_location(
    'memory_index_add', os.path.join(HERE, 'memory-index-add.py'))
_mia = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mia)

MEM, INDEX, LIMIT, LINE_LIMIT = _mia.MEM, _mia.INDEX, _mia.LIMIT, _mia.LINE_LIMIT
index_lines = _mia.index_lines

REF = re.compile(r'[^\s()\[\]]+\.md')


def refs(line):
    return sorted(set(REF.findall(line)))


def usage():
    lines = __doc__.strip().splitlines()
    i = next(i for i, l in enumerate(lines) if l.strip() == 'Usage:')
    return '\n'.join(lines[i:])


def find_line(text, selector):
    hits = [l for l in text.split('\n') if l.startswith('- [') and selector in l]
    if len(hits) != 1:
        raise SystemExit(
            f'REFUSING: selector {selector!r} matches {len(hits)} index lines, not 1.\n'
            + ('Nothing to trim.' if not hits else
               'Ambiguous. Use a reference that appears on exactly one line:\n'
               + '\n'.join(f'    {l[:100]}' for l in hits)))
    return hits[0]


def main():
    argv = sys.argv[1:]

    if argv and argv[0] == '--check':
        if len(argv) != 2:
            raise SystemExit(usage())
        old = find_line(_mia.read(INDEX), argv[1])
        print(f'{len(old)} characters, {len(refs(old))} reference(s)')
        print(f'refs: {", ".join(refs(old))}')
        print(old)
        return

    if len(argv) != 2:
        raise SystemExit(usage())
    selector, src = argv

    # READ THE REPLACEMENT BEFORE TAKING THE LOCK -- stdin can block on a human, and the
    # lock is shared with every agent's add. Never hold it while waiting for input.
    new = (sys.stdin.read() if src == '-' else _mia.read(src)).strip('\n')
    if '\n' in new:
        raise SystemExit('REFUSING: the replacement is more than one line.')
    if not new.startswith('- ['):
        raise SystemExit(f'REFUSING: the replacement is not an index line (must start "- ["):\n{new[:120]}')

    with open(INDEX, 'r+', encoding='utf-8') as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        s = fh.read()
        old = find_line(s, selector)

        lost = [r for r in refs(old) if r not in refs(new)]
        gained = [r for r in refs(new) if r not in refs(old)]
        if lost or gained:
            raise SystemExit(
                'REFUSING: the reference set changed. Cut prose, never `.md`.\n'
                + (f'  LOST (a memory would drop out of the index): {", ".join(lost)}\n' if lost else '')
                + (f'  GAINED (this is a consolidation, not a trim): {", ".join(gained)}\n' if gained else '')
                + f'  before: {", ".join(refs(old))}\n  after:  {", ".join(refs(new))}')

        if len(new) >= len(old):
            raise SystemExit(
                f'REFUSING: the replacement is {len(new)} characters against {len(old)} -- '
                'that is not a trim.\nThis tool only recovers characters. A same-length '
                'reword is an editorial edit\nand has no tool today; say so rather than '
                'routing it through this one.')

        s2 = s.replace(old, new, 1)
        fh.seek(0)
        fh.write(s2)
        fh.truncate()

    print(f'trimmed {selector}: {len(old)} -> {len(new)} characters (recovered {len(old) - len(new)})')
    print(f'references preserved: {len(refs(old))} ({", ".join(refs(old))})')
    print(f'index lines: {len(index_lines(s2))} | characters: {len(s2)} | headroom {LIMIT - len(s2)}')


if __name__ == '__main__':
    main()
