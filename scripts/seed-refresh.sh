#!/bin/bash
# seed-refresh.sh -- refresh the installed copies of shipped skills and scheduled tasks that nobody
# edited locally, on the path this install is actually updated by (card 03126955).
#
# WHY: update.sh's run_seed_refresh is the only thing that refreshes them, and on a host that is
# updated by merges + build (not by update.sh) it never runs. Measured 2026-10-13 on the reference
# host: update.sh last ran 2026-08-16, AUTO_UPDATE_ENABLED unset, 3 untouched copies stale -- a
# shipped fix to a seeded task reached new installs only.
#
# ONE IMPLEMENTATION: the four functions are sliced out of update.sh at run time (the same slice the
# vitest suite uses, src/__tests__/seed-refresh-untouched-only.test.ts), not copied, so the
# untouched-only rule cannot drift between the two paths.
#
# DRY RUN (default) runs the real function on a COPY of the seeded dirs and lists what differs
# afterwards: the result is measured, not predicted. --apply runs it on the real tree.
#
# Usage: seed-refresh.sh [--apply]
# Exit:  0 done (also when nothing to do), 2 bad usage,
#        3 BLIND: a function is missing from update.sh, or MAIN_AGENT_ID is unset (the scheduled
#          tasks would be skipped silently by run_seed_refresh, so this refuses instead).
# Test seams: SEED_REFRESH_INSTALL_DIR (the install root), HOME (the ~/.claude owner).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${SEED_REFRESH_INSTALL_DIR:-$ROOT}"
APPLY=0
case "${1:-}" in
  "") ;;
  --apply) APPLY=1 ;;
  *) echo "usage: seed-refresh.sh [--apply]" >&2; exit 2 ;;
esac

FUNCS=""
for fn in render_seed_template seed_copy_is_untouched refresh_untouched_seeds run_seed_refresh; do
  body="$(awk -v n="$fn" '$0 ~ "^"n"\\(\\) \\{" {on=1} on {print} on && /^}/ {exit}' "$INSTALL_DIR/update.sh" 2>/dev/null)"
  if [ -z "$body" ] || [ "$(printf '%s\n' "$body" | tail -1)" != "}" ]; then
    echo "seed-refresh: BLIND -- $fn() not found in $INSTALL_DIR/update.sh; nothing checked, nothing written" >&2
    exit 3
  fi
  FUNCS="$FUNCS$body"$'\n'
done

MAIN_AGENT_ID="$(sed -n 's/^MAIN_AGENT_ID=//p' "$INSTALL_DIR/.env" 2>/dev/null | head -1 | tr -d '"')"
if [ -z "$MAIN_AGENT_ID" ]; then
  echo "seed-refresh: BLIND -- MAIN_AGENT_ID is not set in $INSTALL_DIR/.env; the scheduled tasks cannot be rendered, nothing checked, nothing written" >&2
  exit 3
fi

# The seeded copies: every <target>/<name>/<file> that has a source in one of the three trees.
# Same selection as refresh_untouched_seeds (it never adds a dir or a file).
seeded_files() {
  local home="$1" src target name f
  for pair in "seed-skills:skills" "seed-scheduled-tasks:scheduled-tasks" "scheduled-tasks:scheduled-tasks"; do
    src="${pair%%:*}"; target="${pair#*:}"
    for d in "$INSTALL_DIR/$src"/*/; do
      [ -d "$d" ] || continue
      name="$(basename "$d")"
      for f in "$d"*; do
        [ -f "$f" ] || continue
        [ -f "$home/.claude/$target/$name/$(basename "$f")" ] && echo "$target/$name/$(basename "$f")"
      done
    done
  done | sort -u
}

snapshot() {   # "<sha> <rel>" for every seeded copy under $1
  local home="$1" rel
  seeded_files "$home" | while read -r rel; do
    echo "$(shasum -a 256 <"$home/.claude/$rel" | awk '{print $1}') $rel"
  done
}

run_on() {     # run the sliced update.sh code with HOME=$1; prints "<updated> <kept>"
  ( GREEN=""; NC=""; HOME="$1"; MAIN_AGENT_ID="$MAIN_AGENT_ID"
    eval "$FUNCS"
    run_seed_refresh >/dev/null
    echo "$SEED_REFRESH_UPDATED $SEED_REFRESH_KEPT" )
}

if [ "$APPLY" = "1" ]; then
  TARGET_HOME="$HOME"; VERB="REFRESHED"
else
  TARGET_HOME="$(mktemp -d "${TMPDIR:-/private/tmp}/seed-refresh.XXXXXX")"
  trap 'rm -rf "$TARGET_HOME"' EXIT
  seeded_files "$HOME" | while read -r rel; do
    mkdir -p "$TARGET_HOME/.claude/$(dirname "$rel")"
    cp -p "$HOME/.claude/$rel" "$TARGET_HOME/.claude/$rel"
  done
  VERB="WOULD REFRESH"
fi

BEFORE="$(snapshot "$TARGET_HOME")"
COUNTS="$(run_on "$TARGET_HOME")"
AFTER="$(snapshot "$TARGET_HOME")"
CHANGED="$(diff <(printf '%s\n' "$BEFORE") <(printf '%s\n' "$AFTER") | sed -n 's/^> [0-9a-f]* //p')"

[ -n "$CHANGED" ] && printf '%s\n' "$CHANGED" | sed "s/^/$VERB /"
N_CHANGED="$( [ -n "$CHANGED" ] && printf '%s\n' "$CHANGED" | wc -l | tr -d ' ' || echo 0)"
[ "$APPLY" = "1" ] && MODE="applied" || MODE="DRY RUN, nothing written (--apply writes)"
echo "seed-refresh: $MODE -- $(printf '%s\n' "$BEFORE" | grep -c .) seeded copies checked, ${N_CHANGED} $( [ "$APPLY" = "1" ] && echo refreshed || echo 'would refresh'), ${COUNTS#* } keep decisions (a locally edited copy is never overwritten; a dir with two sources counts twice)"
exit 0
