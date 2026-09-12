"""Card 3bdaa5e8. `--check` printed FIVE unreachable names out of any number, with nothing
marking the cut, so the list read as the population.

WHY THAT IS THE DANGEROUS DIRECTION: the question people bring to this list is "did my
`--evict` make something unreachable?" -- they scan for a name, do not find it, and read
that as no. Absence from a silently truncated list is not a negative. didi hit exactly
that on 2026-09-10 (five shown, 62 real); re-measured 09-12 it was five shown, 72 real.

AND THE MEASURING TOOL COUNTED ITSELF: the legend ended "depth 3+ counts as NO PATH", so
the cheapest possible check -- `--check | grep -c 'NO PATH'` -- returned one MORE than the
names printed. Three different numbers for one question (6 / 5 / 72), and the most
reachable one was wrong.

These fixtures use MORE THAN FIVE orphans on purpose: at five or fewer the defect cannot
be expressed at all, which is why it survived in a file that already had two test suites.

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import os
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


def run(mem, *args):
    env = dict(os.environ, MARVEEN_MEMORY_DIR=mem, MARVEEN_SNAPSHOT_REPO="/nonexistent-on-purpose")
    p = subprocess.run([sys.executable, SCRIPT, "--check", *args],
                       capture_output=True, text=True, env=env)
    return p.returncode, p.stdout + p.stderr


def fixture(mem, orphans):
    """One linked hub plus N orphans nothing points at."""
    os.makedirs(mem, exist_ok=True)
    with open(os.path.join(mem, "MEMORY.md"), "w", encoding="utf-8") as fh:
        fh.write("- [Hub](hub.md) - the only line the index carries\n")
    with open(os.path.join(mem, "hub.md"), "w", encoding="utf-8") as fh:
        fh.write("body with no outbound links\n")
    for i in range(orphans):
        with open(os.path.join(mem, "orphan-%02d.md" % i), "w", encoding="utf-8") as fh:
            fh.write("body\n")


def names_listed(out):
    return [l.split("NO PATH: ", 1)[1].strip()
            for l in out.splitlines() if "NO PATH: " in l]


def main():
    mem = tempfile.mkdtemp(prefix="unreach-")
    fixture(mem, 9)

    rc, out = run(mem)
    check("--check still exits 0", rc == 0, rc)

    # CONTROL FIRST: the walk actually finds all nine, otherwise everything below is vacuous.
    check("the header counts ALL of them, not the shown ones",
          "UNREACHABLE: 9" in out, out)

    listed = names_listed(out)
    check("the default view is still capped at five", len(listed) == 5, listed)

    # THE DEFECT.
    check("the cut SAYS it is a cut, and names how many are hidden",
          "and 4 more NOT SHOWN" in out, out)
    check("and it warns that absence proves nothing",
          "absence from it proves nothing" in out, out)
    check("and it names the way to see the rest",
          "--check --unreachable" in out, out)

    # THE SECOND TRAP: the legend must not spell the token the reader greps for.
    grep_count = out.count("NO PATH")
    check("grep -c 'NO PATH' equals the names printed, not one more",
          grep_count == len(listed), "%d vs %d" % (grep_count, len(listed)))
    check("the legend still states the definition (it was reworded, not deleted)",
          "depth 3+ is unreachable" in out, out)

    # THE FULL LIST.
    rc_full, full = run(mem, "--unreachable")
    check("--unreachable exits 0", rc_full == 0, rc_full)
    listed_full = names_listed(full)
    check("--unreachable lists every one of them", len(listed_full) == 9, listed_full)
    check("--unreachable agrees with its own header",
          "UNREACHABLE: 9" in full and len(listed_full) == 9, full)
    check("nothing is truncated there, so no cut notice",
          "NOT SHOWN" not in full, full)

    # An unknown extra argument must be REFUSED, not silently treated as plain --check --
    # a typo that quietly returns the truncated list is the very failure being fixed.
    rc_typo, typo = run(mem, "--unreachabl")
    check("a mistyped modifier is refused, not silently downgraded",
          rc_typo != 0 and "NO PATH:" not in typo, "rc=%s %s" % (rc_typo, typo[:200]))

    # NEGATIVE CONTROL: at five or fewer there is nothing to hide and no notice appears.
    small = tempfile.mkdtemp(prefix="unreach-small-")
    fixture(small, 3)
    _, out_small = run(small)
    check("CONTROL: under the cap, no cut notice and every name is shown",
          "NOT SHOWN" not in out_small and len(names_listed(out_small)) == 3, out_small)

    print("\n%d failure(s)." % len(FAILS) if FAILS
          else "\nAll memory-index-add --unreachable/truncation tests passed.")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
