#!/bin/bash
# Is the Google access (calendar + Drive + mail) still alive? JSON, read-only.
#
# Same contract as scripts/calendar-agenda.sh, and for the same reason: the
# failures that matter most happen before any of our code runs. Always JSON on
# stdout, always exit 0, and `via` names which copy answered.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/dist/google-health-cli.js"
TSX="$ROOT/node_modules/.bin/tsx"

emit_error() {
  python3 -c 'import json,sys; print(json.dumps({"ok": False, "error": sys.argv[1]}))' "$1"
  exit 0
}

NODE=""
for cand in /opt/homebrew/opt/node@22/bin/node /usr/local/opt/node@22/bin/node "$(command -v node || true)"; do
  [ -n "$cand" ] && [ -x "$cand" ] && NODE="$cand" && break
done
[ -z "$NODE" ] && emit_error "nincs node a PATH-on (node@22 varhato)"

if [ -f "$CLI" ]; then
  VIA="dist"
  CMD=("$NODE" "$CLI")
elif [ -f "$ROOT/src/google-health-cli.ts" ] && [ -x "$TSX" ]; then
  VIA="tsx-source (nincs build -- 'npm run build' utan a dist szolgal ki)"
  CMD=("$TSX" "$ROOT/src/google-health-cli.ts")
elif [ -f "$ROOT/src/google-health-cli.ts" ]; then
  emit_error "dist/google-health-cli.js hianyzik, a forras megvan, de tsx sincs -- 'npm run build' kell"
else
  emit_error "dist/google-health-cli.js hianyzik (es a forras sem talalhato)"
fi

ERR_FILE="$(mktemp -t google-health)"
OUT="$(GOOGLE_HEALTH_VIA="$VIA" "${CMD[@]}" "$@" 2>"$ERR_FILE")"
RC=$?
STDERR="$(tr '\n' ' ' < "$ERR_FILE" | cut -c1-200)"
rm -f "$ERR_FILE"

[ $RC -ne 0 ] && emit_error "a node $RC kodda halt: ${STDERR:-nincs stderr}"
[ -z "$OUT" ] && emit_error "ures kimenet a CLI-tol: ${STDERR:-nincs stderr}"

printf '%s\n' "$OUT"
exit 0
