#!/usr/bin/env bash
# agent-progress.sh -- is that agent actually moving, or is a tool call wedged?
#
# WHY: the [session-stuck] alert fires every 30 minutes for every agent that is
# merely BUSY, and it says so itself ("Not a stall by itself -- check whether the
# turn is progressing"). Checking by hand means capturing the pane twice with a
# sleep in between and eyeballing two numbers. On 2026-08-21 that happened four
# times before lunch, and each time the answer was "it is fine". Four hand-runs
# of the same three commands is a script.
#
# WHAT IT MEASURES: the spinner line carries elapsed time and DOWNLOADED TOKENS
# ("· Envisioning… (35m 54s · ↓ 43.6k tokens)"). Tokens rising = the model is
# still producing. Tokens flat is NOT proof of a stall -- a long tool call
# produces nothing while it runs -- so a flat sample reports UNCLEAR and says
# what to look at, rather than pretending to a verdict it cannot reach.
#
# Usage:  bash scripts/agent-progress.sh <agent> [samples] [gap-seconds]
#         bash scripts/agent-progress.sh mandark          # 3 samples, 15s apart
# Exit:   0 = moving | 1 = unclear (look at the last tool call) | 2 = no pane
set -uo pipefail

AGENT="${1:?agent required}"; N="${2:-3}"; GAP="${3:-15}"
SESSION="agent-$AGENT"

tmux has-session -t "$SESSION" 2>/dev/null || { echo "NINCS PANE: $SESSION"; exit 2; }

spinner() { tmux capture-pane -p -t "$SESSION" 2>/dev/null | grep -E '·.*tokens|tokens\)' | tail -1; }

FIRST=""; LAST=""
for i in $(seq 1 "$N"); do
  LINE="$(spinner)"
  [ -z "$FIRST" ] && FIRST="$LINE"
  LAST="$LINE"
  printf '  %s\n' "${LINE:-(nincs spinner -- a pane valoszinuleg IDLE)}"
  [ "$i" -lt "$N" ] && python3 -c "import time,sys; time.sleep(float(sys.argv[1]))" "$GAP"
done

if [ -z "$LAST" ]; then
  # NOT the same as "idle for a while": a turn that just ended and a turn about
  # to start look identical here. Measured 2026-08-21: three empty samples on
  # mandark, and forty seconds later he was mid-turn again -- the samples landed
  # in the gap between two turns. Say what was measured, not what it suggests.
  echo "NEM FUTOTT FORDULO a meres $N mintaja alatt (${GAP}s koznel)."
  echo "  Ez lehet tetlenseg, de lehet KET FORDULO KOZTI RES is -- a ketto innen azonos."
  echo "  Amivel eldontheto: a legutobbi uzenete mikori volt, es var-e pending a soraban"
  echo "  (egy pending uzenet a kovetkezo resbe MAGATOL bemegy, tehat nem kell inditani)."
  exit 1
fi

# Compare the token counts, not the elapsed clock: the clock rises even when the
# turn is wedged, so it can only ever say "still stuck" and never "moving".
VERDICT="$(FIRST="$FIRST" LAST="$LAST" python3 - <<'PY'
import os, re
def toks(s):
    m = re.search(r'([\d.]+)k?\s+tokens', s or '')
    if not m: return None
    v = float(m.group(1))
    return v * 1000 if 'k tokens' in s else v
a, b = toks(os.environ["FIRST"]), toks(os.environ["LAST"])
if a is None or b is None: print("UNCLEAR\t?\t?")
elif b > a:                print(f"MOVING\t{a:.0f}\t{b:.0f}")
else:                      print(f"FLAT\t{a:.0f}\t{b:.0f}")
PY
)"
STATE="$(printf '%s' "$VERDICT" | cut -f1)"
A="$(printf '%s' "$VERDICT" | cut -f2)"; B="$(printf '%s' "$VERDICT" | cut -f3)"

case "$STATE" in
  MOVING)
    echo "HALAD: $A -> $B token. Nem kell beavatkozni."
    exit 0 ;;
  FLAT)
    echo "NEM DONTHETO: a token-szam nem valtozott ($A). Ez NEM jelent elakadast --"
    echo "  egy hosszu tool-hivas alatt nem no. Nezd meg, mi az utolso hivas:"
    echo "    tmux capture-pane -p -t $SESSION -S -60 | tail -25"
    echo "  Ha ugyanaz a hivas all ott percek ota valtozatlanul, AKKOR gyanus."
    exit 1 ;;
  *)
    echo "NEM DONTHETO: a spinner-sorbol nem tudtam token-szamot olvasni."
    echo "  Ez a formatum valtozasat is jelentheti -- ellenorizd kezzel, ne feltetelezz elakadast."
    exit 1 ;;
esac
