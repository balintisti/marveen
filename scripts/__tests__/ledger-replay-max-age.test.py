#!/usr/bin/env python3
"""Card 49ecc9fc (Isti TG 9311): the SessionStart replay leaves out turns older than
LEDGER_CONTEXT_MAX_AGE_HOURS (default 48), but the OPEN QUESTION stays whatever its age.

Measured 2026-11-09: six agents restarted with 2.0-6.7k characters of 4-18 day old turns each
time. Everything here runs the real hook against a real ledger file (LEDGER_DB_PATH), seeded with
explicit created_at values, so the cut is read off the hook's actual output.

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
HOOKS = os.path.join(os.path.dirname(HERE), "hooks")
REPLAY = os.path.join(HOOKS, "ledger-replay.py")
AGENT = "replay-age"
H = 3600

failed = []


def check(name, ok):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    if not ok:
        failed.append(name)


SEED = (
    "import sys; sys.path.insert(0, sys.argv[1]); import ledger_lib;"
    "ledger_lib.log_inbound(sys.argv[2], '4242', sys.argv[3], sys.argv[4], '2026-11-09T10:00:00Z');"
)


def run_hook(rows, env_extra=None):
    """rows: [(direction, text, age_hours)]. Seeds the ledger, runs the hook, returns (rc, stdout)."""
    with tempfile.TemporaryDirectory() as tmp:
        db = os.path.join(tmp, "ledger.db")
        env = dict(os.environ, LEDGER_DB_PATH=db, MARVEEN_AGENT_ID=AGENT, MAIN_AGENT_ID=AGENT)
        env.pop("LEDGER_CONTEXT_MAX_AGE_HOURS", None)
        env.update(env_extra or {})
        # Create the schema through the real library, then write the rows with an exact age.
        subprocess.run([sys.executable, "-c", SEED, HOOKS, AGENT, "0", "schema-probe"], env=env, check=True, cwd=tmp)
        con = sqlite3.connect(db)
        con.execute("DELETE FROM conversation_log")
        now = int(time.time())
        for i, (direction, text, age_h) in enumerate(rows):
            con.execute(
                "INSERT INTO conversation_log (agent_id, chat_id, direction, message_id, text, ts, created_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (AGENT, "4242", direction, str(1000 + i), text, "2026-11-09T10:00:00Z", now - int(age_h * H)),
            )
        con.commit()
        con.close()
        r = subprocess.run([sys.executable, REPLAY], input="{}", env=env, cwd=tmp, capture_output=True, text=True)
        return r.returncode, r.stdout


def context(stdout):
    return json.loads(stdout)["hookSpecificOutput"]["additionalContext"] if stdout.strip() else ""


# A conversation where every inbound was answered, so there is no open question.
def pair(tag, age_h):
    return [("in", f"KERDES-{tag}", age_h + 0.01), ("out", f"VALASZ-{tag}", age_h)]


# 1. The cut: 49 h out, 47 h in.
rc, out = run_hook(pair("OLD49", 49) + pair("NEW47", 47))
ctx = context(out)
check("rc 0", rc == 0)
check("a 47 h old turn is replayed", "VALASZ-NEW47" in ctx)
check("a 49 h old turn is NOT replayed", "VALASZ-OLD49" not in ctx and "KERDES-OLD49" not in ctx)

# 2. CONTROL: the same rows with the cut moved out replay the 49 h turn (the cut is what removes it).
rc, out = run_hook(pair("OLD49", 49) + pair("NEW47", 47), {"LEDGER_CONTEXT_MAX_AGE_HOURS": "100"})
check("control: LEDGER_CONTEXT_MAX_AGE_HOURS=100 brings the 49 h turn back", "VALASZ-OLD49" in context(out))

# 3. The open question outlives the cut: the LAST inbound, unanswered, 100 h old, is still named
#    (an older answered pair does not hide it; a NEWER outbound would answer it, so none is seeded).
rc, out = run_hook(pair("OLD200", 200) + [("in", "NYITOTT-100H", 100)])
ctx = context(out)
check("an unanswered 100 h old question is still named", "NYITOTT KÉRDÉS" in ctx and "NYITOTT-100H" in ctx)
check("...while the 200 h old answered turn is cut", "VALASZ-OLD200" not in ctx)

# 4. Nothing recent and nothing open: no block at all.
rc, out = run_hook(pair("OLD49", 49) + pair("OLD200", 200))
check("only old, answered turns: no output", rc == 0 and out.strip() == "")

# 5. Only the open question is left: directive and question, no transcript sections at all.
rc, out = run_hook([("in", "NYITOTT-100H", 100)])
ctx = context(out)
check("only an old open question: it is the whole block", "NYITOTT-100H" in ctx and "LEGFRISSEBB" not in ctx and "KORÁBBI" not in ctx)

# 6. A fresh conversation is untouched.
rc, out = run_hook(pair("A", 3) + pair("B", 1))
ctx = context(out)
check("a recent conversation is replayed whole", "VALASZ-A" in ctx and "VALASZ-B" in ctx and "LEGFRISSEBB" in ctx)

# 7. An invalid env value falls back to the 48 h default instead of disabling the cut.
rc, out = run_hook(pair("OLD49", 49) + pair("NEW47", 47), {"LEDGER_CONTEXT_MAX_AGE_HOURS": "soon"})
check("a non-numeric override keeps the 48 h cut", "VALASZ-OLD49" not in context(out) and "VALASZ-NEW47" in context(out))

print(f"{'FAIL' if failed else 'PASS'}: {len(failed)} failed")
sys.exit(1 if failed else 0)
