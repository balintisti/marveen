#!/usr/bin/env python3
"""The agent id must survive a `cd` into another agent's directory (card bfd8d307).

Class this pins: an identity derived from MUTABLE state. The shell cwd changes
within a session, so a hook that resolves "who am I" from cwd re-attributes every
later row the moment anyone steps into agents/<x>/ for a measurement. Upstream
measured the blast radius of exactly that (LEDGERCWD828): the main agent's own
replies ledgered under another name, the reply guard then found no outbound under
the real id, and it TRIPLE-SENT an already-answered link to the owner -- 51
outbound rows under 7 names.

Adopted rather than written: the resolution chain is theirs (transcript_path ->
MARVEEN_AGENT_ID -> cwd), and step 3 is our own pre-existing resolver.

THE CONTROL HAS TWO DIRECTIONS AND ONLY THE SECOND ONE PROVES THE FIX:

    normal cwd, no transcript      -> unchanged (nothing regressed)
    cwd inside agents/<x>/, but a
    transcript owned by the main    -> STILL the main agent  <- today's bug returns <x>

Without the first direction a function that always returned the main agent would
pass; without the second, the old cwd resolver would.

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(HERE, "..", "hooks", "ledger_lib.py")
spec = importlib.util.spec_from_file_location("ledger_lib", LIB)
lib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lib)

INSTALL = lib._install_dir().rstrip("/")
MAIN = lib.main_agent_id()
AGENTS = os.path.join(INSTALL, "agents")
# A SYNTHETIC sub-agent name, deliberately: `agents/` is gitignored, so it exists
# in the main checkout and NOT in a worktree, and its membership changes. A test
# that read the live directory would pass or fail depending on where it was run
# and on who is in the fleet that day. The resolver is pure path logic, so a name
# that never existed exercises it identically -- and no hyphen in it, so the
# hyphen-disambiguation fallback cannot mask a wrong answer.
SUB = "subagentx"

failures = []


def check(name, got, want):
    if got != want:
        failures.append(f"{name}: got {got!r}, want {want!r}")


# --- direction 1: nothing regressed ------------------------------------------
check("no payload at all falls back to the cwd resolver",
      lib.agent_id_from_payload({}), lib.agent_id_from_cwd(os.getcwd()))
check("cwd-only payload matches the old resolver exactly",
      lib.agent_id_from_payload({"cwd": INSTALL}), lib.agent_id_from_cwd(INSTALL))
check("a sub-agent's own cwd still resolves to that sub-agent",
      lib.agent_id_from_payload({"cwd": os.path.join(AGENTS, SUB)}), SUB)

# --- direction 2: the fix ----------------------------------------------------
# The main agent, mid-measurement, standing inside another agent's directory.
main_transcript = os.path.join(
    os.path.expanduser("~"), ".claude", "projects",
    INSTALL.replace(os.sep, "-"), "session.jsonl")
check("cwd inside agents/<x>/ does NOT re-attribute a main-owned session",
      lib.agent_id_from_payload({"transcript_path": main_transcript,
                                 "cwd": os.path.join(AGENTS, SUB)}), MAIN)
# And the negative of the same shape: a sub-agent's own transcript still wins,
# so the fix is not "always say main".
sub_transcript = os.path.join(AGENTS, SUB, ".claude-config", "projects", "x", "session.jsonl")
check("a sub-agent's own transcript still resolves to the sub-agent",
      lib.agent_id_from_payload({"transcript_path": sub_transcript, "cwd": INSTALL}), SUB)

# --- the env override, step 2 of the chain -----------------------------------
os.environ["MARVEEN_AGENT_ID"] = "explicit-override"
check("the explicit override beats cwd",
      lib.agent_id_from_payload({"cwd": os.path.join(AGENTS, SUB)}), "explicit-override")
check("but transcript_path still beats the override",
      lib.agent_id_from_payload({"transcript_path": sub_transcript,
                                 "cwd": INSTALL}), SUB)
del os.environ["MARVEEN_AGENT_ID"]

if failures:
    print(f"FAIL ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print(f"ok -- 7 checks, sub-agent fixture: {SUB}, main: {MAIN}")
