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
#
# THE EXPECTED PASSWORD IS THE DECODED ONE, AND THAT IS THE POINT -- card 87cfe5ae.
# Until then this line asserted `a%40b%40c`, i.e. it PINNED a defect: libpq
# percent-decodes the URI userinfo but reads PGPASSWORD literally, so handing
# over the raw substring authenticates with a different string than the URL
# meant. The test NAME was always right; the assertion was the wrong half.
# If a later change makes this go red, the change is wrong, not this line.
check "password containing an encoded at-sign" \
  "postgresql://appuser@db.example.test/mydb" "a@b@c" \
  "postgresql://appuser:a%40b%40c@db.example.test/mydb"

# %25 is the only way a literal `%` can appear in a URI, so it MUST come back
# as one -- otherwise a password containing `%` round-trips to something else.
check "encoded percent sign decodes to one percent sign" \
  "postgresql://appuser@db.example.test/mydb" "100%" \
  "postgresql://appuser:100%25@db.example.test/mydb"

# A `%` that is NOT valid encoding is left EXACTLY as it stands. Rewriting it
# would be a guess about what the author meant, and a guess about a password is
# an authentication failure.
check "stray percent sign is left alone" \
  "postgresql://appuser@db.example.test/mydb" "a%zzb" \
  "postgresql://appuser:a%zzb@db.example.test/mydb"

check "trailing percent sign is left alone" \
  "postgresql://appuser@db.example.test/mydb" "vege%" \
  "postgresql://appuser:vege%@db.example.test/mydb"

# MULTI-BYTE UTF-8, and this case exists because it was the one thing left as a
# DERIVATION rather than a measurement. didi proved the fix end-to-end against a
# real scram-sha-256 cluster and stated plainly that she had not tried a
# multi-byte password -- byte-wise concatenation is "correct by construction",
# which is an argument, not a result. It is measured here instead: the decoder
# emits one raw byte per %XX and bash strings are byte strings, so `%C3%A1`
# reassembles into a single character. Pinned so that the next rewrite of the
# decoder cannot quietly lose it.
check "multi-byte UTF-8 password decodes byte-wise" \
  "postgresql://appuser@db.example.test/mydb" "jélszó" \
  "postgresql://appuser:j%C3%A9lsz%C3%B3@db.example.test/mydb"

# BOTH MECHANISMS ON ONE PASSWORD -- and the comment that first stood here was
# WRONG, which the mutation probe caught before this landed.
#
# It claimed this case pinned the ORDER of split-then-decode. It does not:
# decoding before splitting still produces the right answer here, because the
# split is on the LAST `@` and a HOSTNAME cannot contain one. The mutation
# survived, so the claim was refuted rather than confirmed, and the case that
# genuinely pins the order is the one below it.
#
# What this case IS worth: the two mechanisms coexist on a single password -- an
# encoded separator and a multi-byte character -- and didi measured the same
# password authenticating against a real scram-sha-256 server (card 87cfe5ae,
# comment 5). That matters because "the decoder emits the right bytes" and "the
# server accepts them" are two claims: SCRAM runs the password through SASLprep.
check "an encoded at-sign AND a multi-byte character in one password" \
  "postgresql://appuser@db.example.test/mydb" "á@b" \
  "postgresql://appuser:%C3%A1%40b@db.example.test/mydb"

# AN UNENCODED `@` IN A QUERY PARAMETER -- didi found this on the SHIPPED code,
# and it is the same catastrophic shape as the reversed-order bug below, reached
# by a different input.
#
# `@` needs no escaping in a URI query (RFC 3986 `pchar`), so this DSN is not
# malformed and nothing warns about it. With the search running over the whole
# string, the last `@` lands in the query:
#
#     url  -> "postgresql://u@box"                              THE WRONG HOST
#     pass -> "titok@db.example.test:6543/postgres?applicat..."  THE WHOLE DSN
#
# Latent rather than active when it was found -- the live DSN has exactly one
# `@` and nothing after it -- so the trigger is a later, entirely legitimate
# config change, which is the same structure as the decode defect this card
# started from.
check "an UNENCODED at-sign in the query does not move the split" \
  "postgresql://u@db.example.test:6543/postgres?application_name=svc@box" "titok" \
  "postgresql://u:titok@db.example.test:6543/postgres?application_name=svc@box"

# THIS is the one that pins the ORDER, and it took a refuted guess to find it.
#
# The split must happen BEFORE the decoding. Reverse them -- "decode the userinfo
# first, then split it", which reads tidier -- and an encoded `@` ANYWHERE LATER
# IN THE URL becomes a real one, moving the last `@` out of its place. Measured
# with the reversed implementation on this exact URL:
#
#     pass -> "titok@db.example.test/mydb?application_name=svc"   (the whole DSN)
#     url  -> "postgresql://appuser@host"                          (the wrong host)
#
# So the failure is not a garbled password: it is a connection attempt to a
# DIFFERENT HOST with the connection string as the credential. A query parameter
# like `application_name=svc%40host` is ordinary, which is what makes it worth a
# case rather than a comment.
check "an encoded at-sign in the QUERY does not move the split" \
  "postgresql://appuser@db.example.test/mydb?application_name=svc%40host" "titok" \
  "postgresql://appuser:titok@db.example.test/mydb?application_name=svc%40host"

