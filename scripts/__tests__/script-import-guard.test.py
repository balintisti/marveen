#!/usr/bin/env python3
"""Contract: the two scripts that ACT AT IMPORT do not act when imported.

CARD e479b940. The hazard is not a bare import -- that already failed loudly on
an argv unpack. It is an importer that carries argv of its own: the module then
read those entries as its own arguments and did the outward thing. Measured
population: two files, and the side effects are not cosmetic.

    scripts/watchdog-replay.py ... tmux send-keys into a live agent pane
    scripts/polarity-sweep.py .... rewrites a TRACKED source file in place

WHY A POSITIVE CONTROL IS THE WHOLE TEST. "Nothing happened" is exactly what a
test that never executed the module also reports. So each case runs TWICE: once
against the shipped file, and once against a copy with the guard STRIPPED. If
the stripped copy does not act, the harness is not reaching module top level and
the green half proves nothing.

The discriminator is deliberately the FIRST argv-driven read in each module, not
the destructive call: pointing it at a path that does not exist makes an
unguarded import raise, and a guarded one import cleanly. Nothing is written,
no tmux exists in the loop, and the test stays fast.

THIS FILE NEEDS NO WIRING, AND THE COMMIT THAT ADDED IT SAID OTHERWISE.
`src/__tests__/scripts-shell-tests.test.ts` (card 4df370d9) DISCOVERS every
`*.test.(sh|py)` in this directory and runs one `it` per file -- 45 before this
one, 46 after, visible in the suite output. The wrapper spec that shipped
alongside this file was redundant and ran the contract twice per suite; it is
removed. Its own docblock argues against per-file wrappers in as many words.

Run it alone with:  python3 scripts/__tests__/script-import-guard.test.py
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUARD = re.compile(r"^if __name__ == '__main__':\n    main\(\)\n", re.M)

# (script, argv the importer would carry -- enough entries to reach the read)
CASES = [
    ('scripts/watchdog-replay.py', ['sess', 'friday', '0', '/nonexistent/data.json', '/dev/null']),
    ('scripts/polarity-sweep.py', ['/nonexistent/screen.txt', '/dev/null']),
]

failures = []
checks = 0


def import_module_file(path: Path, argv: list) -> subprocess.CompletedProcess:
    """Import the file the way an importer would: top level runs, __name__ is not __main__."""
    runner = (
        'import importlib.util,sys\n'
        f'spec=importlib.util.spec_from_file_location("subject", r"{path}")\n'
        'm=importlib.util.module_from_spec(spec)\n'
        'spec.loader.exec_module(m)\n'
    )
    return subprocess.run(
        [sys.executable, '-c', runner, *argv],
        capture_output=True, text=True, timeout=30, cwd=ROOT,
    )


def check(label: str, cond: bool, detail: str = '') -> None:
    global checks
    checks += 1
    if cond:
        print(f'  ok   {label}')
    else:
        print(f'  FAIL {label}  {detail}')
        failures.append(label)


for rel, argv in CASES:
    src = ROOT / rel
    print(f'{rel}:')

    text = src.read_text(encoding='utf-8')
    check(f'{rel}: ships a __main__ guard', bool(GUARD.search(text)))

    # 1. THE SHIPPED FILE: imported with a poisoned argv, it must do nothing.
    r = import_module_file(src, argv)
    check(
        f'{rel}: importing with inherited argv is inert',
        r.returncode == 0 and not r.stderr.strip(),
        f'rc={r.returncode} stderr={r.stderr.strip()[:160]!r}',
    )

    # 2. THE POSITIVE CONTROL: the same import with the guard stripped MUST act,
    #    or step 1 was measuring an import that never ran.
    with tempfile.TemporaryDirectory() as d:
        stripped = Path(d) / src.name
        body = GUARD.sub('main()\n', text)
        if body == text:
            # A FAILED CHECK, NEVER AN `assert`: when the guard is already gone
            # the control cannot be built, and a crash here would also take the
            # NEXT case down with it -- turning one defect into no measurement.
            check(f'{rel}: CONTROL is buildable (guard found to strip)', False,
                  'no guard to remove, so the inert result above proves nothing')
            continue
        stripped.write_text(body, encoding='utf-8')
        rc = import_module_file(stripped, argv)
        check(
            f'{rel}: CONTROL -- without the guard the same import DOES act',
            rc.returncode != 0 and 'FileNotFoundError' in rc.stderr,
            f'rc={rc.returncode} stderr={rc.stderr.strip()[-160:]!r}',
        )

print(f'\n{checks - len(failures)}/{checks} checks passed')
sys.exit(1 if failures else 0)
