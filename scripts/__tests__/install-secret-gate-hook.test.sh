#!/bin/bash
# Tests for scripts/install-secret-gate-hook.sh -- card 5bcf185d.
#
# The hook used to run `npx --no-install tsx`, which in a worktree without
# node_modules resolved tsx from the ~/.npm/_npx CACHE; with that cache empty
# it exited 1 on "npx canceled due to missing packages", a blocked commit that
# never named the gate. These tests pin WHICH tsx runs and what the hook says
# when none can.
#
# Everything runs in a throwaway repo under a temp dir: the installer only
# writes into $(git rev-parse --git-common-dir)/hooks of the repo it runs from.
# The scanner is replaced by a stub, and tsx by marker scripts, so what is
# measured is the hook's resolution, not the scanner.
#
# Run: bash scripts/__tests__/install-secret-gate-hook.test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   -- $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL -- $1"; }
has()  { if printf '%s' "$2" | grep -q -- "$3"; then ok "$1"; else bad "$1 (no [$3] in: $2)"; fi; }
hasnt(){ if printf '%s' "$2" | grep -q -- "$3"; then bad "$1 (unexpected [$3] in: $2)"; else ok "$1"; fi; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$3], got [$2])"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export npm_config_cache="$TMP/empty-npm-cache"   # the card's control: no npx cache

MAIN="$TMP/main"
mkdir -p "$MAIN/scripts"
cp "$ROOT/scripts/install-secret-gate-hook.sh" "$MAIN/scripts/"
printf 'process.exit(0)\n' > "$MAIN/scripts/secret-gate.ts"
git -C "$MAIN" init -q
git -C "$MAIN" config user.email t@t; git -C "$MAIN" config user.name t
printf 'node_modules/\n' > "$MAIN/.gitignore"
git -C "$MAIN" add -A >/dev/null; git -C "$MAIN" commit -qm init
(cd "$MAIN" && bash scripts/install-secret-gate-hook.sh >/dev/null)
GUARD="$MAIN/.git/hooks/pre-commit.d/10-secret-gate"
check "the installer wrote the hook" "$([ -x "$GUARD" ] && echo yes)" "yes"

WT="$TMP/wt"
git -C "$MAIN" worktree add -q "$WT" -b wt-branch >/dev/null 2>&1

marker() { # $1 dir, $2 label -- a fake tsx that says who it is
  mkdir -p "$1/node_modules/.bin"
  printf '#!/bin/sh\necho "TSX=%s $*"\n' "$2" > "$1/node_modules/.bin/tsx"
  chmod +x "$1/node_modules/.bin/tsx"
}
run() { (cd "$1" && "$GUARD" 2>&1); echo "rc=$?"; }

echo "-- 1. the worktree's own tsx runs the gate"
marker "$MAIN" MAIN; marker "$WT" WORKTREE
out="$(run "$WT")"
has   "uses the worktree install" "$out" "TSX=WORKTREE scripts/secret-gate.ts --staged"
has   "and passes its exit code" "$out" "rc=0"

echo "-- 2. a worktree WITHOUT node_modules uses the main checkout's"
rm -rf "$WT/node_modules"
out="$(run "$WT")"
has   "falls back to the main checkout" "$out" "TSX=MAIN"
hasnt "never goes through npx" "$out" "npx"

echo "-- 3. no tsx anywhere: blocked, and the message is about the GATE"
rm -rf "$MAIN/node_modules"
out="$(run "$WT")"
has   "exits 1 (fail-closed)" "$out" "rc=1"
has   "names the secret gate" "$out" "SECRET GATE cannot run"
has   "says it is not a secret hit" "$out" "NOT A SECRET HIT"
has   "names the way out" "$out" "SKIP_SECRET_GATE=1"
hasnt "is not an npx error" "$out" "npx canceled"

echo "-- 4. the script's absence still passes, as before"
rm "$WT/scripts/secret-gate.ts"
out="$(run "$WT")"
has   "exits 0" "$out" "rc=0"
has   "says the branch predates the gate" "$out" "NOT on this branch"

echo "-- 5. SKIP_SECRET_GATE=1 still passes"
out="$(cd "$WT" && SKIP_SECRET_GATE=1 "$GUARD" 2>&1; echo "rc=$?")"
has   "exits 0 with the skip" "$out" "rc=0"

echo
echo "install-secret-gate-hook: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
