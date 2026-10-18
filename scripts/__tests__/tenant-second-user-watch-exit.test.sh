#!/bin/bash
# tenant-second-user-watch.sh exit contract (card 8b1323ab): a MEASURED verdict exits 0
# (clear or breached, the verdict in the last stdout line), so the scheduler's health record
# (src/web/command-task.ts: only exit 0 is ok) shows whether the watch WORKS. Measured
# 2026-10-16: the old exit 2 for an alerted, unchanged breach wrote 157 consecutive `fail`s.
# Not measured / alert not delivered stays non-zero (3/5/6).
#
# The script runs from a temp copy whose scripts/readonly-measure.sh and agent-msg.sh are stubs:
# no database, no message leaves this test.
# Run: bash scripts/__tests__/tenant-second-user-watch-exit.test.sh

set -u
PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/root/scripts/sql" "$TMP/mroot/scripts"
cp "$REPO/scripts/tenant-second-user-watch.sh" "$TMP/root/scripts/"
: > "$TMP/root/scripts/sql/tenant-second-user.sql"

# Stub measurement: rc and the four counters come from files the cases write.
cat > "$TMP/root/scripts/readonly-measure.sh" <<EOF
#!/bin/bash
cat "$TMP/measure.out"
exit \$(cat "$TMP/measure.rc")
EOF
# Stub sender: counts calls, answers OK id= unless told to fail.
cat > "$TMP/mroot/scripts/agent-msg.sh" <<EOF
#!/bin/bash
cat >/dev/null
echo x >> "$TMP/sends"
if [ -f "$TMP/send.fail" ]; then echo "NEM KULDTEM"; exit 1; fi
echo "OK id=1"
EOF

run() { # second invites orgs users rc
  printf 'orgs_with_second_user | %s\ninvitations_ever | %s\norgs_total | %s\nusers_total | %s\n' "$1" "$2" "$3" "$4" > "$TMP/measure.out"
  echo "$5" > "$TMP/measure.rc"
  OUT="$(bash "$TMP/root/scripts/tenant-second-user-watch.sh" --state "$TMP/state" --marveen-root "$TMP/mroot" 2>&1)"
  RC=$?
}
sends() { [ -f "$TMP/sends" ] && wc -l < "$TMP/sends" | tr -d ' ' || echo 0; }

echo "tenant-second-user-watch exit contract (8b1323ab)"

run 0 0 12 30 0
[ "$RC" = 0 ] && [ "$(echo "$OUT" | tail -1)" = "VERDIKT: clear" ] && pass "clear: exit 0, VERDIKT: clear" || fail "clear: rc=$RC last='$(echo "$OUT" | tail -1)'"

run 1 1 12 30 0
[ "$RC" = 0 ] && [ "$(echo "$OUT" | tail -1)" = "VERDIKT: breached" ] && [ "$(sends)" = 1 ] && [ "$(cat "$TMP/state")" = breached ] \
  && pass "first breach: alert sent once, exit 0, VERDIKT: breached, state breached" \
  || fail "first breach: rc=$RC sends=$(sends) state=$(cat "$TMP/state") last='$(echo "$OUT" | tail -1)'"

run 1 1 12 30 0
[ "$RC" = 0 ] && [ "$(echo "$OUT" | tail -1)" = "VERDIKT: breached" ] && [ "$(sends)" = 1 ] \
  && pass "unchanged breach: no resend, exit 0 (was exit 2 = a scheduler fail every run)" \
  || fail "unchanged breach: rc=$RC sends=$(sends) last='$(echo "$OUT" | tail -1)'"

# didi 37133: with the exit code at 0 for a breach, the state file is the guard's ONLY loud path,
# so both of its transitions are pinned here, not just the first alert.
run 1 1 12 30 0
[ "$(sends)" = 1 ] && [ "$(cat "$TMP/state")" = breached ] \
  && pass "third breach in a row: still 1 alert (the unchanged branch restores 'breached')" \
  || fail "third breach: sends=$(sends) state=$(cat "$TMP/state")"

run 0 0 12 30 0
run 1 1 12 30 0
[ "$(sends)" = 2 ] && [ "$(cat "$TMP/state")" = breached ] \
  && pass "breached -> clear -> breached: the second breach alerts again (2 alerts)" \
  || fail "re-breach after clear: sends=$(sends) state=$(cat "$TMP/state")"

rm -f "$TMP/state"; touch "$TMP/send.fail"
run 1 1 12 30 0
[ "$RC" = 6 ] && pass "breach, alert NOT delivered: exit 6 (stays a failure)" || fail "undelivered: rc=$RC"
rm -f "$TMP/send.fail"

run 0 0 12 30 7
[ "$RC" = 3 ] && pass "measurement failed: exit 3, never clear" || fail "measure fail: rc=$RC"

run 0 0 0 0 0
[ "$RC" = 5 ] && pass "zero denominator: exit 5" || fail "zero denominator: rc=$RC"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
