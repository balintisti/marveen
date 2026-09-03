#!/usr/bin/env python3
"""Every payload-carrying hook resolves the agent from the SESSION, not the cwd
(card bfd8d307, upstream LEDGERCWD828).

This is a SHAPE check, not a behaviour check, and it is written down as such: it
reads the source and asserts that no hook which already has a payload in hand
still calls the cwd resolver. The behavioural proof lives in
agent-id-from-payload.test.py (the resolver, 7 checks, three mutations) and in
telegram-reply-guard-agent-id.test.py (the one call site that can talk to Isti).

Why a shape check earns its place here: the swap is one line per file and the
failure mode is silent -- a hook left on the cwd resolver mis-files rows under a
directory name and nothing ever complains. This test is what makes a NEW hook,
or a revert, loud.

THE THREE EXCEPTIONS ARE LISTED HERE ON PURPOSE, not in a comment somewhere else:
an exception a meter cannot see is an exception that gets re-litigated every time
someone runs the meter.

Run: python3 <thisfile>   Exit 0 = pass.
"""
import os
import re
import sys

HOOKS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hooks")

EXCEPTIONS = {
    "ledger-live-drain.py": (
        "no payload exists: it resolves from os.getcwd() because the hook is not "
        "given one. Adopting the chain here would pass an empty dict and change "
        "nothing -- it stays on the honest call."),
    "skill-usage-capture.py": (
        "carries its OWN private _agent_id_from_cwd copy. Upstream centralised "
        "exactly this file after the copy drifted; the port is a judgement call, "
        "not a one-line swap, and it is not in this commit."),
    "taskstate-replay.py": (
        "private copy AND different semantics: its resolver returns falsy for the "
        "main agent, which the caller uses to mean 'not a sub-agent target'. The "
        "adopted chain never returns falsy, so swapping it would change behaviour."),
}

CWD_CALL = re.compile(r"agent_id_from_cwd\s*\(")
HAS_PAYLOAD = re.compile(r"json\.load\(sys\.stdin\)|def \w+\(payload")

failures = []
checked = 0
for name in sorted(os.listdir(HOOKS)):
    if not name.endswith(".py") or name == "ledger_lib.py":
        continue
    src = open(os.path.join(HOOKS, name), encoding="utf-8").read()
    # Only the CALL matters; a definition or a comment naming the function does not.
    calls = [l for l in src.split("\n")
             if CWD_CALL.search(l) and not l.strip().startswith("#") and "def " not in l]
    if not calls:
        continue
    checked += 1
    if name in EXCEPTIONS:
        continue
    if HAS_PAYLOAD.search(src):
        failures.append(f"{name}: has a payload but still calls the cwd resolver -> {calls[0].strip()}")

# CONTROL: the meter must be able to SEE a violation, otherwise "0 failures" is
# indistinguishable from a regex that matches nothing.
probe = "payload = json.load(sys.stdin)\nx = ledger_lib.agent_id_from_cwd(payload.get('cwd'))"
if not (CWD_CALL.search(probe) and HAS_PAYLOAD.search(probe)):
    failures.append("CONTROL FAILED: the meter does not recognise a known-bad shape")

if failures:
    print(f"FAIL ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print(f"ok -- {checked} hooks still call the cwd resolver, all {len(EXCEPTIONS)} of them "
      f"listed exceptions; control recognises a known-bad shape")
