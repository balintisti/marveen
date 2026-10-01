#!/usr/bin/env python3
"""The CI watcher must not report an OLDER answer as a state change (card fd1d30af).

Isti's screenshot (Telegram 4759, 2026-10-01): "ZOLD lett" and "CI FIGYELMEZTETES" alternated
every ~10 minutes while main was red. Measured the same evening: the same
`gh run list --branch main` returned, call after call, a newest run from 10-01, 09-25, 09-10
and even June. The watcher took each older picture as the current one. A workflow's newest
completed run can only move forward, so an answer whose newest is older than one already seen
is stale -- logged, not believed. The repo is also asked by name, not resolved from a remote.

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(HERE), "ci-watch.sh")
FAILS = []


def check(name, got, want):
    ok = got == want
    print("  [%s] %s: got=%r want=%r" % ("PASS" if ok else "FAIL", name, got, want))
    if not ok:
        FAILS.append(name)


def answer(ci_id, ci_concl, dep_id, dep_concl):
    return json.dumps([
        {"workflowName": "CI", "status": "completed", "conclusion": ci_concl, "displayTitle": "t",
         "createdAt": "2026-10-01T00:00:00Z", "url": "http://x/%d" % ci_id, "databaseId": ci_id},
        {"workflowName": "Deploy to Cloud Run", "status": "completed", "conclusion": dep_concl,
         "displayTitle": "t", "createdAt": "2026-10-01T00:00:00Z", "url": "http://y/%d" % dep_id,
         "databaseId": dep_id},
    ])


def run(d, gh_json):
    bindir = os.path.join(d, "bin")
    os.makedirs(bindir, exist_ok=True)
    args_log = os.path.join(d, "gh-args.txt")
    with open(os.path.join(bindir, "gh"), "w") as fh:
        fh.write("#!/bin/bash\necho \"$@\" >> %s\ncat <<'JSON'\n%s\nJSON\n" % (args_log, gh_json))
    os.chmod(os.path.join(bindir, "gh"), 0o755)
    calls = os.path.join(d, "notify-calls.txt")
    with open(os.path.join(d, "notify.sh"), "w") as fh:
        fh.write("#!/bin/bash\nprintf '%%s\\n---\\n' \"$1\" >> %s\nexit 0\n" % calls)
    env = dict(os.environ)
    env.update(PATH=bindir + os.pathsep + env["PATH"], CI_WATCH_STATE=os.path.join(d, "state.json"),
               CI_WATCH_NOTIFY=os.path.join(d, "notify.sh"), CI_WATCH_REPO=d, CI_WATCH_BRANCH="main")
    p = subprocess.run(["bash", SCRIPT], capture_output=True, text=True, env=env, timeout=120)
    sent = open(calls).read().count("---") if os.path.exists(calls) else 0
    return p.returncode, sent, (p.stdout or "") + (p.stderr or ""), open(args_log).read()


def main():
    with tempfile.TemporaryDirectory() as d:
        # 1. main is red: CI 200 failure, deploy 201 skipped -> one alert
        rc, sent, out, args = run(d, answer(200, "failure", 201, "skipped"))
        check("red: alerted once", sent, 1)
        check("the repo is asked BY NAME, not resolved from a remote", "--repo balintisti/Delta-CRM" in args, True)
        check("the log line carries a timestamp and the repo", "balintisti/Delta-CRM]" in out and "[ci-watch 20" in out, True)
        # 2. THE BUG: a stale answer shows the June state (older ids, all green) -> NO alert
        rc, sent, out, _ = run(d, answer(100, "success", 101, "success"))
        check("stale older answer: no 'ZOLD lett'", sent, 1)
        check("stale older answer: said so in the log", "ELAVULT valasz" in out, True)
        state = json.load(open(os.path.join(d, "state.json")))
        check("stale older answer: the state did not move", state["last_key"], "CI:failure|Deploy to Cloud Run:skipped")
        # 3. the current answer again: unchanged, still no alert
        rc, sent, out, _ = run(d, answer(200, "failure", 201, "skipped"))
        check("current again: unchanged", sent, 1)
        # 4. CONTROL: a genuinely NEWER green run is reported -- the guard can say yes
        rc, sent, out, _ = run(d, answer(300, "success", 301, "success"))
        check("newer green: reported", sent, 2)
        check("newer green: the message says green", "ZOLD lett" in open(os.path.join(d, "notify-calls.txt")).read(), True)
        # 5. ...and after it, the OLD red is stale too, in the other direction
        rc, sent, out, _ = run(d, answer(200, "failure", 201, "skipped"))
        check("older red after newer green: no alert", sent, 2)

    if FAILS:
        print("\nFAILED: %d" % len(FAILS))
        sys.exit(1)
    print("\nAll ci-watch stale-answer tests passed.")


if __name__ == "__main__":
    main()
