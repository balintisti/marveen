#!/usr/bin/env bash
# standstill-set.sh -- egy agens workcheck.json `standstill` bejegyzesenek beirasa, es VISSZAOLVASASA
# a tetlen-or SAJAT ertekelojen at.
#
# MIERT LETEZIK (kartya 292ee15a, marveen mert 2026-11-09). A `parseWorkCheck` NYERS SZOVEGET var, nem
# objektumot: objektummal hivva CSENDBEN `null`-t ad, es egy kezzel irt ellenorzes zold, mikozben az
# or mast lat. A hibas vagy lejarat nelkuli bejegyzes pedig elnemitja a tetlen-ort. Ezert a script
#   1. EGY ATMENETI FAJLBA epiti az uj tartalmat, es az or ertekelojen (dist/idle-agent.js:
#      parseWorkCheck + standstillVerdict) ELLENORZI, MIELOTT barmit felulirna: hibas hivasra a
#      workcheck.json BAJTRA ugyanaz marad;
#   2. biztonsagi mentest keszit (workcheck.json.bak-standstill-<idopont>-<pid>: ket hivas egy masodpercen
#      belul ket mentest hagy), es atnevezessel felirja;
#   3. a VEGLEGES fajlt ujra beolvassa ugyanazon az uton, es ha az ertekelo mast mond, mint amit
#      kertek, VISSZAALLITJA a mentest, es nem nulla kodot ad. A `kind` es a `reviewer` valtozatlansaga
#      is resze az ellenorzesnek (a standstill a kind MELLE kerul, nem a helyere).
# Az ertekelo dont a `reason`, az `until` (idozonas ISO-8601, jovobeli, legfeljebb 7 nap) es a `pid`
# fole: a szabalyt nem masoljuk ide, csak megkerdezzuk.
#
# HASZNALAT:
#   bash scripts/standstill-set.sh [--card <id>] [--by <nev>] <agens> <reason> <until> <megjegyzes>
#   bash scripts/standstill-set.sh --self-test
#   <reason>: forbidden | budget | waiting | background_job
#   <until> : pl. 2026-11-11T09:00:00+01:00 (idozona KOTELEZO)
#   Nem tud: pid-es background_job (azt kezzel, a rulebook/workcheck-esetek.md szerint).
#   Kornyezet: STANDSTILL_ROOT (az agents/ es a koordinator fajl gyokere; alapertelmezes: a script
#   melletti repo-gyoker), STANDSTILL_ENGINE (az ertekelo modul; alapertelmezes: <gyoker>/dist/idle-agent.js).
#   A koordinator neve a <gyoker>/.env MAIN_AGENT_ID sorabol jon (mint a watcheren), alapertelmezes: marveen.
#
# KILEPESI KOD: 0 = beirva ES visszaolvasva | 1 = megtagadva vagy visszaallitva | 2 = hasznalati hiba
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
SCRIPT_ROOT="$(cd "$(dirname "$SELF")/.." && pwd)"

