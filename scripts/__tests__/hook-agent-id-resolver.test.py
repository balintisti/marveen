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
        "NOT OUTSTANDING WORK, AND NOT AN ADOPTION -- upstream 29a1bd9 uses the shared "
        "chain and WE put the private resolver back (+22/-8), so the move would be "
        "WITHDRAWING our divergence. Ruled NO, not as-is (2026-09-06, marveen). "
        "THE DANGER, RE-MEASURED -- the earlier wording here said the resolver 'returns "
        "falsy for the main agent'; that has been FALSE since 2026-07-27, and both "
        "resolvers agree on the main agent (marveen) and on sub-agents. Both resolvers "
        "RUN on identical payloads, MARVEEN_AGENT_ID unset: worker -> None vs "
        "'.marveen-worker'; worker-fast -> None vs '.marveen-worker-fast'; unknown cwd "
        "-> None vs a directory name. The shared chain never goes falsy, so the caller "
        "would act on WORKER and UNKNOWN-cwd sessions under ids derived from directory "
        "names -- the exact failure ledger_lib's own docstring exists to prevent "
        "('plain directory names, not agents'). Its tree model has no concept of a "
        "config dir OUTSIDE the install, and the worker homes are outside it. "
        "CONDITION THAT MAKES IT SAFE: the shared resolver learns the worker homes, or "
        "we keep a local override for exactly those two. NOT MEASURED: the dashboard's "
        "behaviour on such ids, and whether upstream has a worker-home layout at all."),
}

CWD_CALL = re.compile(r"agent_id_from_cwd\s*\(")
HAS_PAYLOAD = re.compile(r"json\.load\(sys\.stdin\)|def \w+\(payload")


def cwd_calls(src):
    """The CALL lines only; a definition or a comment naming the function is not one.

    ONE definition, used by BOTH loops below. Two copies of this filter would be
    free to drift, and a drifted copy is what makes the two directions disagree
    about what "still calls the resolver" means.
    """
    return [l for l in src.split("\n")
            if CWD_CALL.search(l) and not l.strip().startswith("#") and "def " not in l]

failures = []
checked = 0
for name in sorted(os.listdir(HOOKS)):
    if not name.endswith(".py") or name == "ledger_lib.py":
        continue
    src = open(os.path.join(HOOKS, name), encoding="utf-8").read()
    calls = cwd_calls(src)
    if not calls:
        continue
    checked += 1
    if name in EXCEPTIONS:
        continue
    if HAS_PAYLOAD.search(src):
        failures.append(f"{name}: has a payload but still calls the cwd resolver -> {calls[0].strip()}")

# THE LIST IS CHECKED IN BOTH DIRECTIONS, and this half is the one that was missing.
# The loop above walks files that STILL call the resolver, so a file that MOVES OFF it
# drops out of the population at `if not calls: continue` and the test stays green --
# which is precisely the direction taskstate-replay.py's own entry calls dangerous.
#
# MEASURED 2026-09-06 (didi, card f626b725), on a throwaway copy, with the anchor's
# uniqueness asserted: swapping taskstate-replay.py onto the adopted chain left this
# test at exit 0. The only trace was the success line contradicting itself --
# "2 hooks ... all 3 of them listed exceptions" -- and prose is not a gate.
#
# It also closes the second silent case: a STALE entry. Today an obsolete list item and
# an unauthorised adoption are byte-identical, because both end as "no call, no failure".
for name in sorted(EXCEPTIONS):
    path = os.path.join(HOOKS, name)
    if not os.path.exists(path):
        failures.append(f"{name}: listed as an exception, but the file does not exist "
                        f"-- stale entry; remove it and say so in the commit")
        continue
    if not cwd_calls(open(path, encoding="utf-8").read()):
        failures.append(f"{name}: listed as an exception, but it NO LONGER calls the cwd "
                        f"resolver. Either the swap was deliberate (drop the entry AND "
                        f"record why the listed danger no longer applies) or it was not "
                        f"(revert it). This test will not decide that for you.")

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
