#!/usr/bin/env python3
"""FOLD INDEX LINES INTO A HOST LINE UNDER THE LOCK, WITHOUT LOSING A REFERENCE.

Card 4befae32. `memory-index-trim.py` names this operation in its own NOT COVERED section --
"adding a reference to a line -- CONSOLIDATION -- is the documented answer to the LINE ceiling
and is a different operation with the opposite invariant. It has no tool either." This is that
tool, and it exists because the missing operation SHAPED THE STRATEGY: measured 2026-09-05, two
approved coordinator decisions could not be executed with the existing set (`--evict` has no
standalone mode and refuses to loop; trim refuses both halves of a consolidation), so trimming
ran to exhaustion instead -- yields 2139 -> 479 -> 27, 36, 47 -> 24, 10 -- not because it was
the right remedy but because it was the only one that ran.

THE SPLIT IS UNCHANGED, and it is why this does not compose the merged text itself:

    the TOOL keeps ..... the LOCK and the VERIFICATION   -- mechanical, and only a tool can
    the HUMAN keeps .... WHICH lines and WHAT they say   -- editorial, and never a tool's

DELIBERATE DEPARTURE FROM THE CARD'S SKETCH. The card proposed
`memory-index-fold.py <host.md> <fold1.md> ...` with no replacement text, which would make the
tool WRITE the merged prose. That is the one thing the trim docblock refuses to do, and it says
why: "pretending otherwise is how a tool grows a capability nobody asked for." So the caller
supplies the new host line, exactly as with a trim, and this refuses to write it if it would
cost a reference. The signature is the card's minus that capability -- recorded here rather
than silently, because the card is the thing the next reader will check this against.

THE INVARIANT, the mirror image of the trim's:

    the trim ..... the reference set is IDENTICAL; the text SHRINKS
    the fold ..... the references CONSOLIDATE; EVERY folded reference SURVIVES on the host

So the two tools refuse on opposite conditions, and neither can stand in for the other. A trim
that gains a reference is a consolidation in a trim's clothes; a fold that loses one is a
deletion in a fold's clothes. Both are silent, and both look like formatting.

WHAT IT REFUSES, deliberately:
  - a new host line missing ANY reference from the host or from any folded line (the whole point)
  - a new host line carrying a reference that came from NOWHERE -- not on the host, not on any
    folded line. That is a new memory smuggled in under a fold, and it is the mirror of the
    trim's GAINED check. `memory-index-add.py` is the tool for a new entry.
  - a selector matching zero or more than one index line, on either side (ambiguity is not a target)
  - the host appearing among the folded selectors (a line cannot absorb itself)
  - the same line named twice among the folded selectors
  - an operation that does not SHRINK the file -- this recovers characters AND lines; a fold that
    grows the file has no caller, and the ceiling it exists to serve is a size ceiling

WHY THE LOCK IS LOAD-BEARING, not ceremony: six agents write MEMORY.md through a shared inode,
by PREPEND. Measured 2026-09-05, one agent's save LANDED DURING a trim run and the lock caught
it. A hand-edited consolidation would have dropped that line silently, and the loss would look
exactly like the truncation this file exists to prevent.

Usage:
    memory-index-fold.py <host-selector> <newtext-file> <fold-selector> [<fold-selector> ...]
        '-' reads the new host line from stdin
    memory-index-fold.py --check <host-selector> <fold-selector> [<fold-selector> ...]
        show what would be merged and the reference union, write nothing
"""
import fcntl
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# IMPORTED, NOT COPIED -- same reason as the trim tool: MEM/INDEX/LIMIT/LINE_LIMIT live in the
# add script, and a second copy drifts. A fold tool measuring a stale ceiling is worse than none.
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


def find_line(text, selector, what):
    hits = [l for l in text.split('\n') if l.startswith('- [') and selector in l]
    if len(hits) != 1:
        raise SystemExit(
            f'REFUSING: {what} selector {selector!r} matches {len(hits)} index lines, not 1.\n'
            + ('Nothing to fold.' if not hits else
               'Ambiguous. Use a reference that appears on exactly one line:\n'
               + '\n'.join(f'    {l[:100]}' for l in hits)))
    return hits[0]


