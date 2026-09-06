#!/usr/bin/env python3
"""`--evict` must EXIST, because the refusal names it as the way out (card 4b94fefa).

The class this pins. The overflow refusal ends with "(Entry removal is an editorial decision,
not this script's: --evict.)" and that flag was never parsed: argv accepted `--check` or exactly
three arguments, so both `--evict` and `--evict f t h` fell through to the usage line, and
`evict_tail()` -- complete, defensive, already carrying three fixed bugs -- was never called.

A refusal that names an exit which does not exist is worse than one with no exit at all: the
reader believes the door is there and stops looking. Measured cost on 2026-09-05: two agents hit
that wall two hours apart and each responded by NOT saving a measured lesson. Neither was being
careless -- both asked the helper and the helper refused.

What is pinned here is mostly the RESTRAINT, not the capability. Eviction spends a memory, so the
dangerous direction is doing it too easily: without the flag (2), on the line you just added (3),
on a pinned line (4), or more than once per add (5). Test 5 is the rejected design measured -- a
loop reaches the ceiling by evicting THREE lines while the report names ONE, because `evicted` is
a single variable. Two memories would leave the index with nothing on the console naming them.

LIMIT, stated: these run with MARVEEN_SNAPSHOT_REPO pointed at nothing, so ranking takes the
mtime FALLBACK, not `first_seen()`. That is the documented degraded path (it warns on stderr) and
it is what makes the choice deterministic here. The first-seen ranking is NOT covered.

NOT WIRED TO CI: `npm test` is vitest and does not collect Python (card 27975b85, and 12 sibling
.test.py files sit in the same state). Run it by hand; its passing is not a gate.

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
SCRIPT = os.path.join(ROOT, "scripts", "memory-index-add.py")
FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else "  -- " + str(detail)))
    if not cond:
        FAILS.append(name)


def run(mem, *args):
    env = dict(os.environ, MARVEEN_MEMORY_DIR=mem, MARVEEN_SNAPSHOT_REPO="/nonexistent-on-purpose")
    p = subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True, env=env)
    return p.returncode, p.stdout + p.stderr


def fixture(mem, entries, pad_to=25000, pin=None):
    """entries: list of (filename, hook_len, age_seconds). Oldest age == eviction candidate."""
    shutil.rmtree(mem, ignore_errors=True)
    os.makedirs(mem)
    lines = []
    now = time.time()
    for fn, hook_len, age in entries:
        open(os.path.join(mem, fn), "w").write("# " + fn + "\n")
        os.utime(os.path.join(mem, fn), (now - age, now - age))
        marker = " <!-- pin -->" if fn == pin else ""
        lines.append("- [%s](%s)%s — %s" % (fn[:-3], fn, marker, "h" * hook_len))
    head, body = "# MEMORY\n\n", "\n".join(lines)
    pad = "\n<!-- " + "p" * max(0, pad_to - len(head) - len(body) - 40) + " -->\n"
    open(os.path.join(mem, "MEMORY.md"), "w").write(head + body + pad)


def index_text(mem):
    return open(os.path.join(mem, "MEMORY.md"), encoding="utf-8").read()


def archive_text(mem):
    import datetime
    p = os.path.join(mem, "index-farkak-%s.md" % datetime.date.today().isoformat())
    return open(p, encoding="utf-8").read() if os.path.exists(p) else ""


def main():
    tmp = tempfile.mkdtemp(prefix="memidx-")
    mem = os.path.join(tmp, "memory")
    try:
        big = "x" * 250

        # HOOK LENGTHS WIDENED 260 -> 400 ON 2026-09-06, and the reason is a premise change,
        # not a green-hunt. These fixtures were built when an --evict write added exactly one
        # thing: the new entry. It now also writes a 74-character archive pointer the first
        # time (card cc666d39), so the victim has to cover eviction AND pointer. At 260 no
        # single line was long enough and the run refused -- correctly. Note what did NOT
        # change: with the old fixture BOTH paths refuse (the early one here, or main()'s
        # "still over after one eviction" a step later), so the surcharge never turns a
        # refusal into a success. It only moves the refusal earlier, where the message can
        # name the pointer. Test 11 pins that refusal on purpose.
        print("1. --evict is RECOGNISED and evicts on overflow")
        fixture(mem, [("regi.md", 400, 9000), ("kozepes.md", 400, 5000), ("uj.md", 400, 10)])
        open(os.path.join(mem, "ujdonsag.md"), "w").write("# uj\n")
        rc, out = run(mem, "--evict", "ujdonsag.md", "Uj lecke", big)
        check("exits clean", rc == 0, "rc=%d %s" % (rc, out[:200]))
        check("reports the eviction", "evicted to" in out, out[:200])
        check("picks the OLDEST, not the positional tail", "regi.md" in out, out[:200])
        check("the new entry is in the index", "ujdonsag.md" in index_text(mem))
        check("the victim is GONE from the index", "regi.md" not in index_text(mem))
        check("the victim is IN the archive", "regi.md" in archive_text(mem))

        print("2. WITHOUT the flag an overflowing add still REFUSES (the editorial rule)")
        fixture(mem, [("regi.md", 260, 9000), ("kozepes.md", 260, 5000), ("uj.md", 260, 10)])
        open(os.path.join(mem, "ujdonsag.md"), "w").write("# uj\n")
        rc, out = run(mem, "ujdonsag.md", "Uj lecke", big)
        check("refuses", rc != 0 and "REFUSING" in out, out[:160])
        check("evicts nothing", "evicted to" not in out and archive_text(mem) == "")
        check("index untouched", "ujdonsag.md" not in index_text(mem))

        print("3. the line being added is NEVER its own victim (protect)")
        # onmaga.md is the OLDEST, so without protect= the ranking would choose it.
        fixture(mem, [("regi.md", 300, 500), ("uj.md", 300, 10)])
        open(os.path.join(mem, "onmaga.md"), "w").write("# o\n")
        os.utime(os.path.join(mem, "onmaga.md"), (time.time() - 99999,) * 2)
        rc, out = run(mem, "--evict", "onmaga.md", "Onmaga", big)
        check("did not evict what it just added", "evicted to" in out and "onmaga.md" not in out.split("evicted to")[1], out[:220])
        check("the added entry survived in the index", "onmaga.md" in index_text(mem))

        print("4. a PINNED line is not evicted")
        fixture(mem, [("regi.md", 400, 9000), ("kozepes.md", 400, 5000), ("uj.md", 400, 10)],
                pin="regi.md")
        open(os.path.join(mem, "ujdonsag.md"), "w").write("# uj\n")
        rc, out = run(mem, "--evict", "ujdonsag.md", "Uj lecke", big)
        check("skips the pinned oldest", "kozepes.md" in out and "regi.md" not in out.split("evicted to")[-1], out[:220])

        print("5. ONE eviction per add -- still over => refuse, and say the archive already has it")
        lines = [("m%03d.md" % i, 8, (202 - i) * 100) for i in range(202)]
        fixture(mem, lines, pad_to=0)          # 202 lines: TWO over the 200 line ceiling
        open(os.path.join(mem, "uj2.md"), "w").write("# uj\n")
        rc, out = run(mem, "--evict", "uj2.md", "Uj", "rovid")
        check("refuses rather than looping", rc != 0 and "still over after one eviction" in out, out[:200])
        check("names the archive so the reader knows nothing was lost", "index-farkak" in out, out[:200])
        check("the index was NOT modified", "uj2.md" not in index_text(mem))

        print("6. the usage message actually shows the usage")
        rc, out = run(mem, "--evict")
        check("prints the whole Usage block, not the bare word", "--evict" in out and "--check" in out, repr(out[:120]))

        # ------------------------------------------------------------------ card cc666d39
        # THE ARCHIVE WAS WRITTEN AND NOTHING LINKED IT. Eviction preserved the line in full
        # and left it unreachable: the command's output was correct and reassuring, which is
        # why it ran for days. Measured 2026-09-06 on the live tree: the day's archive had 1
        # inbound reference and it was a hand repair; the tool wrote none.
        import datetime
        today = "index-farkak-%s.md" % datetime.date.today().isoformat()

        def check_out(mem):
            """--check on the fixture, so reachability is measured by the SHIPPED meter."""
            env = dict(os.environ, MARVEEN_MEMORY_DIR=mem,
                       MARVEEN_SNAPSHOT_REPO="/nonexistent-on-purpose")
            q = subprocess.run([sys.executable, SCRIPT, "--check"], capture_output=True,
                               text=True, env=env)
            return q.stdout + q.stderr

        print("7. the eviction LINKS the archive it just created")
        fixture(mem, [("regi.md", 400, 9000), ("kozepes.md", 400, 5000), ("uj.md", 400, 10)])
        open(os.path.join(mem, "ujdonsag.md"), "w").write("# uj\n")
        rc, out = run(mem, "--evict", "ujdonsag.md", "Uj lecke", big)
        idx = index_text(mem)
        check("the eviction succeeded", rc == 0, "rc=%d %s" % (rc, out[-300:]))
        check("MEMORY.md now names today's archive", today in idx, idx[:200])
        # The claim is REACHABILITY, so assert it with the meter that defines it, not with
        # a substring: a link the shipped --check does not resolve would still be a defect.
        co = check_out(mem)
        check("--check does not report the archive as orphaned", "NO PATH: " + today not in co, co)
        check("--check counts it as linked", "UNREACHABLE: 0" in co, co)

        print("8. the pointer is MAINTAINED, not multiplied (one line, retargeted)")
        # A pointer per archive would cost ~74 chars and a line-ceiling slot every day a first
        # eviction happens -- taken from the tightest file in the system, which is the very
        # pressure that causes the evictions.
        fixture(mem, [("regi.md", 400, 9000), ("kozepes.md", 400, 5000), ("uj.md", 400, 10)])
        stale = "index-farkak-1999-01-01.md"
        open(os.path.join(mem, stale), "w").write("# regi archivum\n")
        idx0 = index_text(mem)
        open(os.path.join(mem, "MEMORY.md"), "w").write(
            idx0.replace("- [", "<!-- arch --> ARCHIVUM: [levagott index-sorok](%s)\n- [" % stale, 1))
        open(os.path.join(mem, "ujdonsag.md"), "w").write("# uj\n")
        rc, out = run(mem, "--evict", "ujdonsag.md", "Uj lecke", big)
        idx = index_text(mem)
        check("exactly ONE pointer line survives", idx.count("<!-- arch -->") == 1, idx.count("<!-- arch -->"))
        check("it was RETARGETED to today", today in idx and stale not in idx.split("\n")[0:3][0], idx[:160])

        print("9. the pointer is NOT an index line -- no line-ceiling slot, and unevictable")
        n_index = len([l for l in idx.split("\n") if l.startswith("- [")])
        check("pointer does not start with '- ['", not any(
            l.startswith("- [") and "<!-- arch -->" in l for l in idx.split("\n")), idx[:160])
        check("so it can never become an eviction candidate",
              "<!-- arch -->" not in archive_text(mem), archive_text(mem)[:160])

        print("10. the NEWEST archive is the HUB -- older archives stay at depth 2")
        # --check resolves exactly two hops: a markdown (file.md) link from MEMORY.md, then
        # [[stem]] links inside a directly-linked file. Measured on a fixture the same day: a
        # date CHAIN (each archive naming only its predecessor) reports the third one back as
        # NO PATH -- it looks right and goes dark on day three. Control on that fixture: the
        # depth-2 file was NOT reported, so the meter was not blind.
        check("the hub names the older archive with a [[wiki]] link",
              "[[%s]]" % stale[:-3] in archive_text(mem), archive_text(mem)[:300])
        co = check_out(mem)
        check("and the older archive is therefore not orphaned",
              "NO PATH: " + stale not in co, co)

        print("11. when the one-off pointer cannot be afforded, the refusal NAMES it")
        # Without this the reader is sent to trim hooks -- a pass that cannot close a gap the
        # pointer reopens on the next run.
        fixture(mem, [("regi.md", 260, 9000), ("kozepes.md", 260, 5000), ("uj.md", 260, 10)])
        open(os.path.join(mem, "ujdonsag.md"), "w").write("# uj\n")
        rc, out = run(mem, "--evict", "ujdonsag.md", "Uj lecke", big)
        check("refuses", rc != 0 and "REFUSING" in out, out[-200:])
        check("names the archive pointer as part of the bill", "archive pointer" in out, out[-300:])
        check("says it is one-off, not recurring", "ONCE" in out, out[-300:])
        print("12. a SECOND eviction DAY: yesterday's victim stays reachable (didi, c4)")
        # THE FIRST FIX CLOSED THIS FOR TODAY ONLY, and that is this file's own trap one day
        # later: naming just the archives keeps the FILES at depth 2, but yesterday's victim is
        # reachable through a handle written INSIDE yesterday's archive -- which is itself at
        # depth 2, so the handle sits at THREE. Measured by didi and reproduced here before the
        # fix: day one's victim reported NO PATH while both archives reported reachable.
        fixture(mem, [("regi-egy.md", 300, 9000), ("regi-ketto.md", 300, 5000), ("friss.md", 60, 10)])
        open(os.path.join(mem, "uj-egy.md"), "w").write("# uj\n")
        open(os.path.join(mem, "uj-ketto.md"), "w").write("# uj2\n")
        rc, out = run(mem, "--evict", "uj-egy.md", "Uj egy", big)
        check("day one evicts", rc == 0, out[-200:])
        # roll the day over the only way the tool can see it: today's archive becomes yesterday's
        y = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
        os.rename(os.path.join(mem, today), os.path.join(mem, "index-farkak-%s.md" % y))
        rc, out = run(mem, "--evict", "uj-ketto.md", "Uj ketto", big)
        check("day two evicts", rc == 0, out[-200:])
        hub = archive_text(mem)
        check("the hub still names YESTERDAY's ARCHIVE", "[[index-farkak-%s]]" % y in hub, hub[:200])
        check("and it names day ONE's VICTIM -- the memory, not just the file",
              "[[regi-egy]]" in hub, hub[:400])
        co = check_out(mem)
        check("so the shipped --check reports nothing orphaned", "UNREACHABLE: 0" in co, co)

        print("13. a PRE-FIX archive holds raw index lines, no handles -- heal those too")
        # M8 SURVIVED WITHOUT THIS. Test 12's day-one archive is written by the fixed tool, so it
        # already carries a [[handle]]; dropping the markdown-link reader changed nothing and the
        # suite stayed green. The archives that actually need healing are the ones written BEFORE
        # the handle existed (09-03: 1039 lines, 09-05: 184) -- they hold their entries only as
        # the original `- [name](name.md)` index lines.
        fixture(mem, [("regi-egy.md", 300, 9000), ("regi-ketto.md", 300, 5000), ("friss.md", 60, 10)])
        open(os.path.join(mem, "ujdonsag.md"), "w").write("# uj\n")
        open(os.path.join(mem, "orokolt.md"), "w").write("# orokolt\n")
        legacy = "index-farkak-%s.md" % (datetime.date.today() - datetime.timedelta(days=2)).isoformat()
        # exactly the pre-fix shape: an archived index line, and NOT a single [[handle]]
        open(os.path.join(mem, legacy), "w").write(
            "## Levagva regen\n- [Orokolt lecke](orokolt.md) - egy regi sor\n")
        check("the legacy archive really carries NO handle", "[[" not in open(
            os.path.join(mem, legacy), encoding="utf-8").read())
        rc, out = run(mem, "--evict", "ujdonsag.md", "Uj", big)
        check("the eviction succeeded", rc == 0, out[-200:])
        hub = archive_text(mem)
        check("the hub gives the LEGACY entry a handle it never had",
              "[[orokolt]]" in hub, hub[:400])
        co = check_out(mem)
        check("and --check no longer calls it orphaned", "NO PATH: orokolt.md" not in co, co)

        print("14. the two remaining reads: a HAND-repaired archive, and names that are GONE")
        # BOTH OF THESE CAME FROM SURVIVING MUTATIONS, not from foresight. M9 (drop the wiki-form
        # read) and M10 (drop the on-disk filter) both left the suite green, which means nothing
        # covered them.
        #   M9: reading every archive directly makes the wiki form redundant for entries the tool
        #       itself archived -- they always carry their original markdown line too. It is NOT
        #       redundant for a HAND-repaired archive, and those exist: one was hand-linked on
        #       2026-09-06 when this defect was found.
        #   M10: a handle for a deleted memory is harmless to --check, but without the filter the
        #       hub accumulates dead names forever and claims to hold things that are gone.
        fixture(mem, [("regi-egy.md", 300, 9000), ("regi-ketto.md", 300, 5000), ("friss.md", 60, 10)])
        open(os.path.join(mem, "ujdonsag.md"), "w").write("# uj\n")
        open(os.path.join(mem, "kezzel-kotott.md"), "w").write("# kezzel\n")
        handonly = "index-farkak-%s.md" % (datetime.date.today() - datetime.timedelta(days=3)).isoformat()
        # a hand repair: a [[handle]] with NO markdown line, plus a name whose file is GONE
        open(os.path.join(mem, handonly), "w").write(
            "## Kezzel javitva\n[[kezzel-kotott]]\n- [Torolt](mar-nincs-ilyen.md) - a fajlja eltunt\n")
        rc, out = run(mem, "--evict", "ujdonsag.md", "Uj", big)
        check("the eviction succeeded", rc == 0, out[-200:])
        hub = archive_text(mem)
        check("M9: a handle with no markdown line is still picked up",
              "[[kezzel-kotott]]" in hub, hub[:400])
        check("M10: a name whose file is gone is NOT named by the hub",
              "[[mar-nincs-ilyen]]" not in hub, hub[:400])

    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n%d FAILED: %s" % (len(FAILS), FAILS) if FAILS
          else "\nAll memory-index-add --evict tests passed.")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
