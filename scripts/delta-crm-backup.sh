#!/bin/bash
# Delta-CRM daily database backup.
#
# Dumps the production Supabase Postgres (public schema) to a local, verified,
# compressed pg_dump custom-format archive. Credentials are read at runtime from
# the backend .env so nothing is duplicated here.
#
# Run by launchd: ~/Library/LaunchAgents/com.marveen.delta-crm-backup.plist
# Manual run:     bash /Users/isti/marveen/scripts/delta-crm-backup.sh

set -uo pipefail

ENV_FILE="/Users/isti/Projektek/sajat-crm/sajat-crm/backend/api/.env"
BACKUP_DIR="/Users/isti/Backups/delta-crm"
LOG_FILE="$BACKUP_DIR/backup.log"
PG_BIN="/opt/homebrew/opt/libpq/bin"
DASHBOARD_TOKEN_FILE="/Users/isti/marveen/store/.dashboard-token"
R2_KEY_FILE="/Users/isti/marveen/store/.r2-key"
R2_SCRIPT="/Users/isti/marveen/scripts/r2.py"
R2_BUCKET="delta-crm-backup"
NOTIFY_SCRIPT="/Users/isti/marveen/scripts/notify.sh"
PGDUMP_TRIES="${PGDUMP_TRIES:-3}"
DAILY_KEEP=14          # keep this many recent dumps regardless of age
export PATH="$PG_BIN:$PATH"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG_FILE"; }

# MEASURED 2026-09-05, card 900f88ec: the previous version of this function posted to
# /api/messages with from="delta-crm-backup" and threw the response away with
# `>/dev/null 2>&1`. That endpoint answers
#     HTTP 403 {"error":"unknown agent 'delta-crm-backup' -- from must be a registered fleet agent id"}
# so the alert had never once been delivered, and the discarded response meant the
# delivery failure was itself silent. Today's 03:30 DNS failure went unnoticed for
# thirteen hours and was found by accident during an unrelated check.
#
# Two channels now, in this order, and BOTH report whether they worked:
#   1. notify.sh -> Telegram, straight to Isti. It already fails loudly (HTTP 200 AND
#      ok:true required, otherwise exit 1 plus Telegram's own error text).
#   2. the fleet queue, with from="marveen" -- a REGISTERED id, which is the whole
#      reason the old one bounced. Verified by reading the HTTP code back.
notify_failure() {
  local reason="$1"
  local msg="[MENTES HIBA] A Delta-CRM napi adatbazis-mentes elszallt: $reason -- $LOG_FILE"

  if [ -x "$NOTIFY_SCRIPT" ]; then
    if bash "$NOTIFY_SCRIPT" "$msg" >>"$LOG_FILE" 2>&1; then
      log "RIASZTAS: Telegram OK"
    else
      log "RIASZTAS: Telegram BUKOTT (a notify.sh nem nullaval tert vissza)"
    fi
  else
    log "RIASZTAS: nincs notify.sh ($NOTIFY_SCRIPT)"
  fi

  if [ -r "$DASHBOARD_TOKEN_FILE" ]; then
    local code
    code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST http://localhost:3420/api/messages \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $(cat "$DASHBOARD_TOKEN_FILE")" \
      -d "{\"from\":\"marveen\",\"to\":\"marveen\",\"content\":\"$msg\"}" 2>/dev/null)
    if [ "$code" = "200" ] || [ "$code" = "201" ]; then
      log "RIASZTAS: flotta-sor OK"
    else
      log "RIASZTAS: flotta-sor BUKOTT (HTTP ${code:-nincs valasz})"
    fi
  fi
}

fail() {
  log "FAIL: $*"
  notify_failure "$*"
  exit 1
}

[ -r "$ENV_FILE" ] || fail "nincs meg a .env: $ENV_FILE"
command -v pg_dump >/dev/null 2>&1 || fail "pg_dump nem talalhato ($PG_BIN)"

# postgresql://..., keeping the query params pg_dump ACCEPTS and dropping only the
# Prisma-only ones.
#
# The old form was `sed 's/?.*$//'` -- it threw the WHOLE query away as "Prisma-only",
# and that was wrong for one of the three. Measured on pg_dump 18.4 (didi, card 900f88ec):
#     connection_limit  REJECTED  "invalid URI query parameter"
#     pool_timeout      REJECTED
#     connect_timeout   ACCEPTED AND HONOURED
# and the .env already sets connect_timeout=60, so we were discarding a bound we had.
#
# It matters because of the retry, not despite it: the loop bounds the NUMBER of
# attempts and nothing bounded the TIME, so three attempts against a blackhole host
# tripled the exposure. Measured against one: no connect_timeout -> still waiting at
# 40s; connect_timeout=5 -> clean "timeout expired" at 5s.
#
# 15s, not the .env's 60: this runs unattended once a day with two retries behind it.
DBURL_RAW=$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | sed 's/^DATABASE_URL=//; s/^"//; s/"$//')
DBURL_BASE=${DBURL_RAW%%\?*}
DBURL="${DBURL_BASE}?connect_timeout=${PGCONNECT_TIMEOUT:-15}"
[ -n "$DBURL" ] || fail "DATABASE_URL nem olvashato ki a .env-bol"

STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/delta-crm-$STAMP-public.dump"

