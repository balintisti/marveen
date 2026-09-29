#!/bin/bash
# alert-coordinator.sh -- an ALARM that cannot be muted by the load it is warning about (card 906e9159).
#
# usage: printf '%s' "<text>" | bash scripts/alert-coordinator.sh [FROM]
#
# WHY: agent-msg.sh refuses a message when the recipient already has >= 3 pending (its saturation
# gate, "NEM KULDTEM", exit 2). For a chat that is right; for an alarm it is exactly wrong: the
# coordinator is saturated when things go wrong, so an alarm sent without --force and without a
# fallback goes silent at the one moment it matters. didi measured it (2026-09-29 04:2x): a fake
# sender answering exit 2 for 2 hours -> 0 alarms delivered; fleet-page-guard and
# installed-drift-daily were live in that shape.
#
# WHAT: the coordinator first, with --force (an alarm is not a chat); if that does not come back
# "OK id=", the owner through notify.sh (Telegram) -- the route rule of card 45101873, the same
# one backup-offsite.py and disk-space-guard.sh already follow.
# Prints where it went: "OK coordinator <agent-msg line>" / "OK owner (notify.sh)" /
# "NOWHERE: <why>". Exit 0 when delivered somewhere, 1 when nowhere -- a caller that exits on it
# makes a lost alarm loud in its own log and exit code.
#
# Test seams: ALERT_AGENT_MSG (the coordinator sender command), ALERT_NOTIFY (the owner sender).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The coordinator's id, resolved the way backup.sh and disk-space-guard.sh do (.env MAIN_AGENT_ID,
# default "marveen").
MAIN_AGENT_ID="marveen"
if [ -f "$ROOT/.env" ]; then
  _mid="$(grep -E '^[[:space:]]*MAIN_AGENT_ID[[:space:]]*=' "$ROOT/.env" | tail -1 | sed -E 's/^[^=]*=[[:space:]]*//; s/^["'"'"']//; s/["'"'"'][[:space:]]*$//')"
  [ -n "$_mid" ] && MAIN_AGENT_ID="$_mid"
fi
FROM="${1:-$MAIN_AGENT_ID}"
TEXT="$(cat)"
[ -n "$TEXT" ] || { echo "NOWHERE: empty alarm text"; exit 1; }

SEND="${ALERT_AGENT_MSG:-bash '$ROOT/scripts/agent-msg.sh' $FROM $MAIN_AGENT_ID - --force}"
if OUT="$(printf '%s' "$TEXT" | bash -c "$SEND" 2>&1)" && printf '%s' "$OUT" | grep -q 'OK id='; then
  echo "OK coordinator $(printf '%s' "$OUT" | grep -m1 'OK id=')"
  exit 0
fi
NOTIFY="${ALERT_NOTIFY:-bash '$ROOT/scripts/notify.sh'}"
if bash -c "$NOTIFY \"\$1\"" notify "$TEXT" >/dev/null 2>&1; then
  echo "OK owner (notify.sh; the coordinator route answered: $(printf '%s' "$OUT" | head -1 | cut -c1-120))"
  exit 0
fi
echo "NOWHERE: coordinator ($(printf '%s' "$OUT" | head -1 | cut -c1-120)) and owner (notify.sh) both failed"
exit 1
