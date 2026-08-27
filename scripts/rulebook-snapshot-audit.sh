#!/usr/bin/env bash
# rulebook-snapshot-audit.sh -- find snapshot commits whose store is TRUNCATED.
#
# WHY A SEPARATE, SELF-CHECKING DETECTOR (didi, card c26193d7, 2026-08-27).
# rulebook-snapshot.sh now compares its own source count with what it staged, so
# a truncated commit cannot be written silently any more. That check runs INSIDE
# the run and can only defend the future. This one asks a question the commit
# answers ENTIRELY BY ITSELF:
#
#     the MANIFEST.tsv line count   vs   the number of files under store/
#     -- in the same commit, with no reference to any live source
#
# so it works on history that was written before the fix existed, and it does not
# have to trust the run that produced the commit.
#
# WHY THE TWO CAN DISAGREE AT ALL, and why the existing deletion guard could not
# see it: the manifest is written AFTER the copy loop. A second instance that
# reached `git add -A` mid-copy therefore captured a COMPLETE manifest beside a
# HALF-FILLED store. The next run's guard compares that complete manifest against
# the source, finds everything present, and reports green. The guard is not
# written wrongly -- its INPUT lies to it.
#
# READ-ONLY. It runs `git ls-tree` and `git show` and nothing else; it never
# checks anything out and never writes to the repository.
#
# `-- store` IS LOAD-BEARING, and it is a measured defect fix. Counting the WHOLE
# tree makes every healthy commit look wrong: MANIFEST.tsv sits in the repo root,
# so the full tree is ALWAYS manifest+1. Measured on six intact commits: 6/6
# would have alerted. A checker that flags the correct state is worse than none.
set -euo pipefail

REPO="${RULEBOOK_REPO:-/Users/isti/Backups/rulebooks}"
LIMIT="${1:-0}"          # 0 = the whole history

[ -d "$REPO/.git" ] || { printf 'nincs git repo: %s\n' "$REPO" >&2; exit 2; }

if [ "$LIMIT" -gt 0 ] 2>/dev/null; then
  shas=$(git -C "$REPO" rev-list -n "$LIMIT" HEAD)
else
  shas=$(git -C "$REPO" rev-list HEAD)
fi

total=0; bad=0
for sha in $shas; do
  # A commit from before the manifest existed cannot be judged: skipped, and
  # counted out of the population rather than silently passed.
  man=$(git -C "$REPO" show "$sha:MANIFEST.tsv" 2>/dev/null) || continue
  total=$((total + 1))
  m=$(printf '%s\n' "$man" | grep -c . || true)
  s=$(git -C "$REPO" ls-tree -r --name-only "$sha" -- store | grep -c . || true)
  if [ "$m" -ne "$s" ]; then
    bad=$((bad + 1))
    printf 'CSONKA %s  manifest=%s  store=%s  %s\n' \
      "$(printf '%s' "$sha" | cut -c1-7)" "$m" "$s" "$(git -C "$REPO" log -1 --format='%s | %ci' "$sha")"
  fi
done

printf 'megvizsgalva: %s commit (manifesttel), csonka: %s\n' "$total" "$bad"
[ "$bad" -eq 0 ]
