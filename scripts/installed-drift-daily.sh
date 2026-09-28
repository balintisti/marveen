#!/bin/bash
# installed-drift-daily.sh -- the daily run of installed-drift-check.ts (card 4a5a4aae).
#
# WHY: nothing ran the meter. After the upstream merge it stood at "NEM MERHETO" (an unclassified
# installer) and nobody knew until someone ran it by hand (card db782525). A meter that only speaks
# when asked is a meter nobody asks.
#
# WHO HEARS WHAT (marveen's triage, 2026-09-28):
#   rc=0  nothing differs ................. the log only
#   rc=3  drift found ..................... the log only; the findings are a TRIAGE question and
#                                           the triage path reads the log, a daily letter would not
#   rc=1  NEM MERHETO ..................... the COORDINATOR, loudly: the meter is blind
#   any other rc (crash, no node/tsx) ...... the coordinator too: also blind, only less politely
# The letter goes through agent-msg.sh, the one route that checks the HTTP code AND the id. If even
# that fails, this script exits non-zero and says so in the log -- a failed alarm is not silent.
#
# INSTALL (a launchd unit, NOT live on merge): bash scripts/install-launchd-unit.sh com.marveen.installed-drift
#
# Test seams: INSTALLED_DRIFT_CMD replaces the check, INSTALLED_DRIFT_MSG the sender,
# INSTALLED_DRIFT_LOG the log path.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${INSTALLED_DRIFT_LOG:-$ROOT/store/installed-drift.log}"
NODE=/opt/homebrew/opt/node@22/bin/node
CMD="${INSTALLED_DRIFT_CMD:-$NODE $ROOT/node_modules/tsx/dist/cli.mjs $ROOT/scripts/installed-drift-check.ts}"
MSG_CMD="${INSTALLED_DRIFT_MSG:-bash $ROOT/scripts/agent-msg.sh marveen marveen -}"

OUT="$($CMD 2>&1)"
RC=$?
{
  printf '[%s] rc=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$RC"
  printf '%s\n' "$OUT"
} >> "$LOG"

case "$RC" in
  0|3) exit 0 ;;
esac

# The meter is blind. Name it with its own first line, and where the rest is.
FIRST="$(printf '%s\n' "$OUT" | grep -m1 -E 'NEM MERHETO|Error|error' || printf '%s\n' "$OUT" | head -1)"
TEXT="installed-drift napi futas: NEM MERHETO (rc=$RC). ${FIRST:-(ures kimenet)} -- teljes kimenet: $LOG. A mero ma VAK: amig ez all, egy telepitett-es-repo elteres senkinek nem jelez."
if SENT="$(printf '%s' "$TEXT" | $MSG_CMD 2>&1)" && printf '%s' "$SENT" | grep -q '^OK id='; then
  printf '[%s] jelezve: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$(printf '%s' "$SENT" | head -1)" >> "$LOG"
  exit 1
fi
printf '[%s] A JELZES IS ELBUKOTT: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$SENT" >> "$LOG"
exit 2
