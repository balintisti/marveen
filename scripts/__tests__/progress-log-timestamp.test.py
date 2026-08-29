#!/usr/bin/env python3
"""Every progress/debug.log line must carry a DATED timestamp (card e9cc1fc2).

Class this pins: a log that records WHAT happened but not WHEN. Measured
2026-08-28 on the live file -- 319 [submit]/[enforce] lines, ZERO with a time.
The watchdog was the only writer with one, and it had no DATE, so placing a line
on a calendar meant inferring day boundaries from the clock running backwards.

What that cost: the Stop hook's three "no reply sent" denials could not be lined
up against conversation_log, which does have real timestamps. The card's actual
question -- WHICH enforcement was false -- was unanswerable, not because the
evidence was missing but because two records could not be joined.

Four writers share this file and each had its own log(). A test per writer,
because "one of them formats correctly" is what the watchdog already proved, and
it did not help.

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import importlib.util
import os
import re
import sys
import tempfile

HOOKS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hooks")
DATED = re.compile(r"^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] ")

# (module, passes a STATE dir rather than the progress dir)
WRITERS = [
    ("telegram_progress.py", True),
    ("telegram_progress_clear.py", True),
    ("telegram_fallback_send.py", True),
    ("telegram_progress_watchdog.py", False),
]

failed = []


def load(name):
    """Import by path. Safe: all four carry a __name__ guard, so nothing runs."""
    path = os.path.join(HOOKS, name)
    spec = importlib.util.spec_from_file_location(name[:-3], path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


for name, state_dir_arg in WRITERS:
    tmp = tempfile.mkdtemp(prefix="progress-log-")
    try:
        mod = load(name)
        if state_dir_arg:
            mod.log(tmp, "[proba] sor")
        else:
            os.makedirs(os.path.join(tmp, "progress"), exist_ok=True)
            mod.log(os.path.join(tmp, "progress"), "sor")
        path = os.path.join(tmp, "progress", "debug.log")
        if not os.path.exists(path):
            failed.append(f"{name}: nem irt semmit")
            print(f"FAIL {name}: nem keletkezett naplo")
            continue
        line = open(path, encoding="utf-8").read().rstrip("\n")
        if DATED.match(line):
            print(f"ok   {name}: {line}")
        else:
            failed.append(f"{name}: {line}")
            print(f"FAIL {name}: nincs datalt elotag -- {line}")
    except Exception as e:  # a writer that cannot be exercised is a failure too
        failed.append(f"{name}: {e}")
        print(f"FAIL {name}: {e}")

# CONTROL on the matcher itself. The old shape had a time but no date; if the
# pattern accepted it, every assertion above would pass without the fix. A test
# whose matcher cannot reject the defect it guards is a green light, not a test.
if DATED.match("[watchdog 23:24:39] regi alak"):
    failed.append("a minta elfogadja a DATUM NELKULI regi alakot")
    print("FAIL kontroll: a minta a datum nelkuli alakot is elfogadja")
else:
    print("ok   kontroll: a datum nelkuli regi alakot a minta ELUTASITJA")

print()
if failed:
    print(f"{len(failed)} FAILED: {failed}", file=sys.stderr)
    sys.exit(1)
print("All progress-log timestamp tests passed.")