log "START -> $(basename "$OUT")"
# RETRY, measured reason: 2026-09-05 03:30 this failed on a transient DNS lookup
# ("could not translate host name ... to address") and was decided in 30 seconds.
# The unit fires once a day, so one blink cost a whole day of backup. The dump
# itself is ~100s, so the retries are cheap next to the thing they protect.
DUMP_OK=0
for ATTEMPT in $(seq 1 "$PGDUMP_TRIES"); do
  if pg_dump "$DBURL" --format=custom --compress=9 --no-owner --no-privileges \
        --schema=public --file="$OUT" 2>>"$LOG_FILE"; then
    DUMP_OK=1
    [ "$ATTEMPT" -gt 1 ] && log "pg_dump OK a(z) $ATTEMPT. probalkozasra"
    break
  fi
  rm -f "$OUT"
  if [ "$ATTEMPT" -lt "$PGDUMP_TRIES" ]; then
    BACKOFF=$((ATTEMPT * 30))
    log "pg_dump hiba ($ATTEMPT/$PGDUMP_TRIES), ujraprobalas ${BACKOFF}s mulva"
    sleep "$BACKOFF"
  fi
done
[ "$DUMP_OK" = "1" ] || fail "pg_dump hiba $PGDUMP_TRIES probalkozas utan"
chmod 600 "$OUT"

# Verify: the archive must parse end to end and contain table data sections.
pg_restore --file=/dev/null "$OUT" 2>>"$LOG_FILE" || { rm -f "$OUT"; fail "a mentes serult (pg_restore parse)"; }
TABLES=$(pg_restore --list "$OUT" 2>/dev/null | grep -c 'TABLE DATA')
[ "$TABLES" -ge 50 ] || { rm -f "$OUT"; fail "gyanusan keves tabla a mentesben: $TABLES"; }

SIZE=$(du -h "$OUT" | cut -f1)
log "OK $(basename "$OUT") $SIZE $TABLES tabla"

# Retention: keep the newest $DAILY_KEEP dumps, plus the first dump of every month
# forever (monthly archives are ~8 MB each, cheap insurance against silent corruption
# that only gets noticed weeks later).
cd "$BACKUP_DIR" || exit 0
KEEP_FILE=$(mktemp)
ls -1t delta-crm-*.dump 2>/dev/null | head -n "$DAILY_KEEP" >>"$KEEP_FILE"
for MONTH in $(ls -1 delta-crm-*.dump 2>/dev/null | sed -E 's/delta-crm-([0-9]{6})[0-9]{2}-.*/\1/' | sort -u); do
  ls -1 delta-crm-"$MONTH"*.dump 2>/dev/null | sort | head -n 1 >>"$KEEP_FILE"
done
sort -u "$KEEP_FILE" -o "$KEEP_FILE"
for F in $(ls -1 delta-crm-*.dump 2>/dev/null); do
  grep -qxF "$F" "$KEEP_FILE" || { rm -f "$F" && log "PRUNE $F"; }
done
rm -f "$KEEP_FILE"

LOCAL_COUNT=$(ls -1 delta-crm-*.dump 2>/dev/null | wc -l | tr -d ' ')

# ---------------------------------------------------------------------------
# Offsite copy (Cloudflare R2). Everything above this line protects against a
# bad migration or a wrong delete; only this part survives the Mac itself being
# lost, stolen or dead. A failure here is logged and reported but must NOT fail
# the run: a local backup that exists is still worth more than no backup.
# ---------------------------------------------------------------------------
if [ -r "$R2_KEY_FILE" ]; then
  if python3 "$R2_SCRIPT" put "$R2_BUCKET" "$OUT" "$(basename "$OUT")" >>"$LOG_FILE" 2>&1; then
    log "R2 OK $(basename "$OUT")"

    # Mirror the local retention: the local directory IS the policy, so whatever
    # local pruning kept is what the bucket should hold.
    #
    # GUARD: never prune the bucket from a suspiciously thin local directory. If
    # the disk died or the dumps were wiped, an unguarded mirror would delete the
    # offsite copies too — turning the one surviving backup into no backup at the
    # exact moment it is needed.
    if [ "$LOCAL_COUNT" -ge 3 ]; then
      python3 "$R2_SCRIPT" list "$R2_BUCKET" 2>/dev/null | awk '{print $3}' | grep '\.dump$' | while read -r REMOTE; do
        [ -f "$BACKUP_DIR/$REMOTE" ] || {
          python3 "$R2_SCRIPT" delete "$R2_BUCKET" "$REMOTE" >/dev/null 2>&1 && log "R2 PRUNE $REMOTE"
        }
      done
    else
      log "R2 PRUNE kihagyva: csak $LOCAL_COUNT helyi mentes van, ez tul keves ahhoz hogy tukrozzek"
    fi
  else
    log "R2 HIBA: a feltoltes nem sikerult, a helyi mentes megvan"
    # SECOND instance of the same defect, and the REGRESSION TEST is what found it:
    # I fixed fail() first and this path still carried from="delta-crm-backup" with
    # its response discarded. One defect, two call sites -- the test asked the file,
    # not me, and my own grep had matched the explanatory comment instead.
    notify_failure "az R2 feltoltes elszallt, csak a Macen van masolat"
  fi
else
  log "R2 kihagyva: nincs kulcs ($R2_KEY_FILE)"
fi

log "DONE ($LOCAL_COUNT mentes van a mappaban)"
