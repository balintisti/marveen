#!/bin/bash
# Contract tests for check (e) of scripts/verify-channels-health.sh (card dcdcab66):
# a provider token on the shared ~/.claude/channels/<provider> fallback, for a
# provider the MAIN session does not run, is reported as a failure.
#
# The script is run from a fixture install with a fixture HOME. The tmux session does
# not exist there, so the script is UNHEALTHY through (a)/(b) regardless; these tests
# therefore assert on the "(e)" line, not on the exit code. The (e) line only ever
# names the PATH of a file, so the fixture .env content is a dummy and is never printed.
# Run: bash scripts/__tests__/verify-channels-fallback.test.sh

set -u

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1 -- got: $2"; }

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
VERIFY="${VERIFY_BIN:-$REPO_DIR/scripts/verify-channels-health.sh}"
PLUGIN_IDS="${PLUGIN_IDS_FILE:-$REPO_DIR/src/web/plugin-ids.ts}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

INSTALL="$TMP/install"
FAKE_HOME="$TMP/home"
mkdir -p "$INSTALL/scripts" "$FAKE_HOME"
cp "$VERIFY" "$INSTALL/scripts/verify-channels-health.sh"

# The provider list the script checks must equal the keys of CHANNEL_PLUGIN_IDS.
TS_PROVIDERS="$(sed -n '/CHANNEL_PLUGIN_IDS *= *{/,/^} as const/p' "$PLUGIN_IDS" | sed -n "s/^ *\([a-z][a-z]*\): *'.*/\1/p" | sort | tr '\n' ' ')"
SCRIPT_PROVIDERS="$(sed -n 's/^for _prov in \(.*\); do$/\1/p' "$INSTALL/scripts/verify-channels-health.sh" | tr ' ' '\n' | sort | tr '\n' ' ')"

echo "verify-channels-health check (e), shared-fallback token:"

if [ -n "$TS_PROVIDERS" ] && [ "$TS_PROVIDERS" = "$SCRIPT_PROVIDERS" ]; then
  pass "PARITY: script provider list == keys of CHANNEL_PLUGIN_IDS ($TS_PROVIDERS)"
else
  fail "PARITY: script provider list == keys of CHANNEL_PLUGIN_IDS" "script='$SCRIPT_PROVIDERS' ts='$TS_PROVIDERS'"
fi

run_e() {
  # $1 = install .env content. Prints the "(e)" line.
  printf '%s\n' "MAIN_AGENT_ID=fixturenomain" "$1" > "$INSTALL/.env"
  HOME="$FAKE_HOME" bash "$INSTALL/scripts/verify-channels-health.sh" 2>&1 | grep -F '(e)' || echo "NO (e) LINE"
}
put_env()  { mkdir -p "$FAKE_HOME/.claude/channels/$1"; echo "DUMMY_TOKEN=not-a-secret" > "$FAKE_HOME/.claude/channels/$1/.env"; }
clear_env() { rm -rf "$FAKE_HOME/.claude"; }

# CONTROL: a clean fallback is OK (so the FAIL cases below are not a constant).
clear_env
OUT="$(run_e 'CHANNEL_PROVIDER=telegram')"
case "$OUT" in *"(e) OK"*) pass "CONTROL: empty fallback -> OK" ;; *) fail "CONTROL: empty fallback -> OK" "$OUT" ;; esac

# Each provider that is not the main one is flagged, by path.
for P in $TS_PROVIDERS; do
  [ "$P" = "telegram" ] && continue
  clear_env; put_env "$P"
  OUT="$(run_e 'CHANNEL_PROVIDER=telegram')"
  case "$OUT" in
    *"(e) FAIL"*".claude/channels/$P/.env"*) pass "$P token on the fallback -> FAIL naming the path" ;;
    *) fail "$P token on the fallback -> FAIL naming the path" "$OUT" ;;
  esac
done

# The main provider's own fallback is legitimate on an unmigrated install: not flagged.
clear_env; put_env telegram
OUT="$(run_e 'CHANNEL_PROVIDER=telegram')"
case "$OUT" in *"(e) OK"*) pass "main provider (telegram) on the fallback -> OK (unmigrated install)" ;; *) fail "main provider on the fallback -> OK" "$OUT" ;; esac

# A main on another provider moves the exemption with it, and telegram becomes a stray.
clear_env; put_env slack
OUT="$(run_e 'CHANNEL_PROVIDER=slack')"
case "$OUT" in *"(e) OK"*) pass "CHANNEL_PROVIDER=slack: slack on the fallback -> OK" ;; *) fail "CHANNEL_PROVIDER=slack: slack on the fallback -> OK" "$OUT" ;; esac
clear_env; put_env telegram
OUT="$(run_e 'CHANNEL_PROVIDER=slack')"
case "$OUT" in *"(e) FAIL"*) pass "CHANNEL_PROVIDER=slack: telegram on the fallback -> FAIL" ;; *) fail "CHANNEL_PROVIDER=slack: telegram on the fallback -> FAIL" "$OUT" ;; esac

# A provider listed in CHANNEL_PLUGINS_EXTRA is a main provider too.
clear_env; put_env discord
OUT="$(run_e $'CHANNEL_PROVIDER=telegram\nCHANNEL_PLUGINS_EXTRA=discord@claude-plugins-official')"
case "$OUT" in *"(e) OK"*) pass "extra provider (discord) on the fallback -> OK" ;; *) fail "extra provider on the fallback -> OK" "$OUT" ;; esac

# The token content is never printed.
clear_env; put_env slack
FULL="$(printf '%s\n' "MAIN_AGENT_ID=fixturenomain" > "$INSTALL/.env"; HOME="$FAKE_HOME" bash "$INSTALL/scripts/verify-channels-health.sh" 2>&1)"
case "$FULL" in *not-a-secret*) fail "token content not printed" "content leaked" ;; *) pass "token content not printed" ;; esac

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
