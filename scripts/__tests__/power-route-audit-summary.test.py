#!/usr/bin/env python3
"""Card 3fc4df30: power-route-audit-summary.py counts per route and caller, states its window, opens read-only.

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import os
import sqlite3
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(HERE), "power-route-audit-summary.py")
failed = []


def check(name, ok):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    if not ok:
        failed.append(name)


SCHEMA = """CREATE TABLE power_route_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, method TEXT NOT NULL,
 route_id TEXT NOT NULL, path TEXT NOT NULL, auth_kind TEXT NOT NULL, auth_who TEXT, token_agent TEXT, claimed TEXT,
 body_fields TEXT, body_scalars TEXT, remote TEXT, user_agent TEXT, status INTEGER, would_deny INTEGER NOT NULL DEFAULT 0)"""


def make_db(path, rows):
    con = sqlite3.connect(path)
    con.execute(SCHEMA)
    for r in rows:
        con.execute(
            "INSERT INTO power_route_audit (ts, method, route_id, path, auth_kind, auth_who, token_agent, claimed, status, would_deny)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)", r)
    con.commit()
    con.close()


def run(db, *extra):
    return subprocess.run([sys.executable, SCRIPT, "--db", db, *extra], capture_output=True, text=True)


now = int(time.time())
with tempfile.TemporaryDirectory() as tmp:
    db = os.path.join(tmp, "a.db")
    make_db(db, [
        (now - 100, "POST", "settings-write", "/api/settings", "token", None, None, "actor=dexter", 200, 1),
        (now - 90, "POST", "settings-write", "/api/settings", "token", None, None, "actor=dexter", 403, 1),
        (now - 80, "POST", "settings-write", "/api/settings", "session", "isti", None, None, 200, 0),
        (now - 70, "POST", "autonomy-write", "/api/autonomy", "token", None, "ford", None, 200, 1),
        (now - 9 * 86400, "POST", "settings-write", "/api/settings", "token", None, None, "actor=old", 200, 1),
    ])
    r = run(db)
    out = r.stdout
    check("exit 0", r.returncode == 0)
    check("states the window and the row counts (5 in table, 4 in 7 days)", "5 rows in the table" in out and "4 rows in the last 7 days" in out)
    check("token calls with a claimed actor counted together: 2 calls, 2 would_deny, statuses 200x1 403x1",
          any(l.startswith("settings-write") and "token claims[actor=dexter]" in l and l.split()[3:5] == ["2", "2"] and "200x1 403x1" in l
              for l in out.splitlines()))
    check("owner session is its own row with 0 would_deny",
          any("session:isti" in l and l.split()[2:4] == ["1", "0"] for l in out.splitlines()))
    check("authenticated agent token is named", "token:agent-token=ford" in out)
    check("a call older than the window is not in the table", "actor=old" not in out)
    r30 = run(db, "--days", "30")
    check("--days 30 includes it", "actor=old" in r30.stdout)

    before = os.path.getsize(db)
    run(db)
    check("read-only: size unchanged", os.path.getsize(db) == before)

    empty = os.path.join(tmp, "e.db")
    make_db(empty, [])
    re_ = run(empty)
    check("empty table is said to be empty, not silent", "0 rows in the table" in re_.stdout and "no calls in the window" in re_.stdout)

    nodb = os.path.join(tmp, "n.db")
    sqlite3.connect(nodb).execute("CREATE TABLE x (a)").connection.close()
    rn = run(nodb)
    check("no table: exit 3 and says the build is not running yet", rn.returncode == 3 and "not running" in rn.stdout)

    rm = run(os.path.join(tmp, "missing", "z.db"))
    check("unopenable db: exit 2", rm.returncode == 2)

print("FAIL: " + ", ".join(failed) if failed else "PASS: 0 failed")
sys.exit(1 if failed else 0)
