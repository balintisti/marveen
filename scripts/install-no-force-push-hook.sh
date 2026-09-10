#!/usr/bin/env bash
# Idempotent installer: reject a NON-FAST-FORWARD push to a protected branch.
# Auto-run by scripts/sync-hooks.sh, so a re-clone or a new host regains the
# guard instead of silently losing it.
#
# WHY THIS FILE EXISTS AT ALL (card f2b369ff, measured 2026-09-10 19:5x).
# The guard itself was already running -- and it existed on ONE DISK. The
# hook body sat in .git/hooks/pre-push.d/ since 2026-08-27 with NO tracked
# source: `git ls-files | grep no-force-push` returned nothing. That is the
# state this repo's own rulebook calls the fifth one -- live, running, and
# unrecoverable: a `git clean -fd`, a fresh clone or a new machine takes the
# ONLY real force-push protection with it, silently, while every card still
# reads as if the fleet were protected.
#
# WHY THE HOOK AND NOT THE DENY-LIST (the card's own point 3, now measured).
# The Claude Code deny list matches the COMMAND TEXT, prefix-anchored on the
# token sequence. Measured with inert probes (`--help`, no remote contact):
#
#   git push --force --help ................. DENIED
#   git push --force-with-lease --help ...... RAN     <- the card's finding
#   git push --force-if-includes --help ..... RAN
#   git push origin +main --help ............ RAN     (`+` IS the force refspec)
#   git push --repo=origin --force --help ... RAN     <- bypasses the EXISTING rule
#
# The last one is the argument: any token inserted before `--force` walks past
# a text rule, so no deny list can be completed -- it can only be improved.
# This hook reads the ACTUAL refs git is about to push and compares SHAs, so it
# is FLAG-INDEPENDENT: `--force`, `--force-with-lease`, `+main` and a rewritten
# `--repo=` ordering all arrive at the same non-fast-forward test.
#
# SCOPE, stated because the guard's silence is otherwise read as coverage:
#   - protected refs are `main` and `master` ONLY; a force-push to develop or
#     to a feature branch passes on purpose (that is where rebases live),
#   - it guards THIS repository; another checkout needs its own install,
#   - the override is deliberate and loud: ALLOW_FORCE_PUSH=1 git push ...
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# A `--git-common-dir` RELATIV utat ad, ha a repobol kerdezik (`.git`), es abszolutat
# egy linkelt worktreebol. A `cd` a HIVO konyvtarabol indulna, tehat a relativ alak
# csak akkor mukodik, ha epp a gyokerben allunk -- a `sync-hooks.sh` viszont barhonnan
# hivhat. Merve 2026-09-10: scratch repoban `cd: .git: Not a directory`, es a telepites
# CSENDBEN elmaradt volna, ha a teszt nem a hook LETET allitja.
COMMON="$(git -C "$ROOT" rev-parse --git-common-dir)"
case "$COMMON" in /*) ;; *) COMMON="$ROOT/$COMMON" ;; esac
HOOK_DIR="$(cd "$COMMON" && pwd)/hooks"
DISPATCH="$HOOK_DIR/pre-push"
GUARD="$HOOK_DIR/pre-push.d/10-no-force-push-protected"
DISPATCH_MARK="marveen-pre-push-dispatcher"
mkdir -p "$HOOK_DIR/pre-push.d"

# A pre-push file is OURS if it carries the dispatcher marker. Anything else is
# FOREIGN and gets PRESERVED as a chain entry, never deleted: a wrongly kept
# duplicate is recoverable, a wrongly deleted foreign hook is not. (Same rule
# and same reasoning as install-prod-tree-guard-hook.sh.)
if [ -f "$DISPATCH" ] && ! grep -qF "$DISPATCH_MARK" "$DISPATCH" 2>/dev/null; then
  mv "$DISPATCH" "$HOOK_DIR/pre-push.d/00-preexisting-local"
  chmod +x "$HOOK_DIR/pre-push.d/00-preexisting-local"
  echo "  (preserved a pre-existing pre-push hook as pre-push.d/00-preexisting-local)"
fi

if [ ! -f "$DISPATCH" ]; then
  cat > "$DISPATCH" <<'EOF'
#!/usr/bin/env bash
# marveen-pre-push-dispatcher : run every executable in pre-push.d/, passing the ref list to each.
set -euo pipefail
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
payload="$(cat)"
status=0
for h in "$HOOK_DIR"/pre-push.d/*; do
  [ -x "$h" ] || continue
  printf '%s\n' "$payload" | "$h" "$@" || status=1
done
exit $status
EOF
  chmod +x "$DISPATCH"
  echo "  (installed pre-push dispatcher)"
fi

cat > "$GUARD" <<'EOF'
#!/usr/bin/env bash
# Reject a non-fast-forward (force / rebase / amend) push to a protected branch.
# A normal fast-forward or merge keeps the remote tip as an ancestor of the
# local tip; a rewrite does not. Override: ALLOW_FORCE_PUSH=1 git push ...
#
# FLAG-INDEPENDENT ON PURPOSE: it never looks at the command line, so
# --force-with-lease and a `+main` refspec are caught exactly like --force.
#
# PROTECTED: `main`, `master`, and the branch the MAIN WORKTREE currently sits
# on -- the latter DERIVED, never named (card 33b40c03, measured 2026-09-10).
# This repo's list guarded two refs that DO NOT MOVE: main's last commit is
# 2026-08-11 and master does not exist locally, while the branch the running
# system is BUILT FROM stood 801 commits ahead of fork/develop and is actively
# pushed. A name list also cannot be finished, only extended -- the deploy
# branch's NAME changes -- which is the same family as the text-matching deny
# list this hook exists to replace.
#
# WHY NOT `git rev-parse --abbrev-ref HEAD`: .git/hooks is SHARED with linked
# worktrees, and this hook runs with the PUSHING worktree's cwd (measured with
# a real push against a local bare remote). From an agent's worktree that
# expression yields the AGENT'S OWN branch, so the naive form would block the
# feature-branch rewrites we deliberately allow AND leave the deploy branch
# open -- while looking correct in the main checkout, which is where anyone
# would test it.
#
# WHY `cd`+`pwd` AND NOT AN ANCHOR: `--git-common-dir` is relative from the main
# checkout and absolute from a linked worktree. Measured 2026-09-10: the
# relative form is relative to the CWD, not to the repo root -- from a
# subdirectory it is `../.git`, so resolving it against `--show-toplevel` gives
# `<root>/../.git`, which does not exist. `cd`+`pwd` needs no anchor at all.
set -euo pipefail
ZERO="0000000000000000000000000000000000000000"

DEPLOY_REF=""
if COMMON="$(git rev-parse --git-common-dir 2>/dev/null)" \
   && COMMON="$(cd "$COMMON" 2>/dev/null && pwd)" \
   && [ -r "$COMMON/HEAD" ]; then
  # `ref: refs/heads/<branch>` -> `refs/heads/<branch>`; a DETACHED main worktree
  # holds a bare SHA, so this yields the empty string and nothing extra is guarded.
  DEPLOY_REF="$(sed -n 's|^ref: ||p' "$COMMON/HEAD" || true)"
fi

fail=0
while read -r local_ref local_sha remote_ref remote_sha; do
  [ "$local_sha" = "$ZERO" ] && continue            # branch deletion
  case "$remote_ref" in
    refs/heads/main|refs/heads/master) ;;
    *)
      if [ -z "$DEPLOY_REF" ] || [ "$remote_ref" != "$DEPLOY_REF" ]; then continue; fi
      ;;
  esac
  [ "$remote_sha" = "$ZERO" ] && continue           # brand-new branch
  if ! git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
    if [ "${ALLOW_FORCE_PUSH:-0}" = "1" ]; then
      echo "pre-push: ALLOW_FORCE_PUSH=1 set; permitting force-push to ${remote_ref#refs/heads/}." >&2
    else
      why="protected branch"
      [ "$remote_ref" = "$DEPLOY_REF" ] && why="the branch this installation is BUILT FROM"
      echo "" >&2
      echo "BLOCKED: non-fast-forward (force) push to ${remote_ref#refs/heads/} ($why)." >&2
      echo "This rewrites shared history. If truly intended: ALLOW_FORCE_PUSH=1 git push ..." >&2
      fail=1
    fi
  fi
done
exit $fail
EOF
chmod +x "$GUARD"
echo "✓ no-force-push guard installed: ${GUARD#$HOOK_DIR/}"
