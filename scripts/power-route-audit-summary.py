#!/usr/bin/env python3
"""
power-route-audit-summary.py -- count table of the power-route audit (card 3fc4df30, marveen 58797).

Reads the power_route_audit table (src/web/power-route-audit.ts writes it, log-only) and prints, per route and
caller, how many calls came in the window, how many an owner-session rule would have refused, and which
statuses the routes answered. READ-ONLY: the database opens with mode=ro and nothing is written.

The window is stated with the result: first and last recorded call, and the request count, so a table from
a build that has only run for two days says two days. An empty table is printed as empty, not as "no calls".

Run: python3 scripts/power-route-audit-summary.py [--db store/claudeclaw.db] [--days 7]
"""
import argparse
import os
import sqlite3
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(os.path.dirname(HERE), "store", "claudeclaw.db")


def caller_of(row):
    """The caller as the request identifies it: authenticated first, then what it only claims."""
    kind, who, token_agent, claimed = row
    if token_agent:
        return f"{kind}:agent-token={token_agent}"
    base = kind + (f":{who}" if who else "")
    return f"{base} claims[{claimed}]" if claimed else base


def summarize(con, since_ts):
    rows = con.execute(
        "SELECT route_id, auth_kind, auth_who, token_agent, claimed, would_deny, status "
        "FROM power_route_audit WHERE ts >= ?",
        (since_ts,),
    ).fetchall()
    table = defaultdict(lambda: {"n": 0, "deny": 0, "status": defaultdict(int)})
    for route_id, kind, who, token_agent, claimed, would_deny, status in rows:
        cell = table[(route_id, caller_of((kind, who, token_agent, claimed)))]
        cell["n"] += 1
        cell["deny"] += 1 if would_deny else 0
        cell["status"][status if status is not None else "none"] += 1
    return len(rows), table


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--days", type=float, default=7.0)
    args = ap.parse_args(argv)
    uri = "file:" + os.path.abspath(args.db) + "?mode=ro"
    try:
        con = sqlite3.connect(uri, uri=True)
    except sqlite3.Error as e:
        print(f"cannot open {args.db} read-only: {e}", file=sys.stderr)
        return 2
    try:
        has = con.execute("SELECT name FROM sqlite_master WHERE name='power_route_audit'").fetchone()
        if not has:
            print("no power_route_audit table: the build that writes it is not running on this database yet")
            return 3
        since = int(time.time() - args.days * 86400)
        total_all, first, last = con.execute("SELECT COUNT(*), MIN(ts), MAX(ts) FROM power_route_audit").fetchone()
        n, table = summarize(con, since)
    finally:
        con.close()
    fmt = lambda t: time.strftime("%Y-%m-%d %H:%M", time.localtime(t)) if t else "-"
    print(f"power_route_audit: {total_all} rows in the table (first {fmt(first)}, last {fmt(last)});"
          f" {n} rows in the last {args.days:g} days")
    if not table:
        print("(no calls in the window)")
        return 0
    print(f"{'route':<28} {'caller':<56} {'calls':>5} {'would_deny':>10}  statuses")
    for (route_id, caller), cell in sorted(table.items(), key=lambda kv: (-kv[1]["n"], kv[0])):
        st = " ".join(f"{k}x{v}" for k, v in sorted(cell["status"].items(), key=lambda kv: str(kv[0])))
        print(f"{route_id:<28} {caller[:56]:<56} {cell['n']:>5} {cell['deny']:>10}  {st}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
