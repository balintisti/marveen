#!/usr/bin/env bash
# rulebook-snapshot.sh -- version the fleet's UNVERSIONED rulebooks by snapshot.
#
# WHY THIS EXISTS (card 52edd21e, measured 2026-08-27). The files every agent
# loads at the start of every session are in no repository at all:
#
#     /Users/isti/marveen/CLAUDE.md   gitignored (.gitignore:82)
#     /Users/isti/CLAUDE.md           gitignored
#     agents/*/CLAUDE.md, SOUL.md     12 persona files
#     ~/.claude/skills/**             64 files -- ~/.claude is not a repo either
#
#     78 files, 1.64 MB. No git, no Time Machine (`tmutil destinationinfo` ->
#     "No destinations configured"), no automation. A bad write or an `rm` takes
#     the lot, permanently.
#
# Measured churn on 2026-08-27: TEN files changed in one day, NINE of them
# skills. Following only CLAUDE.md would leave 90% of that day untraceable --
# which is why all three roots are in scope.
#
# WHAT THIS IS NOT, so nobody later reads it as a defect: the history is a chain
# of SNAPSHOTS, not authored commits. It records WHAT changed and WHEN, never
# WHO or WHY. The card asked for recoverability; that is what this gives.
#
# WHY COPIES AND NOT A BARE REPO OVER $HOME: the set spans three roots, so a
# single --work-tree would have to be $HOME itself -- which contains the marveen
# repo, its 40+ worktrees and every node_modules. One mistyped `add -A` there
# does more damage than this script prevents. Copying is slower and duller, and
# that is the point: the copy step IS the allowlist, 78 named files rather than
# a glob over a home directory.
set -euo pipefail

# --- Sources. Env-overridable ONLY so the guard below can be tested against a
# --- throwaway tree; production runs use the defaults.
RULEBOOK_REPO="${RULEBOOK_REPO:-/Users/isti/Backups/rulebooks}"
MARVEEN_ROOT="${RULEBOOK_MARVEEN_ROOT:-/Users/isti/marveen}"
DELTA_CLAUDE="${RULEBOOK_DELTA_CLAUDE:-/Users/isti/CLAUDE.md}"
SKILLS_ROOT="${RULEBOOK_SKILLS_ROOT:-$HOME/.claude/skills}"
NOTIFY_CMD="${RULEBOOK_NOTIFY:-$MARVEEN_ROOT/scripts/notify.sh}"

# --- THE DELETION GUARD THRESHOLD.
# A run that sees more than this share of the previous snapshot's files gone
# from the SOURCE does not commit: it alerts and leaves the repository
# untouched, so the last good state stays the checked-out state.
#
# WHY ONE THIRD. A real reorganisation moves less: the largest single-day change
# measured on this set was 10 of 78 files (13%), and the biggest structural edit
# of the day -- splitting two sections of a skill out to references/ -- moved
# one file. An accident moves more: an interrupted sync, a wrong $HOME, an
# unmounted volume or an `rm` on a directory takes a whole root at once, and the
# smallest root here (the 12 persona files) is already 15%. One third sits above
# every measured legitimate change and below every whole-root loss.
# It is a NUMBER, not a condition, so it can be argued with and re-measured.
MAX_MISSING_PCT="${RULEBOOK_MAX_MISSING_PCT:-33}"

MANIFEST_NAME="MANIFEST.tsv"

log() { printf '%s\n' "$*" >&2; }

