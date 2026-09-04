#!/usr/bin/env python3
"""Tests for scripts/run-python-contract-tests.py (card 27975b85).

The class this pins: a watchdog that speaks ONLY on failure is byte-identical to a watchdog that
died. So the two properties worth testing are NOT "does it notice a red test" -- that part is
loud -- but the two silent ones:

  1. the run record is written even when EVERYTHING PASSES (liveness independent of verdict), and
  2. an EMPTY test directory is a FAILURE (exit 2), not "zero failures, all healthy".

Plus a positive control: the runner must be able to say FAIL at all, otherwise (1) proves nothing.

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
RUNNER = os.path.join(ROOT, "scripts", "run-python-contract-tests.py")

FAILS = []


def check(name, got, want):
    ok = got == want
    print("  [%s] %s: got=%r want=%r" % ("PASS" if ok else "FAIL", name, got, want))
    if not ok:
        FAILS.append(name)


def fixture(dirpath, name, body):
    p = os.path.join(dirpath, name)
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(body)
    return p


def run_runner(test_dir, state, timeout=10):
    p = subprocess.run([sys.executable, RUNNER, "--dir", test_dir, "--state", state,
                        "--timeout", str(timeout), "--quiet"],
                       capture_output=True, text=True, timeout=60)
    rec = None
    if os.path.exists(state):
        with open(state, encoding="utf-8") as fh:
            rec = json.load(fh)
    return p.returncode, rec, (p.stdout or "") + (p.stderr or "")


def main():
    OK = "#!/usr/bin/env python3\nprint('fine')\n"
    BAD = "#!/usr/bin/env python3\nimport sys\nprint('broken')\nsys.exit(1)\n"
    SLOW = "#!/usr/bin/env python3\nimport time\ntime.sleep(30)\n"

    # 1. ALL PASS -- and the record must appear even though nothing is wrong.
    with tempfile.TemporaryDirectory() as d:
        td = os.path.join(d, "t"); os.makedirs(td)
        fixture(td, "a.test.py", OK); fixture(td, "b.test.py", OK)
        state = os.path.join(d, "state.json")
        check("a zold futas ELOTT nincs allapot-fajl", os.path.exists(state), False)
        rc, rec, _ = run_runner(td, state)
        check("mind zold -> rc=0", rc, 0)
        check("a rekord ZOLD futas utan IS letezik (liveness)", rec is not None, True)
        check("files_run rogzitve", rec and rec["files_run"], 2)
        check("failed=0", rec and rec["failed"], 0)
        check("van olvashato befejezesi ido", bool(rec and rec.get("finished_at_local")), True)

    # 2. POSITIV KONTROLL: a futtato TUD FAIL-t mondani -- e nelkul az 1. semmit nem bizonyit.
    with tempfile.TemporaryDirectory() as d:
        td = os.path.join(d, "t"); os.makedirs(td)
        fixture(td, "a.test.py", OK); fixture(td, "b.test.py", BAD)
        state = os.path.join(d, "state.json")
        rc, rec, _ = run_runner(td, state)
        check("egy piros -> rc=1", rc, 1)
        check("failed=1", rec and rec["failed"], 1)
        check("a bukott fajl NEVESITVE van", 
              sorted(os.path.basename(r["file"]) for r in rec["results"] if not r["ok"]),
              ["b.test.py"])
        check("a rekord piros futas utan is letezik", rec is not None, True)

    # 3. URES KONYVTAR -> ez a lelet, nem az egeszseg. rc=2, KULON a zoldtol ES a pirostol.
    with tempfile.TemporaryDirectory() as d:
        td = os.path.join(d, "t"); os.makedirs(td)
        state = os.path.join(d, "state.json")
        rc, rec, out = run_runner(td, state)
        check("nulla teszt-fajl -> rc=2 (NEM 0)", rc, 2)
        check("files_run=0 a rekordban", rec and rec["files_run"], 0)
        check("a rekord ilyenkor is megirodik", rec is not None, True)
        check("a stderr KIMONDJA, hogy ez bukas", "NO TEST FILES" in out, True)

    # 4. BEAKADT teszt -> bukas, nem csend.
    with tempfile.TemporaryDirectory() as d:
        td = os.path.join(d, "t"); os.makedirs(td)
        fixture(td, "slow.test.py", SLOW)
        state = os.path.join(d, "state.json")
        rc, rec, _ = run_runner(td, state, timeout=2)
        check("idotullepes -> rc=1", rc, 1)
        check("a beakadt fajl rc=124-gyel van jelolve", rec and rec["results"][0]["rc"], 124)

    print("\n%d FAILED: %s" % (len(FAILS), FAILS) if FAILS
          else "\nAll python-contract-runner tests passed.")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
