#!/usr/bin/env python3
"""Card 4008ea30 -- the tester-inactivity signal. No production, no Postgres:
pg_restore, notify.sh and the kanban API are stubs, and the end-to-end runs go
through the real script in a subprocess with LANG unset, the way launchd runs it.

Run: python3 scripts/__tests__/delta-crm-tester-inactivity.test.py
"""
import datetime
import http.server
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(HERE, "delta-crm-tester-inactivity.py")
spec = importlib.util.spec_from_file_location("ti", SCRIPT)
ti = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ti)

PASS = FAIL = 0


def check(label, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label}")


D = datetime.datetime
NOW = D(2026, 10, 4, 4, 15, 0)

print("== decide: one alert per lapse ==")
co = {"a": ("Aktiv Kft.", None, NOW - datetime.timedelta(days=2), True),
      "b": ("Alvo Kft.", None, NOW - datetime.timedelta(days=9), True)}
alerts, st = ti.decide(co, {}, NOW)
check("only the company past 7 days is announced", [a[0] for a in alerts] == ["b"])
check("the day count is in the alert", alerts[0][5] == 9)
alerts2, st2 = ti.decide(co, st, NOW + datetime.timedelta(days=1))
check("the same lapse is not announced twice", alerts2 == [] and st2 == st)
back = dict(co, b=("Alvo Kft.", None, NOW, True))
_, st3 = ti.decide(back, st2, NOW)
check("a company back under the threshold leaves the state", "b" not in st3)
again = dict(co, b=("Alvo Kft.", None, NOW - datetime.timedelta(days=8), True))
alerts4, _ = ti.decide(again, st3, NOW + datetime.timedelta(days=1))
check("its NEXT lapse is announced again", [a[0] for a in alerts4] == ["b"])
edge, _ = ti.decide({"e": ("E", None, NOW - datetime.timedelta(days=7), True)}, {}, NOW)
check("exactly 7 days counts as a lapse", len(edge) == 1)
under, _ = ti.decide({"u": ("U", None, NOW - datetime.timedelta(days=6, hours=23), True)}, {}, NOW)
check("6 days 23 hours does not", under == [])

print("== last_seen: the signal and the population ==")
N = ti.NULL
tables = {
    "Organization": [
        {"id": "o1", "name": "Login Kft.", "provenance": N, "deletedAt": N, "createdAt": "2026-01-01 00:00:00"},
        {"id": "o2", "name": "Session Kft.", "provenance": "CUSTOMER", "deletedAt": N, "createdAt": "2026-01-01 00:00:00"},
        {"id": "o3", "name": "Soha Kft.", "provenance": N, "deletedAt": N, "createdAt": "2026-09-01 10:00:00"},
        {"id": "o4", "name": "E2E Kft.", "provenance": "E2E", "deletedAt": N, "createdAt": "2026-01-01 00:00:00"},
        {"id": "o5", "name": "Torolt Kft.", "provenance": N, "deletedAt": "2026-09-01 00:00:00", "createdAt": "2026-01-01 00:00:00"},
    ],
    "User": [
        {"organizationId": "o1", "lastLoginAt": "2026-09-20 08:00:00.123", "deletedAt": N},
        {"organizationId": "o1", "lastLoginAt": "2026-10-03 08:00:00", "deletedAt": "2026-10-03 09:00:00"},
        {"organizationId": "o2", "lastLoginAt": "2026-09-01 08:00:00", "deletedAt": N},
    ],
    "Session": [
        {"organizationId": "o2", "lastActivityAt": "2026-10-03 17:00:00"},
    ],
}
ls = ti.last_seen(tables)
check("E2E/SEED/DEMO and deleted companies are out", sorted(ls) == ["o1", "o2", "o3"])
check("a DELETED user's login does not count", ls["o1"][2] == D(2026, 9, 20, 8, 0, 0))
check("a newer session activity beats an older login (refresh-token users)", ls["o2"][2] == D(2026, 10, 3, 17, 0, 0))
check("a company nobody signed into counts from createdAt, marked never active",
      ls["o3"][2] == D(2026, 9, 1, 10, 0, 0) and ls["o3"][3] is False)
