#!/bin/bash
# Restore a Delta-CRM offsite backup from Cloudflare R2. Card 3acc137f.
#
#   delta-crm-restore-offsite.sh [--key-from-stdin] <SOURCE> <OUTDIR>
#
#   SOURCE   --latest              the newest encrypted object in the bucket
#            <name>.dump.gpg       a named object in the bucket
#            /path/to/x.dump.gpg   a file already on disk
#   OUTDIR   where the decrypted .dump lands (created 0700, file 0600)
#
#   --key-from-stdin  read the key from stdin instead of the Keychain: the
#                     DISASTER path, where this Mac is gone and the key is the
#                     paper copy. Case and separators do not matter, a word
#                     may be given by its first four letters, and a typo is
#                     caught by the checksum before gpg ever runs.
#
# It decrypts and VERIFIES the archive; it does NOT load it into a database.
# Loading is a separate decision with a target, so the command is printed, not run.
#
# ---------------------------------------------------------------------------
# WITHOUT THIS SCRIPT -- the case the whole offsite copy exists for: this
# machine is dead, and the new one has none of our code. Any machine with gpg:
#
#   1. download the newest  delta-crm-YYYYMMDD-HHMMSS-public.dump.gpg  from the
#      Cloudflare R2 bucket  delta-crm-backup
#   2. gpg --decrypt --output backup.dump delta-crm-...-public.dump.gpg
#      and at the prompt type the 15 words from paper: lowercase, in order,
#      separated by ONE space each, nothing before or after. The whole word --
#      gpg does not know the four-letter shorthand; this script does.
#   3. pg_restore --list backup.dump        (must list the tables)
#   4. pg_restore --no-owner --no-privileges --dbname <target url> backup.dump
#
#   On a FRESH target two errors are expected and harmless, and pg_restore
#   carries on past both (it ends "errors ignored on restore: N"):
#     schema "public" already exists     -- the dump creates it, the target has one
#     unrecognized ... "transaction_timeout"  -- only on a PostgreSQL 15/16 target
#   Any OTHER error is real. On a target that already holds data, stop: this
#   loads into it, it does not replace it.
#
#   MEASURED 2026-09-24 on a real restore (the 20260901 monthly, from R2, into a
#   throwaway PostgreSQL 15): 114/114 tables and every row landed (Contact 5402,
#   Project 7125, Activity 7454, Task 5249 -- equal to the dump's own COPY
#   rows). NINE SEARCH INDEXES DID NOT: the idx_*_trgm indexes on Company and
#   Contact use extensions.gin_trgm_ops and extensions.immutable_unaccent, and
#   this dump is --schema=public, so it carries neither. The DATA is complete;
#   fuzzy search is slow until they exist. On a new Supabase project the
#   `extensions` schema is there, but immutable_unaccent comes from a MIGRATION,
#   so run the migrations on the target first, or recreate those indexes after.
#
# A wrong key or a damaged file makes step 2 fail with an error and write no
# file; it never produces a plausible-looking wrong dump.
# ---------------------------------------------------------------------------

set -uo pipefail

R2_SCRIPT="/Users/isti/marveen/scripts/r2.py"
R2_BUCKET="delta-crm-backup"
PG_BIN="/opt/homebrew/opt/libpq/bin"
MIN_TABLES="${MIN_TABLES:-50}"

LIB="$(dirname "${BASH_SOURCE[0]}")/lib/backup-key.sh"
[ -f "$LIB" ] || LIB="/Users/isti/marveen/scripts/lib/backup-key.sh"
[ -f "$LIB" ] || { echo "hianyzik: scripts/lib/backup-key.sh" >&2; exit 1; }
# shellcheck source=/dev/null
. "$LIB"

die() { echo "VISSZAALLITAS SIKERTELEN: $*" >&2; exit 1; }

KEY_FROM_STDIN=0
if [ "${1:-}" = "--key-from-stdin" ]; then KEY_FROM_STDIN=1; shift; fi
[ $# -eq 2 ] || { sed -n '4,16p' "$0" >&2; exit 2; }
SRC="$1"; OUTDIR="$2"

umask 077
mkdir -p "$OUTDIR" || die "nem hozhato letre: $OUTDIR"

KEY=""
if [ "$KEY_FROM_STDIN" = "1" ]; then
  if [ -t 0 ]; then printf 'Offsite kulcs (nem jelenik meg): ' >&2; read -rs RAW; echo >&2
  else read -r RAW; fi
  backup_key_normalize KEY "$RAW" || die "a megadott kulcs nem 15 ep szo (lasd fent) -- elgepeles?"
  RAW=""
else
  backup_key_read KEY || die "az offsite kulcs nem olvashato a Keychainbol ($BACKUP_KEY_STATUS). Papir-masolattal: --key-from-stdin"
fi

if [ -f "$SRC" ]; then
  ENC="$SRC"
else
  NAME="$SRC"
  if [ "$SRC" = "--latest" ]; then
    NAME=$(python3 "$R2_SCRIPT" list "$R2_BUCKET" 2>/dev/null | awk '{print $3}' \
      | grep -E '^delta-crm-[0-9]{8}-[0-9]{6}-public\.dump\.gpg$' | sort | tail -n 1)
    [ -n "$NAME" ] || die "nincs titkositott mentes a bucketben ($R2_BUCKET)"
  fi
  case "$NAME" in *.dump.gpg) ;; *) die "nem titkositott mentes neve: $NAME" ;; esac
  ENC="$OUTDIR/$NAME"
  python3 "$R2_SCRIPT" get "$R2_BUCKET" "$NAME" "$ENC" >/dev/null 2>&1 || die "a letoltes nem sikerult: $NAME"
  [ -s "$ENC" ] || die "a letoltott fajl ures: $NAME"
fi

BASE=$(basename "$ENC"); BASE="${BASE%.gpg}"
OUT="$OUTDIR/$BASE"
rm -f "$OUT"
backup_decrypt KEY "$ENC" "$OUT" 2>/dev/null \
  || { rm -f "$OUT"; die "a visszafejtes nem sikerult: rossz kulcs VAGY serult fajl ($BASE.gpg)"; }
KEY=""
[ -s "$OUT" ] || die "a visszafejtett fajl ures"

TABLES=$("$PG_BIN/pg_restore" --list "$OUT" 2>/dev/null | grep -c 'TABLE DATA')
[ "$TABLES" -ge "$MIN_TABLES" ] || die "a mentes gyanusan keves tablat tartalmaz: $TABLES (min $MIN_TABLES)"

echo "OK: $OUT"
echo "    $TABLES tabla, $(du -h "$OUT" | cut -f1)"
echo "Betoltes (NEM futtattam, a celt te valasztod):"
echo "    $PG_BIN/pg_restore --no-owner --no-privileges --dbname <cel-url> \"$OUT\""
