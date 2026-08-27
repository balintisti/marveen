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

# --- THE SINGLE-WRITER LOCK (card c26193d7, measured by didi 2026-08-27).
# TWO callers can start this script -- the launchd unit and
# scripts/hooks/skills-snapshot-on-write.sh, which fires on EVERY skill write
# and starts one arm in the BACKGROUND. There was no lock, and the mirror step
# below is `rm -rf store` followed by ~1.5 s of copying, so a second instance
# could reach `git add -A` while the first was still half-way through the copy.
# Measured result: three commits in two hours recording 34, 24 and 19 files,
# each PAIRED with an intact commit in the same minute. `SKILLS_SNAPSHOT_RUNNING`
# does not cover this: it is checked in the HOOK only, and stops the hook
# re-entering itself, not two independent callers colliding.
#
# The lock lives OUTSIDE the repository on purpose: anything inside it would be
# swept up by `git add -A` and committed.
#
# A second instance exits 0, quietly. That is not a failure: the next poll runs
# anyway, and a backup mechanism that reports failure teaches people to ignore it.
LOCK_DIR="${RULEBOOK_LOCK_DIR:-${RULEBOOK_REPO%/}.lock}"

log() { printf '%s\n' "$*" >&2; }

# `mkdir` is the atomic primitive here: macOS ships no `flock`. The PID file is
# for the STALE case, and the stale case is real, not theoretical -- the hook
# kills a slow snapshot with `kill -9` (skills-snapshot-on-write.sh), which runs
# no trap, so a lock CAN outlive its owner. Breaking a lock whose owner is gone
# is therefore required; breaking one whose owner is alive would undo the lock.
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then printf '%s\n' "$$" > "$LOCK_DIR/pid"; return 0; fi
  owner=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  if [ -n "${owner:-}" ] && kill -0 "$owner" 2>/dev/null; then return 1; fi
  log "rulebook-snapshot: stale lock (PID ${owner:-?} is gone) -- breaking it"
  rm -rf "$LOCK_DIR"
  if mkdir "$LOCK_DIR" 2>/dev/null; then printf '%s\n' "$$" > "$LOCK_DIR/pid"; return 0; fi
  return 1
}

