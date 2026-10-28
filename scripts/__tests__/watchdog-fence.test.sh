#!/bin/bash
# Contract tests for the per-agent channel state fence in scripts/watchdog.sh
# (card dcdcab66; origin SLACKDMVESZT1006).
#
# The dashboard launch (src/web/channel-state-fence.ts) strips every
# <PROVIDER>_STATE_DIR and points the providers an agent does NOT use at the
# agent's own dir, so a stray channel plugin cannot fall back to the shared
# ~/.claude/channels/<provider> where the MAIN agent's token lives. The watchdog
# respawn path stripped the bot tokens but not the state dirs and had no fence:
# the first auto-recovery of an agent would have reopened that hole. The script
# is dormant on this host today (no cron, no LaunchAgent), the defect is not.
#
# Driven through `watchdog.sh --print-launch-cmd <dir>`, which prints the real
# launch command string and exits before touching tmux, the API or the log.
# Run: bash scripts/__tests__/watchdog-fence.test.sh

set -u

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1 -- got: $2"; }

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# Overridable so the suite can be pointed at a deliberately-broken copy.
WATCHDOG="${WATCHDOG_BIN:-$REPO_DIR/scripts/watchdog.sh}"
PLUGIN_IDS="${PLUGIN_IDS_FILE:-$REPO_DIR/src/web/plugin-ids.ts}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FIXTURE_INSTALL="$TMP/install"
mkdir -p "$FIXTURE_INSTALL/scripts" "$FIXTURE_INSTALL/store" "$FIXTURE_INSTALL/agents"
cp "$WATCHDOG" "$FIXTURE_INSTALL/scripts/watchdog.sh"
# The identity helper the launch sources (card db775775); without it the no-op fallback
# would print nothing and the identity check below could not fail.
mkdir -p "$FIXTURE_INSTALL/scripts/lib"
cp "$REPO_DIR/scripts/lib/git-identity.sh" "$FIXTURE_INSTALL/scripts/lib/git-identity.sh"
WD="$FIXTURE_INSTALL/scripts/watchdog.sh"

# The provider list of the source of truth: the keys of CHANNEL_PLUGIN_IDS.
TS_PROVIDERS="$(sed -n '/CHANNEL_PLUGIN_IDS *= *{/,/^} as const/p' "$PLUGIN_IDS" | sed -n "s/^ *\([a-z][a-z]*\): *'.*/\1/p" | sort | tr '\n' ' ')"
# The list the watchdog fences over, read from the script itself.
BASH_PROVIDERS="$(sed -n 's/^CHANNEL_PROVIDERS="\(.*\)"$/\1/p' "$WD" | tr ' ' '\n' | sort | tr '\n' ' ')"

echo "watchdog channel state fence contract:"

# CONTROL: the parse found something. Without this, two empty strings would be "equal".
if [ -n "$TS_PROVIDERS" ] && [ "$(echo $TS_PROVIDERS | wc -w | tr -d ' ')" -ge 2 ]; then
  pass "CONTROL: parsed providers from plugin-ids.ts ($TS_PROVIDERS)"
else
  fail "CONTROL: parsed providers from plugin-ids.ts" "'$TS_PROVIDERS'"
fi

# PARITY: a new provider added to plugin-ids.ts must be added to the bash list too.
if [ "$TS_PROVIDERS" = "$BASH_PROVIDERS" ]; then
  pass "PARITY: bash CHANNEL_PROVIDERS == keys of CHANNEL_PLUGIN_IDS"
else
  fail "PARITY: bash CHANNEL_PROVIDERS == keys of CHANNEL_PLUGIN_IDS" "bash='$BASH_PROVIDERS' ts='$TS_PROVIDERS'"
fi

count_occurrences() { printf '%s' "$1" | grep -o -- "$2" | wc -l | tr -d ' '; }
upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

for OWN in $TS_PROVIDERS; do
  AGENT="$FIXTURE_INSTALL/agents/agent-$OWN"
  mkdir -p "$AGENT"
  printf '{"channelProvider":"%s"}\n' "$OWN" > "$AGENT/agent-config.json"
  CMD="$(bash "$WD" --print-launch-cmd "$AGENT")"

  # The launch is on its own provider (resolve_agent_provider did not fall back).
  case "$CMD" in
    *"--channels plugin:${OWN}@"*) pass "$OWN: launches its own provider" ;;
    *) fail "$OWN: launches its own provider" "$CMD" ;;
  esac

  # The respawned agent commits under its own name (card db775775), kept through the move
  # of the launch string into build_agent_launch_cmd.
  case "$CMD" in
    *"export GIT_AUTHOR_NAME='agent-$OWN' GIT_AUTHOR_EMAIL='agent-$OWN@agents.local'"*) pass "$OWN: carries the agent's git identity" ;;
    *) fail "$OWN: carries the agent's git identity" "$CMD" ;;
  esac

  # The unset covers every provider's state dir.
  UNSET_PART="${CMD#*unset }"; UNSET_PART="${UNSET_PART%% &&*}"
  MISSING=""
  for P in $TS_PROVIDERS; do
    case " $UNSET_PART " in *" $(upper "$P")_STATE_DIR "*) ;; *) MISSING="$MISSING $(upper "$P")_STATE_DIR" ;; esac
  done
  if [ -z "$MISSING" ]; then pass "$OWN: unset covers all state dirs"; else fail "$OWN: unset covers all state dirs" "missing:$MISSING"; fi

  for P in $TS_PROVIDERS; do
    VAR="$(upper "$P")_STATE_DIR"
    N="$(count_occurrences "$CMD" "export $VAR=")"
    if [ "$P" = "$OWN" ]; then
      # Own provider: exactly ONE export (the real one), not a fence duplicate.
      if [ "$N" = "1" ]; then pass "$OWN: own $VAR exported once, no fence"; else fail "$OWN: own $VAR exported once" "count=$N"; fi
    else
      case "$CMD" in
        *"export $VAR=\"$AGENT/.claude/channels/$P\""*) pass "$OWN: fence exports $VAR to the agent's own dir" ;;
        *) fail "$OWN: fence exports $VAR to the agent's own dir" "$CMD" ;;
      esac
    fi
  done

  # ORDER: unset first, then the fence, then the own export (a later export wins over the
  # unset only if it comes after it; the own export must follow the fence).
  OWN_VAR="$(upper "$OWN")_STATE_DIR"
  POS_UNSET="$(printf '%s' "$CMD" | grep -bo 'unset ' | head -1 | cut -d: -f1)"
  POS_OWN="$(printf '%s' "$CMD" | grep -bo "export $OWN_VAR=" | head -1 | cut -d: -f1)"
  LAST_FENCE=-1
  for P in $TS_PROVIDERS; do
    [ "$P" = "$OWN" ] && continue
    PP="$(printf '%s' "$CMD" | grep -bo "export $(upper "$P")_STATE_DIR=" | head -1 | cut -d: -f1)"
    [ -n "$PP" ] && [ "$PP" -gt "$LAST_FENCE" ] && LAST_FENCE="$PP"
  done
  if [ -n "$POS_UNSET" ] && [ -n "$POS_OWN" ] && [ "$POS_UNSET" -lt "$LAST_FENCE" ] && [ "$LAST_FENCE" -lt "$POS_OWN" ]; then
    pass "$OWN: order is unset < fence < own export"
  else
    fail "$OWN: order is unset < fence < own export" "unset=$POS_UNSET lastfence=$LAST_FENCE own=$POS_OWN"
  fi
done

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