# THE ONE THAT RULES OUT THE OBVIOUS IMPLEMENTATION. The usual one-line decoder
# is `printf %b "${s//%/\\x}"`, which also interprets every other backslash
# escape -- so a password containing a literal backslash would be rewritten and
# the failure would look like a wrong password, not like a decoder bug.
check "a literal backslash survives decoding" \
  "postgresql://appuser@db.example.test/mydb" 'back\slash' \
  'postgresql://appuser:back\slash@db.example.test/mydb'

# A password may contain a colon; only the FIRST colon separates user from pass.
check "password containing a colon" \
  "postgresql://appuser@db.example.test/mydb" "a:b:c" \
  "postgresql://appuser:a:b:c@db.example.test/mydb"

# THE TWO CASES THE "LEFT ALONE" GROUP BELOW COULD NOT MAKE -- didi measured
# that both of its inputs PASS against the BROKEN lib, so they are structurally
# unable to tell fixed from broken on this axis. Today's behaviour was right and
# nothing would have said so if it regressed.
#
# WHAT THEY WERE MISSING IS A PORT, and that is the whole shape: without a `:`
# before the stray `@` there is nothing to read as `user:pass`, so the old code
# left those URLs alone by accident rather than by rule. Every real DSN we have
# carries a port -- the live pooler is on :6543 -- so the DANGEROUS shape is the
# ordinary one and the safe shape is the exotic one.
#
# The first case is the sharpest thing this defect did: with no userinfo at all,
# the broken version INVENTED a credential.
#   trunk -> url `postgresql://host.example.test@b`, PGPASSWORD `5432/db?x=a`
check "no userinfo, but a port and a stray at-sign -> no credential is invented" \
  "postgresql://host.example.test:5432/db?x=a@b" "-" \
  "postgresql://host.example.test:5432/db?x=a@b"

check "user without password, with a port and a stray at-sign -> unchanged" \
  "postgresql://appuser@host.example.test:5432/db?x=a@b" "-" \
  "postgresql://appuser@host.example.test:5432/db?x=a@b"

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

# EVERY OUTBOUND LEG IS STUBBED, and the first version of this case did not do
# that -- it sent THREE REAL backup-failure alerts to the owner's phone, and the
# first one wrote a FAIL line into the REAL backup log. The refusal branch is
# SUPPOSED to shout; a harness that exercises it therefore has to make the shout
# land somewhere harmless, or it is indistinguishable from a failed backup.
# The rewrite list is the same one the retry suite already uses -- I copied two
# of its four entries and not the two that reach outside.
printf '#!/bin/bash\necho "STUB NOTIFY: $*" >> "%s/notified.txt"\nexit 0\n' "$TMPD" > "$TMPD/notify.sh"
chmod +x "$TMPD/notify.sh"
break_lib "$SCRIPTS_DIR/delta-crm-backup.sh" \
  | sed -e "s|^ENV_FILE=.*|ENV_FILE=\"$TMPD/.env\"|" \
        -e "s|^BACKUP_DIR=.*|BACKUP_DIR=\"$TMPD/backups\"|" \
        -e "s|^NOTIFY_SCRIPT=.*|NOTIFY_SCRIPT=\"$TMPD/notify.sh\"|" \
        -e "s|^DASHBOARD_TOKEN_FILE=.*|DASHBOARD_TOKEN_FILE=\"$TMPD/no-such-token\"|" > "$TMPD/delta-crm-backup.sh"
mkdir -p "$TMPD/backups"
out="$(cd "$TMPD" && PATH="$TMPD:$PATH" bash ./delta-crm-backup.sh 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && { printf '%s' "$out" | grep -q 'pg-argv-safe' || grep -q 'pg-argv-safe' "$TMPD/backups/backup.log" 2>/dev/null; }; then
  pass=$((pass+1))
else
  fail=$((fail+1)); echo "FAIL: delta-crm-backup did not refuse (rc=$rc): $(printf '%s' "$out" | head -1)"
fi

# The alert must have gone to the STUB, not outward. Asserting the stub RECEIVED
# it is stronger than asserting nothing was sent: it proves the notify leg still
# runs end-to-end, which is the thing this case exists to exercise.
if [ -s "$TMPD/notified.txt" ]; then
  pass=$((pass+1))
else
  fail=$((fail+1)); echo "FAIL: the refusal did not reach the stubbed notifier -- the leg is not being exercised"
fi

echo "pg-argv-safe: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
