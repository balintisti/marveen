#!/usr/bin/env python3
"""Which commands does an instruction document name, and are they installed?

WHY THIS IS ITS OWN FILE. The extraction plus the path resolution is a `case`
inside a command substitution when written in bash, and a backtick or a quote
in one of the patterns then breaks the parse -- twice, while writing this.
A separate script also makes the rule testable on its own.

WHY THE RESOLUTION RULE MATTERS MORE THAN THE PATTERN (Marveen, 2026-08-22
23:54, catching the first version of this check): resolving every reference
against the tree the CHECKER runs in answers the wrong question. The author's
own branch always has the file -- that is the one place the answer is
guaranteed to be yes, and it is never the place the morning briefing runs
from. An absolute path in a document is a promise about a SPECIFIC tree.

  /Users/.../marveen/scripts/x.sh   -> check exactly that path
  $INSTALL_DIR/scripts/x.sh         -> resolved at runtime against the install
  scripts/x.sh                      -> relative to the install root

Usage:  doc-commands.py <document> <install_dir> [--list]
Output: one MISSING absolute path per line (nothing = everything is installed).
        --list prints every invocation found instead, for the two-list check.
Exit:   always 0 -- the caller decides what a missing file means.
"""
import os
import re
import sys

# The interpreter anchor is load-bearing: a bare `scripts/foo.sh` pattern fires
# on prose, and worst of all on the sentence explaining that some old script
# was REMOVED. Measured: three separate checks in one evening alarmed on their
# own documentation.
INVOCATION = re.compile(
    r'(?:bash|sh|python3)\s+(\$\{?INSTALL_DIR\}?/\S+|/\S*/scripts/\S+|scripts/\S+)'
)

TRAILING = chr(96) + '.,;:)"' + chr(39)


def code_only(text):
    """Whole-line comments dropped. A comment names a script precisely when it
    is explaining that the script is no longer called."""
    return '\n'.join(l for l in text.split('\n') if not re.match(r'^\s*#', l))


def invocations(text):
    return sorted({m.rstrip(TRAILING) for m in INVOCATION.findall(code_only(text))})


def resolve(ref, install_dir):
    if ref.startswith('$'):
        return os.path.join(install_dir, ref.split('/', 1)[1])
    if ref.startswith('/'):
        return ref
    return os.path.join(install_dir, ref)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 2:
        return
    doc, install_dir = args[0], args[1]
    try:
        text = open(doc, encoding='utf-8', errors='replace').read()
    except OSError:
        return
    for ref in invocations(text):
        target = resolve(ref, install_dir)
        if '--list' in sys.argv:
            print(f'{ref}\t{target}\t{"OK" if os.path.isfile(target) else "MISSING"}')
        elif not os.path.isfile(target):
            print(target)


if __name__ == '__main__':
    main()
    sys.exit(0)
