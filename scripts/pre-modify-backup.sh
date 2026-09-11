#!/usr/bin/env bash
# Pre-modification backup.
#
# RULE: before ANY system modification (schema change,
# feature deploy, config edit that the live service reads), snapshot the
# critical mutable state first. Code is already safe in git; this captures the
# state git does NOT track: the SQLite DB, the vault, and runtime config.
#
# Rolling retention: keep the newest $KEEP snapshots, prune the rest.
# Usage: scripts/pre-modify-backup.sh [label]
#   label is an optional short tag for the snapshot dir (e.g. "openrouter-ui").
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
STORE="$REPO/store"
BKDIR="$STORE/backups"
KEEP=10
LABEL="${1:-manual}"
TS="$(date +%Y%m%d-%H%M%S)"
DEST="$BKDIR/${TS}-${LABEL}"

mkdir -p "$DEST"

# Consistent SQLite snapshot (NOT a raw cp -- the live dashboard may be mid-write).
if [ -f "$STORE/claudeclaw.db" ]; then
  sqlite3 "$STORE/claudeclaw.db" ".backup '$DEST/claudeclaw.db'" \
    && echo "  db: consistent snapshot ok" \
    || echo "  db: WARNING snapshot failed"
fi

# Small critical state git does not track. Explicit list -- store/ also holds
# ~1.7G of large/regenerable data we deliberately do NOT copy.
# A NAMED FILE THAT IS NOT THERE MUST NOT PASS IN SILENCE (card 965f3ee6).
# `[ -f ] && cp` skipped over a named file and the run still reported success,
# so the backup could not be told apart from a complete one. Measured
# 2026-09-11: two of the nine names were absent and nothing said so -- and the
# gate installed that morning made this script mandatory before every merge, so
# a silent hole now ships on every snapshot.
#
# THE FIX IS NOT TO COPY THEM. Some absences are correct: on this install the
# vault master key is NOT a file at all (it migrated to the macOS Keychain, and
# neither store/.vault-key nor .vault-key.migrated exists while vault.json still
# decrypts). A `cp` could never capture it. So the backup STATES what it did not
# save, and an intended absence is declared rather than inferred:
#   store/backup-exclude.txt -- one name per line, `name  reason`, # comments ok
# Whether the key belongs in a backup at all is a separate, open decision
# (card 989e1171). This output is correct either way: if the answer is NO the
# name is EXCLUDED with a reason, and if it is YES the name simply starts saving.
EXCLUDE_LIST="$STORE/backup-exclude.txt"
STATE="$DEST/STATE.txt"
: > "$STATE"
SAVED=0; ABSENT=0; EXCLUDED=0; ABSENT_NAMES=""
for f in vault.json .vault-key .dashboard-token \
         openrouter-models.json agents-desired.json autonomy-config.json \
         auto-restart.json command-task-health.json schedule-last-run.json; do
  reason=""
  if [ -f "$EXCLUDE_LIST" ]; then
    reason="$(grep -vE '^\s*(#|$)' "$EXCLUDE_LIST" | awk -v n="$f" '$1==n {$1=""; sub(/^ +/,""); print; exit}')"
  fi
  if [ -f "$STORE/$f" ]; then
    cp -p "$STORE/$f" "$DEST/" 2>/dev/null
    printf 'SAVED      %s\n' "$f" >> "$STATE"
    SAVED=$((SAVED + 1))
  elif [ -n "$reason" ]; then
    printf 'EXCLUDED   %s  -- %s\n' "$f" "$reason" >> "$STATE"
    EXCLUDED=$((EXCLUDED + 1))
  else
    printf 'NOT SAVED  %s  -- named, but not present in store/\n' "$f" >> "$STATE"
    ABSENT=$((ABSENT + 1))
    ABSENT_NAMES="$ABSENT_NAMES $f"
  fi
done
echo "  state files: $SAVED saved, $EXCLUDED deliberately excluded, $ABSENT NOT saved"
if [ "$ABSENT" -gt 0 ]; then
  echo "  WARNING these named files were NOT saved and are NOT declared excluded:$ABSENT_NAMES"
  echo "           (declare them in store/backup-exclude.txt, or this stays loud)"
fi

# Personal, untracked scripts -- the ones git will NOT bring back.
#
# These hold install-specific data (chat ids, absolute home paths, account-bound
# token refreshers), so they are deliberately never pushed upstream -- which
# means git can never restore them, and this folder is the ONLY copy. On
# 2026-07-26 a branch switch silently deleted pre-modify-backup.sh itself (it
# lived only on a feature branch); nothing errored, it was simply gone.
#
# WHICH files count as personal is per-install, so the list is data, not code:
# store/personal-scripts.txt, one repo-relative path per line (# comments and
# blank lines ignored). With no such file we fall back to every untracked,
# executable script git already knows nothing about -- which is exactly the set
# at risk. Either way the manifest makes the post-update check possible: compare
# the live tree against personal-scripts/MANIFEST.txt after any update or
# branch switch.
PERSONAL_DIR="$DEST/personal-scripts"
PERSONAL_LIST="$STORE/personal-scripts.txt"
mkdir -p "$PERSONAL_DIR"
: > "$PERSONAL_DIR/MANIFEST.txt"
PERSONAL_MISSING=0
PERSONAL_SAVED=0

if [ -f "$PERSONAL_LIST" ]; then
  PERSONAL_FILES="$(grep -vE '^\s*(#|$)' "$PERSONAL_LIST")"
else
  # Untracked files under scripts/ are by definition the ones git cannot restore.
  PERSONAL_FILES="$(git -C "$REPO" ls-files --others --exclude-standard -- scripts/ 2>/dev/null)"
fi

for rel in $PERSONAL_FILES; do
  if [ -f "$REPO/$rel" ]; then
    mkdir -p "$PERSONAL_DIR/$(dirname "$rel")"
    cp -p "$REPO/$rel" "$PERSONAL_DIR/$rel" 2>/dev/null
    printf '%s  %s\n' "$(sha256sum "$REPO/$rel" | cut -d' ' -f1)" "$rel" >> "$PERSONAL_DIR/MANIFEST.txt"
    PERSONAL_SAVED=$((PERSONAL_SAVED + 1))
  else
    # Only reachable via an explicit list: a named file that is already gone is
    # the exact loss this backup exists to catch, so say so loudly.
    printf 'MISSING  %s\n' "$rel" >> "$PERSONAL_DIR/MANIFEST.txt"
    PERSONAL_MISSING=$((PERSONAL_MISSING + 1))
  fi
done
if [ "$PERSONAL_MISSING" -gt 0 ]; then
  echo "  personal-scripts: WARNING $PERSONAL_MISSING file(s) ALREADY MISSING from the live tree ($PERSONAL_SAVED saved)"
else
  echo "  personal-scripts: $PERSONAL_SAVED saved + manifest"
fi

# Code rollback reference (the code itself lives in git).
git -C "$REPO" rev-parse HEAD          > "$DEST/git-HEAD.txt"    2>/dev/null
git -C "$REPO" branch --show-current   > "$DEST/git-branch.txt"  2>/dev/null

# Rotate: keep the newest $KEEP snapshot dirs, remove older ones.
if [ -d "$BKDIR" ]; then
  ls -1dt "$BKDIR"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -rf "$old" && echo "  pruned old snapshot: $(basename "$old")"
  done
fi

SIZE="$(du -sh "$DEST" 2>/dev/null | cut -f1)"
echo "backup ok: $DEST ($SIZE, retain newest $KEEP)"
