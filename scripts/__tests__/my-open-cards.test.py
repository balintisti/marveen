#!/usr/bin/env python3
"""Card 2e78cf63: scripts/my-open-cards.sh is the idle wake's re-measure (it replaced a ~320
character curl + python3 one-liner with a relative token path). It must give the SAME set as
that one-liner -- assigned to the agent, not done/waiting, not archived -- from ANY cwd, and say
so out loud when the board cannot be read.

The script talks to a real local HTTP server here (the same path it takes live).

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import ast
import json
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(HERE), "my-open-cards.sh")

failed = []


def check(name, ok):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    if not ok:
        failed.append(name)


CARDS = [
    {"id": "aaaaaaaa1111", "status": "in_progress", "assignee": "ford", "archived_at": None},
    {"id": "bbbbbbbb2222", "status": "testing", "assignee": "ford", "archived_at": None},
    {"id": "cccccccc3333", "status": "planned", "assignee": "ford", "archived_at": None},
    {"id": "dddddddd4444", "status": "done", "assignee": "ford", "archived_at": None},
    {"id": "eeeeeeee5555", "status": "waiting", "assignee": "ford", "archived_at": None},
    {"id": "ffffffff6666", "status": "testing", "assignee": "ford", "archived_at": 1700000000},
    {"id": "99999999aaaa", "status": "testing", "assignee": "dexter", "archived_at": None},
]
state = {"down": False, "seen": [], "auth": []}


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        state["seen"].append(self.path)
        state["auth"].append(self.headers.get("Authorization"))
        if state["down"]:
            self.send_response(500); self.end_headers(); return
        # Like the live server with ?assignee=, but this one ignores it on purpose: the script must
        # not rely on the server to filter.
        body = json.dumps(CARDS).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


srv = HTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
API = f"http://127.0.0.1:{srv.server_address[1]}"

tmp = tempfile.mkdtemp(prefix="my-open-cards-")
tok = os.path.join(tmp, "token")
with open(tok, "w") as f:
    f.write("test-token\n")


def run(agent, token_file=tok, cwd=None):
    env = dict(os.environ, MY_OPEN_CARDS_API=API, MY_OPEN_CARDS_TOKEN_FILE=token_file)
    return subprocess.run(["bash", SCRIPT, agent], env=env, cwd=cwd or tmp, capture_output=True, text=True)


r = run("ford")
check("rc 0", r.returncode == 0)
got = ast.literal_eval(r.stdout) if r.returncode == 0 else None
check("the agent's open cards: in_progress, testing, planned (id8, status)",
      got == [("aaaaaaaa", "in_progress"), ("bbbbbbbb", "testing"), ("cccccccc", "planned")])
check("done, waiting, archived and someone else's cards are out",
      got is not None and all(i not in {x[0] for x in got} for i in ("dddddddd", "eeeeeeee", "ffffffff", "99999999")))
check("the request asks the server for this agent", any("assignee=ford" in p for p in state["seen"]))
check("the token goes out as a Bearer header", state["auth"][-1] == "Bearer test-token")

r = run("dexter")
check("CONTROL: another agent gets its own set", ast.literal_eval(r.stdout) == [("99999999", "testing")])

r = run("ford", cwd="/")
check("works from any cwd (the old one-liner needed the install root)", r.returncode == 0 and "aaaaaaaa" in r.stdout)

# The DEFAULT token path is <script dir>/../store/.dashboard-token, whatever the cwd: a throwaway
# install layout with the script copied in, and only the API address overridden.
import shutil
inst = os.path.join(tmp, "install")
os.makedirs(os.path.join(inst, "scripts")); os.makedirs(os.path.join(inst, "store"))
shutil.copy(SCRIPT, os.path.join(inst, "scripts", "my-open-cards.sh"))
with open(os.path.join(inst, "store", ".dashboard-token"), "w") as f:
    f.write("install-token\n")
env = {k: v for k, v in os.environ.items() if k != "MY_OPEN_CARDS_TOKEN_FILE"}
env["MY_OPEN_CARDS_API"] = API
r = subprocess.run(["bash", os.path.join(inst, "scripts", "my-open-cards.sh"), "ford"], env=env, cwd="/", capture_output=True, text=True)
check("default token path resolves from the script's own location, from cwd /", r.returncode == 0 and state["auth"][-1] == "Bearer install-token")

state["down"] = True
r = run("ford")
check("a board that answers 500: rc 1, nothing on stdout, said on stderr",
      r.returncode == 1 and r.stdout == "" and "could not be read" in r.stderr)
state["down"] = False

r = run("ford", token_file=os.path.join(tmp, "missing"))
check("no token file: rc 1 and named", r.returncode == 1 and "no dashboard token" in r.stderr and r.stdout == "")

empty = os.path.join(tmp, "empty")
open(empty, "w").close()
r = run("ford", token_file=empty)
check("an empty token: rc 1 (no silent unauthenticated call)", r.returncode == 1 and "empty dashboard token" in r.stderr)

for bad in ("", "Ford", "x;rm", "a b", "../x"):
    r = run(bad)
    check(f"agent name {bad!r}: usage error rc 2", r.returncode == 2 and r.stdout == "")

print(f"{'FAIL' if failed else 'PASS'}: {len(failed)} failed")
sys.exit(1 if failed else 0)