check("unclassified stays unclassified (None), classified keeps its label",
      ls["o1"][1] is None and ls["o2"][1] == "CUSTOMER")
check("the never-active message says so, not 'last activity'",
      "senki nem lépett be" in ti.message("Soha Kft.", None, ls["o3"][2], False, 33))

print("== the exclusion list (Isti 5224 via marveen 23333) ==")
X = tempfile.mkdtemp(prefix="ti-excl-")
xf = os.path.join(X, "exclude.json")
check("no file: nothing excluded", ti.load_exclusions(xf) == {})
open(xf, "w").write(json.dumps({"o2": {"name": "Claude Teszt Kft.", "why": "Isti 5224"}}))
ex = ti.load_exclusions(xf)
comp = {"o1": ("A", None, D(2026, 9, 1), True), "o2": ("Claude Teszt Kft.", None, D(2026, 7, 27), False)}
kept, dropped, stale = ti.apply_exclusions(comp, ex)
check("the listed id is dropped, the other kept", sorted(kept) == ["o1"] and [d[0] for d in dropped] == ["o2"])
check("the reason travels with it, for the log", dropped[0][2] == "Isti 5224")
_, _, stale = ti.apply_exclusions({"o1": comp["o1"]}, ex)
check("a listed id missing from the dump is reported stale", stale == ["o2"])
for bad in ("[1]", '{"o2": "no reason"}', '{"o2": {"name": "x"}}', '{"o2": {"why": "  "}}', "not json"):
    open(xf, "w").write(bad)
    try:
        ti.load_exclusions(xf)
        ok = False
    except Exception:
        ok = True
    check(f"a malformed list raises, never 'nothing excluded': {bad!r}", ok)

print("== end to end, through the real script (LANG unset, like launchd) ==")
T = tempfile.mkdtemp(prefix="ti-test-")
dumps = os.path.join(T, "dumps")
os.mkdir(dumps)
dump = os.path.join(dumps, "delta-crm-20261004-033004-public.dump")
open(dump, "w").write("not a real dump; the stub pg_restore ignores it")
copy = (
    'COPY public."Organization" (id, name, provenance, "deletedAt", "createdAt") FROM stdin;\n'
    "o1\tÁrvíztűrő Kft.\t\\N\t\\N\t2026-01-01 00:00:00\n"
    "o2\tFriss Kft.\t\\N\t\\N\t2026-01-01 00:00:00\n\\.\n"
    'COPY public."User" ("organizationId", "lastLoginAt", "deletedAt") FROM stdin;\n'
    "o1\t2026-09-01 08:00:00\t\\N\n"
    "o2\t2026-10-03 08:00:00\t\\N\n\\.\n"
    'COPY public."Session" ("organizationId", "lastActivityAt") FROM stdin;\n\\.\n'
)
copy_file = os.path.join(T, "copy.txt")
open(copy_file, "w", encoding="utf-8").write(copy)
fake_pg = os.path.join(T, "pg_restore")
open(fake_pg, "w").write(f'#!/bin/bash\n[ -f "{T}/pg-fail" ] && exit 3\ncat "{copy_file}"\n')
os.chmod(fake_pg, 0o755)
notified = os.path.join(T, "notified.txt")
fake_notify = os.path.join(T, "notify.sh")
open(fake_notify, "w").write(f'#!/bin/bash\n[ -f "{T}/notify-fail" ] && exit 1\nprintf "%s\\n" "$1" >> "{notified}"\n')
token = os.path.join(T, "token")
open(token, "w").write("test-token")

cards = []