read -r -d '' NODE_PROG <<'JS'
import { readFileSync, writeFileSync, statSync, chmodSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const [mode, ...a] = process.argv.slice(1)

if (mode === 'build') {
  // build <file> <out> <reason> <until> <note> <card> <by> <setAt>
  const [file, out, reason, until, note, card, by, setAt] = a
  const text = readFileSync(file, 'utf8')
  let obj
  try { obj = JSON.parse(text) } catch (e) { console.error(`a workcheck.json nem ervenyes JSON: ${e.message}`); process.exit(1) }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) { console.error('a workcheck.json nem objektum'); process.exit(1) }
  if (obj.standstill !== undefined) {
    // a felulirt bejegyzes nyoma a history-ban marad (a fajl eddigi "lifted" alakja)
    if (!Array.isArray(obj.history)) obj.history = []
    obj.history.push({ lifted: new Date().toISOString(), by, why: 'felulirta a standstill-set.sh', lifted_entry: obj.standstill })
  }
  const s = { reason, until }
  if (card) s.card = card
  Object.assign(s, { set_by: by, set_at: setAt, note })
  obj.standstill = s
  const m = text.match(/^\{\n( +)"/)
  const body = JSON.stringify(obj, null, m ? m[1].length : 2) + (text.endsWith('\n') ? '\n' : '')
  writeFileSync(out, body)
  chmodSync(out, statSync(file).mode & 0o777)
  process.exit(0)
}

if (mode === 'verify') {
  // verify <engine> <path> <origPath> <reason> <until>
  const [engine, path, origPath, reason, until] = a
  const eng = await import(pathToFileURL(engine).href)
  // NYERS SZOVEG: a parseWorkCheck objektummal csendben null-t ad
  const check = eng.parseWorkCheck(readFileSync(path, 'utf8'))
  const orig = eng.parseWorkCheck(readFileSync(origPath, 'utf8'))
  const untilMs = Date.parse(until)
  const v = eng.standstillVerdict(check, Date.now(), null)
  const atUntil = eng.standstillVerdict(check, untilMs, null)
  const bad = []
  if (!orig) bad.push('az eredeti workcheck.json az or szerint nem ertelmezheto (nincs ervenyes kind), standstillt nem lehet ra tenni')
  if (v.state !== 'active') bad.push(`az or ertekelese: ${v.state}${v.error ? ` (${v.error})` : ''}${v.why ? ` (${v.why})` : ''}; kert: active`)
  else {
    if (v.standstill.reason !== reason) bad.push(`reason: ${v.standstill.reason}, kert: ${reason}`)
    if (v.standstill.untilMs !== untilMs) bad.push(`until: ${new Date(v.standstill.untilMs).toISOString()}, kert: ${new Date(untilMs).toISOString()}`)
  }
  if (atUntil.state !== 'expired') bad.push(`az until pillanataban az or ertekelese ${atUntil.state}, vart: expired`)
  if (check && orig && check.kind !== orig.kind) bad.push(`a kind megvaltozott: ${orig.kind} -> ${check.kind}`)
  if (check && orig && Boolean(check.reviewer) !== Boolean(orig.reviewer)) bad.push('a reviewer megvaltozott')
  if (bad.length) { for (const b of bad) console.error(`  - ${b}`); process.exit(1) }
  console.log(`az or szerint ACTIVE (reason ${reason}, until ${until}), kind ${check.kind}; az until pillanataban: expired`)
  process.exit(0)
}
console.error(`ismeretlen mod: ${mode}`)
process.exit(2)
JS

run_node() { node --input-type=module -e "$NODE_PROG" -- "$@"; }

set_standstill() {
  local card="" by="unknown (standstill-set.sh)" root engine dir file tmp backup stamp main_id
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --card) [ "$#" -ge 2 ] || { echo "standstill-set: a --card ertek nelkul" >&2; return 2; }; card="$2"; shift 2 ;;
      --by)   [ "$#" -ge 2 ] || { echo "standstill-set: a --by ertek nelkul" >&2; return 2; }; by="$2"; shift 2 ;;
      *) break ;;
    esac
  done
  if [ "$#" -ne 4 ] || [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ] || [ -z "$4" ]; then
    echo "standstill-set: negy nem ures argumentum kell: <agens> <reason> <until> <megjegyzes> (az until nelkul a none lejarat nelkul nemit)" >&2
    sed -n '/^# HASZNALAT:/,/^# KILEPESI/p' "$SELF" >&2
    return 2
  fi
  local agent="$1" reason="$2" until="$3" note="$4"
  case "$agent" in *[!a-z0-9_-]*|-*) echo "standstill-set: ervenytelen agensnev: $agent" >&2; return 1 ;; esac

  root="${STANDSTILL_ROOT:-$SCRIPT_ROOT}"
  engine="${STANDSTILL_ENGINE:-$root/dist/idle-agent.js}"
  [ -f "$engine" ] || { echo "standstill-set: nincs ertekelo modul: $engine (npm run build, vagy STANDSTILL_ENGINE)" >&2; return 1; }
  # ugyanaz az ut, amit a watcher olvas (readWorkCheckRaw): a koordinatornak nincs agents/ mappaja.
  # A koordinator neve a .env FAJLBOL jon (config.ts readEnvFile, mint az idle-reporter.py), NEM a
  # folyamat kornyezetebol: a watcher sem olvas process.env-et.
  main_id="$(sed -n 's/^MAIN_AGENT_ID=//p' "$root/.env" 2>/dev/null | head -n 1 | tr -d '\r' | sed "s/^[[:space:]]*//; s/[[:space:]]*\$//; s/^\"\(.*\)\"\$/\1/; s/^'\(.*\)'\$/\1/")"
  if [ "$agent" = "${main_id:-marveen}" ]; then dir="$root"; else dir="$root/agents/$agent"; fi
  [ -d "$dir" ] || { echo "standstill-set: ismeretlen agens: $agent (nincs $dir)" >&2; return 1; }
  file="$dir/workcheck.json"
  [ -f "$file" ] || { echo "standstill-set: $agent-nak nincs workcheck.json-ja; a kind-ot elobb ki kell mondani, a standstill nem helyettesiti" >&2; return 1; }

  tmp="$(mktemp "$dir/.workcheck.standstill.XXXXXX")" || { echo "standstill-set: nem hozhato letre atmeneti fajl" >&2; return 1; }
  # shellcheck disable=SC2064
  trap "rm -f '$tmp'" RETURN
  run_node build "$file" "$tmp" "$reason" "$until" "$note" "$card" "$by" "$(TZ=Europe/Belgrade date '+%Y-%m-%d %H:%M %Z')" \
    || { echo "standstill-set: MEGTAGADVA, a workcheck.json valtozatlan" >&2; return 1; }
  if ! run_node verify "$engine" "$tmp" "$file" "$reason" "$until" >/dev/null; then
    echo "standstill-set: MEGTAGADVA, az or szerint a kert standstill nem all fenn (reszletek fent); a workcheck.json valtozatlan" >&2
    return 1
  fi

  stamp="$(date '+%Y%m%d-%H%M%S')"
  backup="$file.bak-standstill-$stamp-$$"
  cp -p "$file" "$backup" || { echo "standstill-set: a mentes nem sikerult, nem irok" >&2; return 1; }
  mv -f "$tmp" "$file" || { echo "standstill-set: az atnevezes nem sikerult, a workcheck.json valtozatlan" >&2; return 1; }

  if ! run_node verify "$engine" "$file" "$backup" "$reason" "$until"; then
    if cp -p "$backup" "$file"; then
      echo "standstill-set: a VEGLEGES fajl visszaolvasasa mast adott, mint amit kertek; a mentes VISSZAALLITVA ($backup)" >&2
    else
      echo "standstill-set: a VEGLEGES fajl visszaolvasasa mast adott, mint amit kertek, ES a visszaallitas SIKERTELEN: a mentes kezzel masolando vissza: $backup" >&2
    fi
    return 1
  fi
  echo "OK $agent: standstill beirva; mentes: $backup"
  return 0
}

