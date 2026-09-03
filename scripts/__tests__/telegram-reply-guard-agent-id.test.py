#!/usr/bin/env python3
"""The reply guard must look up the open question under the SESSION's agent, not
the cwd's (card bfd8d307).

Why this hook first, and alone: it is the one on the path to Isti. The upstream
incident (LEDGERCWD828) had exactly this shape -- the guard resolved the wrong
agent id, found no outbound under the real one, and TRIPLE-SENT an already
answered link to the owner. Everything else on the nine-hook list can mis-file a
ledger row; this one can talk to the user.

The test stubs ledger_lib, so nothing touches the real ledger, no state file is
written and no block decision reaches a live turn. What it records is the single
thing that matters: WHICH agent id the guard passes to open_question_with_age.

    payload: transcript owned by the main agent, cwd inside agents/<x>
    want:    'marveen'      (the session's identity)
    today:   '<x>'          (the cwd's identity) -- that is the bug

Run: python3 <thisfile>   Exit 0 = pass.
"""
import importlib.util
import io
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "..", "hooks", "telegram-reply-guard.py")
INSTALL = os.path.abspath(os.path.join(HERE, "..", ".."))
MAIN = "marveen"
SUB = "subagentx"          # synthetic on purpose: agents/ is gitignored

seen = {}

stub = types.ModuleType("ledger_lib")
stub.db_path = lambda: os.path.join(INSTALL, "store", "x.db")


def _from_cwd(cwd):
    cwd = (cwd or "").rstrip("/")
    root = os.path.join(INSTALL, "agents")
    if cwd.startswith(root + os.sep):
        return cwd[len(root) + 1:].split(os.sep)[0]
    return MAIN


def _from_payload(payload):
    p = (payload or {}).get("transcript_path") or ""
    root = os.path.join(INSTALL, "agents")
    if p.startswith(root + os.sep):
        return p[len(root) + 1:].split(os.sep)[0]
    if p:
        return MAIN
    return _from_cwd((payload or {}).get("cwd"))


stub.agent_id_from_cwd = _from_cwd
stub.agent_id_from_payload = _from_payload


def _open_question(agent_id):
    seen["agent_id"] = agent_id
    return None                      # nothing open -> the hook exits quietly


stub.open_question_with_age = _open_question
sys.modules["ledger_lib"] = stub

spec = importlib.util.spec_from_file_location("reply_guard", HOOK)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

payload = {
    "transcript_path": os.path.join(
        os.path.expanduser("~"), ".claude", "projects",
        INSTALL.replace(os.sep, "-"), "session.jsonl"),
    "cwd": os.path.join(INSTALL, "agents", SUB),
}
sys.stdin = io.StringIO(json.dumps(payload))
try:
    guard.main()
except SystemExit:
    pass

failures = []
if seen.get("agent_id") != MAIN:
    failures.append(
        f"the guard looked up the open question under {seen.get('agent_id')!r}, "
        f"want {MAIN!r} -- a cd into agents/{SUB}/ re-attributed the session")

# CONTROL, without which a guard hard-wired to the main agent would also pass:
# a genuine sub-agent session must still resolve to that sub-agent.
seen.clear()
sys.stdin = io.StringIO(json.dumps({
    "transcript_path": os.path.join(INSTALL, "agents", SUB, ".claude-config",
                                    "projects", "p", "s.jsonl"),
    "cwd": INSTALL,
}))
try:
    guard.main()
except SystemExit:
    pass
if seen.get("agent_id") != SUB:
    failures.append(
        f"a real sub-agent session resolved to {seen.get('agent_id')!r}, want {SUB!r} "
        f"-- the fix must not collapse everyone into the main agent")

if failures:
    print(f"FAIL ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("ok -- 2 checks: session identity wins over cwd, and sub-agents still resolve")
