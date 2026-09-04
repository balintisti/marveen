#!/usr/bin/env python3
"""Run every python contract test under scripts/__tests__/ and record THE FACT OF THE RUN.

WHY THIS EXISTS (card 27975b85). Nothing ran scripts/__tests__/*.test.py: `npm test` is
`vitest run`, and neither workflow mentions python. Measured 2026-09-04 -- and one of the six
was RED and had been for weeks: telegram-reply-guard.test.py caught a dead Stop hook (card
91926eaa). The tests were not missing. Their execution was.

WHY IT WRITES A STATE FILE EVEN WHEN EVERYTHING PASSES (marveen's condition on this card).
The intended consumer is a `heartbeat` schedule, which is deliberately SILENT when it has
nothing to report. A watchdog that speaks only on failure is byte-identical to a watchdog that
died -- which is precisely the shape of the bug this runner exists to have caught. So the run
itself must be queryable INDEPENDENT of the verdict:

    python3 -c "import json;d=json.load(open('store/python-contract-tests.json'));\
print(d['finished_at_local'], d['files_run'], 'files,', d['failed'], 'failed')"

If that timestamp is old, the RUNNER is dead -- and that is now a distinguishable state rather
than an indistinguishable silence.

ZERO FILES IS A FAILURE, NOT A PASS (exit 2). A glob that matches nothing reports "0 failures",
which reads as health. The same trap the rulebook records for a type-checker reporting zero
diagnostics over zero files: a count of findings means nothing until you know how many files
were looked at. `files_run` is therefore in the record and in the exit code.

A HANGING TEST IS A FAILURE, NOT SILENCE. Each file gets --timeout seconds; a timeout counts as
failed and is named in the record, so one wedged test cannot swallow the whole run.

Exit codes:  0 = every file passed   1 = at least one failed   2 = no test files found
Usage:       python3 scripts/run-python-contract-tests.py [--dir DIR] [--state PATH]
                                                          [--timeout SECONDS] [--quiet]
"""
import argparse
import glob
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_DIR = os.path.join(ROOT, "scripts", "__tests__")
DEFAULT_STATE = os.path.join(ROOT, "store", "python-contract-tests.json")


def _local(ts):
    return time.strftime("%Y-%m-%d %H:%M:%S %Z", time.localtime(ts))


def _tail(text, n=200):
    lines = [ln for ln in (text or "").strip().splitlines() if ln.strip()]
    return lines[-1][:n] if lines else ""


def run(test_dir, state_path, timeout, quiet=False):
    started = time.time()
    files = sorted(glob.glob(os.path.join(test_dir, "*.test.py")))
    results = []
    for f in files:
        t0 = time.time()
        try:
            p = subprocess.run([sys.executable, f], capture_output=True, text=True,
                               timeout=timeout, cwd=ROOT)
            rc, out = p.returncode, (p.stdout or "") + (p.stderr or "")
        except subprocess.TimeoutExpired:
            rc, out = 124, "TIMEOUT after %ss" % timeout
        results.append({
            "file": os.path.relpath(f, ROOT),
            "rc": rc,
            "ok": rc == 0,
            "seconds": round(time.time() - t0, 2),
            "tail": _tail(out),
        })

    finished = time.time()
    failed = [r for r in results if not r["ok"]]
    record = {
        "started_at": int(started),
        "finished_at": int(finished),
        "finished_at_local": _local(finished),
        "seconds": round(finished - started, 2),
        "test_dir": os.path.relpath(test_dir, ROOT) if test_dir.startswith(ROOT) else test_dir,
        "files_run": len(files),
        "passed": len(results) - len(failed),
        "failed": len(failed),
        "results": results,
    }

    # The record is written BEFORE the verdict is returned, and regardless of it: this is the
    # liveness signal, and a signal that only appears on failure is the bug, not the feature.
    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    tmp = state_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, state_path)   # a truncated write must never look like a run

    if not quiet:
        for r in results:
            print("  [%s] %-46s rc=%-4s %5.1fs | %s"
                  % ("PASS" if r["ok"] else "FAIL", os.path.basename(r["file"]),
                     r["rc"], r["seconds"], r["tail"][:70]))
        print("PYTHON-CONTRACT-TESTS: %d file(s), %d passed, %d failed  (%s)"
              % (record["files_run"], record["passed"], record["failed"],
                 record["finished_at_local"]))

    if not files:
        # UNCONDITIONAL, and the runner's own test pins it: --quiet suppresses the per-file PASS
        # lines, never the REASON for a failure. The heartbeat runs quiet, so a --quiet-only
        # silence here would hide the one finding this exit code exists for.
        print("PYTHON-CONTRACT-TESTS: NO TEST FILES under %s -- this is a FAILURE, not a "
              "pass: a glob that matches nothing reports zero failures." % test_dir,
              file=sys.stderr)
        return 2, record
    return (1 if failed else 0), record


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=DEFAULT_DIR)
    ap.add_argument("--state", default=DEFAULT_STATE)
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    rc, _ = run(a.dir, a.state, a.timeout, a.quiet)
    sys.exit(rc)


if __name__ == "__main__":
    main()