def resolve(text, host_sel, fold_sels):
    """Host line, folded lines, and the reference union -- refusing on overlap."""
    if len(set(fold_sels)) != len(fold_sels):
        raise SystemExit('REFUSING: the same selector is named twice among the folded lines.')
    host = find_line(text, host_sel, 'host')
    folded = []
    for sel in fold_sels:
        line = find_line(text, sel, 'folded')
        if line == host:
            raise SystemExit(
                f'REFUSING: selector {sel!r} resolves to the HOST line. A line cannot absorb itself.')
        if line in folded:
            raise SystemExit(
                f'REFUSING: selector {sel!r} resolves to a line already named by another selector.')
        folded.append(line)
    union = sorted(set(refs(host)).union(*(set(refs(l)) for l in folded)))
    return host, folded, union


def main():
    argv = sys.argv[1:]

    if argv and argv[0] == '--check':
        if len(argv) < 3:
            raise SystemExit(usage())
        host, folded, union = resolve(_mia.read(INDEX), argv[1], argv[2:])
        total = len(host) + sum(len(l) for l in folded)
        print(f'host   ({len(host)} chars, {len(refs(host))} ref): {host[:110]}')
        for l in folded:
            print(f'fold   ({len(l)} chars, {len(refs(l))} ref): {l[:110]}')
        print(f'\nthe new host line MUST carry all {len(union)} reference(s):')
        print(f'  {", ".join(union)}')
        print(f'\n{len(folded) + 1} lines -> 1, {total} characters before; '
              f'the replacement must be shorter than {total}.')
        return

    if len(argv) < 3:
        raise SystemExit(usage())
    host_sel, src, fold_sels = argv[0], argv[1], argv[2:]

    # READ THE REPLACEMENT BEFORE TAKING THE LOCK -- stdin can block on a human, and the lock is
    # shared with every agent's add. Never hold it while waiting for input. (Same as the trim.)
    new = (sys.stdin.read() if src == '-' else _mia.read(src)).strip('\n')
    if '\n' in new:
        raise SystemExit('REFUSING: the replacement is more than one line.')
    if not new.startswith('- ['):
        raise SystemExit(
            f'REFUSING: the replacement is not an index line (must start "- ["):\n{new[:120]}')

    with open(INDEX, 'r+', encoding='utf-8') as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        s = fh.read()
        host, folded, union = resolve(s, host_sel, fold_sels)

        lost = [r for r in union if r not in refs(new)]
        nowhere = [r for r in refs(new) if r not in union]
        if lost or nowhere:
            raise SystemExit(
                'REFUSING: the reference set is wrong. A fold CONSOLIDATES references; it never drops one.\n'
                + (f'  LOST (a memory would drop out of the index): {", ".join(lost)}\n' if lost else '')
                + (f'  FROM NOWHERE (not on the host, not on any folded line -- use memory-index-add.py): '
                   f'{", ".join(nowhere)}\n' if nowhere else '')
                + f'  required: {", ".join(union)}\n  supplied: {", ".join(refs(new))}')

        before = len(s)
        s2 = s
        for line in folded:
            # Remove the folded line WITH its newline, so the file loses a line, not just text.
            if line + '\n' in s2:
                s2 = s2.replace(line + '\n', '', 1)
            else:
                s2 = s2.replace(line, '', 1)
        s2 = s2.replace(host, new, 1)

        if len(s2) >= before:
            raise SystemExit(
                f'REFUSING: the result is {len(s2)} characters against {before} -- that is not a fold.\n'
                'This recovers characters AND lines. A consolidation that grows the file has no\n'
                'caller today, and the ceiling it serves is a size ceiling.')

        fh.seek(0)
        fh.write(s2)
        fh.truncate()

    saved = before - len(s2)
    print(f'folded {len(folded)} line(s) into {host_sel}: {len(folded) + 1} -> 1 lines, '
          f'recovered {saved} characters')
    print(f'references preserved: {len(union)} ({", ".join(union)})')
    print(f'index lines: {len(index_lines(s2))} | characters: {len(s2)} | headroom {LIMIT - len(s2)}')


if __name__ == '__main__':
    main()
