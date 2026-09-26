#!/usr/bin/env bash
# Card 61648d4b: two installers wrote the SAME hook file with different bodies.
#   install-git-guard-hook.sh      -> 23 lines, protects main/master only
#   install-no-force-push-hook.sh  -> 66 lines, also the branch the main worktree sits on
# The update path (sync-hooks.sh, glob order) let the right one win by alphabet; a manual run of
# git-guard -- which docs/security-hardening.md invites -- wrote the short body back and dropped
# the deploy-branch protection. Reproduced in a throwaway repo before the fix (66 -> 23 lines).
# Each case runs in its OWN throwaway git repo; nothing touches the real .git/hooks.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$(cd "$HERE/.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  OK    $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

mkrepo() { # name, installers...
  local r="$T/$1"; shift
  git init -q "$r" && mkdir -p "$r/scripts"
  for i in "$@"; do cp "$SCRIPTS/$i" "$r/scripts/"; done
  echo "$r"
}
guard() { echo "$1/.git/hooks/pre-push.d/10-no-force-push-protected"; }

# Reference: the full body, as the fuller installer writes it on its own.
REF="$(mkrepo ref install-no-force-push-hook.sh)"
( cd "$REF" && bash scripts/install-no-force-push-hook.sh >/dev/null 2>&1 )
[ -s "$(guard "$REF")" ] && ok "control: the reference guard exists" || bad "control: the reference guard was not written"
grep -q DEPLOY_REF "$(guard "$REF")" && ok "control: the reference carries the deploy-branch protection" \
  || bad "control: the reference lacks DEPLOY_REF -- the fixture is wrong, not the fix"

# 1. The reported path: the fuller installer, then a MANUAL git-guard run.
R1="$(mkrepo manual install-git-guard-hook.sh install-no-force-push-hook.sh)"
( cd "$R1" && bash scripts/install-no-force-push-hook.sh >/dev/null 2>&1 && bash scripts/install-git-guard-hook.sh >/dev/null 2>&1 )
cmp -s "$(guard "$REF")" "$(guard "$R1")" && ok "1. a manual git-guard run keeps the full guard" \
  || bad "1. a manual git-guard run overwrote the full guard ($(wc -l < "$(guard "$R1")") lines)"

# 2. git-guard alone, with the fuller installer next to it.
R2="$(mkrepo alone install-git-guard-hook.sh install-no-force-push-hook.sh)"
( cd "$R2" && bash scripts/install-git-guard-hook.sh >/dev/null 2>&1 )
cmp -s "$(guard "$REF")" "$(guard "$R2")" && ok "2. git-guard alone writes the full guard" \
  || bad "2. git-guard alone wrote a different guard"

# 3. An install WITHOUT the fuller installer keeps git-guard's own body (the fallback works).
R3="$(mkrepo upstream-only install-git-guard-hook.sh)"
( cd "$R3" && bash scripts/install-git-guard-hook.sh >/dev/null 2>&1 )
if [ -s "$(guard "$R3")" ] && ! grep -q DEPLOY_REF "$(guard "$R3")"; then
  ok "3. without the fuller installer, git-guard still writes its own guard"
else
  bad "3. the upstream-only fallback is broken"
fi

# 4. Update order (glob: git-guard before no-force-push) ends on the full guard too.
R4="$(mkrepo update install-git-guard-hook.sh install-no-force-push-hook.sh)"
( cd "$R4" && for i in scripts/install-*-hook.sh; do bash "$i" >/dev/null 2>&1; done )
cmp -s "$(guard "$REF")" "$(guard "$R4")" && ok "4. the update order ends on the full guard" \
  || bad "4. the update order ends on a different guard"

echo "Results: $PASS/$((PASS+FAIL)) passed"
[ "$FAIL" -eq 0 ] && echo "All tests passed." || exit 1
