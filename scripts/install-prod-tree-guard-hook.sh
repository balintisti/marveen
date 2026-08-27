#!/usr/bin/env bash
# Idempotent installer: protect the MAIN checkout (the tree the dashboard
# serves static files from and host updates pull into) against branch-ops.
# Auto-run by scripts/sync-hooks.sh on every update, so a re-clone or a new
# host regains the guard on its first update instead of silently losing it
# (PRODFAAG822 / RESPAWNZAJ822, 2026-08-22: a context-less resumed session
# branch-switched and committed on the live prod tree).
#
# Two git hooks, both scoped to the MAIN worktree only (linked worktrees have
# a different toplevel and pass untouched):
#   pre-commit.d/05-prod-tree-guard -- BLOCKS a commit on the main checkout.
#                    Override: MARVEEN_PROD_COMMIT_OK=1 git commit ...
#                    Installed as a CHAIN ENTRY, not as the pre-commit file:
#                    the secret gate (install-secret-gate-hook.sh) shares the
#                    same pre-commit.d dispatcher, and a monolithic pre-commit
#                    would couple the end state to installer ORDER -- run
#                    second, it would demote the other guard's runner to a
#                    .bak and silently disable it (review finding, msg 14196).
#   post-checkout -- git has no pre-checkout, so a branch switch cannot be
#                    blocked; this ALERTS the main agent and, when the tracked
#                    tree is clean, auto-reverts to the default branch.
#                    Override: MARVEEN_PROD_CHECKOUT_OK=1 git checkout ...
#
# No operator-specific paths are baked in: the guarded root is derived from
# the repository itself (the main worktree of the .git the hook lives in), so
# the same guard ships to every deployment.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_DIR="$(cd "$(git -C "$ROOT" rev-parse --git-common-dir)" && pwd)/hooks"
DISPATCH="$HOOK_DIR/pre-commit"
GUARD="$HOOK_DIR/pre-commit.d/05-prod-tree-guard"
DISPATCH_MARK="marveen-pre-commit-dispatcher"
MARK="marveen-prod-tree-guard"
mkdir -p "$HOOK_DIR/pre-commit.d"

# A hook file is OURS (a superseded hand-install or an earlier version of this
# installer) if it carries the marker OR a full sentence of OUR OWN prose.
# Content matters, not just the marker: the 2026-08-22 hand-installed host
# files PREDATE the marker convention this PR introduced (review, msg 14200).
# But the recognition is deliberately NARROW: never match the override/alert
# TOKENS (MARVEEN_PROD_COMMIT_OK etc.) -- those are published in our own
# error messages, so a foreign hook whose comment merely mentions the bypass
# would match and be deleted without trace (review, msg 14204; measured with
# a foreign lint-hook). On any doubt the default is PRESERVATION: a wrongly
# preserved duplicate is recoverable, a wrongly deleted foreign hook is not.
is_ours_precommit() {
  grep -qF 'marveen-prod-tree-guard' "$1" 2>/dev/null ||
  grep -qF 'BLOCKED: commit on the running prod checkout' "$1" 2>/dev/null
}
is_ours_postcheckout() {
  grep -qF 'marveen-prod-tree-guard' "$1" 2>/dev/null ||
  grep -qF 'Loud (non-blocking) alert when the running prod checkout switches branches' "$1" 2>/dev/null
}

# 0. A superseded MONOLITHIC prod-guard pre-commit is OURS: remove it instead
#    of preserving it, or it would ride along in the chain as a duplicate.
if [ -f "$DISPATCH" ] && is_ours_precommit "$DISPATCH" && ! grep -q "$DISPATCH_MARK" "$DISPATCH" 2>/dev/null; then
  rm "$DISPATCH"
  echo "  (removed superseded monolithic prod-guard pre-commit)"
fi

