#!/usr/bin/env bash
# Idempotent installer: make the pre-modify backup MECHANICAL on the main
# (prod) checkout, instead of a written step someone has to remember.
#
# WHY THIS EXISTS -- the rule was already written, and measured not to work.
# scripts/pre-modify-backup.sh captures the state git does NOT track (SQLite DB,
# vault, runtime config). On 2026-08-29 the rule "run it first" was added as
# step 0 of the koteg-beolvasztas-elo-rendszerbe skill. Measured 2026-09-11,
# 13 days later, on the main checkout's own history:
#
#     merge windows since the rule (>2h gap splits a window) ... 12
#     windows with a snapshot ................................... 3   (08-29, 09-02, 09-03)
#     windows with NO snapshot .................................. 9   (96 merge commits)
#     the last 9 windows in a row were uncovered.
#
# The rule fired three times and then stopped. Nothing was neglected: a step
# written in a skill is only read by whoever invokes that skill, and the merge
# is performed by someone who already knows what they are doing. So the fix is
# not a better sentence -- it is a trigger that fires without being remembered.
#
# SCOPE -- the MAIN worktree only. .git/hooks is SHARED with every linked
# worktree (measured 2026-09-10 with a real push through a local bare remote),
# so an unscoped gate here would fire in all six agents' worktrees. Linked
# worktrees have a different toplevel and pass untouched.
#
# BEHAVIOUR -- it does NOT block. If no snapshot is fresh enough it RUNS the
# backup itself and verifies the result. A gate that merely refuses would be
# overridden into a habit the third time it fired mid-window, and a bypassed
# guard is decoration. It refuses only when the backup could not be produced --
# that is, when the thing it protects genuinely did not happen.
#   Deliberate override: MARVEEN_BACKUP_OK=1 git merge ...   (logged)
#
# Installed as a CHAIN ENTRY in pre-commit.d/, never as the pre-commit file
# itself: that dispatcher is shared with the prod-tree guard and the secret
# gate, and a monolithic hook would couple the end state to installer ORDER.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# `--git-common-dir` returns a RELATIVE path from the main checkout and an
# ABSOLUTE one from a linked worktree, and git resolves the relative form
# against ITS OWN cwd -- so `cd "$(git -C "$ROOT" ...)"` resolves ".git" against
# the CALLER's cwd instead, and dies with "cd: .git: Not a directory" whenever
# the installer is run from anywhere but $ROOT. Measured here, not reasoned:
# this is the latent defect card 2b07f542 already tracks in three other hook
# installers. Entering $ROOT first makes the anchor correct for both cases.
HOOK_DIR="$(cd "$ROOT" && cd "$(git rev-parse --git-common-dir)" && pwd)/hooks"
GUARD="$HOOK_DIR/pre-commit.d/07-pre-modify-backup-gate"
MARK="marveen-pre-modify-backup-gate"
mkdir -p "$HOOK_DIR/pre-commit.d"

cat > "$GUARD" <<'EOF'
#!/usr/bin/env bash
# marveen-pre-modify-backup-gate : snapshot untracked live state before a merge
# lands on the running prod checkout. Managed by
# scripts/install-backup-gate-hook.sh -- edit there, not here.
# Deliberate override: MARVEEN_BACKUP_OK=1 git merge ...
set -uo pipefail

MAX_AGE_H="${MARVEEN_BACKUP_MAX_AGE_H:-12}"
PROD_ROOT="${MARVEEN_PROD_ROOT:-$(dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd)")}"
TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null || echo)"

# Not the main checkout -> not our business (see SCOPE in the installer).
[ "$TOPLEVEL" = "$PROD_ROOT" ] || exit 0

# Is this a merge? On the pre-merge-commit path MERGE_HEAD does NOT exist yet
# (measured, card 2033a2da) -- the dispatcher exports a flag for exactly that.
# The MERGE_HEAD arm catches the other path: finishing a CONFLICTED merge.
if ! { [ "${MARVEEN_MERGE_COMMIT:-0}" = "1" ] \
       || git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; }; then
  exit 0
fi

BKDIR="$PROD_ROOT/store/backups"
LOG="$PROD_ROOT/store/backup-gate-override.log"

