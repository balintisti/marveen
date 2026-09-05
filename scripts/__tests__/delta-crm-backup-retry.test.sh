#!/bin/bash
# Card 900f88ec. Two things this proves, and both had NEVER been true before today:
#   1. a transient pg_dump failure is RETRIED instead of costing a whole day
#   2. the failure alert actually LEAVES the machine, and says so when it cannot
#
# The old alert posted with from="delta-crm-backup" and threw the response away.
# That endpoint answers 403 "unknown agent", so the alert had never fired once --
# and the discarded response made the delivery failure silent too. Case 3 pins it.
set -uo pipefail
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/delta-crm-backup.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok(){ printf '  ok   %s\n' "$1"; PASS=$((PASS+1)); }
no(){ printf '  FAIL %s\n' "$1"; FAIL=$((FAIL+1)); }

# --- 1. the retry loop exists, is bounded by PGDUMP_TRIES, and backs off ---
grep -q 'for ATTEMPT in $(seq 1 "$PGDUMP_TRIES")' "$SCRIPT" \
  && ok 'a pg_dump ciklus a PGDUMP_TRIES-ra kot' || no 'nincs PGDUMP_TRIES ciklus'
grep -q 'sleep "$BACKOFF"' "$SCRIPT" \
  && ok 'van novekvo varakozas a probalkozasok kozott' || no 'nincs backoff'
grep -q 'fail "pg_dump hiba $PGDUMP_TRIES probalkozas utan"' "$SCRIPT" \
  && ok 'a vegleges bukas MEGNEVEZI a probalkozasok szamat' || no 'a vegso fail nem nevezi meg'

# --- 2. NEGATIVE CONTROL: the old single-shot form must be GONE ---
if grep -q 'if ! pg_dump "$DBURL"' "$SCRIPT"; then
  no 'a REGI egy-lovetu pg_dump meg ott van'
else
  ok 'KONTROLL: a regi egy-lovetu alak eltunt'
fi

# --- 3. the alert sender is a REGISTERED agent id ---
# This is the whole defect: "delta-crm-backup" is not one, and the endpoint 403s.
# anchor on the JSON FIELD, not the bare word: the word also appears in the comment
# that EXPLAINS the defect, and an earlier version of this test fired on its own
# documentation -- the exact shape the fleet keeps re-finding.
if grep -qF '\"from\":\"delta-crm-backup\"' "$SCRIPT"; then
  no 'meg mindig a NEM REGISZTRALT delta-crm-backup a kuldo'
else
  ok 'a kuldo mar nem a nem regisztralt delta-crm-backup'
fi
grep -q 'from\\":\\"marveen' "$SCRIPT" \
  && ok 'a kuldo a regisztralt marveen' || no 'nem marveen a kuldo'

# --- 4. neither channel discards its own result ---
if grep -q "api/messages" "$SCRIPT" && grep -A6 "api/messages" "$SCRIPT" | grep -q "w '%{http_code}'"; then
  ok 'a flotta-sor kuldese VISSZAOLVASSA a HTTP kodot'
else
  no 'a flotta-sor kuldese nem nezi a HTTP kodot'
fi
grep -q 'RIASZTAS: Telegram BUKOTT' "$SCRIPT" \
  && ok 'a Telegram-ag BUKAST is naploz, nem csak sikert' || no 'a Telegram-ag nem naploz bukast'

# --- 5. END TO END: a failing dump must retry N times and then alert ---
# No production contact: a deliberately unresolvable host. Both alert channels are
# neutralised (stub notify, unreadable token path) so the test sends nothing anywhere.
ENVF="$TMP/.env"; echo 'DATABASE_URL=postgresql://u:p@nincs-ilyen-host-xyz.invalid:5432/db' > "$ENVF"
STUB="$TMP/notify.sh"; printf '#!/bin/bash\necho "STUB NOTIFY: $*" >> "%s/notified.txt"\nexit 0\n' "$TMP" > "$STUB"; chmod +x "$STUB"
sed -e "s|^ENV_FILE=.*|ENV_FILE=\"$ENVF\"|" \
    -e "s|^BACKUP_DIR=.*|BACKUP_DIR=\"$TMP/backups\"|" \
    -e "s|^NOTIFY_SCRIPT=.*|NOTIFY_SCRIPT=\"$STUB\"|" \
    -e "s|^DASHBOARD_TOKEN_FILE=.*|DASHBOARD_TOKEN_FILE=\"$TMP/nincs-ilyen-token\"|" \
    "$SCRIPT" > "$TMP/under-test.sh"
mkdir -p "$TMP/backups"
# no `timeout` on stock macOS (rc=127 looks exactly like a failing dump, which is
# how this test lied to itself once already). Use it only when it exists.
TO=""; command -v gtimeout >/dev/null 2>&1 && TO="gtimeout 180"
command -v timeout  >/dev/null 2>&1 && TO="timeout 180"
PGDUMP_TRIES=2 $TO bash "$TMP/under-test.sh" >/dev/null 2>&1
RC=$?
LOG="$TMP/backups/backup.log"
[ "$RC" -ne 0 ] && ok "a szkript NEM NULLAVAL lep ki bukott dumpnal (rc=$RC)" || no "rc=0 egy bukott dumpnal"
if [ -f "$LOG" ] && grep -q 'ujraprobalas' "$LOG"; then ok 'a naplo mutatja az ujraprobalast'; else no 'nincs ujraprobalas a naploban'; fi
if [ -f "$LOG" ] && grep -q 'probalkozas utan' "$LOG"; then ok 'a vegso FAIL a probalkozasok utan all'; else no 'nincs vegso FAIL sor'; fi
if [ -f "$TMP/notified.txt" ]; then ok 'A RIASZTAS TENYLEGESEN ELMENT (a stub megkapta)'; else no 'a riasztas NEM ment el'; fi
# and the failure MUST be reported to the alert channel, not just logged
if [ -f "$TMP/notified.txt" ] && grep -q 'MENTES HIBA' "$TMP/notified.txt"; then
  ok 'a riasztas szovege azonosithato ([MENTES HIBA])'
else
  no 'a riasztas szovege nem azonosithato'
fi

echo
echo "  $PASS ok, $FAIL bukott"
[ "$FAIL" -eq 0 ]
