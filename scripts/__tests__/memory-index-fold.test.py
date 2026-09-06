#!/usr/bin/env python3
"""The fold tool must take the LOCK and CONSOLIDATE references without losing one (card 4befae32).

The class this pins. `memory-index-trim.py` names consolidation in its own NOT COVERED section:
the documented answer to the LINE ceiling, opposite invariant, "no tool either". The absence was
not neutral -- measured 2026-09-05, it SHAPED THE STRATEGY: two approved coordinator decisions
were unexecutable, so trimming ran to exhaustion (yields 2139 -> 479 -> 27, 36, 47 -> 24, 10)
because it was the only operation that ran, not because it was the right one.

The invariant is the MIRROR of the trim's, and that is why neither tool can stand in for the
other:

    the trim ..... the reference set is IDENTICAL; the text SHRINKS
    the fold ..... the references CONSOLIDATE; EVERY folded reference SURVIVES on the host

So a fold that loses a reference is a DELETION in a fold's clothes -- silent, and it looks like
formatting. That is test 3, made deliberately, dropping the reference that sits at the END of the
merged line, which is exactly where a careless merge truncates.

Test 8 is the one that separates this tool from a hand-edit with extra steps: everything else
would pass on a version with no flock at all. Six agents write MEMORY.md through a shared inode
by PREPEND, and on 2026-09-05 one agent's save LANDED DURING a trim run and the lock caught it.

NOT WIRED TO vitest: `npm test` does not collect Python. Collected by
scripts/run-python-contract-tests.py.

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SCRIPT = os.path.join(ROOT, "scripts", "memory-index-fold.py")
FAILS = []

REF = re.compile(r'[^\s()\[\]]+\.md')

HOST = "- [Host alak](host.md) — a befogado sor, boven hosszu prozaval a vegen"
FOLD1 = "- [Elso beolvasztando](egy.md) — sajat proza, ami a merge utan rovidul"
FOLD2 = "- [Masodik beolvasztando](ketto.md) — es meg egy adag proza a vegehez"
OTHER = "- [Erintetlen](maganyos.md) — ez a sor vegig valtozatlan kell maradjon"


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else "  -- " + str(detail)))
    if not cond:
        FAILS.append(name)


def fixture(mem):
    shutil.rmtree(mem, ignore_errors=True)
    os.makedirs(mem)
    for fn in ("host.md", "egy.md", "ketto.md", "maganyos.md"):
        open(os.path.join(mem, fn), "w").write("# " + fn + "\n")
    open(os.path.join(mem, "MEMORY.md"), "w").write(
        "# MEMORY\n\n" + HOST + "\n" + FOLD1 + "\n" + FOLD2 + "\n" + OTHER + "\n")


def run(mem, *args, stdin=None):
    env = dict(os.environ, MARVEEN_MEMORY_DIR=mem)
    p = subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True,
                       env=env, input=stdin)
    return p.returncode, p.stdout + p.stderr


def index_text(mem):
    return open(os.path.join(mem, "MEMORY.md"), encoding="utf-8").read()


def file_refs(mem):
    """The reference set of the WHOLE file -- the card's stated control for a valid fold."""
    return sorted(set(REF.findall(index_text(mem))))


def index_line_count(mem):
    return len([l for l in index_text(mem).split("\n") if l.startswith("- [")])


# A valid merged host line: carries ALL THREE references, and is shorter than the three
# originals put together.
MERGED = "- [Host alak](host.md) — rovid; [elso](egy.md) — rovid; [masodik](ketto.md) — rovid"


