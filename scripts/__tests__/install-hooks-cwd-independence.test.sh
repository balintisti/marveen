#!/bin/bash
# Card 2b07f542: a hook installer must work from ANY cwd, not just the repo root.
#
# THE DEFECT, reproduced 2026-09-11: `git rev-parse --git-common-dir` returns a
# RELATIVE path (".git") from the main checkout and an ABSOLUTE one from a linked
# worktree, and git resolves the relative form against ITS OWN cwd. So
#     cd "$(git -C "$ROOT" rev-parse --git-common-dir)"
# asks git to resolve against $ROOT and then cd's in the CALLER's cwd -- two
# different anchors. From anywhere but $ROOT it dies with
#     cd: .git: Not a directory
# and sync-hooks.sh swallows the non-zero exit with a warning, so the install is
# simply absent. Three installers carried it (git-guard, prod-tree-guard,
# secret-gate); install-no-force-push-hook.sh did not, and grep alone could not
# tell them apart -- it matches the text in all four. Only running them did.
#
# WHY THIS TEST IS CLASS-LEVEL AND NOT THREE PER-INSTALLER CASES: each of those
# installers was written with its own guard, and the set grew one guard per task
# and never once grew a guard for the CLASS -- so a new installer would arrive
# with the same bug and every existing test would stay green. The static check
# below covers every install-*-hook.sh that exists now OR LATER.
#
# Run: bash scripts/__tests__/install-hooks-cwd-independence.test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   -- $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL -- $1"; }

# The mismatched-anchor shape: git told to use one cwd, cd using another.
BAD_SHAPE='cd "\$\(git -C [^)]*--git-common-dir\)"'

# ---- 0. POSITIVE CONTROL: the detector must be able to say YES ---------------
#      Without this the static sweep below is a tautology that cannot fail.
CTL="$(mktemp)"
printf '%s\n' 'HOOK_DIR="$(cd "$(git -C "$ROOT" rev-parse --git-common-dir)" && pwd)/hooks"' > "$CTL"
if grep -qE "$BAD_SHAPE" "$CTL"; then ok "detector flags the known-bad shape (positive control)"
else bad "detector CANNOT flag the known-bad shape -- the sweep below proves nothing"; fi
# ...and must NOT flag either accepted idiom (negative control), or it would
# force one style and reject the other correct fix already in the tree.
CTL2="$(mktemp)"
{ printf '%s\n' 'HOOK_DIR="$(cd "$ROOT" && cd "$(git rev-parse --git-common-dir)" && pwd)/hooks"'
  printf '%s\n' 'COMMON="$(git -C "$ROOT" rev-parse --git-common-dir)"'
  printf '%s\n' 'case "$COMMON" in /*) ;; *) COMMON="$ROOT/$COMMON" ;; esac'; } > "$CTL2"
if grep -qE "$BAD_SHAPE" "$CTL2"; then bad "detector flags a CORRECT idiom (false positive)"
else ok "detector accepts both correct idioms (negative control)"; fi
rm -f "$CTL" "$CTL2"

# ---- 1. STATIC SWEEP over every installer, present and future ---------------
OFFENDERS=""
for f in "$ROOT"/scripts/install-*-hook.sh; do
  [ -e "$f" ] || continue
  grep -qE "$BAD_SHAPE" "$f" && OFFENDERS="$OFFENDERS $(basename "$f")"
done
N=0; for f in "$ROOT"/scripts/install-*-hook.sh; do [ -e "$f" ] && N=$((N+1)); done
if [ "$N" -gt 0 ]; then ok "swept $N installer(s) -- a silent zero would mean the glob broke"
else bad "swept ZERO installers: the glob is wrong, not the tree clean"; fi
if [ -z "$OFFENDERS" ]; then ok "no installer cd's into an unanchored --git-common-dir"
else bad "mismatched anchor in:$OFFENDERS"; fi

# ---- 2. BEHAVIOURAL: actually run them from a foreign cwd -------------------
# ONLY the installers whose entire effect is inside the target repo's .git/hooks.
# install-telegram-progress-hook.sh and friends call launchctl into the real
# gui/501 domain -- running those from a test registers units on the developer's
# machine (measured 2026-09-05, and I repeated it by accident on 2026-09-11).
# They are excluded BY NAME, deliberately, not by a pattern that could drift.
SAFE="install-git-guard-hook.sh install-prod-tree-guard-hook.sh install-secret-gate-hook.sh
      install-no-force-push-hook.sh install-backup-gate-hook.sh"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# EACH INSTALLER GETS ITS OWN FRESH REPO. Run in sequence into one repo, they mask
# each other: git-guard installs the same pre-push chain no-force-push owns, so by
# no-force-push's turn there is nothing NEW to create and a file-count assertion
# calls a correct, idempotent installer broken. Measured -- this test reported
# exactly that false failure before the split. (Same shape as the two guards that
# masked each other in install-backup-gate-hook.test.sh: when subjects share a
# side effect, only isolation makes the count mean anything.)
i=0
for s in $SAFE; do
  [ -f "$ROOT/scripts/$s" ] || continue
  i=$((i+1))
  REPO="$TMP/repo$i"; mkdir -p "$REPO/scripts/hooks" "$REPO/store"
  cp "$ROOT/scripts/$s" "$REPO/scripts/"
  cp "$ROOT/scripts/pre-modify-backup.sh" "$REPO/scripts/" 2>/dev/null
  cp -R "$ROOT/scripts/hooks/." "$REPO/scripts/hooks/" 2>/dev/null
  git -C "$REPO" init -q
  git -C "$REPO" config user.email t@t; git -C "$REPO" config user.name t
  printf 'store/\n' > "$REPO/.gitignore"
  git -C "$REPO" add -A >/dev/null 2>&1; git -C "$REPO" commit -qm init >/dev/null 2>&1

  BEFORE="$(find "$REPO/.git/hooks" -type f ! -name '*.sample' 2>/dev/null | wc -l | tr -d ' ')"
  ( cd / && bash "$REPO/scripts/$s" >/dev/null 2>&1 ); RC=$?
  AFTER="$(find "$REPO/.git/hooks" -type f ! -name '*.sample' 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$RC" -eq 0 ] && [ "$AFTER" -gt "$BEFORE" ]; then
    ok "$s runs from a foreign cwd AND installs ($BEFORE -> $AFTER)"
  elif [ "$RC" -ne 0 ]; then
    bad "$s exits $RC from a foreign cwd"
  else
    bad "$s exits 0 from a foreign cwd but installed nothing ($BEFORE -> $AFTER)"
  fi
done

echo
echo "install-hooks-cwd-independence: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
