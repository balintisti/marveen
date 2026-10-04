#!/bin/bash
# agent-reports-snapshot.sh -- a versioned, LOCAL copy of every agent's reports/ tree.
#
# WHY (card b511e460, measured 2026-10-03 13:57): /Users/Shared/marveen-sirius/reports held
# 33 files in no git repository, covered by no backup (rulebooks, agent memory). Cards cite
# the PATH only, so after a deletion a card would assert something existed that nobody can
# show any more. marveen took one manual snapshot into /Users/isti/Backups/agent-reports;
# this script keeps it current: every agents/<name>/reports tree (agents/<name> may be a
# symlink to /Users/Shared/marveen-<name>) is mirrored to <repo>/<name>/ and committed when
# something changed.
#
# LOCAL ONLY, ENFORCED: a remote copy goes off the machine, and that is Isti's decision
# (card b511e460). The rulebooks snapshot pushes to GitHub, which is exactly why the reports
# are NOT added to it. If this repository ever has a remote, the script refuses to run
# instead of silently starting to publish.
#
# DELETION GUARD (same rule as rulebook-snapshot.sh): if more than MAX_MISSING_PCT of the
# tracked files vanished from the sources, or the sources are empty while the repo is not,
# nothing is committed and an alert goes out -- a wrong root or a wiped disk looks exactly
# like that, and committing it would make the backup agree with the loss. A smaller
# deletion is a real edit and is committed (git history keeps the old file).
#
#   bash scripts/agent-reports-snapshot.sh      # launchd, every 30 minutes
set -uo pipefail

REPO="${REPORTS_REPO:-/Users/isti/Backups/agent-reports}"
MARVEEN_ROOT="${REPORTS_MARVEEN_ROOT:-/Users/isti/marveen}"
NOTIFY_CMD="${REPORTS_NOTIFY:-$MARVEEN_ROOT/scripts/notify.sh}"
MAX_MISSING_PCT="${REPORTS_MAX_MISSING_PCT:-33}"
LOCK_DIR="${REPORTS_LOCK_DIR:-${REPO%/}.lock}"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
alert() {
  log "$1"
  if [ -f "$NOTIFY_CMD" ] && bash "$NOTIFY_CMD" "[RIPORT-MENTES] $1" >/dev/null 2>&1; then
    log "riasztas: elkuldve"
  else
    log "riasztas: NEM ment ki ($NOTIFY_CMD)"
  fi
}

[ -d "$REPO/.git" ] || { alert "nincs git-repo a riport-mentes helyen: $REPO"; exit 2; }
REMOTES=$(git -C "$REPO" remote)
if [ -n "$REMOTES" ]; then
  alert "a riport-mentes repojanak tavolija van ($(printf '%s' "$REMOTES" | tr '\n' ' ')): a tavoli masolat Isti dontese, ezert nem futok"
  exit 3
fi

if mkdir "$LOCK_DIR" 2>/dev/null; then
  printf '%s\n' "$$" > "$LOCK_DIR/pid"
else
  owner=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  if [ -n "${owner:-}" ] && kill -0 "$owner" 2>/dev/null; then
    log "egy masik peldany fut (PID $owner) -- kilepek"
    exit 0
  fi
  log "elavult zar (PID ${owner:-?} nem fut) -- feltorom"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" 2>/dev/null || { log "a zar nem szerezheto meg"; exit 0; }
  printf '%s\n' "$$" > "$LOCK_DIR/pid"
fi
TMP=$(mktemp -d)
trap 'rm -rf "$LOCK_DIR" "$TMP"' EXIT

# "<agent>/<relative path>" for every file of every agents/<name>/reports tree.
for d in "$MARVEEN_ROOT"/agents/*/reports; do
  [ -d "$d" ] || continue
  a=$(basename "$(dirname "$d")")
  (cd "$d" && find -L . -type f ! -name '.DS_Store' | sed "s|^\./|$a/|")
done | LC_ALL=C sort > "$TMP/src"
git -C "$REPO" ls-files | LC_ALL=C sort > "$TMP/tracked"
LC_ALL=C comm -23 "$TMP/tracked" "$TMP/src" > "$TMP/missing"
N_SRC=$(grep -c . "$TMP/src" || true)
N_TRACKED=$(grep -c . "$TMP/tracked" || true)
N_MISSING=$(grep -c . "$TMP/missing" || true)

if [ "$N_SRC" -eq 0 ] && [ "$N_TRACKED" -gt 0 ]; then
  alert "a forras URES ($MARVEEN_ROOT/agents/*/reports), a mentesben $N_TRACKED fajl van: nem commitolok (rossz gyoker vagy torolt lemez)"
  exit 4
fi
if [ "$N_TRACKED" -gt 0 ] && [ $((N_MISSING * 100 / N_TRACKED)) -gt "$MAX_MISSING_PCT" ]; then
  alert "$N_TRACKED kovetett riportbol $N_MISSING eltunt a forrasbol (tobb mint ${MAX_MISSING_PCT}%): nem commitolok, nezd meg kezzel"
  exit 4
fi

# Mirror: deletions first (only the guarded list above), then new and changed files.
while IFS= read -r rel; do
  [ -n "$rel" ] && rm -f "$REPO/$rel"
done < "$TMP/missing"
while IFS= read -r rel; do
  a=${rel%%/*}
  src="$MARVEEN_ROOT/agents/$a/reports/${rel#*/}"
  dst="$REPO/$rel"
  if ! cmp -s "$src" "$dst" 2>/dev/null; then
    mkdir -p "$(dirname "$dst")" && cp -p "$src" "$dst"
  fi
done < "$TMP/src"

git -C "$REPO" add -A
if git -C "$REPO" diff --cached --quiet; then
  log "nincs valtozas ($N_SRC fajl)"
  exit 0
fi
CHANGED=$(git -C "$REPO" diff --cached --name-only | grep -c . || true)
if git -C "$REPO" commit -q -m "snapshot $(date '+%Y-%m-%d %H:%M'): $N_SRC fajl, $CHANGED valtozott, $N_MISSING torolve"; then
  log "commit: $N_SRC fajl, $CHANGED valtozott, $N_MISSING torolve"
else
  alert "a riport-mentes commitja nem sikerult ($REPO)"
  exit 5
fi
