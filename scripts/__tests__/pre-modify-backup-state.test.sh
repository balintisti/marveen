#!/bin/bash
# Card 965f3ee6: a named file that is not there must not pass in silence.
#
# `[ -f ] && cp` skipped a named file and the run still reported success, so an
# incomplete backup could not be told from a complete one. That mattered more
# from 2026-09-11, when the backup gate made this script run before every merge.
#
# The fix is NOT to copy the missing files -- some absences are correct. On this
# install the vault master key is not a file at all. So the backup STATES what it
# did not save, and an intended absence is DECLARED (store/backup-exclude.txt)
# rather than inferred. These tests hold that line: an undeclared absence is
# loud, a declared one is quiet and named, and both are written down.
#
# Run: bash scripts/__tests__/pre-modify-backup-state.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   -- $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL -- $1"; }
eq()  { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$3], got [$2])"; fi; }

command -v sqlite3 >/dev/null 2>&1 || { echo "SKIP: sqlite3 not installed"; exit 0; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

setup() {   # $1 = scratch repo path
  mkdir -p "$1/scripts" "$1/store"
  cp "$ROOT/scripts/pre-modify-backup.sh" "$1/scripts/"
  sqlite3 "$1/store/claudeclaw.db" "create table t(a);"
  git -C "$1" init -q; git -C "$1" config user.email t@t; git -C "$1" config user.name t
  printf 'store/\n' > "$1/.gitignore"
  git -C "$1" add -A >/dev/null 2>&1; git -C "$1" commit -qm init >/dev/null 2>&1
}
state_of() { cat "$1"/store/backups/*/STATE.txt 2>/dev/null; }

# ---- 1. an UNDECLARED absence is LOUD and named ----------------------------
R1="$TMP/r1"; setup "$R1"
printf 'x' > "$R1/store/autonomy-config.json"          # one present, the rest absent
OUT1="$(cd "$R1" && bash scripts/pre-modify-backup.sh probe 2>&1)"
eq "undeclared absence warns" "$(printf '%s' "$OUT1" | grep -c 'WARNING these named files were NOT saved')" "1"
eq "...and names the missing file" "$(printf '%s' "$OUT1" | grep -c 'vault.json')" "1"
eq "the STATE file records it as NOT SAVED" "$(state_of "$R1" | grep -c '^NOT SAVED  vault.json')" "1"
eq "the present file is recorded as SAVED" "$(state_of "$R1" | grep -c '^SAVED      autonomy-config.json')" "1"
eq "the script still exits 0 (it is a backup, not a gate)" \
   "$(cd "$R1" && bash scripts/pre-modify-backup.sh probe2 >/dev/null 2>&1; echo $?)" "0"

# ---- 2. a DECLARED exclusion is quiet, named, and written down -------------
#         The point of the whole card: a NO on card 989e1171 must read as
#         intent, not as an accident.
R2="$TMP/r2"; setup "$R2"
printf 'x' > "$R2/store/autonomy-config.json"
cat > "$R2/store/backup-exclude.txt" <<'EX'
# name  reason
.vault-key  not a file on this install: master key lives in the macOS Keychain
EX
OUT2="$(cd "$R2" && bash scripts/pre-modify-backup.sh probe 2>&1)"
eq "declared exclusion is counted as excluded" \
   "$(printf '%s' "$OUT2" | grep -c '1 deliberately excluded')" "1"
eq "STATE says EXCLUDED, with the reason" \
   "$(state_of "$R2" | grep -c '^EXCLUDED   .vault-key  -- not a file on this install')" "1"
eq "an excluded file is NOT in the loud warning" \
   "$(printf '%s' "$OUT2" | grep 'WARNING' | grep -c '\.vault-key')" "0"
# ...but the OTHER undeclared absences must still be loud, or one exclusion
# would silence the whole check.
eq "other undeclared absences stay loud" \
   "$(printf '%s' "$OUT2" | grep -c 'WARNING these named files were NOT saved')" "1"

# ---- 3. a COMPLETE set is quiet -- the negative control --------------------
#         Without this, case 1 could pass because the tool always warns.
R3="$TMP/r3"; setup "$R3"
for f in vault.json .vault-key .dashboard-token openrouter-models.json \
         agents-desired.json autonomy-config.json auto-restart.json \
         command-task-health.json schedule-last-run.json; do printf 'x' > "$R3/store/$f"; done
OUT3="$(cd "$R3" && bash scripts/pre-modify-backup.sh probe 2>&1)"
eq "complete set: no warning at all" "$(printf '%s' "$OUT3" | grep -c 'WARNING')" "0"
eq "complete set: 9 saved" "$(printf '%s' "$OUT3" | grep -c '9 saved, 0 deliberately excluded, 0 NOT saved')" "1"
eq "complete set: STATE has 9 SAVED lines" "$(state_of "$R3" | grep -c '^SAVED')" "9"

# ---- 4. the DB snapshot still works (this script's actual job) -------------
eq "claudeclaw.db is still snapshotted" \
   "$(ls "$R3"/store/backups/*/claudeclaw.db >/dev/null 2>&1 && echo yes || echo no)" "yes"

echo
echo "pre-modify-backup-state: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
