#!/bin/bash
# Tests for scripts/ci-env-parity.py (card 61f8f593).
#
# The card's closing condition, verbatim: the tool must retroactively find the
# four measured cases (JWT_SECRET, JWT_REFRESH_SECRET, NODE_OPTIONS, and the
# missing Upstash shim service) and be SILENT on a complete environment --
# mutation-proven by removing ONE variable from the correct set.
#
# Run: bash scripts/__tests__/ci-env-parity.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOL="$ROOT/scripts/ci-env-parity.py"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   -- $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL -- $1"; }
eq()  { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$3], got [$2])"; fi; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# A fixture carrying the measured shapes: a job-level env:, a STEP-level env:
# (where this repo's Upstash shim actually lives), and a services: block.
WF="$TMP/ci.yml"
cat > "$WF" <<'YML'
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  backend-test:
    runs-on: ubuntu-latest
    env:
      NODE_ENV: test
  backend-e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        ports: ['5432:5432']
        env:
          POSTGRES_DB: app
      srh:
        image: hiett/serverless-redis-http
    env:
      JWT_SECRET: x
      JWT_REFRESH_SECRET: y
      NODE_OPTIONS: --max-old-space-size=4096
    steps:
      - run: pnpm e2e
        env:
          UPSTASH_REDIS_REST_URL: http://localhost:8079
  ci-summary:
    runs-on: ubuntu-latest
YML

# ---- 1. the four measured cases, against an EMPTY environment ---------------
OUT="$(python3 "$TOOL" "$WF" --job backend-e2e --no-process-env 2>&1)"; RC=$?
eq "empty env: exits 1 (a gap)" "$RC" "1"
for v in JWT_SECRET JWT_REFRESH_SECRET NODE_OPTIONS; do
  eq "names $v" "$(printf '%s' "$OUT" | grep -c "$v")" "1"
done
# The step-level key must survive. NOTE for whoever mutates this: flipping the
# env call to direct_only=True does NOT break it -- shallowest is computed per
# block, so a flat env: mapping is identical either way (verified: 10/10 on the
# real ci.yml under both). That mutation is a no-op, not an escaped defect.
eq "names the STEP-level UPSTASH_REDIS_REST_URL" \
   "$(printf '%s' "$OUT" | grep -c 'UPSTASH_REDIS_REST_URL')" "1"
# the shim is a SERVICE, not an env var -- and services must be the direct
# children only (union-across-levels returned image/ports/env as services)
eq "lists srh as a service" "$(printf '%s' "$OUT" | grep -c 'postgres, srh')" "1"
eq "does NOT call 'image' a service" "$(printf '%s' "$OUT" | grep -c 'image')" "0"

# ---- 2. SILENCE on a complete environment ----------------------------------
ENVF="$TMP/full.env"
cat > "$ENVF" <<'E'
JWT_SECRET=x
JWT_REFRESH_SECRET=y
NODE_OPTIONS=--max-old-space-size=4096
UPSTASH_REDIS_REST_URL=http://localhost:8079
E
OUT2="$(python3 "$TOOL" "$WF" --job backend-e2e --env-file "$ENVF" --no-process-env 2>&1)"; RC2=$?
eq "complete env: exits 0" "$RC2" "0"
eq "complete env: no env-gap line" "$(printf '%s' "$OUT2" | grep -c 'NOT provided')" "0"
# The printed label must AGREE with the exit code: services alone used to print
# "GAP" while the tool exited 0, which is the ambiguity this tool exists to kill.
eq "complete env: labelled ok, not GAP (it has services)" \
   "$(printf '%s' "$OUT2" | grep -c '^ok  backend-e2e')" "1"
eq "complete env: still REPORTS the services" \
   "$(printf '%s' "$OUT2" | grep -c 'services this job runs')" "1"

# ---- 3. MUTATION: remove exactly ONE variable -> it must speak --------------
#         This is the card's stated proof. Without it, case 2 could be green
#         because the tool cannot detect anything at all.
for drop in JWT_SECRET NODE_OPTIONS UPSTASH_REDIS_REST_URL; do
  grep -v "^$drop=" "$ENVF" > "$TMP/one-missing.env"
  O="$(python3 "$TOOL" "$WF" --job backend-e2e --env-file "$TMP/one-missing.env" --no-process-env 2>&1)"; R=$?
  if [ "$R" -eq 1 ] && printf '%s' "$O" | grep -q "$drop"; then
    ok "mutation: dropping $drop alone is reported"
  else
    bad "mutation: dropping $drop gave rc=$R and did not name it"
  fi
done

# ---- 4. THE INVENTORY HALF: a job you did NOT ask about ---------------------
eq "names the jobs it made no statement about" \
   "$(printf '%s' "$OUT2" | grep -c 'NO STATEMENT about:.*backend-test')" "1"
eq "reports coverage as 1 of 3" "$(printf '%s' "$OUT2" | grep -c 'coverage: 1/3')" "1"
# and the job count must exclude the `on:` keys push/pull_request -- a regex
# over-counted exactly those two on the real file
eq "--list counts 3 jobs, not the on: keys" \
   "$(python3 "$TOOL" "$WF" --list | grep -c 'jobs in .*: 3')" "1"

# ---- 5. CANNOT ANSWER is 2, never 0 ----------------------------------------
python3 "$TOOL" "$WF" --job nosuchjob --no-process-env >/dev/null 2>&1
eq "unknown job: exit 2, not 0" "$?" "2"
printf 'name: CI\non: push\n' > "$TMP/nojobs.yml"
python3 "$TOOL" "$TMP/nojobs.yml" >/dev/null 2>&1
eq "no jobs: key: exit 2" "$?" "2"
printf 'jobs:\n' > "$TMP/emptyjobs.yml"
python3 "$TOOL" "$TMP/emptyjobs.yml" >/dev/null 2>&1
eq "jobs: present but unparseable: exit 2, NOT 0" "$?" "2"
python3 "$TOOL" "$TMP/missing-file.yml" >/dev/null 2>&1
eq "missing workflow: exit 2" "$?" "2"
python3 "$TOOL" "$WF" --job backend-e2e --env-file "$TMP/nope.env" >/dev/null 2>&1
eq "missing --env-file: exit 2, not a fake gap" "$?" "2"

echo
echo "ci-env-parity: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