def main():
    tmp = tempfile.mkdtemp(prefix="memfold-")
    mem = os.path.join(tmp, "memory")
    try:
        print("1. --check reports the host, the folded lines and the reference UNION")
        fixture(mem)
        rc, out = run(mem, "--check", "host.md", "egy.md", "ketto.md")
        check("exits clean", rc == 0, out[:200])
        check("names all three references",
              all(r in out for r in ("host.md", "egy.md", "ketto.md")), out[:300])
        check("writes nothing", index_line_count(mem) == 4)

        print("2. POSITIVE CONTROL: a valid fold applies, and the FILE-WIDE reference set is identical")
        fixture(mem)
        before_refs, before_len = file_refs(mem), len(index_text(mem))
        rc, out = run(mem, "host.md", "-", "egy.md", "ketto.md", stdin=MERGED)
        check("exits clean", rc == 0, out[:300])
        check("3 index lines became 2 (the two folded lines are gone)",
              index_line_count(mem) == 2, index_line_count(mem))
        check("THE FILE-WIDE .md REFERENCE SET IS UNCHANGED", file_refs(mem) == before_refs,
              f"{before_refs} -> {file_refs(mem)}")
        check("the file shrank", len(index_text(mem)) < before_len)
        check("the untouched line is untouched", OTHER in index_text(mem))
        check("reports characters recovered", "recovered" in out, out[:200])

        print("3. M1 -- DROPPING a folded reference is refused (a deletion in a fold's clothes)")
        fixture(mem)
        lossy = "- [Host alak](host.md) — rovid; [elso](egy.md) — rovid"   # ketto.md cut off the END
        rc, out = run(mem, "host.md", "-", "egy.md", "ketto.md", stdin=lossy)
        check("refuses", rc != 0 and "REFUSING" in out, out[:200])
        check("names the LOST reference specifically", "LOST" in out and "ketto.md" in out, out[:300])
        check("the index is unchanged", index_line_count(mem) == 4 and FOLD2 in index_text(mem))

        print("4. a reference FROM NOWHERE is refused (the mirror of the trim's GAINED check)")
        fixture(mem)
        smuggled = MERGED + "; [uj](maganyos.md)"
        rc, out = run(mem, "host.md", "-", "egy.md", "ketto.md", stdin=smuggled)
        check("refuses", rc != 0 and "REFUSING" in out, out[:200])
        check("names it and points at the add tool",
              "FROM NOWHERE" in out and "maganyos.md" in out and "memory-index-add" in out, out[:320])

        print("5. M2 -- a missing/ambiguous selector is refused, on EITHER side")
        fixture(mem)
        rc, out = run(mem, "nincs-ilyen.md", "-", "egy.md", stdin=MERGED)
        check("missing HOST refused", rc != 0 and "host selector" in out and "0 index lines" in out, out[:220])
        rc, out = run(mem, "host.md", "-", "nincs-ilyen.md", stdin=MERGED)
        check("missing FOLDED refused", rc != 0 and "folded selector" in out and "0 index lines" in out, out[:220])
        rc, out = run(mem, ".md", "-", "egy.md", stdin=MERGED)
        check("ambiguous HOST refused", rc != 0 and "index lines, not 1" in out, out[:220])
        check("the index is unchanged after all three", index_line_count(mem) == 4)

        print("6. a line cannot absorb itself, and the same line cannot be named twice")
        fixture(mem)
        rc, out = run(mem, "host.md", "-", "host.md", stdin=MERGED)
        check("host among the folded selectors refused",
              rc != 0 and "cannot absorb itself" in out, out[:220])
        rc, out = run(mem, "host.md", "-", "egy.md", "egy.md", stdin=MERGED)
        check("duplicate folded selector refused", rc != 0 and "twice" in out, out[:220])

        print("7. M4 -- a result that does not SHRINK the file is refused")
        fixture(mem)
        padding = " es meg egy jo adag toldalek, hogy a vegeredmeny hosszabb legyen mint a harom eredeti egyutt" * 3
        rc, out = run(mem, "host.md", "-", "egy.md", "ketto.md", stdin=MERGED + padding)
        check("refuses", rc != 0 and "not a fold" in out, out[:260])
        check("the index is unchanged", index_line_count(mem) == 4)

        print("8. a replacement that is not an index line, or is multi-line, is refused")
        fixture(mem)
        rc, out = run(mem, "host.md", "-", "egy.md", stdin="csak sima szoveg")
        check("non-index-line refused", rc != 0 and "not an index line" in out, out[:200])
        rc, out = run(mem, "host.md", "-", "egy.md", stdin=MERGED + "\n" + OTHER)
        check("multi-line refused", rc != 0 and "more than one line" in out, out[:200])

        print("9. M3 -- IT ACTUALLY TAKES THE LOCK (the whole reason this is a tool)")
        # Everything above would pass on a version with no flock at all. A holder takes LOCK_EX
        # and signals; the fold must BLOCK. The control is the same fold with no holder: if that
        # also timed out, this would be measuring slowness, not mutual exclusion.
        fixture(mem)
        holder = subprocess.Popen(
            [sys.executable, "-c",
             "import fcntl,sys,time\n"
             "fh=open(sys.argv[1],'r+')\n"
             "fcntl.flock(fh,fcntl.LOCK_EX)\n"
             "open(sys.argv[2],'w').write('held')\n"
             "time.sleep(6)\n",
             os.path.join(mem, "MEMORY.md"), os.path.join(tmp, "held")])
        try:
            for _ in range(100):
                if os.path.exists(os.path.join(tmp, "held")):
                    break
                time.sleep(0.05)
            check("the holder acquired the lock (test precondition)",
                  os.path.exists(os.path.join(tmp, "held")))
            blocked = False
            try:
                subprocess.run([sys.executable, SCRIPT, "host.md", "-", "egy.md", "ketto.md"],
                               capture_output=True, text=True, input=MERGED, timeout=2.5,
                               env=dict(os.environ, MARVEEN_MEMORY_DIR=mem))
            except subprocess.TimeoutExpired:
                blocked = True
            check("BLOCKS while another process holds the lock", blocked,
                  "it wrote through a held lock -- there is no mutual exclusion")
            check("and wrote nothing while blocked", index_line_count(mem) == 4)
        finally:
            holder.kill()
            holder.wait()
        # CONTROL: with the lock free the very same call completes well inside the timeout.
        rc, out = run(mem, "host.md", "-", "egy.md", "ketto.md", stdin=MERGED)
        check("CONTROL: the same fold succeeds once the lock is free", rc == 0, out[:200])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n%d FAILED: %s" % (len(FAILS), FAILS) if FAILS
          else "\nAll memory-index-fold tests passed.")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
