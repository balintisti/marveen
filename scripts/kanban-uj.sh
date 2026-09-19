#!/usr/bin/env bash
# kanban-uj.sh -- kartya letrehozas a marveen kanbanon, VISSZAOLVASASSAL.
#
# MIERT LETEZIK. A `CLAUDE.md`-ben het curl-pelda all a kartya-nyitasra, es a valasz,
# amit adnak, ez -- forrasbol ES a lefordított fabol merve 2026-09-19:
#
#     src/web/routes/kanban.ts:452   json(res, warning ? { ok: true, id, warning } : { ok: true, id })
#     dist/web/routes/kanban.js:431  ugyanaz  <- ez fut
#
# Ket kovetkezmenye van, es mindketto NEMA:
#
#  1. AZ IDOPONT NINCS BENNE. A letrehozas pillanataban a `created_at` EGY korutnyira
#     van, es semmi nem keri, hogy elvedd. Tiz perccel kesobb, amikor szamit, mar csak
#     a TORTENET all az ember elott. Mert eset 2026-09-19: ket agens ket fuggetlen
#     beszamoloja ugyanarrol a ket kartyarol -- MINDKETTO hamis, ELLENTETES iranyban,
#     es alakra osszefertek, ezert nem utkoztek. A kulonbseg 39 masodperc volt, amit
#     semmilyen tabla-olvasas nem elozhetett volna meg. Hianyzo MEZO, nem hianyzo
#     emlekezteto -- ezert ez a sor a helper kimenete, nem egy szabaly a lapon.
#
#  2. AMIT A SZERVER NEM ISMER, AZT ELDOBJA, ES `ok:true`-t mond. A validator
#     szandekosan csak azt utasitja el, amit az ADATBAZIS is elutasitana (lasd
#     kanban-create-validation.ts), tehat egy elgepelt mezonev atmegy, a kartya
#     letrejon nelkule, es a valasz sikert jelent. Ezert olvas vissza ez a szkript, es
#     ezert HASONLITJA OSSZE mezonkent azt, amit KULDTEL, azzal, ami a KARTYAN VAN.
#
# AMIT SZANDEKOSAN NEM CSINAL: nem masolja ide a status/priority ENUM-ot. A repo mar
# ket peldanyban tartja (db.ts CHECK + kanban-create-validation.ts), es egy teszt azert
# all, hogy a ketto elteresse LATHATO legyen. Egy harmadik peldany egy helperben pont
# az az elsodrodas lenne. A szerver 400-a megnevezi a mezot; azt irjuk ki szo szerint.
#
# Usage:
#   bash scripts/kanban-uj.sh <agent> <projekt|-> "<cim>" [opciok]
#     --assignee <nev>     alapertelmezes: <agent>
#     --status <s>         alapertelmezes: planned
#     --priority <p>       alapertelmezes: normal
#     --desc <szoveg|->    "-" eseten STDIN-rol olvas
#   A <projekt> helyen a "-" AZT JELENTI, hogy szandekosan nincs projekt.
#   bash scripts/kanban-uj.sh --self-test
#
# Output: siker -> "OK id=<id> created_at=<epoch> (<helyi ido>)" + a VISSZAOLVASOTT mezok.
#         bukas -> "FAIL <ok>", exit 1.  Hasznalati hiba -> exit 2.
# Env: MARVEEN_WEB_PORT (default 3420), KANBAN_UJ_BASE_URL (self-testhez).
set -uo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${MARVEEN_WEB_PORT:-3420}"
ROOT="${KANBAN_UJ_BASE_URL:-http://localhost:${PORT}}"
# A store a TELEPITESBEN van, nem a munkafaban: egy worktree-ben letezik a `store/`
# konyvtar, de nincs benne token. A `MARVEEN_STORE` mar bevett konvencio (harom
# szkript hasznalja), tehat nem uj kapcsolo -- e nelkul egy fejleszto a sajat
# worktreejeben nem tudja vegigprobalni a sajat helperet, ami eppen az a hely, ahol
# a lap szerint fejlesztenie kell.
STORE="${MARVEEN_STORE:-$BASE/store}"
TOKEN_FILE="$STORE/.dashboard-token"

# Osszehasonlitja a KULDOTT es a VISSZAOLVASOTT mezoket. Csak azokat nezi, amiket
# tenylegesen kuldtunk: egy kihagyott mezot a szerver tolt ki, az nem elteres.
# Kulon fuggveny, hogy a --self-test szerver nelkul is meg tudja hivni.
_compare() { # $1 = kuldott JSON, $2 = visszaolvasott JSON -> elteresek soronkent
  python3 - "$1" "$2" <<'PY'
import json, sys
sent = json.loads(sys.argv[1]); got = json.loads(sys.argv[2])
for k in sorted(sent):
    if k in ('actor',):            # a szerver eventbe irja, nem a kartyara
        continue
    want = sent[k]; have = got.get(k)
    if want != have:
        print("  ELTERES %-11s kuldott=%r  kartyan=%r" % (k, want, have))
PY
}

