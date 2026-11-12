#!/usr/bin/env bash
# memory-save.sh -- reliable memory write for the Marveen fleet.
#
# WHY: the pattern documented in CLAUDE.md is
#   curl -s -X POST .../api/memories ... | head -c 200
# and it CANNOT FAIL VISIBLY. curl exits 0 on a 400, `head` prints the error body
# as if it were a result, and the agent moves on believing the memory was saved.
# Measured 2026-08-21 (mandark, then re-measured here): the memory API rejects any
# content matching an injection pattern -- `curl -s http://host/path` was the common
# one until card 1d455b6c dropped the command patterns; since then only injection
# idioms are refused -- with `400 {"error":"Content rejected by security filter"}`. Note the first
# reading of that measurement was wrong in a way that MATTERS: "put the URL on its
# own line" does NOT help, because the pattern's `\s+` matches a newline too. What
# helps is not storing the raw command at all. A helper that hands out a fix which
# does not work is worse than one that only reports the refusal. Every startup recipe
# and API example is written with curl, so the filter hits exactly the technical
# memories, and it hits them SILENTLY. This is the same shape as the inter-agent
# send bug that agent-msg.sh already fixes; the memory path had no helper.
#
# Usage:  bash scripts/memory-save.sh <agent> <category> "<keywords>" "<content>"
#   category: hot | warm | cold | shared
#   content:  "-" reads STDIN (use for anything long or multi-line):
#     bash scripts/memory-save.sh marveen cold "git, push" - < /tmp/mem.txt
# Output: success -> "OK id=<n>"; failure -> "FAIL <reason>", exit 1.
#   A save that repeats one of the agent's OWN memories is refused by the API (409
#   duplicate): "NEM MENTETTEM duplikatum: ... id=<n>", exit 3, no retry (a retry
#   cannot change the answer). Genuinely new information: ALLOW_DUPLICATE=1.
# Env: MARVEEN_WEB_PORT (default 3420); ALLOW_DUPLICATE=1 sends allow_duplicate:true.
set -uo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${MARVEEN_WEB_PORT:-3420}"
TOKEN_FILE="$BASE/store/.dashboard-token"
URL="http://localhost:${PORT}/api/memories"
LOG="$BASE/store/agent-msg-failures.log"

AGENT="${1:?agent required}"; CAT="${2:?category required}"; KW="${3:?keywords required}"
C="${4:?content required (or - for STDIN)}"
[ "$C" = "-" ] && C="$(cat)"
[ -r "$TOKEN_FILE" ] || { echo "FAIL: no token file at $TOKEN_FILE"; exit 1; }
TOKEN="$(cat "$TOKEN_FILE")"

case "$CAT" in
  hot|warm|cold|shared) ;;
  *) echo "FAIL: category '$CAT' invalid -- allowed: hot warm cold shared"; exit 1 ;;
esac

# --- PREFLIGHT: name the pattern BEFORE the server refuses it ---
# The server answers only "Content rejected by security filter", which does not
# say WHICH line is the problem -- and in a 2000-character memory that is the
# whole question. The preflight evaluates the SERVER'S OWN SUSPICIOUS_PATTERNS
# literals from src/web/routes/memories.ts in node (the same way
# scripts/__tests__/memory-content-filter.test.py does), never a copy: the copy
# this used to carry kept refusing curl/rm -rf content for as long as it went
# unsynced after the server dropped those patterns (card 1d455b6c), and it never
# knew the Hungarian ones. If the source cannot be read or parsed, the preflight
# says so on stderr and steps aside: the server is still the guard.
FILTER_SRC="$BASE/src/web/routes/memories.ts"
HIT="$(AGENT_CONTENT="$C" node --input-type=module -e '
import { readFileSync } from "node:fs"
let src
try { src = readFileSync(process.argv[1], "utf8") } catch { console.log("UNREAD"); process.exit(0) }
const m = src.match(/const SUSPICIOUS_PATTERNS = \[([\s\S]*?)\n\]/)
if (!m) { console.log("UNREAD"); process.exit(0) }
const pats = m[1].split("\n").map(s => s.trim().replace(/,$/, ""))
  .filter(s => s.startsWith("/") && !s.startsWith("//"))
  .map(l => { const i = l.lastIndexOf("/"); return new RegExp(l.slice(1, i), l.slice(i + 1)) })