self_test() {
  local tmp bad=0 rc live_before live_after fut past far
  tmp="$(mktemp -d)"
  local live="$SCRIPT_ROOT" engine="${STANDSTILL_ENGINE:-$SCRIPT_ROOT/dist/idle-agent.js}"
  [ -f "$engine" ] || { echo "  BUKO  nincs ertekelo modul: $engine"; return 1; }
  live_before="$(cat "$live"/agents/*/workcheck.json "$live/workcheck.json" 2>/dev/null | shasum | cut -d' ' -f1)"

  mkdir -p "$tmp/agents/alpha" "$tmp/agents/broken" "$tmp/agents/nofile"
  printf '{\n  "kind": "assigned_open_cards",\n  "reviewer": true,\n  "why": "proba"\n}' > "$tmp/agents/alpha/workcheck.json"
  printf '{"kind":"nincs-ilyen"}' > "$tmp/agents/broken/workcheck.json"
  printf '{"kind":"none"}' > "$tmp/workcheck.json"
  fut="$(node -e 'console.log(new Date(Date.now()+2*3600e3).toISOString())')"
  past="$(node -e 'console.log(new Date(Date.now()-3600e3).toISOString())')"
  far="$(node -e 'console.log(new Date(Date.now()+10*86400e3).toISOString())')"
  local fut2; fut2="$(node -e 'console.log(new Date(Date.now()+3*3600e3).toISOString())')"

  t() { STANDSTILL_ROOT="$tmp" STANDSTILL_ENGINE="${ENG:-$engine}" bash "$SELF" "$@" >"$tmp/out" 2>&1; }
  sha() { shasum "$1" | cut -d' ' -f1; }
  baks() { ls "$1"/workcheck.json.bak-standstill-* 2>/dev/null | wc -l | tr -d ' '; }
  tmps() { ls -A "$1"/.workcheck.standstill.* 2>/dev/null | wc -l | tr -d ' '; }
  ok()  { echo "  OK    $1"; }
  no()  { echo "  BUKO  $1"; sed 's/^/        /' "$tmp/out"; bad=1; }
  want_rc() { [ "$rc" = "$1" ] && ok "$2 (rc=$1)" || no "$2: rc=$rc, vart $1"; }

  local a="$tmp/agents/alpha/workcheck.json" orig h
  chmod 640 "$a"
  orig="$(cat "$a")"; h="$(sha "$a")"

  # 1. POZITIV KONTROLL: ervenyes hivas -> beirva, kind/reviewer/why valtozatlan, mentes = az eredeti
  t --card c1 --by selftest alpha waiting "$fut" "proba"; rc=$?
  want_rc 0 "ervenyes hivas beirja"
  if [ "$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log([o.kind,o.reviewer,o.why,o.standstill.reason,o.standstill.until,o.standstill.card,o.standstill.set_by].join("|"))' "$a")" = "assigned_open_cards|true|proba|waiting|$fut|c1|selftest" ]; then
    ok "a kind, reviewer, why megmaradt; a standstill mezok a fajlban vannak"; else no "a beirt fajl tartalma nem a vart"; fi
  [ "$(cat "$tmp"/agents/alpha/workcheck.json.bak-standstill-* | head -c 4000)" = "$orig" ] && ok "a mentes bajtra az eredeti" || no "a mentes nem az eredeti"
  [ "$(stat -f %Lp "$a")" = "640" ] && ok "a fajl jogosultsaga megmaradt (640)" || no "a fajl jogosultsaga megvaltozott: $(stat -f %Lp "$a")"

  # 2. FELULIRAS: a regi bejegyzes a history-ba kerul. NINCS sleep: ket hivas egy masodpercen belul
  # KET mentest hagy (a mentes neve nem csak az idobelyegtol fugg)
  t alpha budget "$fut2" "masodik"; rc=$?
  want_rc 0 "masodik hivas felulir"
  [ "$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(o.standstill.reason+"|"+o.history.length+"|"+o.history[0].lifted_entry.reason)' "$a")" = "budget|1|waiting" ] \
    && ok "a felulirt bejegyzes a history-ban" || no "a history nem tartalmazza a felulirt bejegyzest"
  [ "$(baks "$tmp/agents/alpha")" = "2" ] && ok "ket hivas egy masodpercen belul ket mentest hagy" || no "a ket hivas $(baks "$tmp/agents/alpha") mentest hagyott, vart 2"
  [ "$(tmps "$tmp/agents/alpha")" = "0" ] && ok "sikeres hivas utan nem marad atmeneti fajl" || no "atmeneti fajl maradt sikeres hivas utan"

  # 2/b. FELULIRAS OLYAN FAJLON, AMIBEN MAR VAN history (mind a 13 elo fajl ilyen): az elozmeny megmarad
  mkdir -p "$tmp/agents/hist"
  node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({kind:"assigned_open_cards",history:[{lifted:"2026-01-01T00:00:00.000Z",why:"regi"}],standstill:{reason:"waiting",until:process.argv[2],set_by:"x",set_at:"y",note:"n"}},null,2)+"\n")' "$tmp/agents/hist/workcheck.json" "$fut"
  t hist budget "$fut2" "felulir"; rc=$?
  want_rc 0 "feluliras history-s fajlon"
  [ "$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(o.history.length+"|"+o.history[0].why+"|"+o.history[1].lifted_entry.reason+"|"+o.standstill.reason)' "$tmp/agents/hist/workcheck.json")" = "2|regi|waiting|budget" ] \
    && ok "a meglevo history megmaradt, a felulirt bejegyzes a vegere kerult" || no "a meglevo history elveszett vagy elmozdult"

  # 3. NEGATIV KONTROLLOK: semmi nem irodik (a fajl SHA-ja es a mentesek szama valtozatlan)
  h="$(sha "$a")"; local nb; nb="$(baks "$tmp/agents/alpha")"
  neg() { # <leiras> <vart rc> <args...>
    local d="$1" w="$2"; shift 2
    t "$@"; rc=$?
    want_rc "$w" "$d"
    [ "$(sha "$a")" = "$h" ] && [ "$(baks "$tmp/agents/alpha")" = "$nb" ] || no "$d: a fajl vagy a mentesek valtoztak"
    [ "$(tmps "$tmp/agents/alpha")" = "0" ] || no "$d: atmeneti fajl maradt a megtagadas utan"
  }
  neg "until nelkul" 2 alpha waiting
  neg "ures until" 2 alpha waiting "" "x"
  neg "lejart until" 1 alpha waiting "$past" "x"
  neg "7 napnal tavolabbi until" 1 alpha waiting "$far" "x"
  neg "idozona nelkuli until" 1 alpha waiting "2099-01-01T10:00:00" "x"
  neg "ismeretlen reason" 1 alpha tetszoleges "$fut" "x"
  t nincs-ilyen waiting "$fut" "x"; rc=$?; want_rc 1 "ismeretlen agens"
  t nofile waiting "$fut" "x"; rc=$?; want_rc 1 "workcheck.json nelkuli agens"
  grep -q 'a kind-ot elobb ki kell mondani' "$tmp/out" && ok "az okot nevezi meg (nincs workcheck.json)" || no "nem az okot nevezi meg"
  h="$(sha "$a")"
  t ../agents/alpha waiting "$fut" "x"; rc=$?; want_rc 1 "utvonal-bejaras az agensnevben (egy LETEZO agens fele)"
  [ "$(sha "$a")" = "$h" ] && ok "a bejarassal celzott fajl valtozatlan" || no "a bejarassal celzott fajl valtozott"
  local bh; bh="$(sha "$tmp/agents/broken/workcheck.json")"
  t broken waiting "$fut" "x"; rc=$?; want_rc 1 "ertelmezhetetlen kind-u fajl"
  grep -q 'nem ertelmezheto' "$tmp/out" && ok "az okot nevezi meg (nincs ervenyes kind)" || no "nem az okot nevezi meg"
  [ "$(sha "$tmp/agents/broken/workcheck.json")" = "$bh" ] && ok "a hibas fajl valtozatlan" || no "a hibas fajl valtozott"

  # 4. KOORDINATOR: a gyokerbeli fajl (ugyanaz az ut, mint a watcher readWorkCheckRaw-ja)
  t marveen forbidden "$fut" "koordinator"; rc=$?
  want_rc 0 "a koordinator fajlja a gyokerben"

  # 4/b. A KOORDINATOR NEVE A .env FAJLBOL JON (mint a watcheren), NEM a folyamat kornyezetebol
  printf 'FOO=1\nMAIN_AGENT_ID=boss\n' > "$tmp/.env"
  h="$(sha "$tmp/workcheck.json")"
  MAIN_AGENT_ID=marveen t marveen forbidden "$fut" "x"; rc=$?
  want_rc 1 "a .env-ben boss a koordinator: a marveen nev (folyamat-kornyezet) NEM a gyoker fajlt irja"
  [ "$(sha "$tmp/workcheck.json")" = "$h" ] && ok "a gyoker fajl valtozatlan" || no "a gyoker fajl valtozott a .env-tol eltero nevre"
  MAIN_AGENT_ID=marveen t boss forbidden "$fut" "x"; rc=$?
  want_rc 0 "a .env szerinti koordinator (boss) a gyoker fajlt irja"
  rm -f "$tmp/.env"

  # 5. AZ ERTEKELO MEGSZOLALTATASA: hamis ertekelokkel a script NEM hihet a sajat irasanak
  local fake="$tmp/fake-engine.mjs"
  cat > "$fake" <<FAKE
