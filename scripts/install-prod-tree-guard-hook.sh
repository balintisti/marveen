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
#                    tree is clean, auto-reverts to THE BRANCH IT CAME FROM.
#                    Override: MARVEEN_PROD_CHECKOUT_OK=1 git checkout ...
#                    It used to revert to the first of develop/main/master that
#                    existed. That premise expired: on 2026-08-29 `develop` was
#                    510 commits behind the deployed tree and carried neither
#                    scripts/secret-gate.ts nor scripts/card-comment.sh, so the
#                    "restore" WAS the strip -- reproduced, see the block below.
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

# A MERGE EZEN A FAN SZANKCIONALT, TEHAT A MERGE BEFEJEZESE SEM MEGKERULES (kartya 8c08c0bc).
# Merve 2026-09-04 a fo checkout SAJAT HEAD-reflogjabol, 2026-08-20 ota: 116 merge / 91 commit,
# a 116-bol 82 kartya-id nevu agrol -- vagyis a koordinator napi kotegei. A build EBBOL a fabol
# keszul, es a post-checkout or SZANDEKOSAN ide allitja vissza. A merge nem szivargas: ez a fa
# dolga.
#
# Egy tiszta auto-merge amugy sem fut at itt (a git a `pre-merge-commit` hookot hivja, ami nincs
# telepitve). Ami IDE er, az az UTKOZO merge feloldasa utani kezi `git commit` -- ugyanannak a
# szankcionalt muveletnek a befejezese, es eddig megtagadva.
#
# A MERGE_HEAD PONTOSAN ADDIG LETEZIK, AMIG A MERGE BEFEJEZETLEN (merve: utkozo merge alatt es
# `--no-commit` utan LETEZIK; a merge befejezese utan NEM). Tehat ez a kapu nem tagit tobbet, mint
# a folyamatban levo merge lezarasa -- egy kesobbi, fuggetlen commit ugyanugy blokkolt marad.
if [ "$TOPLEVEL" = "$PROD_ROOT" ] && git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
  echo "prod-tree-guard: folyamatban levo MERGE lezarasa -- atengedve (a merge ezen a fan szankcionalt)." >&2
  exit 0
fi

# ALAPVONAL-KIVETEL (kartya c3573fd6). MERVE: 29 felulbiralasbol 18 (62%) a koteg UTANI
# alapvonal-frissites, ahol a MERGE_HEAD MAR NEM letezik, tehat a merge-kivetel szerkezetileg
# nem er ide. Egy or, amit a NORMAL munkafolyamatban ki kell kapcsolni, rossz helyen huzza a
# vonalat -- es a naplo mar gyujti a zajt: 29-bol 26 indok NELKUL, 6 pedig ures (files=0).
#
# marveen SZANDEKOSAN nem javasolta a kezenfekvo alakot (kivetel a fajlra), mert az engedne, hogy
# a fo fa a VEDELMET HORDOZO fajlt szerkessze. Ez a valtozat szukebb, es a harom feltetel EGYUTT
# kell: barmelyik hianyzik, a kapu ugyanugy blokkol.
#   1. a staged halmaz PONTOSAN ez az egy fajl (barmi mas mellette -> nincs kivetel)
#   2. minden valtozott sor a GENERALT blokkon belul van (a ket konstans + a mero kommentje)
#   3. egyik ertek sem CSOKKEN  -- ez az, ami a veszelyes esetet kizarja: az alapvonal
#      LESZALLITASA epp az a mozdulat, amivel egy keszlet-zsugorodast el lehetne rejteni
# MERVE a jelen tortenetre: 56 nem-merge commitbol 43 CSAK a generalt blokkot erinti, es az
# ertekek monoton nonek (404/5148 -> 415/5265). Vagyis a kivetel a tenyleges tobbsegi esetet
# fedi, es semmit nem enged, amit ma barki csinalna.
_BASE_F="src/__tests__/setup/suite-size-guard.ts"
if [ "$TOPLEVEL" = "$PROD_ROOT" ] && [ "${MARVEEN_PROD_COMMIT_OK:-0}" != "1" ] \
   && [ "$(git diff --cached --name-only 2>/dev/null)" = "$_BASE_F" ]; then
  _outside="$(git diff --cached -U0 -- "$_BASE_F" 2>/dev/null | grep -E '^[+-]' \
      | grep -vE '^(\+\+\+|---)' \
      | grep -vcE 'SUITE_BASELINE_(FILES|TESTS) = [0-9]+|Merve .*vitest list' || true)"
  _of="$(git show "HEAD:$_BASE_F" 2>/dev/null | awk '/SUITE_BASELINE_FILES = /{print $NF}')"
  _nf="$(git show ":0:$_BASE_F" 2>/dev/null | awk '/SUITE_BASELINE_FILES = /{print $NF}')"
  _ot="$(git show "HEAD:$_BASE_F" 2>/dev/null | awk '/SUITE_BASELINE_TESTS = /{print $NF}')"
  _nt="$(git show ":0:$_BASE_F" 2>/dev/null | awk '/SUITE_BASELINE_TESTS = /{print $NF}')"
  if [ "${_outside:-1}" = "0" ] && [ -n "$_nf" ] && [ -n "$_nt" ] \
     && [ "$_nf" -ge "${_of:-0}" ] && [ "$_nt" -ge "${_ot:-0}" ]; then
    echo "prod-tree-guard: GEPI ALAPVONAL-FRISSITES (${_of:-?}/${_ot:-?} -> $_nf/$_nt) -- atengedve." >&2
    exit 0
  fi