if [ "${MARVEEN_BACKUP_OK:-0}" = "1" ]; then
  mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
  printf '%s\tbranch=%s\treason=override MARVEEN_BACKUP_OK=1\n' \
    "$(date '+%Y-%m-%dT%H:%M:%S%z')" \
    "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')" >> "$LOG" 2>/dev/null || true
  echo "backup-gate: overridden (MARVEEN_BACKUP_OK=1) -- logged" >&2
  exit 0
fi

# Freshness by DIRECTORY NAME, not mtime: the name is what the producer stamps,
# and a stray touch must not be able to forge freshness. The format is
# fixed-width and zero-padded, so a string compare IS a time compare.
#   `find -newermt '-12 hours'` was the obvious form and is NOT usable here:
#   find on this host is bfs, which rejects relative timestamps (measured).
THRESH="$(date -v-"${MAX_AGE_H}"H +%Y%m%d-%H%M%S 2>/dev/null \
       || date -d "-${MAX_AGE_H} hours" +%Y%m%d-%H%M%S 2>/dev/null \
       || echo)"

NEWEST=""
if [ -d "$BKDIR" ]; then
  for d in "$BKDIR"/*/; do
    [ -d "$d" ] || continue
    b="$(basename "$d")"
    case "$b" in
      [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-*) ;;
      *) continue ;;
    esac
    [ "$b" \> "$NEWEST" ] && NEWEST="$b"
  done
fi

# Unknown threshold (neither date dialect) -> take the SAFE direction and back
# up, rather than assume freshness we cannot compute.
if [ -n "$THRESH" ] && [ -n "$NEWEST" ] && [ "$NEWEST" \> "$THRESH" ]; then
  exit 0   # a snapshot inside the window already covers this merge
fi

BK="$PROD_ROOT/scripts/pre-modify-backup.sh"
if [ ! -f "$BK" ]; then
  echo "BLOCKED: scripts/pre-modify-backup.sh is MISSING from the prod tree." >&2
  echo "  That is the exact loss it exists to catch (2026-07-26: a branch switch" >&2
  echo "  silently deleted it; nothing errored, it was simply gone)." >&2
  echo "  Deliberate override: MARVEEN_BACKUP_OK=1 git merge ..." >&2
  exit 1
fi

LABEL="merge-$(git rev-parse --abbrev-ref HEAD 2>/dev/null | tr -c 'A-Za-z0-9' '-' | cut -c1-24 | sed 's/-*$//')"
echo "backup-gate: no snapshot in the last ${MAX_AGE_H}h -- taking one before this merge" >&2
BEFORE="$NEWEST"
bash "$BK" "$LABEL" >&2

# VERIFY, do not trust the exit code: pre-modify-backup.sh runs without `set -e`
# and prints "db: WARNING snapshot failed" while still exiting 0. The check the
# skill already specifies is the one that matters -- a NEW dir, with the DB in it.
AFTER=""
for d in "$BKDIR"/*/; do
  [ -d "$d" ] || continue
  b="$(basename "$d")"
  case "$b" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-*) ;;
    *) continue ;;
  esac
  [ "$b" \> "$AFTER" ] && AFTER="$b"
done

if [ -n "$AFTER" ] && [ "$AFTER" != "$BEFORE" ] && [ -f "$BKDIR/$AFTER/claudeclaw.db" ]; then
  echo "backup-gate: ok -- $AFTER" >&2
  exit 0
fi

echo "BLOCKED: the pre-modify backup did not produce a usable snapshot." >&2
echo "  expected a new store/backups/<TS>-<label>/ containing claudeclaw.db" >&2
echo "  got: ${AFTER:-<none>} (previous newest: ${BEFORE:-<none>})" >&2
echo "  The code is safe in git; store/ is not -- this is the only copy." >&2
echo "  Deliberate override: MARVEEN_BACKUP_OK=1 git merge ..." >&2
exit 1
EOF

chmod +x "$GUARD"
grep -qF "$MARK" "$GUARD" || { echo "install-backup-gate-hook: marker missing after write" >&2; exit 1; }
echo "✓ backup gate installed: $GUARD"