import * as real from '$(node -e 'console.log(require("url").pathToFileURL(process.argv[1]).href)' "$engine")'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const mode = process.env.FAKE_MODE
const cf = process.env.FAKE_COUNT
let n = 1
if (cf) { n = (existsSync(cf) ? Number(readFileSync(cf, 'utf8')) : 0) + 1; writeFileSync(cf, String(n)) }
export function parseWorkCheck(t) {
  const r = real.parseWorkCheck(t)
  if (mode === 'kind-flip' && r && t.includes('"set_by": "selftest-flip"')) r.kind = 'none'
  if (mode === 'reviewer-flip' && r && t.includes('"set_by": "selftest-flip"')) r.reviewer = !r.reviewer
  return r
}
export function standstillVerdict(c, now, p) {
  const v = real.standstillVerdict(c, now, p)
  if (mode === 'never-expire' && v.state === 'expired') return { state: 'active', standstill: v.standstill }
  if (mode === 'second-none' && n >= 2) return { state: 'none' }
  if (mode === 'reason-flip' && v.state === 'active') return { state: 'active', standstill: { ...v.standstill, reason: v.standstill.reason === 'waiting' ? 'budget' : 'waiting' } }
  if (mode === 'until-shift' && v.state === 'active') return { state: 'active', standstill: { ...v.standstill, untilMs: v.standstill.untilMs + 3600e3 } }
  return v
}
FAKE
  h="$(sha "$a")"; nb="$(baks "$tmp/agents/alpha")"
  ENG="$fake" FAKE_MODE=second-none FAKE_COUNT="$tmp/count" t alpha waiting "$fut" "x"; rc=$?
  want_rc 1 "a vegleges visszaolvasas elter -> hiba"
  grep -q 'VISSZAALLITVA' "$tmp/out" && ok "kimondja, hogy visszaallitotta a mentest" || no "nem mondja ki a visszaallitast"
  [ "$(sha "$a")" = "$h" ] && ok "a fajl bajtra a visszaallitott eredeti" || no "a fajl nem allt vissza"
  ENG="$fake" FAKE_MODE=never-expire t alpha waiting "$fut" "x"; rc=$?
  want_rc 1 "ha az ertekelo az until utan is 'active', megtagadja"
  [ "$(sha "$a")" = "$h" ] && ok "megtagadasnal a fajl valtozatlan" || no "a fajl valtozott"
  ENG="$fake" FAKE_MODE=kind-flip t --by selftest-flip alpha waiting "$fut" "x"; rc=$?
  want_rc 1 "ha a kind megvaltozik a visszaolvasasban, megtagadja"
  ENG="$fake" FAKE_MODE=reviewer-flip t --by selftest-flip alpha waiting "$fut" "x"; rc=$?
  want_rc 1 "ha a reviewer megvaltozik a visszaolvasasban, megtagadja"
  ENG="$fake" FAKE_MODE=until-shift t alpha waiting "$fut" "x"; rc=$?
  want_rc 1 "ha az ertekelo mas until-t lat, mint a kert, megtagadja"
  ENG="$fake" FAKE_MODE=reason-flip t alpha waiting "$fut" "x"; rc=$?
  want_rc 1 "ha az ertekelo mas reason-t lat, mint a kert, megtagadja"
  [ "$(tmps "$tmp/agents/alpha")" = "0" ] && ok "a hamis-ertekelos megtagadasok utan nem marad atmeneti fajl" || no "atmeneti fajl maradt"
  [ "$(sha "$a")" = "$h" ] && ok "a fajl a vegen is valtozatlan" || no "a fajl valtozott a hamis-ertekelos probak utan"

  # 6. A CSAPDA MAGA: objektummal hivva a parseWorkCheck csendben null-t ad (ez az, amit a script nem kovet el)
  if [ "$(node --input-type=module -e "import('file://$engine').then(m=>console.log(m.parseWorkCheck({kind:'none'})===null))")" = "true" ]; then
    ok "kontroll: a parseWorkCheck objektummal null-t ad (ezert olvas a script nyers szoveget)"
  else
    echo "  BUKO  a parseWorkCheck mar elfogad objektumot: a script nyers-szoveg feltevese felulvizsgalando"; bad=1
  fi

  # 7. ELO FAJLOKHOZ NEM NYULT A TESZT
  live_after="$(cat "$live"/agents/*/workcheck.json "$live/workcheck.json" 2>/dev/null | shasum | cut -d' ' -f1)"
  [ "$live_before" = "$live_after" ] && ok "az elo workcheck fajlok valtozatlanok (STANDSTILL_ROOT=temp)" || { echo "  BUKO  az elo workcheck fajlok valtoztak"; bad=1; }

  rm -rf "$tmp"
  [ "$bad" = 0 ] && echo "self-test: PASS" || echo "self-test: FAIL"
  return "$bad"
}

main() {
  if [ "${1:-}" = "--self-test" ]; then self_test; return $?; fi
  set_standstill "$@"
}

main "$@"
