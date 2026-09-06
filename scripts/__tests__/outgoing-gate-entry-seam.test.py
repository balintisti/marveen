#!/usr/bin/env python3
"""A RETURNING telegram_gate must BLOCK, not pass through (card 9106d8e6).

THE SEAM. `outgoing-copy-gate.py`'s entry point dispatches like this:

    if telegram      -> telegram_gate(...)
    if send_email    -> ...          <- a second `if`, not `elif`
    elif Bash        -> ...
    else             -> sys.exit(0)

Every path in telegram_gate exits today -- measured 2026-09-06: five exits, all hard. So the
seam is latent. But if a `return` is ever added (a perfectly ordinary refactor: early exit,
shared error branch, "let's give the caller a status"), control falls PAST the telegram branch,
fails to match `send_email`, is not `Bash`, and lands in `else: sys.exit(0)`. That is a SILENT
pass-through on exactly the path that inspects text going to the owner.

WHY NOT `elif` (marveen's ruling, didi's mechanism). `elif` closes the chain, so control resumes
AFTER it with `text`/`unreadable` unassigned -> exception -> exit 1 + traceback. This file's own
contract is "exit 0 = allow, exit 2 = block"; 1 is neither, so the harness treats it as a hook
error and THE CALL PROCEEDS. `elif` converts a silent pass-through into a loud one and leaves
the pass-through intact. Hence an explicit exit 2 -- and specifically 2, because "non-zero"
would ship precisely the exit-1 behaviour the card rejects.

THE REGRESSION IS PRODUCED, NOT ASSUMED. Test 1 runs a COPY of the gate whose telegram_gate
returns immediately -- the future edit, made real. The live hook is never modified or invoked.

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import ast
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GATE = os.path.join(ROOT, "scripts", "hooks", "outgoing-copy-gate.py")
FAILS = []

SIG = "def telegram_gate(tool_input: dict) -> None:"


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else "  -- " + str(detail)))
    if not cond:
        FAILS.append(name)


def variant(tmp, name, returning):
    """A copy of the gate; if `returning`, telegram_gate returns instead of exiting."""
    src = open(GATE, encoding="utf-8").read()
    if returning:
        assert src.count(SIG) == 1, "telegram_gate signature is not unique -- anchor is stale"
        src = src.replace(SIG, SIG + "\n    return None  # TEST STUB: the future regression", 1)
    path = os.path.join(tmp, name)
    open(path, "w", encoding="utf-8").write(src)
    return path


def run(path, payload):
    p = subprocess.run([sys.executable, path], input=json.dumps(payload),
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


TELEGRAM = "mcp__plugin_telegram_telegram__reply"


def main():
    tmp = tempfile.mkdtemp(prefix="entryseam-")
    try:
        pristine = variant(tmp, "pristine.py", returning=False)
        stubbed = variant(tmp, "returning.py", returning=True)

        print("1. THE PIN -- a RETURNING telegram_gate must exit 2, never 0")
        rc, out = run(stubbed, {"tool_name": TELEGRAM, "tool_input": {"text": "ez egy teljesen rendes üzenet a gazdának"}})
        check("exit code is 2 (block), not 0 (silent pass-through)", rc == 2, f"rc={rc} out={out[:200]}")
        check("names the returning gate in stderr", "telegram_gate visszatert" in out, out[:220])
        check("it is NOT exit 1 (that would be a hook error, and the call proceeds)", rc != 1, f"rc={rc}")

        print("2. CONTROL -- the same STUBBED copy still lets an unrelated tool through")
        rc, out = run(stubbed, {"tool_name": "Read", "tool_input": {"file_path": "/tmp/x"}})
        check("unrelated tool exits 0", rc == 0, f"rc={rc} out={out[:200]}")
        # Without this the stub could be blocking everything, and test 1 would prove nothing.

        print("3. CONTROL -- the REAL gate still blocks a bad telegram message with ITS OWN message")
        rc, out = run(pristine, {"tool_name": TELEGRAM, "tool_input": {"text": "ez egy gondolatjel — itt"}})
        check("exit 2", rc == 2, f"rc={rc} out={out[:200]}")
        check("it is the GATE's message, not the seam's",
              "GONDOLATJEL" in out and "telegram_gate visszatert" not in out, out[:260])

        print("4. CONTROL -- the REAL gate still lets a clean telegram message through")
        rc, out = run(pristine, {"tool_name": TELEGRAM, "tool_input": {"text": "ez egy teljesen rendes üzenet a gazdának"}})
        check("exit 0", rc == 0, f"rc={rc} out={out[:200]}")

        print("5. CONTROL -- an unrelated tool is untouched on the REAL gate")
        rc, out = run(pristine, {"tool_name": "Read", "tool_input": {"file_path": "/tmp/x"}})
        check("exit 0", rc == 0, f"rc={rc} out={out[:200]}")

        print("6. STRUCTURAL -- telegram_gate itself still has no `return` (the latent form)")
        tree = ast.parse(open(GATE, encoding="utf-8").read())
        fn = next((n for n in ast.walk(tree)
                   if isinstance(n, ast.FunctionDef) and n.name == "telegram_gate"), None)
        check("telegram_gate is present", fn is not None)
        if fn is not None:
            returns = [n for n in ast.walk(fn) if isinstance(n, ast.Return)]
            check("no `return` statement in telegram_gate", not returns,
                  f"{len(returns)} return(s) -- the seam is now LIVE, and test 1 is what stands between "
                  "that and a silent pass-through")
        # CONTROL: the meter can say "this one HAS a return" -- otherwise it says no to everything.
        other = next((n for n in ast.walk(tree)
                      if isinstance(n, ast.FunctionDef) and n.name == "collect_telegram_body"), None)
        check("CONTROL: the AST meter finds a `return` where one exists",
              other is not None and any(isinstance(n, ast.Return) for n in ast.walk(other)))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n%d FAILED: %s" % (len(FAILS), FAILS) if FAILS
          else "\nAll outgoing-gate entry-seam tests passed.")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