# 1. The sub-hook: block commits on the main checkout.
cat > "$GUARD" <<'EOF'
#!/usr/bin/env bash
# marveen-prod-tree-guard : block commits on the main (prod) checkout.
# The dashboard serves static files from this tree and host updates pull into
# it; repo work belongs in a worktree. Managed by
# scripts/install-prod-tree-guard-hook.sh -- edit there, not here.
# Deliberate override: MARVEEN_PROD_COMMIT_OK=1 git commit ...
set -euo pipefail
PROD_ROOT="${MARVEEN_PROD_ROOT:-$(dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd)")}"
TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null || echo)"
if [ "$TOPLEVEL" = "$PROD_ROOT" ] && [ "${MARVEEN_PROD_COMMIT_OK:-0}" != "1" ]; then
  echo "" >&2
  echo "BLOCKED: commit on the running main checkout ($PROD_ROOT)." >&2
  echo "The dashboard serves static files from this tree and host updates pull into it." >&2
  echo "Work in a worktree instead:" >&2
  # A SHA-t adjuk meg, NEM az `origin/develop`-ot. Merve 2026-08-27 (friday, a sajat
  # again, push kozben): a `-b <ag> origin/develop` alak EGYUTT beallitja az
  # `origin` upstreamet -- es ebben a repoban az `origin` a Szotasz/marveen, egy
  # IDEGEN NYILVANOS PROJEKT. A dokumentalt biztonsagos szokas termelte a hibas
  # konfiguraciot. Ot aznap NEM a figyelme vedte meg, hanem a `push.default=simple`,
  # ami az ag-nev elteresen akadt fel; `develop` neven atment volna.
  # A SHA-s alak egyaltalan nem allit upstreamet, tehat a csapda nem keletkezik.
  echo "  git worktree add ../$(basename "$PROD_ROOT")-wt-<topic> -b <branch> \$(git rev-parse HEAD)" >&2
  echo "  (SHA-val, NEM origin/develop-pal: az idegen upstreamet allitana be -- lasd CLAUDE.md)" >&2
  echo "Deliberate override: MARVEEN_PROD_COMMIT_OK=1 git commit ..." >&2
  exit 1
fi

# THE OVERRIDE LEAVES A TRACE (card e81f0a5e, 2026-08-27). Until today the
# bypass was an environment variable: no log, no trailer, nothing in git. The
# question "how many commits went round this guard, and touching what?" had no
# answer -- two agents counted two and three on the same day, and only from
# their own session notes, which cannot be re-read a week later.
#
# The log records the INTENT: it is written here, in pre-commit, so an override
# that is later aborted (empty commit, failed later hook, ctrl-C) still shows
# up. The commit TRAILER records the outcome and is the durable half -- this
# log lives under store/ and a `git clean -fdx` takes it.
if [ "$TOPLEVEL" = "$PROD_ROOT" ] && [ "${MARVEEN_PROD_COMMIT_OK:-0}" = "1" ]; then
  _log="$PROD_ROOT/store/prod-tree-override.log"
  _branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  _files="$(git diff --cached --name-only 2>/dev/null | tr '\n' ' ')"
  _n="$(git diff --cached --name-only 2>/dev/null | grep -c . || true)"
  mkdir -p "$(dirname "$_log")" 2>/dev/null || true
  printf '%s\tbranch=%s\tfiles=%s\treason=%s\tpaths=%s\n' \
    "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$_branch" "${_n:-0}" \
    "${MARVEEN_PROD_COMMIT_REASON:-(nincs indok)}" "$_files" >> "$_log" 2>/dev/null || true
  # AND SAY SO OUT LOUD. A bypass that is silent for the person doing it is how
  # the third one happens by reflex.
  echo "prod-tree-guard: MEGKERULVE (${_n:-0} fajl, ag $_branch) -- naplozva: $_log" >&2
  [ -n "${MARVEEN_PROD_COMMIT_REASON:-}" ] || \
    echo "  indok nelkul; add meg: MARVEEN_PROD_COMMIT_REASON='miert' MARVEEN_PROD_COMMIT_OK=1 git commit ..." >&2
fi
exit 0
EOF
chmod +x "$GUARD"

