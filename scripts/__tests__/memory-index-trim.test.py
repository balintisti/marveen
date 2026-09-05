#!/usr/bin/env python3
"""The trim tool must take the LOCK and guard the REFERENCE SET (card 4b94fefa, second door).

The class this pins. `memory-index-add.py`'s overflow refusal names trimming as the remedy,
and until now nothing trimmed under the flock -- so following the advice meant hand-editing a
file six agents share. This tool exists for the mechanical half only. The editorial half (WHICH
line, WHAT it should say) stays with the caller, so almost everything worth pinning here is a
REFUSAL.

The invariant is didi's: the `.md` reference set is identical before and after. It matters
because the longest index lines are long BECAUSE they are consolidated, and their extra
references sit at the END, exactly where a careless trim cuts -- a naive pass over the ten
longest would drop eight memories AS A FORMATTING CHANGE. Test 3 is that failure, made
deliberately, on a line carrying three references.

Both directions are pinned and they are different bugs: a reference LOST drops a memory out of
the index; a reference GAINED is a CONSOLIDATION wearing a trim's clothes, which is a real
operation with the opposite invariant and no tool.

NOT WIRED TO CI: `npm test` is vitest and does not collect Python (card 27975b85). Run by hand;
its passing is not a gate.

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SCRIPT = os.path.join(ROOT, "scripts", "memory-index-trim.py")
FAILS = []

CONSOLIDATED = ("- [Egy alak](egy.md) — hosszu proza ami trimmelheto; "
                "[masodik](ketto.md) — meg tobb proza; [harmadik](harom.md) — es a vege")
PLAIN = "- [Maganyos](maganyos.md) — ennek a horga bosegesen hosszu es nyugodtan rovidulhet"


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else "  -- " + str(detail)))
    if not cond:
        FAILS.append(name)


def fixture(mem):
    shutil.rmtree(mem, ignore_errors=True)
    os.makedirs(mem)
    for fn in ("egy.md", "ketto.md", "harom.md", "maganyos.md"):
        open(os.path.join(mem, fn), "w").write("# " + fn + "\n")
    open(os.path.join(mem, "MEMORY.md"), "w").write(
        "# MEMORY\n\n" + CONSOLIDATED + "\n" + PLAIN + "\n")


def run(mem, *args, stdin=None):
    env = dict(os.environ, MARVEEN_MEMORY_DIR=mem)
    p = subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True,
                       env=env, input=stdin)
    return p.returncode, p.stdout + p.stderr


def index_text(mem):
    return open(os.path.join(mem, "MEMORY.md"), encoding="utf-8").read()


def main():
    tmp = tempfile.mkdtemp(prefix="memtrim-")
    mem = os.path.join(tmp, "memory")
    try:
        print("1. --check reports the line and its references (the meter can speak)")
        fixture(mem)
        rc, out = run(mem, "--check", "egy.md")
        check("exits clean", rc == 0, out[:160])
        check("names all three references", all(r in out for r in ("egy.md", "ketto.md", "harom.md")), out[:200])

        print("2. a real trim applies and preserves every reference")
        fixture(mem)
        shorter = ("- [Egy alak](egy.md) — rovid; [masodik](ketto.md) — rovid; "
                   "[harmadik](harom.md) — rovid")
        rc, out = run(mem, "egy.md", "-", stdin=shorter)
        check("exits clean", rc == 0, out[:200])
        check("reports characters recovered", "recovered" in out, out[:200])
        check("the new text is in the index", shorter in index_text(mem))
        check("all three references survive", all(r in index_text(mem) for r in ("egy.md", "ketto.md", "harom.md")))
        check("the untouched line is untouched", PLAIN in index_text(mem))

        print("3. DROPPING a reference is refused -- the eight-memories-as-formatting bug")
        fixture(mem)
        lossy = "- [Egy alak](egy.md) — rovid; [masodik](ketto.md) — rovid"   # harom.md cut off the END
        rc, out = run(mem, "egy.md", "-", stdin=lossy)
        check("refuses", rc != 0 and "REFUSING" in out, out[:160])
        check("names the LOST reference specifically", "LOST" in out and "harom.md" in out, out[:240])
        check("the index is unchanged", CONSOLIDATED in index_text(mem))

        print("4. GAINING a reference is refused -- consolidation is not a trim")
        fixture(mem)
        grown = "- [Maganyos](maganyos.md) — rov; [uj](egy.md)"
        rc, out = run(mem, "maganyos.md", "-", stdin=grown)
        check("refuses", rc != 0 and "REFUSING" in out, out[:160])
        check("names the GAINED reference and calls it consolidation",
              "GAINED" in out and "consolidation" in out, out[:240])

        print("5. a replacement that is not shorter is refused")
        fixture(mem)
        longer = PLAIN + " es meg egy kis toldalek a vegere hogy hosszabb legyen"
        rc, out = run(mem, "maganyos.md", "-", stdin=longer)
        check("refuses", rc != 0 and "not a trim" in out, out[:200])
        check("the index is unchanged", index_text(mem).count(PLAIN) == 1 and longer not in index_text(mem))

        print("6. an ambiguous or missing selector is refused")
        fixture(mem)
        rc, out = run(mem, ".md", "-", stdin=PLAIN)
        check("ambiguous selector refused", rc != 0 and "matches 2 index lines" in out, out[:200])
        rc, out = run(mem, "nincs-ilyen.md", "-", stdin=PLAIN)
        check("missing selector refused", rc != 0 and "matches 0 index lines" in out, out[:200])

        print("7. a replacement that is not an index line, or is multi-line, is refused")
        fixture(mem)
        rc, out = run(mem, "maganyos.md", "-", stdin="csak sima szoveg")
        check("non-index-line refused", rc != 0 and "not an index line" in out, out[:160])
        rc, out = run(mem, "maganyos.md", "-", stdin="- [a](maganyos.md) — x\n- [b](egy.md) — y")
        check("multi-line refused", rc != 0 and "more than one line" in out, out[:160])

        print("8. IT ACTUALLY TAKES THE LOCK -- the whole reason this tool exists")
        # Everything above would pass on a version with no flock at all, so this is the
        # assertion that separates the tool from a hand-edit with extra steps. A holder
        # takes LOCK_EX and signals; the trim must BLOCK. The control is the same trim with
        # no holder: if that also timed out, the test would be measuring slowness, not the lock.
        fixture(mem)
        shorter = "- [Maganyos](maganyos.md) — rovid"
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
                subprocess.run([sys.executable, SCRIPT, "maganyos.md", "-"],
                               capture_output=True, text=True, input=shorter, timeout=2.5,
                               env=dict(os.environ, MARVEEN_MEMORY_DIR=mem))
            except subprocess.TimeoutExpired:
                blocked = True
            check("BLOCKS while another process holds the lock", blocked,
                  "it wrote through a held lock -- there is no mutual exclusion")
            check("and wrote nothing while blocked", shorter not in index_text(mem))
        finally:
            holder.kill()
            holder.wait()
        # CONTROL: with the lock free the very same call completes well inside the timeout.
        rc, out = run(mem, "maganyos.md", "-", stdin=shorter)
        check("CONTROL: the same trim succeeds once the lock is free", rc == 0, out[:160])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n%d FAILED: %s" % (len(FAILS), FAILS) if FAILS
          else "\nAll memory-index-trim tests passed.")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