self_test() {
  local bad=0 out rc
  # 1. hasznalati hiba -> rc 2, NEM csendes siker
  out="$(main 2>&1)"; rc=$?
  [ "$rc" = 2 ] && echo "  OK    argumentum nelkul -> rc=2" || { echo "  BUKO  argumentum nelkul: rc=$rc, vart 2"; bad=1; }
  # 2. NEGATIV KONTROLL: elerhetetlen szerver -> rc 1 es HANGOS, nem 'OK'
  out="$(KANBAN_UJ_BASE_URL='http://127.0.0.1:1' main proba - "proba cim" 2>&1)"; rc=$?
  if [ "$rc" = 1 ] && ! printf '%s' "$out" | grep -q '^OK '; then
    echo "  OK    elerhetetlen szerver -> rc=1, nincs 'OK'"
  else echo "  BUKO  elerhetetlen szerver: rc=$rc out=$out"; bad=1; fi
  # 3. a VISSZAOLVASO OSSZEHASONLITAS tud-e elterest mondani (pozitiv kontroll)
  out="$(_compare '{"title":"A","status":"planned"}' '{"title":"A","status":"done"}')"
  printf '%s' "$out" | grep -q 'ELTERES status' \
    && echo "  OK    az osszehasonlito ESZREVESZI az elterest" \
    || { echo "  BUKO  az osszehasonlito nem vette eszre: '$out'"; bad=1; }
  # 4. es tud-e NEM-et mondani (negativ kontroll): azonos mezokre ures
  out="$(_compare '{"title":"A","status":"planned"}' '{"title":"A","status":"planned","extra":1}')"
  [ -z "$out" ] && echo "  OK    azonos mezokre hallgat" || { echo "  BUKO  hamis elteres: '$out'"; bad=1; }
  [ "$bad" = 0 ] && echo "SELF-TEST PASS (4/4)" || echo "SELF-TEST FAIL"
  return "$bad"
}

main() {
  local agent="${1:-}" project="${2:-}" title="${3:-}"
  if [ -z "$agent" ] || [ -z "$project" ] || [ -z "$title" ]; then
    sed -n '/^# Usage:/,/^# Env:/p' "${BASH_SOURCE[0]}" >&2
    return 2
  fi
  shift 3
  local assignee="$agent" status="planned" priority="normal" desc=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --assignee) assignee="${2:-}"; shift 2 ;;
      --status)   status="${2:-}";   shift 2 ;;
      --priority) priority="${2:-}"; shift 2 ;;
      --desc)     desc="${2:-}";     shift 2; [ "$desc" = "-" ] && desc="$(cat)" ;;
      *) echo "FAIL: ismeretlen opcio: $1" >&2; return 2 ;;
    esac
  done
  [ -r "$TOKEN_FILE" ] || { echo "FAIL: nincs olvashato token: $TOKEN_FILE"; return 1; }
  local token; token="$(cat "$TOKEN_FILE")"

  # A torzset python3 epiti: egy kezzel osszefuzott JSON a cim elso idezojelen elszall.
  local body
  body="$(python3 - "$title" "$project" "$assignee" "$status" "$priority" "$desc" "$agent" <<'PY'
import json, sys
t, proj, asg, st, pr, desc, actor = sys.argv[1:8]
d = {"title": t, "status": st, "assignee": asg, "priority": pr, "actor": actor}
if proj != "-": d["project"] = proj
if desc:        d["description"] = desc
print(json.dumps(d, ensure_ascii=False))
PY
)" || { echo "FAIL: a kerés torzsét nem sikerult osszeallitani"; return 1; }

  local resp code out
  resp="$(curl -s -X POST "$ROOT/api/kanban" -H 'Content-Type: application/json' \
          -H "Authorization: Bearer $token" -d "$body" -w $'\n%{http_code}' 2>/dev/null)"
  code="$(printf '%s' "$resp" | tail -n1)"
  out="$(printf '%s' "$resp" | sed '$d')"
  # A curl 0-val ter vissza 400-ra es 500-ra is; a kod ES az id kell, kulon-kulon egyik sem eleg.
  if [ "$code" != "200" ] && [ "$code" != "201" ]; then
    echo "FAIL: a letrehozas HTTP ${code:-nincs} -- a szerver valasza: ${out:-<ures>}"
    return 1
  fi
  local id; id="$(printf '%s' "$out" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))' 2>/dev/null)"
  [ -n "$id" ] || { echo "FAIL: 200 jott, de NINCS id a valaszban: ${out:-<ures>}"; return 1; }
  printf '%s' "$out" | grep -q '"warning"' && echo "FIGYELEM: a szerver figyelmeztetest adott: $out"

  # VISSZAOLVASAS -- a 200 nem bizonyitek, a visszaolvasas az.
  local card
  card="$(curl -s -H "Authorization: Bearer $token" "$ROOT/api/kanban/$id" 2>/dev/null)"
  local created
  created="$(printf '%s' "$card" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("created_at",""))' 2>/dev/null)"
  if [ -z "$created" ]; then
    echo "FAIL: a kartya letrejott (id=$id), de NEM OLVASHATO vissza -- ellenorizd kezzel."
    return 1
  fi
  local diff; diff="$(_compare "$body" "$card")"
  if [ -n "$diff" ]; then
    echo "FAIL: a kartya letrejott (id=$id), de NEM AZ LETT, amit kuldtel:"
    printf '%s\n' "$diff"
    return 1
  fi
  echo "OK id=$id created_at=$created ($(date -r "$created" '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null || date -d "@$created" '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null))"
  printf '%s' "$card" | python3 -c 'import sys,json;c=json.load(sys.stdin);print("   visszaolvasva: status=%s assignee=%s priority=%s project=%s" % (c.get("status"),c.get("assignee"),c.get("priority"),c.get("project")))'
  return 0
}

if [ "${1:-}" = "--self-test" ]; then self_test; exit $?; fi
main "$@"; exit $?
