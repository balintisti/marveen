#!/bin/bash
# Today's calendar as JSON -- the ONE command the morning briefing runs.
#
# WHY A WRAPPER AND NOT `node dist/agenda-cli.js` DIRECTLY: three of the four
# ways this call can fail happen BEFORE any of our code runs -- no supported
# node on PATH, a dist that was never built, a node that dies on startup. Each
# of those produces a non-JSON stderr blob and a non-zero exit, and a caller
# that only reads stdout sees NOTHING. An empty morning-briefing calendar
# section is exactly the failure this whole chain exists to prevent, so the
# wrapper turns every one of them into the same JSON shape:
#
#   {"ok":true,...}   we looked
#   {"ok":false,"error":"..."}   we could not look, and this is why
#
# Always exits 0, for the same reason gmail-recent.py does: a caller must not
# be able to lose the reason by testing the exit status.
#
# Usage: scripts/calendar-agenda.sh [--hours N] [--calendar ID]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/dist/agenda-cli.js"

emit_error() {
  # jq is not installed on a plain box (see the repo CLAUDE.md), and python3 is.
  python3 -c 'import json,sys; print(json.dumps({"ok": False, "error": sys.argv[1]}))' "$1"
  exit 0
}

# node@22 first: package.json pins engines to >=20 <24, and the homebrew main
# `node` on this box is newer than that.
NODE=""
for cand in /opt/homebrew/opt/node@22/bin/node /usr/local/opt/node@22/bin/node "$(command -v node || true)"; do
  [ -n "$cand" ] && [ -x "$cand" ] && NODE="$cand" && break
done
[ -z "$NODE" ] && emit_error "nincs node a PATH-on (node@22 varhato)"

# WHICH COPY ANSWERS, AND WHY THE OUTPUT SAYS SO.
#
# The compiled dist is the path the running system uses, so it wins. But a
# source file with no build behind it is the quiet failure -- the feature
# exists in the repo and the running system has never seen it -- and a morning
# briefing that silently loses its calendar because a merge has not happened
# yet is the very thing this chain exists to prevent. So: fall back to the
# TypeScript source through tsx, and NAME the path in the output (`via`).
#
# Two paths are fine. Two paths you cannot tell apart are not: Marveen spent
# five days on 2026-08-22 believing a fix was live because a hand-run copy
# produced output identical to production's. `via` is what makes that
# impossible here.
TSX="$ROOT/node_modules/.bin/tsx"
if [ -f "$CLI" ]; then
  VIA="dist"
  CMD=("$NODE" "$CLI")
elif [ -f "$ROOT/src/agenda-cli.ts" ] && [ -x "$TSX" ]; then
  VIA="tsx-source (nincs build -- 'npm run build' utan a dist szolgal ki)"
  CMD=("$TSX" "$ROOT/src/agenda-cli.ts")
elif [ -f "$ROOT/src/agenda-cli.ts" ]; then
  emit_error "dist/agenda-cli.js hianyzik, a forras megvan, de tsx sincs -- 'npm run build' kell"
else
  emit_error "dist/agenda-cli.js hianyzik (es a forras sem talalhato: $ROOT/src/agenda-cli.ts)"
fi

# `"$@"` INSIDE a function is the FUNCTION's arguments, not the script's, so the
# caller's flags have to be handed in explicitly. Getting this wrong drops every
# flag silently -- the wrapper still answers, just for a different question. An
# existing contract test (`--hours` validation) caught it; that is what it is for.
run_once() {
  ERR_FILE="$(mktemp -t calendar-agenda)"
  OUT="$(AGENDA_VIA="$VIA" "${CMD[@]}" "$@" 2>"$ERR_FILE")"
  RC=$?
  STDERR="$(tr '\n' ' ' < "$ERR_FILE" | cut -c1-200)"
  rm -f "$ERR_FILE"
}

# WHY A RETRY, AND WHY ONLY FOR SOME ERRORS (card f4c59571, measured 2026-08-24).
# The CLI reports an API failure as `{"ok":false,"error":...}` with exit 0, and
# this wrapper used to pass that straight through. So a SINGLE slow round trip
# became a sentence in Isti's morning briefing saying the calendar could not be
# reached. Measured that night: 7 runs, one failed on a 5000ms deadline, the
# other 6 answered in 2.16-4.16s -- the failure was transient and the margin is
# thin. The briefing runs ONCE, cold, in the morning: the one call that matters
# most is the one with no second chance.
#
# ONLY TRANSPORT ERRORS ARE RETRIED. A 401/403, a missing file or a bad config
# is deterministic: retrying it cannot change the answer, it only doubles the
# wait and delays a real message. Retrying everything would turn this from a
# repair into a way of hiding outages.
TRANSIENT='timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up'

run_once "$@"
if [ $RC -eq 0 ] && [ -n "$OUT" ] \
   && printf '%s' "$OUT" | grep -q '"ok"[[:space:]]*:[[:space:]]*false' \
   && printf '%s' "$OUT" | grep -qE "$TRANSIENT"; then
  # One retry, not a loop: if the second attempt fails too, that is a real
  # outage and the caller must hear about it now, not after four more waits.
  sleep 1
  FIRST_OUT="$OUT"
  run_once "$@"
  if [ $RC -ne 0 ] || [ -z "$OUT" ]; then
    OUT="$FIRST_OUT"
    RC=0
  fi
fi

if [ $RC -ne 0 ]; then
  emit_error "a node $RC kodda halt: ${STDERR:-nincs stderr}"
fi
if [ -z "$OUT" ]; then
  emit_error "ures kimenet a CLI-tol: ${STDERR:-nincs stderr}"
fi

printf '%s\n' "$OUT"
exit 0
