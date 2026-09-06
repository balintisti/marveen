#!/usr/bin/env python3
"""`--check` hop 2 must follow BOTH link forms, and the output must name its definition
(card a22c40d5 -- marveen's ruling 2026-09-06 05:28, one reason corrected 05:35).

The class this pins. The walk used to follow `[[stem]]` only at hop 2, while the ARCHIVES name
their contents in MARKDOWN. So the meter answered NO PATH for memories a reader reaches in one
click: 146 files on the live tree the day it was measured (181 -> 35 when the fix landed).

WHY THAT IS THE DANGEROUS DIRECTION, and not just an inaccurate number: NO PATH is the input to
`--evict`. A false NO PATH does not merely misreport -- it nominates a reachable memory for
removal, and once the index line is gone the file really is unreachable. The error erases its own
evidence. That is why test 3 exists at all.

TEST 3 IS THE ONE THAT MAKES 1 AND 2 MEAN ANYTHING. A meter that called everything reachable
would pass 1 and 2. Only the orphan proves the walk can still say no.

TEST 4 pins marveen's SECOND condition. A number without its definition is not a claim, and this
change re-interprets every earlier count (176 / 30 / 27 / 181 are all wiki-only). Untested, that
condition is prose.

TEST 5 pins a silent degradation closed in the same edit: a body that could not be READ used to
become '' , which contributes no outbound links and pushes OTHER files toward NO PATH -- the same
silent zero the directory-level handler already refuses. It now says the count is a FLOOR. The
second half (no FLOOR line when everything is readable) is the control: a banner that is always
there measures nothing.

LIMIT, stated: depth 3+ is NO PATH BY DESIGN and is not pinned here -- the ruling was about link
FORMS at hop 2, not about depth. Test 5 needs chmod to actually deny reads; if it does not (root),
the test reports SKIP rather than passing quietly.

NOT WIRED TO CI: `npm test` is vitest and does not collect Python (card 27975b85).
Run: python3 <thisfile>   Exit 0 = all pass.
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SCRIPT = os.path.join(ROOT, "scripts", "memory-index-add.py")
FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else "  -- " + str(detail)))
    if not cond:
        FAILS.append(name)


def run(mem):
    env = dict(os.environ, MARVEEN_MEMORY_DIR=mem, MARVEEN_SNAPSHOT_REPO="/nonexistent-on-purpose")
    p = subprocess.run([sys.executable, SCRIPT, "--check"], capture_output=True, text=True, env=env)
    return p.stdout + p.stderr


def fixture(mem):
    """One directly linked hub; one target per link form; one orphan nothing points at."""
    os.makedirs(mem, exist_ok=True)
    with open(os.path.join(mem, "MEMORY.md"), "w", encoding="utf-8") as fh:
        fh.write("- [Hub](hub.md) - the only line the index carries\n")
    with open(os.path.join(mem, "hub.md"), "w", encoding="utf-8") as fh:
        fh.write("wiki form: [[wiki-target]]\nmarkdown form: [label](md-target.md)\n")
    for name in ("wiki-target.md", "md-target.md", "orphan.md"):
        with open(os.path.join(mem, name), "w", encoding="utf-8") as fh:
            fh.write("body\n")


def main():
    mem = tempfile.mkdtemp(prefix="hop2-")
    try:
        fixture(mem)
        out = run(mem)

        check("1. markdown-only at hop 2 is NOT NO PATH (the ruling)",
              "NO PATH: md-target.md" not in out, out)
        check("2. wiki-only at hop 2 is still NOT NO PATH (no regression on the old form)",
              "NO PATH: wiki-target.md" not in out, out)
        check("3. CONTROL -- a true orphan IS still NO PATH (the walk can say no)",
              "NO PATH: orphan.md" in out, out)
        check("4. the output NAMES the definition it counted with",
              "definition:" in out and "[[wiki]]" in out and "markdown" in out, out)

        # 5. an unreadable body must make the verdict a FLOOR -- and must not say so otherwise
        check("5a. CONTROL -- no FLOOR line when every body is readable",
              "FLOOR" not in out, out)
        hub = os.path.join(mem, "hub.md")
        os.chmod(hub, 0o000)
        try:
            denied = not os.access(hub, os.R_OK)
            out2 = run(mem)
        finally:
            os.chmod(hub, 0o644)
        if not denied:
            print("  SKIP 5b. chmod did not deny reads (running as root?) -- NOT a pass")
        else:
            check("5b. an unreadable body makes UNREACHABLE a stated FLOOR",
                  "FLOOR" in out2, out2)
    finally:
        shutil.rmtree(mem, ignore_errors=True)

    print(("FAIL: " + ", ".join(FAILS)) if FAILS else "all pass")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
