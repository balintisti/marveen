#!/usr/bin/env bash
# verify-context-pct.sh -- the acceptance check for /api/agents `contextPct` (card d5798819).
#
# WHY A SCRIPT AND NOT A UNIT TEST. The route only computes contextTokens (and
# therefore contextPct) for a RUNNING agent, and "running" means a live tmux
# session. That branch is not reachable from a test host with no fleet, so a
# vitest case would pass vacuously in CI while proving nothing -- the exact
# shape this card is about: code that exists, looks right, and has never run.
# The denominator itself IS unit-tested (src/__tests__/context-pct.test.ts);
# this checks the WIRING, on the only path where the wiring exists.
#
# WHY IT RE-IMPLEMENTS THE RULE. The model -> window mapping below is a second,
# deliberate copy of contextLimitForModel. Everywhere else in this repo a rule
# written twice is a defect; a CHECK is the one exception, because a verifier
# that imports what it verifies can only confirm that the code equals itself.
# If the two ever disagree, that disagreement is the finding.
#
# Usage:  bash scripts/verify-context-pct.sh [port]
# Exit:   0 = every running agent's pct matches an independently computed value
#         1 = a mismatch (the wiring is wrong)
#         2 = could not check (server unreachable, or NO running agent had a
#             token count -- an unmeasurable run is a failure, not a pass)
set -uo pipefail
PORT="${1:-${MARVEEN_WEB_PORT:-3420}}"
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN_FILE="$BASE/store/.dashboard-token"
[ -r "$TOKEN_FILE" ] || { echo "NEM ELLENORIZTEM: nincs token ($TOKEN_FILE)"; exit 2; }

curl -s -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
  "http://localhost:${PORT}/api/agents" | python3 -c '
import json, re, sys

# Second implementation, on purpose -- see the header.
ONE_M = [r"fable-\d", r"mythos-\d", r"opus-4-[6-9]", r"opus-[5-9]\b"]
def limit(model):
    m = (model or "").lower()
    if "[1m]" in m: return 1_000_000
    return 1_000_000 if any(re.search(rx, m) for rx in ONE_M) else 200_000

try:
    d = json.load(sys.stdin)
except Exception:
    print("NEM ELLENORIZTEM: a valasz nem JSON (fut a dashboard?)"); sys.exit(2)
rows = d if isinstance(d, list) else d.get("agents", d)
if not isinstance(rows, list):
    print("NEM ELLENORIZTEM: varatlan valasz-alak"); sys.exit(2)

checked = bad = 0
missing_field = []
for a in rows:
    name = a.get("name", "?")
    if "contextPct" not in a:
        missing_field.append(name); continue
    tok, pct = a.get("contextTokens"), a.get("contextPct")
    if tok is None:
        # The two must agree about being unmeasurable; a 0 here would read as
        # "the context is empty", which is a different answer.
        if pct is not None:
            print(f"  ELTERES {name}: contextTokens=None de contextPct={pct}"); bad += 1
        continue
    override = (a.get("contextGuard") or {}).get("limitTokens")
    lim = override if isinstance(override, (int, float)) and override > 0 \
          else limit(a.get("activeModel") or a.get("model"))
    want = tok / lim
    checked += 1
    if pct is None or abs(pct - want) > 1e-9:
        model_used = a.get("activeModel") or a.get("model")
        print(f"  ELTERES {name}: contextPct={pct} varhato={want:.6f} "
              f"(tokens={tok} limit={lim} modell={model_used})")
        bad += 1
    else:
        print(f"  OK {name:12s} {tok:>8} / {lim:>9} = {pct*100:5.1f}%")

if missing_field:
    print(f"BUKOTT: a contextPct mezo HIANYZIK: {missing_field}"); sys.exit(1)
if bad:
    print(f"BUKOTT: {bad} elteres {checked} ellenorzott agensbol"); sys.exit(1)
if checked == 0:
    # NOT SCANNED, therefore NOT CLEARED.
    print("NEM ELLENORIZTEM: egyetlen futo agensnek sincs token-szama -- "
          "ez NEM rendben, hanem NEM MERHETO."); sys.exit(2)
print(f"PASS: {checked} agens, mindegyik pct egyezik a fuggetlenul szamolt ertekkel.")
'
