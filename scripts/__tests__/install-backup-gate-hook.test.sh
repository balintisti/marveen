#!/bin/bash
# Tests for scripts/install-backup-gate-hook.sh (card 0009ed12).
#
# Everything runs in a throwaway repo under a temp dir. The installer only ever
# writes into $(git rev-parse --git-common-dir)/hooks of the repo it is invoked
# from, so a scratch repo fully contains it -- unlike install-telegram-progress-
# hook.test.sh, which overrides HOME while its installer calls launchctl, and
# therefore registers into the REAL gui/501 domain (measured 2026-09-05).
# Checked before writing this: this installer calls no launchctl, no sudo, and
# touches nothing outside the repo it is given.
#
# Run: bash scripts/__tests__/install-backup-gate-hook.test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   -- $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL -- $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$3], got [$2])"; fi; }

command -v sqlite3 >/dev/null 2>&1 || { echo "SKIP: sqlite3 not installed"; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- a scratch repo that looks like the prod checkout ----------------------
REPO="$TMP/repo"
mkdir -p "$REPO/scripts/__tests__" "$REPO/store"
cp "$ROOT/scripts/pre-modify-backup.sh"      "$REPO/scripts/"
cp "$ROOT/scripts/install-backup-gate-hook.sh" "$REPO/scripts/"
sqlite3 "$REPO/store/claudeclaw.db" "create table t(a); insert into t values(1);"
git -C "$REPO" init -q
git -C "$REPO" config user.email t@t; git -C "$REPO" config user.name t
printf 'store/\n' > "$REPO/.gitignore"
git -C "$REPO" add -A >/dev/null; git -C "$REPO" commit -qm init

# the merge dispatcher, exactly as the repo installs it
HOOKS="$REPO/.git/hooks"; mkdir -p "$HOOKS/pre-commit.d"
for h in pre-commit pre-merge-commit; do
  { echo '#!/usr/bin/env bash'; echo 'set -euo pipefail'
    [ "$h" = pre-merge-commit ] && echo 'export MARVEEN_MERGE_COMMIT=1'
    echo 'HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"; status=0'
    echo 'for x in "$HOOK_DIR"/pre-commit.d/*; do [ -x "$x" ] || continue; "$x" "$@" || status=1; done'
    echo 'exit $status'; } > "$HOOKS/$h"
  chmod +x "$HOOKS/$h"
done

bash "$REPO/scripts/install-backup-gate-hook.sh" >/dev/null 2>&1
check "installer writes the chain entry" "$([ -x "$HOOKS/pre-commit.d/07-pre-modify-backup-gate" ] && echo yes || echo no)" "yes"
bash "$REPO/scripts/install-backup-gate-hook.sh" >/dev/null 2>&1
check "installer is idempotent (still exactly one entry)" "$(ls "$HOOKS/pre-commit.d" | wc -l | tr -d ' ')" "1"

snaps() { ls -d "$REPO"/store/backups/*/ 2>/dev/null | grep -cE '/[0-9]{8}-[0-9]{6}-' || true; }

# ---- 1. an ORDINARY commit must not trigger a backup (negative control) ----
echo "a" > "$REPO/a.txt"; git -C "$REPO" add -A >/dev/null
git -C "$REPO" commit -qm "plain" >/dev/null 2>&1
check "plain commit: no snapshot taken" "$(snaps)" "0"

# ---- 2. a MERGE with no fresh snapshot: the gate takes one -----------------
git -C "$REPO" checkout -qb feature
echo "b" > "$REPO/b.txt"; git -C "$REPO" add -A >/dev/null; git -C "$REPO" commit -qm feat >/dev/null
git -C "$REPO" checkout -q master 2>/dev/null || git -C "$REPO" checkout -q main
echo "c" > "$REPO/c.txt"; git -C "$REPO" add -A >/dev/null; git -C "$REPO" commit -qm other >/dev/null
git -C "$REPO" merge --no-ff -m "merge feature" feature >/dev/null 2>&1
MERGE_RC=$?
check "merge succeeds (the gate does not block)" "$MERGE_RC" "0"
check "merge: a snapshot WAS taken" "$(snaps)" "1"
check "snapshot contains the DB" \
  "$(ls "$REPO"/store/backups/*/claudeclaw.db >/dev/null 2>&1 && echo yes || echo no)" "yes"

# ---- 3. a SECOND merge inside the window must NOT take another -------------
#         (the gate must be able to stay silent, or it is not discriminating)
git -C "$REPO" checkout -qb feature2
echo "d" > "$REPO/d.txt"; git -C "$REPO" add -A >/dev/null; git -C "$REPO" commit -qm feat2 >/dev/null
git -C "$REPO" checkout -q master 2>/dev/null || git -C "$REPO" checkout -q main
OUT_W="$(git -C "$REPO" merge --no-ff -m "merge feature2" feature2 2>&1)"
check "second merge in-window: still exactly ONE snapshot" "$(snaps)" "1"
# The count alone cannot see a re-run: both merges fall in the same second and
# the snapshot dir is named by second, so a second run would mkdir -p THE SAME
# path and the count would not move. A surviving mutation proved it (M3).
check "second merge in-window: the gate stayed silent" \
  "$(printf '%s' "$OUT_W" | grep -c 'taking one' | tr -d ' ')" "0"

# ---- 4. BLAST RADIUS: a linked worktree shares .git/hooks ------------------
#         (measured 2026-09-10: one install reaches every agent's worktree)
git -C "$REPO" worktree add -q "$TMP/wt" -b wtbranch >/dev/null 2>&1
git -C "$TMP/wt" config user.email t@t; git -C "$TMP/wt" config user.name t
git -C "$TMP/wt" checkout -qb wtfeat
echo "e" > "$TMP/wt/e.txt"; git -C "$TMP/wt" add -A >/dev/null; git -C "$TMP/wt" commit -qm wtfeat >/dev/null
git -C "$TMP/wt" checkout -q wtbranch
echo "f" > "$TMP/wt/f.txt"; git -C "$TMP/wt" add -A >/dev/null; git -C "$TMP/wt" commit -qm wtother >/dev/null
# Clear the snapshots first: with a fresh one present the FRESHNESS check would
# short-circuit and mask the SCOPE check -- measured, mutation M1 survived that
# version of this test. Now only scope can keep the gate quiet here.
rm -rf "$REPO"/store/backups
OUT_WT="$(git -C "$TMP/wt" merge --no-ff -m "merge in worktree" wtfeat 2>&1)"; RC_WT=$?
check "linked worktree merge succeeds" "$RC_WT" "0"
check "linked worktree merge takes NO snapshot (scope holds)" "$(snaps)" "0"
check "linked worktree: the gate never even announced itself" \
  "$(printf '%s' "$OUT_WT" | grep -c 'backup-gate' | tr -d ' ')" "0"

# ---- 5. fail-closed: the backup script is GONE ----------------------------
rm -rf "$REPO"/store/backups
mv "$REPO/scripts/pre-modify-backup.sh" "$TMP/stashed.sh"
git -C "$REPO" checkout -qb feature3
echo "g" > "$REPO/g.txt"; git -C "$REPO" add -A >/dev/null; git -C "$REPO" commit -qm feat3 >/dev/null
git -C "$REPO" checkout -q master 2>/dev/null || git -C "$REPO" checkout -q main
OUT="$(git -C "$REPO" merge --no-ff -m "merge feature3" feature3 2>&1)"; RC=$?
check "missing backup script: merge BLOCKED" "$([ $RC -ne 0 ] && echo blocked || echo allowed)" "blocked"
check "...and it names the override" \
  "$(printf '%s' "$OUT" | grep -c 'MARVEEN_BACKUP_OK=1' | tr -d ' ')" "1"

# ---- 6. the override lets it through, and LEAVES A TRACE ------------------
git -C "$REPO" merge --abort >/dev/null 2>&1
OUT2="$(MARVEEN_BACKUP_OK=1 git -C "$REPO" merge --no-ff -m "merge feature3" feature3 2>&1)"; RC2=$?
check "override: merge succeeds" "$RC2" "0"
check "override: logged to store/backup-gate-override.log" \
  "$(grep -c 'MARVEEN_BACKUP_OK=1' "$REPO/store/backup-gate-override.log" 2>/dev/null | tr -d ' ')" "1"
mv "$TMP/stashed.sh" "$REPO/scripts/pre-modify-backup.sh"

# ---- 7. fail-closed: the backup runs but yields no DB ---------------------
#         (pre-modify-backup.sh has no `set -e` and exits 0 even when the
#          sqlite snapshot fails -- so the exit code is NOT the evidence)
rm -rf "$REPO"/store/backups
cat > "$REPO/scripts/pre-modify-backup.sh" <<'STUB'
#!/usr/bin/env bash
# stub: makes the directory, never produces the DB, and exits 0 -- exactly the
# silent-failure shape the real script can degrade into.
D="$(cd "$(dirname "$0")/.." && pwd)/store/backups/$(date +%Y%m%d-%H%M%S)-${1:-x}"
mkdir -p "$D"; echo "db: WARNING snapshot failed"; exit 0
STUB
chmod +x "$REPO/scripts/pre-modify-backup.sh"
git -C "$REPO" checkout -qb feature4
echo "h" > "$REPO/h.txt"; git -C "$REPO" add -A >/dev/null; git -C "$REPO" commit -qm feat4 >/dev/null
git -C "$REPO" checkout -q master 2>/dev/null || git -C "$REPO" checkout -q main
OUT3="$(git -C "$REPO" merge --no-ff -m "merge feature4" feature4 2>&1)"; RC3=$?
check "backup exits 0 but produced no DB: merge BLOCKED" \
  "$([ $RC3 -ne 0 ] && echo blocked || echo allowed)" "blocked"

echo
echo "install-backup-gate-hook: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
