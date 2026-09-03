#!/usr/bin/env bash
# memory-index-margin.sh -- PostToolUse hook: say something BEFORE the shared
# MEMORY.md index crosses a limit, because crossing it is silent on both axes.
#
# WHY (card 5071c32b, measured 2026-09-03). One physical MEMORY.md serves six
# agents through a symlink, and a TRUNCATING loader reads it. Past 200 lines the
# tail is dropped; past 25000 characters it is cut. The agent that saved the
# memory gets NO signal either way -- jarvis measured restored lines sitting at
# positions 201-212, invisible behind the boundary while LOOKING first-class.
#
# That day it failed three separate ways: lost lines, a "fix" that satisfied the
# detector but not reachability, and two rounds of wasted work by two agents.
# marveen reverted the file to a safe value at 13:57. THIRTY-TWO MINUTES LATER it
# was back at 200/200 lines and 24942/25000 characters -- 58 characters of room.
# The revert fixed the VALUE; nothing touched the MECHANISM.
#
# WARN, NEVER REFUSE, and that is marveen's decision with his reason (15:00):
#
#     refuse the INDEX LINE  -> the lesson exists in its file, just not on screen
#     refuse the MEMORY SAVE -> the lesson is NEVER WRITTEN DOWN
#
# The second is worse than losing it, so this side only ever warns. It exits 0
# unconditionally; a memory save must never fail because an index is full.
#
# WHY IT MATCHES Bash TOO, AND NOT JUST Write|Edit -- borrowed from
# skills-snapshot-on-write.sh, which measured that ZERO of 292 skill edits used
# Write/Edit. Both paths are live here: today's memory FILE was written with the
# Write tool while the index LINE was appended with a shell redirect. A matcher
# on either alone is blind to half of it.
#
# WHY IT ASKS THE FILESYSTEM AND NOT THE COMMAND TEXT: same reason as its sibling.
# A command that appends to the index can be written a hundred ways, and a script
# written earlier and run later never mentions the path at all.
set -u

INDEX="${MEMORY_INDEX_PATH:-$HOME/.claude/projects/-Users-isti-marveen/memory/MEMORY.md}"
[ -f "$INDEX" ] || exit 0

# The two ceilings the loader enforces. Characters, not bytes: on Hungarian prose
# the two differ by ~6%, and marveen's 26279 was a BYTE figure that read as
# characters. Both said "over" that time, so the direction held and the unit did
# not -- which is exactly how a wrong unit survives.
LINE_LIMIT="${MEMORY_INDEX_LINE_LIMIT:-200}"
CHAR_LIMIT="${MEMORY_INDEX_CHAR_LIMIT:-25000}"

read -r LINES CHARS <<EOF
$(python3 -c '
import sys, io
p = sys.argv[1]
s = io.open(p, encoding="utf-8", errors="replace").read()
print(s.count("\n"), len(s))
' "$INDEX" 2>/dev/null || echo "")
EOF
# NOT MEASURABLE IS NOT "FINE". Without python3 the character count cannot be
# taken, and a byte count would be a wrong-unit number wearing the right label --
# the mistake this file exists downstream of. Say nothing rather than mislead.
[ -n "${LINES:-}" ] && [ -n "${CHARS:-}" ] || exit 0

# The margin is expressed in ENTRIES, not raw distance, because that is the unit
# the reader is about to spend: measured on the live index, the average entry is
# 123 characters. Two entries of headroom is the point where the NEXT save is
# still safe and the one after may not be.
AVG_ENTRY=123
CHARS_LEFT=$((CHAR_LIMIT - CHARS))
LINES_LEFT=$((LINE_LIMIT - LINES))
[ "$CHARS_LEFT" -lt $((AVG_ENTRY * 2)) ] || [ "$LINES_LEFT" -lt 2 ] || exit 0

# Rate limit: this fires from PostToolUse, so an unthrottled warning would repeat
# on every tool call and be muted within an hour -- the failure mode this page
# records for any guard that is red permanently.
STAMP="${MEMORY_INDEX_STAMP:-$HOME/.claude/.memory-index-margin-stamp}"
NOW=$(date +%s)
if [ -f "$STAMP" ]; then
  LAST=$(cat "$STAMP" 2>/dev/null || echo 0)
  [ $((NOW - LAST)) -ge "${MEMORY_INDEX_WARN_EVERY:-1800}" ] || exit 0
fi
printf '%s\n' "$NOW" > "$STAMP" 2>/dev/null || true

{
  echo "MEMORIA-INDEX: a kozos MEMORY.md a hatarhoz ert -- ${LINES}/${LINE_LIMIT} sor, ${CHARS}/${CHAR_LIMIT} karakter (maradek: ${LINES_LEFT} sor / ${CHARS_LEFT} karakter)."
  echo "  A mentesed NEM allt meg es nem is fog: ez FIGYELMEZTETES. De a betolto CSONKOL, es"
  echo "  a hataron TULI sor ugy nez ki, mintha ott lenne -- csak soha nem toltodik be."
  echo "  NYIRAS ELOTT: PROZAT vagj, \`.md\` HIVATKOZAST SOHA. A leghosszabb sorok azert hosszuak,"
  echo "  mert OSSZEVONTAK, es az extra hivatkozasaik a VEGEN ulnek, ahol egy naiv vagas vag --"
  echo "  e tiz naiv nyirasa NYOLC emleket dobna ki (didi merese). A hivatkozas-halmaz legyen"
  echo "  AZONOS elotte-utana."
} >&2
exit 0
