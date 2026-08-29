#!/usr/bin/env bash
# skills-snapshot-on-write.sh -- PostToolUse hook: snapshot ~/.claude/skills the
# moment anything under it changes, instead of waiting up to 30 minutes.
#
# WHY (card de00fd2b, measured 2026-08-27). rulebook-snapshot.sh already versions
# the skills tree, but on a 1800 s timer. Two edits inside one interval collapse
# into one commit and the FIRST one is gone. Measured on a throwaway tree with the
# production script, positive control first:
#
#     one edit per run, twice   ->  both states present in the history
#     two edits in one interval ->  `git log -S'agens-A'` finds ZERO commits
#
# WHY THIS MATCHES Bash AND NOT JUST Write|Edit, which is the whole point.
# Measured across the fleet's session transcripts for 2026-08-27: 292 tool calls
# touched a .claude/skills path, and the number that used Write/Edit/MultiEdit/
# NotebookEdit was ZERO. Every skill edit that day -- friday 7, mandark 3,
# dexter 2, didi 1 under the strict count -- went through Bash. A Write|Edit
# matcher would have caught none of them. (Positive control on that measurement:
# it found all six of the author's own known edits to one skill.)
#
# WHY IT ASKS THE FILESYSTEM AND NOT THE COMMAND TEXT. Grepping the Bash command
# for a skills path is fragile: a script written earlier and run later never
# mentions the path, and two of the 13 strict hits were only visible because the
# path happened to sit inside a heredoc. The command says what someone MEANT to
# do; `find -newer` says what actually changed.
set -uo pipefail          # NOT -e: this must never fail the tool call. See below.

SKILLS_ROOT="${SKILLS_SNAPSHOT_ROOT:-$HOME/.claude/skills}"
# THE STAMP LIVES OUTSIDE THE WATCHED TREE, and that is not tidiness: a stamp
# inside SKILLS_ROOT would be newer than itself on every run, so the gate would
# fire on every single Bash call in the fleet, forever.
STAMP="${SKILLS_SNAPSHOT_STAMP:-$HOME/.claude/.skills-snapshot-stamp}"
SNAPSHOT="${SKILLS_SNAPSHOT_CMD:-/Users/isti/marveen/scripts/rulebook-snapshot.sh}"
TIMEOUT_S="${SKILLS_SNAPSHOT_TIMEOUT:-20}"
# BACKOFF AFTER A FAILURE. On failure the stamp is deliberately left old so the
# change is retried -- but that also leaves the gate OPEN, so without this every
# subsequent Bash call in the fleet pays for the failing snapshot. Measured with
# a snapshot that sleeps 1.5 s and exits 3: three consecutive calls cost 2.06,
# 2.34 and 2.38 s each, and it would not stop on its own.
# This is not hypothetical: rulebook-snapshot.sh exits 3 BY DESIGN when its
# deletion guard trips, and that is exactly a state to stop hammering, not to
# retry every second. The 1800 s poll stays underneath as the net.
COOLDOWN_S="${SKILLS_SNAPSHOT_COOLDOWN:-300}"
FAILMARK="$STAMP.failed"

# (3) RE-ENTRY GUARD. The snapshot itself runs commands and writes files; if this
# hook could observe its own work it would loop. Two independent stops, because
# one of them is an assumption:
#   - PostToolUse fires for calls the MODEL makes, and the snapshot spawned here
#     is a child of the hook, not a tool call -- so it should never come back.
#     That is a claim about the harness, so it is not relied on alone.
#   - This variable is exported into the snapshot, and checked on entry.
[ "${SKILLS_SNAPSHOT_RUNNING:-0}" = "1" ] && exit 0

# (1) THE CHEAP GATE, FIRST, BEFORE ANY PROCESS IS SPAWNED.
# `-print -quit` stops at the first hit; it does not walk the rest of the tree.
# Measured on the live 65-file tree, 5 runs: 0.01-0.02 s, against 1.43-1.62 s for
# a full snapshot cycle. Thousands of Bash calls a day pass through here.
[ -d "$SKILLS_ROOT" ] || exit 0
if [ -f "$STAMP" ]; then
  changed=$(find "$SKILLS_ROOT" -newer "$STAMP" -print -quit 2>/dev/null)
  [ -n "$changed" ] || exit 0
fi

# After a recent failure, stay out of the way until the cooldown expires.
if [ -f "$FAILMARK" ]; then
  now=$(date +%s 2>/dev/null || echo 0)
  last=$(cat "$FAILMARK" 2>/dev/null || echo 0)
  case "$last" in (*[!0-9]*|'') last=0 ;; esac
  [ $((now - last)) -lt "$COOLDOWN_S" ] && exit 0
fi

# THE STAMP IS TAKEN BEFORE THE SNAPSHOT, NOT AFTER, and only promoted on
# success. A write that lands WHILE the snapshot is copying is then still newer
# than the promoted stamp, so the next call picks it up. Stamping afterwards
# would swallow exactly those writes -- the same silent loss this hook exists to
# close, moved inside the fix.
touch "$STAMP.new" 2>/dev/null || exit 0

# (2) FAIL-OPEN AND BOUNDED. A backup mechanism must never stop the work: that is
# a worse outcome than the gap it closes. Every failure path below exits 0.
# A KIMENET A NAPLOBA MEGY, NEM A /dev/null-BA (kartya 5b6a78eb).
# Eddig mindket ag `>/dev/null 2>&1`-gyel indult, tehat AMIT A SZKRIPT MOND -- koztuk az, hogy a
# ZAR megtagadta a futast -- SEHOVA nem jutott el. A `c26193d7` merese ezen bukott el: 0 naplosor,
# es a "nem volt verseny" megkulonboztethetetlen a "volt, es a zar megfogta" esettol.
# Ugyanaz a fajl, amit a launchd egyseg is ir (a plist StandardOut/ErrorPath-ja), tehat a ket hivo
# sorai EGY idorendben allnak -- es a `[hivo]` cimke mondja meg, melyik melyik.
SNAPSHOT_LOG="${SKILLS_SNAPSHOT_LOG:-/Users/isti/marveen/store/rulebook-snapshot.log}"
if command -v timeout >/dev/null 2>&1; then
  SKILLS_SNAPSHOT_RUNNING=1 timeout "$TIMEOUT_S" bash "$SNAPSHOT" >>"$SNAPSHOT_LOG" 2>&1
  rc=$?
else
  # macOS has no coreutils `timeout` by default. Run it in the background and
  # poll, so a hung snapshot cannot hold the tool call open either.
  SKILLS_SNAPSHOT_RUNNING=1 bash "$SNAPSHOT" >>"$SNAPSHOT_LOG" 2>&1 &
  pid=$!
  waited=0
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt "$TIMEOUT_S" ]; do
    sleep 1; waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null; rc=124
  else wait "$pid"; rc=$?; fi
fi

if [ "$rc" -eq 0 ]; then
  mv -f "$STAMP.new" "$STAMP" 2>/dev/null
  rm -f "$FAILMARK" 2>/dev/null
else
  date +%s > "$FAILMARK" 2>/dev/null
  # Leave the OLD stamp in place so the next call retries. Dropping the stamp
  # here would mean the change is never snapshotted and nothing says so.
  rm -f "$STAMP.new" 2>/dev/null
fi
exit 0