# --- Collect (destination<TAB>source) pairs for every file in scope.
# LC_ALL=C A RENDEZESEN, ES EZ MERT DEFEKTUS-JAVITAS (marveen, 2026-08-27 11:5x).
# A csupasz `sort` LOCALE-FUGGO. Merve, ugyanazon a ket uton:
#     LANG=hu_HU.UTF-8 -> references/buktatok.md, majd SKILL.md   (kis-nagybetu-erzeketlen)
#     LC_ALL=C         -> SKILL.md, majd references/buktatok.md   (bajt szerint)
# A launchd C/POSIX locale-lal fut, az interaktiv hej hu_HU-val -- tehat a manifest SORRENDJE
# attol fuggott, KI inditotta a kort. Minden valtas egy commitot szult valtozas NELKUL, es ezzel
# a "nem tortent semmi" jelzes megszunt: 48 zaj-commit naponta, amiben egy VALODI valtozas
# elveszik. A teszt ezt nem foghatta meg: egy futasban egy locale van.
# ES A KIMENET SZANDEKOSAN NEM TELJESEN RENDEZETT -- a manifest ezt orokli.
# Negy csoport megy ki FIX sorrendben (marveen, delta-crm, agents, skills), es csak a ket
# find-es csoport megy at `LC_ALL=C sort`-on. A fix sorrend teszi a manifest-diffet olvashatova:
# az egyetlen CLAUDE.md sor a tetejen marad, nem sodrodik 64 skill-utvonal koze.
# Azert all itt, mert szuletett egy teszt, ami a TELJES manifest rendezettseget allitotta, elbukott,
# es MAGA A TESZT volt a hibas (2026-08-27). A kovetkezo olvaso ugyanezt feltetelezne.
collect() {
  [ -f "$MARVEEN_ROOT/CLAUDE.md" ] && printf 'marveen/CLAUDE.md\t%s\n' "$MARVEEN_ROOT/CLAUDE.md"
  [ -f "$DELTA_CLAUDE" ] && printf 'delta-crm/CLAUDE.md\t%s\n' "$DELTA_CLAUDE"
  if [ -d "$MARVEEN_ROOT/agents" ]; then
    find "$MARVEEN_ROOT/agents" -mindepth 2 -maxdepth 2 \( -name 'CLAUDE.md' -o -name 'SOUL.md' \) -type f 2>/dev/null \
    | LC_ALL=C sort | while IFS= read -r f; do
        a=$(basename "$(dirname "$f")")
        printf 'agents/%s/%s\t%s\n' "$a" "$(basename "$f")" "$f"
      done
  fi
  if [ -d "$SKILLS_ROOT" ]; then
    find "$SKILLS_ROOT" -type f 2>/dev/null | LC_ALL=C sort | while IFS= read -r f; do
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

if acquire_lock; then
  # Only armed AFTER the lock is ours, so a losing instance can never remove
  # the winner's lock on its way out.
  trap 'rm -rf "$LOCK_DIR"' EXIT
else
  log "rulebook-snapshot: another instance holds the lock -- exiting without touching the repository."
  exit 0
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
# No change -> `git commit` exits non-zero and writes nothing, so no "did
# anything change?" pre-check is needed.
#
# THE COST, WITH ITS POPULATION -- the earlier note here said "26 ms" and named
# no tree, which is how a number stops being an answer (friday, 2026-08-27):
#     1 file, throwaway tree ....... 32 ms
#     79 files, the LIVE set ....... 1.43-1.62 s   (5 runs, no change)
# A single run of the live set once came back at 0.386 s and that was an
# outlier, warm from the run before it; one measurement is not a measurement.
# At 1800 s that is ~72 s of wall time a day. Anyone shortening the interval
# should multiply by the 1.5 s figure, not the 26 ms one: 60 s would be ~36
# minutes a day.
# --- THE COUNT IN THE MESSAGE IS THE COMMITTED ONE, NOT THE SOURCE ONE.
# This line used to read `snapshot: ${NOW_COUNT} fajl`, and NOW_COUNT comes from
# collect(), i.e. from the SOURCE, before anything is copied. So a truncated
# commit claimed the full number: the lie sat in the exact field a reader would
# check it by. Measured (card c26193d7): commits reading "83 fajl" whose trees
# held 34, 24 and 19 files.
#
# `ls-files` reads the INDEX after `add -A`, which is precisely what the commit
# will contain -- so the number is known BEFORE the message is written and does
# not have to be corrected afterwards.
#
# WHY IT STILL COMMITS when the two disagree, instead of refusing like the
# deletion guard above: a snapshot store is evidence. A refused commit leaves no
# trace of what happened once the alert scrolls past, and the next run
# supersedes a marked one anyway. What must never happen is a truncated commit
# that CLAIMS to be whole.
STAGED_COUNT=$(git -C "$RULEBOOK_REPO" ls-files -- store | grep -c . || true)
MSG="snapshot: ${STAGED_COUNT} fajl"
TRUNCATED=0
if [ "${STAGED_COUNT:-0}" -ne "${NOW_COUNT:-0}" ]; then
  TRUNCATED=1
  MSG="snapshot: ${STAGED_COUNT} fajl -- CSONKA (a forrasban ${NOW_COUNT})"
fi

if git -C "$RULEBOOK_REPO" commit -q -m "$MSG" 2>/dev/null; then
  # The post-commit check marveen asked for: the message is derived from the
  # index, this reads the TREE that actually landed. Cheap, and it answers a
  # different question than the line above -- "is what I staged what I committed".
  TREE_COUNT=$(git -C "$RULEBOOK_REPO" ls-tree -r --name-only HEAD -- store | grep -c . || true)
  log "rulebook-snapshot: committed ${STAGED_COUNT} files (tree ${TREE_COUNT}, source ${NOW_COUNT})"
  if [ "${TREE_COUNT:-0}" -ne "${STAGED_COUNT:-0}" ]; then
    TRUNCATED=1
    MSG="$MSG [tree ${TREE_COUNT}]"
  fi
else
  log "rulebook-snapshot: no change (${STAGED_COUNT} files)"
fi

if [ "$TRUNCATED" = "1" ]; then
  msg="rulebook-snapshot CSONKA PILLANATFELVETEL: a forrasban ${NOW_COUNT} fajl, a commitban ${STAGED_COUNT}. A commit uzenete megnevezi, hogy csonka. Repo: $RULEBOOK_REPO"
  log "$msg"
  if [ -x "$NOTIFY_CMD" ]; then
    "$NOTIFY_CMD" "$msg" || log "rulebook-snapshot: the alert itself FAILED to send"
  else
    log "rulebook-snapshot: no notifier at $NOTIFY_CMD -- alert not sent"
  fi
  exit 4
fi