fi

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
# RECURSION GUARD. Our own revert is itself a branch switch and re-enters this
# hook. It used to be self-limiting because the revert always landed on a
# develop/main/master name, where the hook exited -- that silence is exactly
# what made the strip below quiet, so the exit is now explicit and narrow.
[ "${MARVEEN_GUARD_REVERTING:-0}" = "1" ] && exit 0
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ismeretlen)"
[ "${MARVEEN_PROD_CHECKOUT_OK:-0}" = "1" ] && exit 0
# REVERT TARGET: THE BRANCH WE CAME FROM, NOT A TRUNK NAME.
#
# Until 2026-08-29 this took the first existing of develop/main/master. The
# comment claimed the target was "derived, not assumed"; the code assumed a
# name list. When the deployment stopped living on those names the guard did
# not merely fail to prevent a strip -- IT PERFORMED ONE. Reproduced in a
# throwaway repo with this hook verbatim: asked for `some/other-branch`,
# ended on `develop`, and secret-gate.ts + card-comment.sh were gone from the
# working tree. (marveen found the premise; friday reproduced it.)
#
# The target is read from the HEAD REFLOG, which records the switch BY NAME
# ("checkout: moving from <FROM> to <TO>") and is already written when this
# hook runs. It needs no opinion about which branch is the trunk -- so this
# fix does not depend on, and does not pre-empt, the separate decision about
# the trunk names.
#
# TWO ALTERNATIVES WERE MEASURED AND REJECTED on 2026-08-29, both because they
# answer a near-miss question:
#   `@{-1}`  -- a SEMANTIC "previous branch". On develop -> feat -> develop it
#               returned `develop`, the branch we had just switched TO.
#   `$1` + `--points-at` -- $1 (the previous HEAD sha) is unambiguous, but
#               mapping a sha back to a name is not: any second branch sitting
#               on the same tip (a backup ref, a twin, or the `-b` we just
#               created) makes it ambiguous. Refusing on that re-opened the
#               strip -- measured: the files were gone and the guard declined.
#               The reflog names the branch, so a twin ref cannot confuse it.
#
# $1 IS STILL USED, as a cross-check rather than as the answer: the resolved
# branch must still point at the commit we actually left. If someone moved it
# in between, restoring it would restore something else under a familiar name.
#
# Resolved to a branch NAME, never checked out as a sha: a detached prod tree
# is its own outage. When the name is not knowable the guard REFUSES and says
# why. A guard that restores the WRONG tree is worse than one that restores
# nothing: an unreverted switch is visible, a wrongly "restored" tree is not.
PREV_SHA="${1:-}"
HOME_BRANCH=""
HOME_WHY=""
# Branch names cannot contain spaces (git check-ref-format), so " to " cannot
# occur inside either name and this split has exactly one reading.
PREV_REF="$(git reflog show HEAD -1 2>/dev/null | sed -n 's/.*checkout: moving from \(.*\) to .*/\1/p')"
if [ -z "$PREV_REF" ]; then
  HOME_WHY="a HEAD reflog nem mondja meg, honnan jottunk (ki van kapcsolva a reflog?)"
elif ! git show-ref --verify --quiet "refs/heads/$PREV_REF"; then
  HOME_WHY="'$PREV_REF' nem letezo lokalis ag (detached HEAD volt, vagy azota torolve)"
elif [ -n "$PREV_SHA" ] && [ "$(git rev-parse "refs/heads/$PREV_REF" 2>/dev/null)" != "$PREV_SHA" ]; then
  HOME_WHY="'$PREV_REF' azota elmozdult (mar nem a $(printf '%s' "$PREV_SHA" | cut -c1-8) commiton all)"
else
  HOME_BRANCH="$PREV_REF"
fi
# Auto-revert only when the TRACKED tree is clean: a guard must never lose
# work. Untracked files deliberately do not count (--untracked-files=no): a
# branch switch never touches them, and on a live tree untracked host-local
# files are the steady state -- counting them would make this revert never
# fire (measured 2026-08-22).
REVERTED="nem"
if [ -z "$HOME_BRANCH" ]; then
  REVERTED="NEM -- a visszateresi pont nem allapithato meg: $HOME_WHY (kezi beavatkozas)"
elif [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  REVERTED="nem (a fa DIRTY, kezi beavatkozas kell)"
elif MARVEEN_GUARD_REVERTING=1 git checkout "$HOME_BRANCH" -q 2>/dev/null; then
  REVERTED="igen ($HOME_BRANCH)"
else
  REVERTED="nem sikerult (checkout $HOME_BRANCH hibazott)"
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
