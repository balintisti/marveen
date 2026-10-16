#!/bin/bash
# install-seed-refresh-hook.sh -- a post-merge hook that runs scripts/seed-refresh.sh --apply when a
# merge lands in the MAIN checkout (card 03126955).
#
# WHY: on a host updated by merges into the running tree, update.sh never runs, so neither does its
# seed refresh; a shipped fix to a seeded skill or scheduled task never reached the installed copy
# (measured 2026-10-13: update.sh last ran 2026-08-16). scripts/ and web/ go live on merge; with
# this hook the untouched seeded copies do too. Locally edited copies are never written.
#
# The hook dir is shared by every worktree, so the hook exits unless the merge happened in the main
# checkout. It never fails the merge. Output: the merging terminal and store/seed-refresh.log.
# A post-merge hook that is not ours is left alone, and this says so (exit 1).
set -u

# The repo is the one this script lives in, not the caller's cwd: installed-drift-check.ts runs SAFE
# installers from cwd=/ inside a throwaway repo, and sync-hooks.sh does not pin a cwd either.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_DIR="$(cd "$REPO" && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd)/hooks"
[ -d "$HOOK_DIR" ] || { echo "  ⚠ install-seed-refresh-hook.sh: no git hooks dir here, nothing installed" >&2; exit 1; }
HOOK="$HOOK_DIR/post-merge"
MARK="marveen-seed-refresh"

if [ -f "$HOOK" ] && ! grep -q "$MARK" "$HOOK"; then
  echo "  ⚠ install-seed-refresh-hook.sh: $HOOK exists and is not ours; NOT overwritten. Chain scripts/seed-refresh.sh --apply into it by hand." >&2
  exit 1
fi

cat > "$HOOK.tmp" <<'HOOK'
#!/usr/bin/env bash
# marveen-seed-refresh : refresh the untouched installed copies of shipped skills and scheduled tasks
# after a merge into the main checkout (card 03126955). Managed by
# scripts/install-seed-refresh-hook.sh -- edit there. Never fails the merge.
PROD_ROOT="$(dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd -P)")"
[ "$(git rev-parse --show-toplevel 2>/dev/null)" = "$PROD_ROOT" ] || exit 0
[ -f "$PROD_ROOT/scripts/seed-refresh.sh" ] || exit 0
OUT="$(bash "$PROD_ROOT/scripts/seed-refresh.sh" --apply 2>&1)"; RC=$?
printf '[%s] %s rc=%s\n%s\n' "$(date '+%F %T %Z')" "$(git rev-parse --short HEAD)" "$RC" "$OUT" >> "$PROD_ROOT/store/seed-refresh.log"
printf '%s\n' "$OUT" | sed 's/^/post-merge: /'
[ "$RC" = "0" ] || echo "post-merge: seed-refresh exited $RC -- the installed seeds were NOT refreshed (store/seed-refresh.log)" >&2
exit 0
HOOK
chmod +x "$HOOK.tmp" && mv "$HOOK.tmp" "$HOOK"
echo "  ✓ seed-refresh post-merge hook: $HOOK"
