#!/usr/bin/env bash
# agent-msg.sh -- reliable inter-agent message send for the Marveen fleet.
#
# WHY: the common `curl -s ... >/dev/null && echo sent` pattern is DANGEROUS -- curl exits 0 even when
# the server REJECTED the request (401/400/5xx), producing a SILENT send failure: the recipient never
# gets the message and two agents can wait on each other forever. The /api/messages router itself is
# fine (HTTP 200 + a message id); the bug is that the SENDER never checks the result. This helper checks
# the HTTP status AND the returned message id, and RETRIES on failure. A message counts as sent only
# when an id came back.
#
# Usage:  bash scripts/agent-msg.sh <from> <to> "<content>"
#   content: plain text (quotes / newlines OK) -- the body is built with json.dumps (no quoting pitfalls).
#   large / multi-line content may come from STDIN when the 3rd arg is "-":
#     echo "<long text>" | bash scripts/agent-msg.sh <from> <to> -
# Output: success -> "OK id=<n> queue=<depth> (~<n> perc)"; failure -> "FAIL <reason>"
# When the recipient is not running -- or could not be asked -- the server also
# returns a line saying so, and it is printed on stderr (card bbb8557c). The
# depth alone cannot say it: "4 waiting" reads as a backlog whether or not
# anybody is there to drain it.
#         + a line in store/agent-msg-failures.log, exit 1.
# The queue fields come from the POST response (2026-08-20): a message is accepted
# instantly but only DELIVERED into an idle gap in the recipient's pane, which on a
# busy agent measured 80+ minutes. At 3+ waiting the script says so on stderr and
# tells the sender to use the card instead -- the number alone would arrive after
# the send, when it can only help next time.
# Env: MARVEEN_WEB_PORT (default 3420).
set -uo pipefail

# base dir = the parent of this script's dir (scripts/..), so it works from any CWD / any install
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${MARVEEN_WEB_PORT:-3420}"
TOKEN_FILE="$BASE/store/.dashboard-token"
URL="http://localhost:${PORT}/api/messages"
LOG="$BASE/store/agent-msg-failures.log"

FROM="${1:?from required}"; TO="${2:?to required}"; C="${3:?content required (or - for STDIN)}"
[ "$C" = "-" ] && C="$(cat)"
[ -r "$TOKEN_FILE" ] || { echo "FAIL: no token file at $TOKEN_FILE"; exit 1; }
TOKEN="$(cat "$TOKEN_FILE")"

BODY="$(FROM="$FROM" TO="$TO" C="$C" python3 -c 'import json,os; print(json.dumps({"from":os.environ["FROM"],"to":os.environ["TO"],"content":os.environ["C"]}))')"

attempt=0; max=3; CODE=""; ID=""
while [ "$attempt" -lt "$max" ]; do
  attempt=$((attempt+1))
  RESP="$(curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "$BODY" -w $'\n%{http_code}' 2>/dev/null || true)"
  CODE="$(printf '%s' "$RESP" | tail -n1)"
  JSON="$(printf '%s' "$RESP" | sed '$d')"
  # Two values out of one parse: the id (proof it was accepted) and the
  # recipient's queue state (how long "accepted" is from "arrived"). Tab
  # separated so an empty queue field cannot shift the id.
  PARSED="$(printf '%s' "$JSON" | python3 -c 'import sys,json
try:
  d = json.load(sys.stdin)
  if not isinstance(d, dict): raise ValueError
  q = d.get("queue") or {}
  depth = q.get("queueDepth", "")
  delay = q.get("estimatedDelaySec")
  # NULL delay means "no delivery history yet", which is NOT "instant" -- keep
  # the distinction visible instead of printing a misleading 0.
  mins = "" if delay is None else str(max(1, round(delay / 60)))
  # The advice text is composed server-side so the threshold and the wording
  # live in ONE place. Newlines become \x1f here and are restored on print:
  # a multi-line field would shift every column after it.
  advice = (q.get("advice") or "").replace("\n", "\x1f")
  print("\t".join([str(d.get("id", "")), str(depth), mins, advice]))
except Exception:
  print("\t\t\t")' 2>/dev/null)"
  ID="$(printf '%s' "$PARSED" | cut -f1)"
  DEPTH="$(printf '%s' "$PARSED" | cut -f2)"
  MINS="$(printf '%s' "$PARSED" | cut -f3)"
  ADVICE="$(printf '%s' "$PARSED" | cut -f4)"
  if { [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; } && [ -n "$ID" ]; then
    # The "OK id=<n>" prefix is a contract -- callers and CLAUDE.md grep for it.
    # Anything new goes after it.
    LINE="OK id=$ID"
    [ -n "$DEPTH" ] && LINE="$LINE queue=$DEPTH"
    [ -n "$MINS" ] && LINE="$LINE (~${MINS} perc)"
    echo "$LINE"
    # Printing the number is not enough: the sender has already sent by the
    # time they read it, and a rule they must REMEMBER for next time is not a
    # rule. So the server says what to do, at the moment the evidence is in
    # front of them -- and it says it only where it applies: a busy recipient
    # and an absent one need opposite advice (card bbb8557c).
    #
    # The threshold and the wording used to live here as well as on the server.
    # One rule written in two places drifts, and the copy nobody edits is the
    # one that ends up lying, so this side now only prints what it is given.
    if [ -n "$ADVICE" ]; then
      printf '%s\n' "$ADVICE" | tr '\037' '\n' >&2
    fi
    exit 0
  fi
  sleep 1
done
echo "FAIL from=$FROM to=$TO http=${CODE:-?} id='$ID' (after $max tries)"
printf '%s\tFAIL\tfrom=%s\tto=%s\thttp=%s\tresp=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$FROM" "$TO" "${CODE:-?}" "$(printf '%s' "${JSON:-}" | head -c 200)" >> "$LOG" 2>/dev/null || true
exit 1
