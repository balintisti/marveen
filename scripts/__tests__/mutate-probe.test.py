#!/usr/bin/env python3
"""mutate-probe.py -- the three changes carried over from the CRM-side copy (card 0ab8a829),
plus the wiring of the probe's own selftest, which no runner had ever executed.

WHY THIS FILE EXISTS, AND NOT ONLY A LONGER selftest: scripts/mutate-probe.selftest.py
lives in scripts/, and the shell-test runner (src/__tests__/scripts-shell-tests.test.ts)
discovers scripts/__tests__/*.test.{sh,py} only. Measured 2026-09-24: no runner, no CI step
and no package script named it -- 17 green cases that `npm test` never ran. The first case
below runs it, so a red selftest is now a red suite.

What the rest pins:
  1. --expect-failed is MANDATORY for a probe, with `unknown` as a spoken third state; a
     typo is an INVALID PROBE (2), never a silent non-assertion.
  2. the count is the DIFFERENCE from the baseline: with a whole-suite --cmd that is red
     before the mutation, the old code called every mutant DISCRIMINATES because the word
     "failed" was in the summary. That was a false green.
  3. a coverage report OLDER than the source is an INVALID PROBE (stale line numbers).
  4. the source's timestamps survive the probe and --recover: without that, the tool's own
     write would make the source newer than the report, and fix 3 would fire on the second
     probe of the same file.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROBE = HERE.parent / "mutate-probe.py"
SELFTEST = HERE.parent / "mutate-probe.selftest.py"
OK, SURVIVED, INVALID, OTHERWISE = 0, 1, 2, 3

SRC = "export function f(x) {\n  if (x > 0) return 1\n  return 0\n}\n"
ANCHOR, REPL = "if (x > 0)", "if (MUTALT)"


def runner_body(base_failed: int, mut_failed: int, total: int = 10) -> str:
    return (
        "import sys\n"
        "src = open(sys.argv[1]).read()\n"
        f"n = {mut_failed} if 'MUTALT' in src else {base_failed}\n"
        f"print('Tests  %s (%d)' % (('%d failed | %d passed' % (n, {total}-n)) if n else '{total} passed', {total}))\n"
    )


def probe(d: Path, runner: str, *extra: str) -> subprocess.CompletedProcess:
    (d / "runner.py").write_text(runner)
    return subprocess.run(
        [sys.executable, str(PROBE), "--file", str(d / "forras.ts"),
         "--anchor-file", str(d / "anchor.txt"), "--replacement-file", str(d / "repl.txt"),
         "--cmd", f"{sys.executable} {d / 'runner.py'} {d / 'forras.ts'}", "--cwd", str(d), *extra],
        capture_output=True, text=True)


def fixture(d: Path) -> Path:
    t = d / "forras.ts"
    t.write_text(SRC)
    (d / "anchor.txt").write_text(ANCHOR)
    (d / "repl.txt").write_text(REPL)
    return t


def coverage_report(d: Path, target: Path) -> Path:
    r = d / "coverage-summary.json"
    r.write_text(json.dumps({str(target): {"statementMap": {"0": {"start": {"line": 2}}}, "s": {"0": 3}}}))
    return r


results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))


def case(fn):
    with tempfile.TemporaryDirectory() as d:
        fn(Path(d))


# 0. the selftest, wired at last
r = subprocess.run([sys.executable, str(SELFTEST)], capture_output=True, text=True)
check("the probe's own selftest passes (it had no runner before)", r.returncode == 0,
      (r.stdout + r.stderr)[-400:])


# 1. --expect-failed: mandatory, `unknown` spoken, typos invalid
def _missing(d):
    fixture(d)
    r = probe(d, runner_body(0, 1))
    check("missing --expect-failed -> INVALID (2)", r.returncode == INVALID and "KOTELEZO" in r.stderr, r.stderr[-300:])
case(_missing)

for bad in ("unknwon", "0", "-1", "two"):
    def _bad(d, bad=bad):
        fixture(d)
        r = probe(d, runner_body(0, 1), "--expect-failed", bad)
        check(f"--expect-failed {bad!r} -> INVALID (2), not a silent non-assertion", r.returncode == INVALID, r.stderr[-200:])
    case(_bad)


def _exact(d):
    fixture(d)
    r = probe(d, runner_body(0, 2), "--expect-failed", "2")
    check("the expected count broke -> DISCRIMINATES (0)", r.returncode == OK, r.stdout + r.stderr)
case(_exact)


def _otherwise(d):
    fixture(d)
    r = probe(d, runner_body(0, 1), "--expect-failed", "2")
    check("red, but 1 broke where 2 were claimed -> DISCRIMINATES OTHERWISE (3)",
          r.returncode == OTHERWISE and "2 helyett" in r.stdout, r.stdout + r.stderr)
case(_otherwise)


def _unknown(d):
    fixture(d)
    r = probe(d, runner_body(0, 1), "--expect-failed", "unknown")
    check("`unknown` -> DISCRIMINATES (0) and says it was a spoken non-assertion",
          r.returncode == OK and "unknown" in r.stdout, r.stdout + r.stderr)
case(_unknown)


def _survived(d):
    fixture(d)
    r = probe(d, runner_body(0, 0), "--expect-failed", "1")
    check("nothing broke -> SURVIVED (1)", r.returncode == SURVIVED, r.stdout + r.stderr)
case(_survived)


# 2. the count is the difference from a RED baseline
def _red_base_survives(d):
    fixture(d)
    r = probe(d, runner_body(3, 3), "--expect-failed", "unknown")
    check("baseline already 3 red, mutation adds none -> SURVIVED (1), not a false DISCRIMINATES",
          r.returncode == SURVIVED and "3 bukassal" in r.stdout, r.stdout + r.stderr)
case(_red_base_survives)


def _red_base_counts(d):
    fixture(d)
    r = probe(d, runner_body(3, 4), "--expect-failed", "1")
    check("baseline 3 red, mutation makes 4 -> exactly 1 broke -> DISCRIMINATES (0)",
          r.returncode == OK, r.stdout + r.stderr)
case(_red_base_counts)


# 3. stale coverage report
def _stale(d):
    t = fixture(d)
    rep = coverage_report(d, t)
    old = t.stat().st_mtime_ns - 86_400 * 10**9
    os.utime(rep, ns=(old, old))
    r = probe(d, runner_body(0, 1), "--expect-failed", "1", "--coverage", str(rep))
    check("coverage report OLDER than the source -> INVALID (2)",
          r.returncode == INVALID and "REGEBBI" in r.stderr, r.stderr[-300:])
case(_stale)


def _fresh(d):
    t = fixture(d)
    rep = coverage_report(d, t)
    new = t.stat().st_mtime_ns + 10**9
    os.utime(rep, ns=(new, new))
    r = probe(d, runner_body(0, 1), "--expect-failed", "1", "--coverage", str(rep))
    check("a fresh report lets the probe run (negative control of the stale case)", r.returncode == OK, r.stdout + r.stderr)
case(_fresh)


# 4. timestamps survive -- measured, not derived
def _write_bumps(d):
    t = fixture(d)
    past = t.stat().st_mtime_ns - 3600 * 10**9
    os.utime(t, ns=(past, past))
    t.write_text(SRC)
    check("CONTROL: write_text DOES bump the mtime (so the next case measures something)",
          t.stat().st_mtime_ns > past)
case(_write_bumps)


def _preserved(d):
    t = fixture(d)
    past = t.stat().st_mtime_ns - 3600 * 10**9
    os.utime(t, ns=(past, past))
    probe(d, runner_body(0, 1), "--expect-failed", "1")
    check("after a probe the source keeps its ORIGINAL mtime", t.stat().st_mtime_ns == past,
          f"{t.stat().st_mtime_ns} != {past}")
    check("...and its original bytes", t.read_text() == SRC)
case(_preserved)


def _second_probe(d):
    t = fixture(d)
    rep = coverage_report(d, t)
    # Both in the PAST and EQUAL: the report is fresh (not older than the source), and any
    # write by the tool itself would make the source NEWER than the report. A report set
    # ahead of "now" would hide exactly that (the first version of this case did, and a
    # mutation dropping the timestamp restore survived it).
    past = t.stat().st_mtime_ns - 3600 * 10**9
    os.utime(t, ns=(past, past))
    os.utime(rep, ns=(past, past))
    r1 = probe(d, runner_body(0, 1), "--expect-failed", "1", "--coverage", str(rep))
    r2 = probe(d, runner_body(0, 1), "--expect-failed", "1", "--coverage", str(rep))
    check("the SECOND probe of the same file is not refused as stale by the tool's own write",
          r1.returncode == OK and r2.returncode == OK, r2.stderr[-300:])
case(_second_probe)


def _recover_keeps_times(d):
    t = fixture(d)
    past = t.stat().st_mtime_ns - 3600 * 10**9
    os.utime(t, ns=(past, past))
    # a killed probe: sentinel written, source mutated, nothing restored
    killer = ("import os, signal, sys\n"
              "src = open(sys.argv[1]).read()\n"
              "if 'MUTALT' in src: os.kill(os.getppid(), signal.SIGKILL)\n"
              "print('Tests  10 passed (10)')\n")
    probe(d, killer, "--expect-failed", "1")
    mutated = "MUTALT" in t.read_text()
    r = subprocess.run([sys.executable, str(PROBE), "--file", str(t), "--cwd", str(d), "--recover"],
                       capture_output=True, text=True)
    check("CONTROL: the killed probe left mutated code", mutated)
    check("--recover restores the bytes AND the original mtime",
          r.returncode == OK and t.read_text() == SRC and t.stat().st_mtime_ns == past,
          f"rc={r.returncode} mtime {t.stat().st_mtime_ns} vs {past}")
case(_recover_keeps_times)


bad = [x for x in results if not x[1]]
for name, ok, detail in results:
    print(f"  {'OK  ' if ok else 'FAIL'}  {name}" + ("" if ok else f"\n        {detail}"))
print(f"\n  {len(results) - len(bad)}/{len(results)} passed")
if bad:
    sys.exit(1)
print("All mutate-probe tests passed.")