if (pats.length === 0) { console.log("UNREAD"); process.exit(0) }
const c = process.env.AGENT_CONTENT
const plain = c.normalize("NFD").replace(/[̀-ͯ]/g, "")
for (const p of pats) {
  for (const t of [c, plain]) {
    const r = p.exec(t)
    if (r) {
      const line = t.slice(0, r.index).split("\n").length
      console.log(`line ${line}\t${r[0].slice(0, 60)}\t${p.source.slice(0, 60)}`)
      process.exit(0)
    }
  }
}
' "$FILTER_SRC" 2>/dev/null)"
if [ "$HIT" = "UNREAD" ] || { [ -z "$HIT" ] && ! command -v node >/dev/null 2>&1; }; then
  echo "FIGYELEM: az elozetes szuro-ellenorzes NEM futott (nem olvashato: $FILTER_SRC, vagy nincs node); a szerver donti el." >&2
  HIT=""
fi
if [ -n "$HIT" ]; then
  echo "NEM MENTETTEM. A tartalom beleutkozne a memoria-API biztonsagi szurojebe:" >&2
  printf '  %s\n' "$HIT" >&2
  echo "  A szuro INDOKOLT: egy elmentett emlek kesobb egy masik agens kontextusaba kerul, es a" >&2
  echo "  befecskendezesi fordulatokat (ignore previous instructions, felejtsd el a szabalyaidat," >&2
  echo "  mostantol uj szerep...) utasitaskent olvashatja. Ami segit: ne IDEZD szo szerint a" >&2
  echo "  fordulatot, ird le a TENYT ('egy felejtsd-el tipusu mondatot a szuro elutasit')." >&2
  echo "  Parancsot (curl, rm -rf, bash -c) a szuro mar NEM szur (1d455b6c): nem az a gond." >&2
  exit 2
fi

attempt=0; max=3; CODE=""; ID=""
while [ "$attempt" -lt "$max" ]; do
  attempt=$((attempt+1))
  BODY="$(AGENT="$AGENT" CAT="$CAT" KW="$KW" C="$C" ALLOW_DUP="${ALLOW_DUPLICATE:-}" python3 -c 'import json,os; b={"agent_id":os.environ["AGENT"],"category":os.environ["CAT"],"keywords":os.environ["KW"],"content":os.environ["C"]}
if os.environ.get("ALLOW_DUP")=="1": b["allow_duplicate"]=True
print(json.dumps(b))')"
  # The secret goes in a -K config from a process substitution, not argv (ps-visible); card 9ac56d05.
  RESP="$(curl -s -X POST "$URL" -H "Content-Type: application/json" -K <(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN") -d "$BODY" -w $'\n%{http_code}' 2>/dev/null || true)"
  CODE="$(printf '%s' "$RESP" | tail -n1)"
  JSON="$(printf '%s' "$RESP" | sed '$d')"
  ID="$(printf '%s' "$JSON" | python3 -c 'import sys,json
try:
  d = json.load(sys.stdin)
  print(d.get("id","") if isinstance(d, dict) and d.get("ok") else "")
except Exception:
  print("")' 2>/dev/null)"
  # An id came back AND ok:true -- the only proof the row exists. A 200 with no
  # id would mean the endpoint changed shape, and that must not read as success.
  if { [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; } && [ -n "$ID" ]; then
    echo "OK id=$ID"
    exit 0
  fi
  if [ "$CODE" = "409" ]; then
    DUPS="$(printf '%s' "$JSON" | python3 -c 'import sys,json
try:
  d = json.load(sys.stdin)
  print(",".join(str(x.get("id")) + ":" + str(x.get("match")) for x in d.get("duplicate_of", [])))
except Exception:
  print("")' 2>/dev/null)"
    echo "NEM MENTETTEM duplikatum: ez egy sajat emleked ismetlese, id:egyezes=${DUPS:-?}. Ha tenyleg uj tartalom: ALLOW_DUPLICATE=1 bash scripts/memory-save.sh ..."
    exit 3
  fi
  sleep 1
done
echo "FAIL agent=$AGENT cat=$CAT http=${CODE:-?} resp=$(printf '%s' "${JSON:-}" | head -c 160)"
printf '%s\tMEM-FAIL\tagent=%s\tcat=%s\thttp=%s\tresp=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$AGENT" "$CAT" "${CODE:-?}" "$(printf '%s' "${JSON:-}" | head -c 200)" >> "$LOG" 2>/dev/null || true
exit 1
