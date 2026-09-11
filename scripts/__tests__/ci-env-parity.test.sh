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

# ---- 6. A `run: |` BLOCK IS A SHELL SCRIPT, NOT YAML -------------------------
#      Measured 2026-09-11: a run block containing the literal text `env:` and an
#      indented KEY: value made this tool report a PHANTOM env key as a gap. The
#      real ci.yml carries 24 block scalars, so this is live, not theoretical --
#      and a wrong answer here is shaped exactly like a parity finding.
TRAP="$TMP/trap.yml"
cat > "$TRAP" <<'YML'
jobs:
  victim:
    runs-on: ubuntu-latest
    env:
      REAL_KEY: 1
    steps:
      - run: |
          echo "setting up"
          env:
            PHANTOM_FROM_RUN_BLOCK: yes
YML
OUT6="$(python3 "$TOOL" "$TRAP" --job victim --no-process-env 2>&1)"
eq "a run: | block does not yield phantom env keys" \
   "$(printf '%s' "$OUT6" | grep -c 'PHANTOM')" "0"
eq "...and the REAL key is still found (the mask is not too greedy)" \
   "$(printf '%s' "$OUT6" | grep -c 'REAL_KEY')" "1"

# ---- 7. UNMODELLED YAML -> NOT MEASURABLE, never a partial comparison -------
#      A hand-rolled parser is right most of the time; the times it is wrong look
#      like findings. So it refuses on what it cannot read.
for frag in 'env: &shared' 'env: *shared' '<<: *base' 'env: {A: 1}'; do
  cat > "$TMP/un.yml" <<YML
jobs:
  a:
    runs-on: x
    $frag
YML
  python3 "$TOOL" "$TMP/un.yml" --job a --no-process-env >/dev/null 2>&1
  eq "unmodelled [$frag]: exit 2, not a partial answer" "$?" "2"
done
# NEGATIVE CONTROL: ordinary YAML must NOT trip the refusal, or the tool refuses
# everything and the exit-2 cases above prove nothing.
eq "ordinary job does NOT trigger the refusal" \
   "$(python3 "$TOOL" "$WF" --job backend-e2e --no-process-env >/dev/null 2>&1; echo $?)" "1"

# ---- 8. THE INVENTORY AXIS, from a REAL RUN ---------------------------------
#      The file says what SHOULD run; a parser bug silently shortens that list,
#      which is the very failure this axis exists to catch. So the inventory
#      comes from what DID run.
WF2="$TMP/named.yml"
cat > "$WF2" <<'YML'
jobs:
  backend-e2e:
    name: Backend E2E Tests
    runs-on: x
  ci-summary:
    runs-on: x
YML
# THE DISPLAY-NAME TRAP: a run reports "Backend E2E Tests", the file says
# "backend-e2e". Compared as raw sets they never match and EVERY job reads as
# "never ran" -- right names present, no correspondence between them.
printf 'Backend E2E Tests\nci-summary\n' > "$TMP/ran-ok.txt"
O8="$(python3 "$TOOL" "$WF2" --no-process-env --run-jobs "$TMP/ran-ok.txt" 2>&1)"
eq "display name maps to the job id (no false 'never ran')" \
   "$(printf '%s' "$O8" | grep -c 'file and run agree')" "1"

# ...and it must be able to DISAGREE, or the line above proves nothing.
printf 'Backend E2E Tests\n' > "$TMP/ran-missing.txt"
O9="$(python3 "$TOOL" "$WF2" --no-process-env --run-jobs "$TMP/ran-missing.txt" 2>&1)"
eq "a job in the file that never ran is named" \
   "$(printf '%s' "$O9" | grep -c 'IN THE FILE BUT NOT IN THE RUN: ci-summary')" "1"
# ...and the reassuring line must be ABSENT. Printing a disagreement AND
# "file and run agree" together is read at skim depth as agreement -- the same
# contradictory-output shape as a GAP label next to exit 0. A mutation that made
# this line unconditional survived until this assertion existed.
eq "a disagreement does NOT also print 'file and run agree'" \
   "$(printf '%s' "$O9" | grep -c 'file and run agree')" "0"
printf 'Backend E2E Tests\nci-summary\nSurprise Job\n' > "$TMP/ran-extra.txt"
O10="$(python3 "$TOOL" "$WF2" --no-process-env --run-jobs "$TMP/ran-extra.txt" 2>&1)"
eq "a job in the run that is not in the file is named" \
   "$(printf '%s' "$O10" | grep -c 'IN THE RUN BUT NOT IN THE FILE: Surprise Job')" "1"

# NOT MEASURABLE beats a guess: an unreadable run must not silently become
# "file and run agree".
# Hide `gh` WITHOUT hiding python3 -- a bare PATH=/nonexistent also hides the
# interpreter, so nothing runs and the empty output reads as a pass for the
# wrong reason. (It did exactly that on the first try.)
PY3="$(command -v python3)"
O11="$(PATH=/nonexistent "$PY3" "$TOOL" "$WF2" --no-process-env --gh-run 999 2>&1)"
eq "gh unavailable: says NOT MEASURABLE" \
   "$(printf '%s' "$O11" | grep -c 'inventory: NOT MEASURABLE')" "1"
eq "gh unavailable: does NOT claim agreement" \
   "$(printf '%s' "$O11" | grep -c 'file and run agree')" "0"
python3 "$TOOL" "$WF2" --no-process-env --run-jobs "$TMP/nope.txt" >/dev/null 2>&1
eq "missing --run-jobs file: exit 2" "$?" "2"

# ---- 9. NAMESPACE MISMATCH IS NOT A FINDING ---------------------------------
#      Zero overlap between two NON-EMPTY lists means they name the same things
#      differently; a real "nothing ran" leaves the run side EMPTY. Before ids
#      were mapped through `name:`, this tool reported 15 of 15 jobs as never
#      having run while both lists were complete -- the most alarming face a bug
#      can wear, and the ordinary control passes it (both sides non-empty, same
#      size, meter plainly working).
printf 'Totally Different One\nTotally Different Two\n' > "$TMP/ran-other-ns.txt"
O12="$(python3 "$TOOL" "$WF2" --no-process-env --run-jobs "$TMP/ran-other-ns.txt" 2>&1)"
eq "zero overlap between non-empty lists: NOT MEASURABLE" \
   "$(printf '%s' "$O12" | grep -c 'namespace mismatch, not a finding')" "1"
eq "...and it does NOT claim every job never ran" \
   "$(printf '%s' "$O12" | grep -c 'IN THE FILE BUT NOT IN THE RUN')" "0"

# NEGATIVE CONTROL: a REAL total miss -- the run side EMPTY -- must still report
# the jobs as never run, or the guard above would swallow the true finding.
: > "$TMP/ran-empty.txt"
O13="$(python3 "$TOOL" "$WF2" --no-process-env --run-jobs "$TMP/ran-empty.txt" 2>&1)"
eq "an EMPTY run side is still a real finding, not a mismatch" \
   "$(printf '%s' "$O13" | grep -c 'IN THE FILE BUT NOT IN THE RUN')" "1"
eq "...and is NOT called a namespace mismatch" \
   "$(printf '%s' "$O13" | grep -c 'namespace mismatch')" "0"
# PARTIAL overlap must not trip it either -- one genuinely missing job is a
# finding, not a mismatch.
eq "partial overlap still reports the one missing job" \
   "$(printf '%s' "$O9" | grep -c 'IN THE FILE BUT NOT IN THE RUN: ci-summary')" "1"

echo
echo "ci-env-parity: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
