#!/usr/bin/env python3
"""Card a1846990 (marveen 54158 (3)): the SessionStart replay keeps the
"LEGFRISSEBB FORDULÓK" turns whole and caps only the "KORÁBBI HÁTTÉR" backfill
at ~2k chars, dropping the oldest backfill lines first.

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HOOKS = os.path.join(os.path.dirname(HERE), "hooks")
sys.path.insert(0, HOOKS)
spec = importlib.util.spec_from_file_location("replay", os.path.join(HOOKS, "ledger-replay.py"))
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)

OLDER_HEAD = "KORÁBBI HÁTTÉR"
RECENT_HEAD = "LEGFRISSEBB FORDUL"


def turns(n, width):
    return [f'  [2026-11-05T08:{i:02d}:00Z] Gazda: "TURN{i:02d} ' + "x" * width + '"' for i in range(n)]


def sections(transcript):
    ctx = replay._build_output(transcript, None, "Gazda")["hookSpecificOutput"]["additionalContext"]
    o = ctx.find(OLDER_HEAD)
    recent = ctx[ctx.find(RECENT_HEAD):o if o >= 0 else len(ctx)]
    older = ctx[o:].split("\n", 1)[1] if o >= 0 else None
    return recent, older


failed = []


def check(name, ok):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    if not ok:
        failed.append(name)


os.environ.pop("LEDGER_CONTEXT_OLDER_CHAR_BUDGET", None)

# 1. 20 turns of ~330 chars: 15 backfill lines (~5k) must shrink to <= 2000.
t = turns(20, 300)
recent, older = sections(t)
check("all 5 recent turns whole", all(f"TURN{i:02d} " + "x" * 300 in recent for i in range(15, 20)))
check("backfill section present", older is not None)
check("backfill <= 2000 chars", older is not None and len(older) + 1 <= 2000)
check("newest backfill line kept (TURN14)", older is not None and "TURN14" in older)
check("oldest backfill line dropped (TURN00)", older is not None and "TURN00" not in older)
kept = [i for i in range(15) if older and f"TURN{i:02d}" in older]
check("kept backfill is a contiguous newest run", kept == list(range(15 - len(kept), 15)) and len(kept) >= 1)

# 2. Control: a budget larger than the backfill keeps every line (the cap is what trims).
os.environ["LEDGER_CONTEXT_OLDER_CHAR_BUDGET"] = "100000"
_, older_all = sections(t)
check("override 100000 keeps all 15 backfill lines", older_all is not None and all(f"TURN{i:02d}" in older_all for i in range(15)))
os.environ.pop("LEDGER_CONTEXT_OLDER_CHAR_BUDGET")

# 3. <= 5 turns: no backfill section at all, nothing trimmed.
recent, older = sections(turns(5, 300))
check("5 turns: no backfill section", older is None and all(f"TURN{i:02d}" in recent for i in range(5)))

# 4. One backfill line longer than the cap: the section disappears, recent turns stay whole.
t = turns(1, 2500) + turns(6, 10)[1:]
recent, older = sections(t)
check("oversized lone backfill line: section dropped", older is None)
check("oversized lone backfill line: recent whole", all(f"TURN{i:02d}" in recent for i in range(1, 6)))

# 5. The byte-fit loop still bounds the whole payload with the cap in place.
out = replay._fit_output(turns(20, 1100), None, "Gazda", 8192)
check("byte-fit: payload <= 8192 bytes", replay._payload_bytes(out) <= 8192)
check("byte-fit: newest turn survives", "TURN19" in out["hookSpecificOutput"]["additionalContext"])

print(f"{'FAIL' if failed else 'PASS'}: {len(failed)} failed")
sys.exit(1 if failed else 0)