# 1b. THE COMMIT TRAILER -- the durable half of the trace (card e81f0a5e).
# The log above records intent and lives under store/, which a `git clean -fdx`
# removes. A trailer is in the commit object itself: it survives clones, clean
# checkouts and a new machine, and `git log --grep` can count it a year later.
#
# WHY prepare-commit-msg AND NOT pre-commit: a pre-commit hook cannot touch the
# message -- it runs before there is one. This is the only hook that can, and it
# sees the message file for `-m`, `-F` and the editor alike.
#
# WHY A CHAIN and not a single file, when today there is exactly one consumer:
# the same reason spelled out for pre-commit above. A monolithic hook couples
# the end state to installer ORDER, and the next installer to arrive would
# demote this one to a .bak without a word.
PREPARE_DISPATCH="$HOOK_DIR/prepare-commit-msg"
PREPARE_MARK="marveen-prepare-commit-msg-dispatcher"
mkdir -p "$HOOK_DIR/prepare-commit-msg.d"
cat > "$HOOK_DIR/prepare-commit-msg.d/05-prod-tree-override-trailer" <<'EOF'
#!/usr/bin/env bash
# marveen-prod-tree-guard : record a deliberate prod-tree override IN THE COMMIT.
# Managed by scripts/install-prod-tree-guard-hook.sh -- edit there, not here.
set -uo pipefail
MSG_FILE="${1:-}"
[ -n "$MSG_FILE" ] && [ -f "$MSG_FILE" ] || exit 0
[ "${MARVEEN_PROD_COMMIT_OK:-0}" = "1" ] || exit 0
PROD_ROOT="${MARVEEN_PROD_ROOT:-$(dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd)")}"
[ "$(git rev-parse --show-toplevel 2>/dev/null || echo)" = "$PROD_ROOT" ] || exit 0
# Idempotent: an --amend must not stack a second trailer. MEASURED consequence,
# so nobody reads it later as a bug: an amend carrying a DIFFERENT reason keeps
# the FIRST one in the trailer (1 -> 1, verified). Nothing is lost -- the log
# records every attempt separately, including the amend's own reason.
grep -q '^Prod-tree-guard-override:' "$MSG_FILE" 2>/dev/null && exit 0
printf '\nProd-tree-guard-override: %s\n' "${MARVEEN_PROD_COMMIT_REASON:-(nincs indok)}" >> "$MSG_FILE"
exit 0
EOF
chmod +x "$HOOK_DIR/prepare-commit-msg.d/05-prod-tree-override-trailer"

# Preserve a foreign prepare-commit-msg by demoting it INTO the chain, exactly
# as the pre-commit installer does -- never delete what we did not write.
if [ -f "$PREPARE_DISPATCH" ] && ! grep -q "$PREPARE_MARK" "$PREPARE_DISPATCH" 2>/dev/null; then
  mv "$PREPARE_DISPATCH" "$HOOK_DIR/prepare-commit-msg.d/00-existing-prepare-commit-msg"
  chmod +x "$HOOK_DIR/prepare-commit-msg.d/00-existing-prepare-commit-msg"
  echo "  (preserved an existing prepare-commit-msg as a chain entry)"
fi
if [ ! -f "$PREPARE_DISPATCH" ] || ! grep -q "$PREPARE_MARK" "$PREPARE_DISPATCH" 2>/dev/null; then
  cat > "$PREPARE_DISPATCH" <<'EOF'
