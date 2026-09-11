#!/usr/bin/env bash
# Cases for `pg_split_password`. Card 38bd8366.
#
# EVERY URL HERE IS INVENTED. The defect this guards is a real password reaching
# argv, so a test that used a real one would be the defect wearing a test's name.
set -uo pipefail
. "$(dirname "$0")/../lib/pg-argv-safe.sh"

pass=0; fail=0
check() { # $1 label  $2 expected-url  $3 expected-pass ('-' = must be UNSET)  $4 input
  unset PGPASSWORD; PG_URL_NOPASS=""
  pg_split_password "$4"
  local got_pass="${PGPASSWORD-<unset>}"
  local want_pass="$3"; [ "$want_pass" = "-" ] && want_pass="<unset>"
  if [ "$PG_URL_NOPASS" = "$2" ] && [ "$got_pass" = "$want_pass" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    echo "FAIL: $1"
    echo "  url  want=[$2] got=[$PG_URL_NOPASS]"
    echo "  pass want=[$want_pass] got=[$got_pass]"
  fi
}

check "plain user:pass" \
  "postgresql://appuser@db.example.test:5432/mydb" "s3cr3t-invented" \
  "postgresql://appuser:s3cr3t-invented@db.example.test:5432/mydb"

check "query params are preserved" \
  "postgresql://appuser@db.example.test:5432/mydb?sslmode=require&connect_timeout=15" "pw-invented" \
  "postgresql://appuser:pw-invented@db.example.test:5432/mydb?sslmode=require&connect_timeout=15"

# The reason the split is on the LAST `@`: an encoded one inside the secret.
check "password containing an encoded at-sign" \
  "postgresql://appuser@db.example.test/mydb" "a%40b%40c" \
  "postgresql://appuser:a%40b%40c@db.example.test/mydb"

# A password may contain a colon; only the FIRST colon separates user from pass.
check "password containing a colon" \
  "postgresql://appuser@db.example.test/mydb" "a:b:c" \
  "postgresql://appuser:a:b:c@db.example.test/mydb"

# --- the three shapes that must be left ALONE -------------------------------
check "user with NO password -> unchanged, PGPASSWORD unset" \
  "postgresql://appuser@db.example.test/mydb" "-" \
  "postgresql://appuser@db.example.test/mydb"

check "no userinfo at all -> unchanged" \
  "postgresql://db.example.test/mydb" "-" \
  "postgresql://db.example.test/mydb"

check "not a URL -> unchanged" \
  "mydb" "-" "mydb"

# --- the load-bearing property, stated as its own case ----------------------
unset PGPASSWORD; PG_URL_NOPASS=""
pg_split_password "postgresql://appuser:must-not-appear@db.example.test/mydb"
if printf '%s' "$PG_URL_NOPASS" | grep -q "must-not-appear"; then
  fail=$((fail+1)); echo "FAIL: the secret survived in the URL that goes to argv"
else
  pass=$((pass+1))
fi

# --- CONTROL: the checker can fail ------------------------------------------
before=$fail
check "CONTROL (expected to fail)" "wrong-on-purpose" "-" \
  "postgresql://u:p@h/d"
if [ "$fail" -eq $((before + 1)) ]; then
  fail=$before; pass=$((pass+1))
  echo "CONTROL ok: a wrong expectation is reported as a failure"
else
  echo "CONTROL BROKEN: a wrong expectation did NOT fail"; fail=$((fail+1))
fi

# --- FAIL-CLOSED: a caller whose helper is missing must REFUSE, not continue ---
#
# The property a well-meant "make it work anyway" would delete: without it a
# copied script silently falls back to putting the URL on argv, which IS the
# defect. Both callers are given the minimum input they need to REACH the check
# -- an earlier `exit 64` for a missing `--sql` would otherwise look like a pass
# for the wrong reason (measured: the first version of this case did exactly
# that, and reported success on a script that never got near the branch).
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
SCRIPTS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
printf 'SELECT 1;\n' > "$TMPD/probe.sql"
printf 'DATABASE_URL=postgresql://u:invented@nonexistent.invalid:5432/db\n' > "$TMPD/.env"
printf '#!/bin/bash\nexit 0\n' > "$TMPD/pg_dump"; chmod +x "$TMPD/pg_dump"

# Point BOTH resolution paths at nothing, so the refusal is the only outcome left.
break_lib() { sed -e 's|/Users/isti/marveen/scripts/lib/pg-argv-safe.sh|/nonexistent/pg-argv-safe.sh|g' "$1"; }

break_lib "$SCRIPTS_DIR/readonly-measure.sh" > "$TMPD/readonly-measure.sh"
out="$(cd "$TMPD" && bash ./readonly-measure.sh --sql "$TMPD/probe.sql" \
        --url 'postgresql://u:invented@nonexistent.invalid:5432/db' 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'pg-argv-safe'; then
  pass=$((pass+1))
else
  fail=$((fail+1)); echo "FAIL: readonly-measure did not refuse (rc=$rc): $(printf '%s' "$out" | head -1)"
fi

break_lib "$SCRIPTS_DIR/delta-crm-backup.sh" \
  | sed -e "s|^ENV_FILE=.*|ENV_FILE=\"$TMPD/.env\"|" \
        -e "s|^BACKUP_DIR=.*|BACKUP_DIR=\"$TMPD/backups\"|" > "$TMPD/delta-crm-backup.sh"
mkdir -p "$TMPD/backups"
out="$(cd "$TMPD" && PATH="$TMPD:$PATH" bash ./delta-crm-backup.sh 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && { printf '%s' "$out" | grep -q 'pg-argv-safe' || grep -q 'pg-argv-safe' "$TMPD/backups/backup.log" 2>/dev/null; }; then
  pass=$((pass+1))
else
  fail=$((fail+1)); echo "FAIL: delta-crm-backup did not refuse (rc=$rc): $(printf '%s' "$out" | head -1)"
fi

echo "pg-argv-safe: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