class Kanban(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])).decode("utf-8"))
        body["auth"] = self.headers.get("Authorization")
        cards.append(body)
        out = json.dumps({"id": f"card{len(cards)}"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


srv = http.server.HTTPServer(("127.0.0.1", 0), Kanban)
threading.Thread(target=srv.serve_forever, daemon=True).start()
state = os.path.join(T, "state.json")
env = {"PATH": "/usr/bin:/bin", "HOME": os.environ.get("HOME", "/tmp"),
       "TI_DUMP_DIR": dumps, "TI_PG_RESTORE": fake_pg, "TI_STATE_FILE": state,
       "TI_LOG_FILE": os.path.join(T, "ti.log"), "TI_NOTIFY_SCRIPT": fake_notify,
       "TI_KANBAN_URL": f"http://127.0.0.1:{srv.server_port}/api/kanban", "TI_TOKEN_FILE": token,
       "TI_NOW": "2026-10-04 04:15:00", "TI_EXCLUDE_FILE": os.path.join(T, "exclude.json")}


def run():
    r = subprocess.run([sys.executable, SCRIPT], env=env, capture_output=True)
    return r.returncode, (r.stdout + r.stderr).decode("utf-8", "replace")


def sent():
    return open(notified, encoding="utf-8").read().splitlines() if os.path.exists(notified) else []


rc, out = run()
check(f"first run succeeds (rc={rc})", rc == 0)
check("exactly one alert, for the 32-day company (09-01 08:00 -> 10-04 04:15), accents intact",
      len(sent()) == 1 and "Árvíztűrő Kft." in sent()[0] and "32 napja" in sent()[0])
check("one card, to marveen, project delta-crm, with the token",
      len(cards) == 1 and cards[0]["assignee"] == "marveen" and cards[0]["project"] == "delta-crm"
      and cards[0]["auth"] == "Bearer test-token" and "Árvíztűrő" in cards[0]["title"])
check("the state remembers it", list(json.load(open(state))) == ["o1"])
rc, out = run()
check("second run: no repeat alert, no second card", rc == 0 and len(sent()) == 1 and len(cards) == 1)

os.remove(state)
open(os.path.join(T, "notify-fail"), "w").close()
rc, out = run()
check(f"a failed alert fails the run (rc={rc})", rc != 0)
check("...and leaves no state, so the next run tries again", not os.path.exists(state))
os.remove(os.path.join(T, "notify-fail"))
rc, out = run()
check("the next run delivers it", rc == 0 and len(sent()) == 2)

print("== the exclusion, through the real script ==")
os.remove(state)
open(notified, "w").close()
cards.clear()
open(os.path.join(T, "exclude.json"), "w").write(json.dumps({"o1": {"name": "Árvíztűrő Kft.", "why": "Isti 5224"}}))
rc, out = run()
log_text = open(os.path.join(T, "ti.log"), encoding="utf-8").read()
check(f"the excluded 32-day company: no alert, no card (rc={rc})", rc == 0 and sent() == [] and cards == [])
check("...and the run says so in its log, with the reason", "EXCLUDED o1 Árvíztűrő Kft. -- Isti 5224" in log_text)
open(os.path.join(T, "exclude.json"), "w").write("[")
rc, out = run()
check(f"a broken list: rc={rc}, UNKNOWN, not a silent pass", rc != 0 and any("ISMERETLEN" in m and "kizaro" in m for m in sent()))
os.remove(os.path.join(T, "exclude.json"))

print("== no silent all-clear ==")
open(notified, "w").close()
old = time.time() - 30 * 3600
os.utime(dump, (old, old))
rc, out = run()
check(f"a 30-hour-old dump: rc={rc}, the signal is reported UNKNOWN", rc != 0 and any("ISMERETLEN" in m for m in sent()))
os.utime(dump, None)
open(notified, "w").close()
open(os.path.join(T, "pg-fail"), "w").close()
rc, out = run()
check("an unreadable dump: UNKNOWN, not 'everybody active'", rc != 0 and any("ISMERETLEN" in m for m in sent()))
os.remove(os.path.join(T, "pg-fail"))
open(notified, "w").close()
os.remove(dump)
rc, out = run()
check("no dump at all: UNKNOWN", rc != 0 and any("ISMERETLEN" in m and "nincs dump" in m for m in sent()))
open(dump, "w").write("x")
open(copy_file, "w", encoding="utf-8").write(copy.split('COPY public."Session"')[0])
open(notified, "w").close()
rc, out = run()
check("a dump without the Session table: UNKNOWN, names the table", rc != 0 and any("Session" in m for m in sent()))

srv.shutdown()
print(f"\n  {PASS} ok, {FAIL} bukott")
sys.exit(1 if FAIL else 0)