#!/usr/bin/env bash
# marveen-prepare-commit-msg-dispatcher : run every executable in prepare-commit-msg.d/.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
status=0
for h in "$HOOK_DIR"/prepare-commit-msg.d/*; do
  [ -x "$h" ] || continue
  "$h" "$@" || status=1
done
exit $status
EOF
  chmod +x "$PREPARE_DISPATCH"
fi

# 2. Dispatcher: byte-for-byte the same contract as install-secret-gate-hook.sh
#    (same marker), so whichever installer runs first creates it and the other
#    leaves it alone -- no ordering dependency between the two guards.
if [ -f "$DISPATCH" ] && ! grep -q "$DISPATCH_MARK" "$DISPATCH" 2>/dev/null; then
  mv "$DISPATCH" "$HOOK_DIR/pre-commit.d/00-existing-precommit"
  chmod +x "$HOOK_DIR/pre-commit.d/00-existing-precommit"
  echo "  (preserved existing pre-commit as pre-commit.d/00-existing-precommit)"
fi
cat > "$DISPATCH" <<EOF
#!/usr/bin/env bash
# $DISPATCH_MARK : run every executable in pre-commit.d/.
set -euo pipefail
HOOK_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
status=0
for h in "\$HOOK_DIR"/pre-commit.d/*; do
  [ -x "\$h" ] || continue
  "\$h" "\$@" || status=1
done
exit \$status
EOF
chmod +x "$DISPATCH"

# 3. post-checkout: no chain exists for this hook type; a pre-existing foreign
#    hook is preserved out of the way (a guard must not clobber, and the .bak
#    is inspectable). Our own superseded copy (marker OR content match, see
#    is_ours_postcheckout) is simply replaced -- backing up our own old file
#    would recreate the misleading-.bak class on this hook (review, msg 14200).
if [ -f "$HOOK_DIR/post-checkout" ] && ! is_ours_postcheckout "$HOOK_DIR/post-checkout"; then
  mv "$HOOK_DIR/post-checkout" "$HOOK_DIR/post-checkout.pre-prod-guard.bak"
  echo "  (preserved existing post-checkout as post-checkout.pre-prod-guard.bak)"
fi
cat > "$HOOK_DIR/post-checkout" <<'EOF'
#!/usr/bin/env bash
# marveen-prod-tree-guard : loud (non-blocking) alert + clean-tree auto-revert
# when the main (prod) checkout switches branches. Git has no pre-checkout
# hook, so the switch itself cannot be blocked -- but it must not sit silent
# either (PRODFAAG822: the 10:10 switch was found only on the next manual
# look). Managed by scripts/install-prod-tree-guard-hook.sh -- edit there.
# Deliberate switch: MARVEEN_PROD_CHECKOUT_OK=1 git checkout ...
# Never fails the checkout itself (no set -e; every step is best-effort).
[ "${3:-0}" = "1" ] || exit 0   # flag=1 -> branch switch; file checkouts exit here
PROD_ROOT="${MARVEEN_PROD_ROOT:-$(dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd)")}"
TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null || echo)"
[ "$TOPLEVEL" = "$PROD_ROOT" ] || exit 0
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ismeretlen)"
case "$BRANCH" in develop|main|master) exit 0 ;; esac
[ "${MARVEEN_PROD_CHECKOUT_OK:-0}" = "1" ] && exit 0
# Revert target: the deployment's default branch, derived, not assumed.
HOME_BRANCH=""
for b in develop main master; do
  if git show-ref --verify --quiet "refs/heads/$b"; then HOME_BRANCH="$b"; break; fi
done
# Auto-revert only when the TRACKED tree is clean: a guard must never lose
# work. Untracked files deliberately do not count (--untracked-files=no): a
# branch switch never touches them, and on a live tree untracked host-local
# files are the steady state -- counting them would make this revert never
# fire (measured 2026-08-22). Recursion is self-limiting: the revert lands on
# the home branch, where this hook exits at the case-guard above.
REVERTED="nem"
if [ -z "$HOME_BRANCH" ]; then
  REVERTED="nem (nincs develop/main/master ag)"
elif [ -z "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  if git checkout "$HOME_BRANCH" -q 2>/dev/null; then
    REVERTED="igen ($HOME_BRANCH)"
  else
    REVERTED="nem sikerult (checkout $HOME_BRANCH hibazott)"
  fi
else
  REVERTED="nem (a fa DIRTY, kezi beavatkozas kell)"
fi
TOKEN_FILE="$PROD_ROOT/store/.dashboard-token"
[ -r "$TOKEN_FILE" ] || exit 0
# 'from' must be a registered fleet agent id (the API rejects made-up names,
# measured 2026-08-22) -- the source is named in the content prefix instead.
# The alert MUST name the tree it fired in: without it a test alert raised
# from a scratch root is word-for-word identical to a real one, and the
# reader starts an investigation (cost one wasted round on 2026-08-22).
ORIGIN="${MARVEEN_DASHBOARD_ORIGIN:-http://localhost:3420}"
ALERT_TO="${MARVEEN_GUARD_ALERT_TO:-marveen}"
curl -s -m 5 -X POST "$ORIGIN/api/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
  -d "{\"from\":\"marveen\",\"to\":\"$ALERT_TO\",\"content\":\"[PROD-FA ORSEG, post-checkout hook] Fa: $TOPLEVEL -- agat valtott a(z) $BRANCH agra. (Ha ez az utvonal nem a telepites fo faja, ez PROBA, nem eles riasztas.) AUTO-VISSZAALLITAS: $REVERTED. Commitot a pre-commit hook blokkol; szandekos valtashoz MARVEEN_PROD_CHECKOUT_OK=1.\"}" >/dev/null 2>&1 || true
exit 0
EOF
chmod +x "$HOOK_DIR/post-checkout"

echo "✓ prod-tree-guard: commit block + branch-switch alert/revert installed for the main checkout."