# --- Collect (destination<TAB>source) pairs for every file in scope.
collect() {
  [ -f "$MARVEEN_ROOT/CLAUDE.md" ] && printf 'marveen/CLAUDE.md\t%s\n' "$MARVEEN_ROOT/CLAUDE.md"
  [ -f "$DELTA_CLAUDE" ] && printf 'delta-crm/CLAUDE.md\t%s\n' "$DELTA_CLAUDE"
  if [ -d "$MARVEEN_ROOT/agents" ]; then
    find "$MARVEEN_ROOT/agents" -mindepth 2 -maxdepth 2 \( -name 'CLAUDE.md' -o -name 'SOUL.md' \) -type f 2>/dev/null \
    | sort | while IFS= read -r f; do
        a=$(basename "$(dirname "$f")")
        printf 'agents/%s/%s\t%s\n' "$a" "$(basename "$f")" "$f"
      done
  fi
  if [ -d "$SKILLS_ROOT" ]; then
    find "$SKILLS_ROOT" -type f 2>/dev/null | sort | while IFS= read -r f; do
      printf 'skills/%s\t%s\n' "${f#"$SKILLS_ROOT"/}" "$f"
    done
  fi
}

PAIRS=$(collect || true)
NOW_COUNT=$(printf '%s' "$PAIRS" | grep -c . || true)
if [ "${NOW_COUNT:-0}" -eq 0 ]; then
  log "rulebook-snapshot: ZERO source files found -- refusing to touch the repository."
  log "  (an empty set is what a wrong root or an unmounted volume looks like)"
  exit 2
fi

mkdir -p "$RULEBOOK_REPO"
if [ ! -d "$RULEBOOK_REPO/.git" ]; then
  git -C "$RULEBOOK_REPO" init -q
  log "rulebook-snapshot: initialised $RULEBOOK_REPO"
fi

# --- THE GUARD, before anything is copied or removed.
# Compare against the PREVIOUS manifest: how many of the files we snapshotted
# last time have disappeared from the source?
PREV="$RULEBOOK_REPO/$MANIFEST_NAME"
if [ -f "$PREV" ]; then
  prev_n=$(grep -c . < "$PREV" || true)
  missing=0
  while IFS=$'\t' read -r _dest src; do
    [ -n "${src:-}" ] || continue
    [ -f "$src" ] || missing=$((missing + 1))
  done < "$PREV"
  if [ "${prev_n:-0}" -gt 0 ]; then
    pct=$(( missing * 100 / prev_n ))
    if [ "$pct" -gt "$MAX_MISSING_PCT" ]; then
      msg="rulebook-snapshot MEGTAGADVA: a korabbi pillanatfelvetel ${prev_n} fajljabol ${missing} (${pct}%) NINCS MEG a forrasban, a kuszob ${MAX_MISSING_PCT}%. Nem commitoltam, a repo erintetlen: $RULEBOOK_REPO"
      log "$msg"
      if [ -x "$NOTIFY_CMD" ]; then
        "$NOTIFY_CMD" "$msg" || log "rulebook-snapshot: the alert itself FAILED to send"
      else
        log "rulebook-snapshot: no notifier at $NOTIFY_CMD -- alert not sent"
      fi
      exit 3
    fi
  fi
fi

# --- Mirror. Remove the old store wholesale so a source deletion below the
# --- threshold shows up as a deletion in the history, not as a stale copy.
rm -rf "$RULEBOOK_REPO/store"
printf '%s\n' "$PAIRS" | while IFS=$'\t' read -r dest src; do
  [ -n "${dest:-}" ] || continue
  mkdir -p "$RULEBOOK_REPO/store/$(dirname "$dest")"
  cp -p "$src" "$RULEBOOK_REPO/store/$dest"
done
printf '%s\n' "$PAIRS" > "$PREV"

git -C "$RULEBOOK_REPO" add -A
# No change -> `git commit` exits non-zero and writes nothing. Measured: an
# empty cycle is 26 ms and leaves no empty commit, so no "did anything change?"
# pre-check is needed.
if git -C "$RULEBOOK_REPO" commit -q -m "snapshot: ${NOW_COUNT} fajl" 2>/dev/null; then
  log "rulebook-snapshot: committed ${NOW_COUNT} files"
else
  log "rulebook-snapshot: no change (${NOW_COUNT} files)"
fi
