#!/usr/bin/env python3
"""The CI watcher must not advance its dedupe state on a FAILED notification (card 93b4b46e).

The class this pins. `ci-watch.sh` reports only on CHANGE -- `last_key` is what stops the second
alert. It used to write that key BEFORE calling notify, and ignore notify's exit code. So one
failed send (expired Telegram token, network, chat_id change) meant: state advanced, alert lost,
and every later run printed `valtozatlan (N rossz) -- nem ertesitek`. That line reads as CORRECT --
"there is a red CI and I am deliberately not repeating myself" -- so even reading the log does not
reveal the loss. A watcher that cannot report is indistinguishable from one with nothing to report.

The script's own header states the principle for the INPUT side: "a 'nem tudtam megmerni' NEM
ugyanaz, mint a 'zold'". It did not hold it for its own OUTPUT. Both notification paths had it --
the gh-failure branch and the normal one -- so this pins both.

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SCRIPT = os.path.join(ROOT, "scripts", "ci-watch.sh")
FAILS = []

GH_OK = """#!/bin/bash
cat <<'JSON'
[{"workflowName":"CI","status":"completed","conclusion":"failure",
  "displayTitle":"t","createdAt":"2026-09-04T00:00:00Z","url":"http://x"}]
JSON
"""
GH_BROKEN = "#!/bin/bash\necho 'i/o timeout' >&2\nexit 1\n"


def check(name, got, want):
    ok = got == want
    print("  [%s] %s: got=%r want=%r" % ("PASS" if ok else "FAIL", name, got, want))
    if not ok:
        FAILS.append(name)


def write_exec(path, body):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(body)
    os.chmod(path, 0o755)
    return path


def run(d, gh_body, notify_rc, state_path):
    """Drive the real script with a stubbed gh and a stubbed notify."""
    bindir = os.path.join(d, "bin"); os.makedirs(bindir, exist_ok=True)
    write_exec(os.path.join(bindir, "gh"), gh_body)
    calls = os.path.join(d, "notify-calls.txt")
    write_exec(os.path.join(d, "notify.sh"),
               "#!/bin/bash\necho called >> %s\nexit %d\n" % (calls, notify_rc))
    env = dict(os.environ)
    env["PATH"] = bindir + os.pathsep + env["PATH"]
    env["CI_WATCH_STATE"] = state_path
    env["CI_WATCH_NOTIFY"] = os.path.join(d, "notify.sh")
    env["CI_WATCH_REPO"] = d
    env["CI_WATCH_BRANCH"] = "main"
    p = subprocess.run(["bash", SCRIPT], capture_output=True, text=True, env=env, timeout=120)
    st = {}
    if os.path.exists(state_path):
        try:
            st = json.load(open(state_path, encoding="utf-8"))
        except Exception:
            st = {"__unparseable__": True}
    n = 0
    if os.path.exists(calls):
        n = len(open(calls, encoding="utf-8").read().split())
    return p.returncode, st, n, (p.stdout or "") + (p.stderr or "")


def main():
    # 1. NOTIFY BUKIK -> az allapot NEM lephet, es a naplo MONDJA KI.
    with tempfile.TemporaryDirectory() as d:
        state = os.path.join(d, "state.json")
        rc, st, calls, out = run(d, GH_OK, 1, state)
        check("bukott ertesites -> rc != 0", rc != 0, True)
        check("bukott ertesites -> a notify-t MEGHIVTA", calls, 1)
        check("bukott ertesites -> last_key NEM irodott", st.get("last_key"), None)
        check("a naplo kimondja a bukast", "AZ ERTESITES BUKOTT" in out, True)

    # 2. POZITIV KONTROLL: sikeres kuldesnel az allapot IGENIS lep -- kulonben az 1. eset
    #    barmilyen torott szkripten is atmenne.
    with tempfile.TemporaryDirectory() as d:
        state = os.path.join(d, "state.json")
        rc, st, calls, out = run(d, GH_OK, 0, state)
        check("sikeres ertesites -> rc=0", rc, 0)
        check("sikeres ertesites -> last_key IRODOTT", bool(st.get("last_key")), True)

    # 3. A LENYEG: bukas UTAN a KOVETKEZO futas UJRA probal, nem dedupel csendbe.
    with tempfile.TemporaryDirectory() as d:
        state = os.path.join(d, "state.json")
        run(d, GH_OK, 1, state)                     # elso: bukik
        rc2, st2, calls2, out2 = run(d, GH_OK, 1, state)   # masodik: ujra kell probalnia
        # a hivas-szamlalo fajl HALMOZODIK a kozos temp-konyvtarban: 1 -> 2 azt jelenti,
        # hogy a masodik futas UJRA kuldott. (Az elso alakom 1-et vart, es a TESZT volt rossz.)
        check("bukas utan a masodik futas UJRA kuld (1 -> 2)", calls2, 2)
        check("es meg mindig nem lepteti az allapotot", st2.get("last_key"), None)
        check("nem irja azt, hogy valtozatlan", "valtozatlan" in out2, False)

    # 4. A MASIK ERTESITESI UT (gh elbukott) ugyanigy viselkedik.
    with tempfile.TemporaryDirectory() as d:
        state = os.path.join(d, "state.json")
        rc, st, calls, out = run(d, GH_BROKEN, 1, state)
        check("gh-bukas + bukott ertesites -> last_key NEM irodott", st.get("last_key"), None)
        check("gh-bukas: a notify-t megis meghivta", calls, 1)

    print("\n%d FAILED: %s" % (len(FAILS), FAILS) if FAILS
          else "\nAll ci-watch notify-rc tests passed.")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
