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
DAILY_KEEP=14          # keep this many recent dumps regardless of age
export PATH="$PG_BIN:$PATH"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG_FILE"; }

fail() {
  log "FAIL: $*"
  # Tell Marveen so the failure is not silent. Best effort only.
  if [ -r "$DASHBOARD_TOKEN_FILE" ]; then
    curl -s -m 10 -X POST http://localhost:3420/api/messages \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $(cat "$DASHBOARD_TOKEN_FILE")" \
      -d "{\"from\":\"delta-crm-backup\",\"to\":\"marveen\",\"content\":\"[MENTES HIBA] A Delta-CRM napi adatbazis-mentes elszallt: $1 -- nezd meg a $LOG_FILE vegét es szolj Istinek.\"}" >/dev/null 2>&1
  fi
  exit 1
}

[ -r "$ENV_FILE" ] || fail "nincs meg a .env: $ENV_FILE"
command -v pg_dump >/dev/null 2>&1 || fail "pg_dump nem talalhato ($PG_BIN)"

# postgresql://... with Prisma-only query params stripped (psql/pg_dump reject them)
DBURL=$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | sed 's/^DATABASE_URL=//; s/^"//; s/"$//' | sed 's/?.*$//')
[ -n "$DBURL" ] || fail "DATABASE_URL nem olvashato ki a .env-bol"

STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/delta-crm-$STAMP-public.dump"

log "START -> $(basename "$OUT")"
if ! pg_dump "$DBURL" --format=custom --compress=9 --no-owner --no-privileges \
      --schema=public --file="$OUT" 2>>"$LOG_FILE"; then
  rm -f "$OUT"
  fail "pg_dump hiba"
fi
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
    if [ -r "$DASHBOARD_TOKEN_FILE" ]; then
      curl -s -m 10 -X POST http://localhost:3420/api/messages \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $(cat "$DASHBOARD_TOKEN_FILE")" \
        -d "{\"from\":\"delta-crm-backup\",\"to\":\"marveen\",\"content\":\"[MENTES FIGYELMEZTETES] A helyi mentes rendben, de az R2 feltoltes elszallt. Csak a Macen van masolat. Nezd meg a $LOG_FILE veget.\"}" >/dev/null 2>&1
    fi
  fi
else
  log "R2 kihagyva: nincs kulcs ($R2_KEY_FILE)"
fi

log "DONE ($LOCAL_COUNT mentes van a mappaban)"
