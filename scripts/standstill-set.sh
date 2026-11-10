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
#   melletti repo-gyoker), STANDSTILL_ENGINE (az ertekelo modul; alapertelmezes: <gyoker>/dist/idle-agent.js),
#   STANDSTILL_ENV_PARSE (a watcher .env-parsere; alapertelmezes: <gyoker>/dist/env-parse.js),
#   STANDSTILL_LOCK_WAIT (a zarra varas ciklusai 0,05 s-ent; alapertelmezes: 200). Halott pid-ju vagy pid nelkuli, egy percnel
#   regebbi zarat a script maga vesz at; jelre (TERM, INT, HUP) a SAJAT zarat es atmeneti fajlt takaritja, es 128+jel kodot ad.
#   A koordinator neve a <gyoker>/.env MAIN_AGENT_ID sorabol jon, a watcher SAJAT parserevel (utolso sor nyer),
#   alapertelmezes (hianyzo kulcs vagy .env): marveen. Egy agensre egyszerre egy hivas ir (zar: <agens-mappa>/.workcheck.standstill.lock).
#
# KILEPESI KOD: 0 = beirva ES visszaolvasva | 1 = megtagadva vagy visszaallitva | 2 = hasznalati hiba | 129/130/143 = jel (HUP/INT/TERM)
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

if (mode === 'mainid') {
  // mainid <env-parse.js> <envfile>: a koordinator neve UGYANAZZAL a parserrel, amit a watcher .env-olvasasa
  // hasznal (dist/env-parse.js, a config.ts readEnvFile-ja): nincs masolt .env-nyelvtan.
  // Kilepes: 0 = a kulcs van (az erteke a kimenet, lehet ures is); 3 = nincs .env vagy nincs kulcs
  // (a watcher ilyenkor a marveen alapertelmezest hasznalja); mas = nem sikerult olvasni (a hivo megall).
  const [parser, envFile] = a
  const { parseEnvContent } = await import(pathToFileURL(parser).href)
  let text
  try { text = readFileSync(envFile, 'utf8') } catch { process.exit(3) }
  const v = parseEnvContent(text, ['MAIN_AGENT_ID']).MAIN_AGENT_ID
  if (v === undefined) process.exit(3)
  console.log(v)
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

write_locked() {
  # A zar alatti resz. A hivo (set_standstill) valtozoit hasznalja (dynamic scope), es o takarit utana.
  tmp="$(mktemp "$dir/.workcheck.standstill.XXXXXX")" || { echo "standstill-set: nem hozhato letre atmeneti fajl" >&2; return 1; }
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

# A zar elavult, ha a tulajdonos pid-je nem fut, vagy ha nincs pid-fajl, es a zar egy percnel regebbi (a mkdir es a
# pid-iras kozott megszakitott hivas hagyja igy; az iras ezredmasodpercek). Egy pid-fajl NELKULI friss zar elo.
# A pid ujrakiosztasa (egy halott pid-et mas folyamat kapott) elo zarnak latszik: az a kezi torles utja.
lock_is_stale() {
  local lock="$1" pid="$2"
  case "$pid" in
    "") [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ] ;;
    *[!0-9]*) return 1 ;;
    *) ! ps -p "$pid" >/dev/null 2>&1 ;;
  esac
}

# A set_standstill valtozoit hasznalja (dynamic scope); csak a zar MEGSZERZESE utan van bekotve, tehat a
# SAJAT zarat es atmeneti fajlt takaritja.
release_on_signal() {
  trap - TERM INT HUP
  [ -n "${tmp:-}" ] && rm -f "$tmp"
  rm -rf "$lockdir"
  exit "$1"
}

set_standstill() {
  local card="" by="unknown (standstill-set.sh)" root engine dir file tmp backup stamp main_id lockdir
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
  # A koordinator neve a .env FAJLBOL jon, a watcher SAJAT parserevel (mode mainid: dist/env-parse.js),
  # NEM a folyamat kornyezetebol es NEM egy ide masolt sed-ekkel: a watcher az UTOLSO MAIN_AGENT_ID sort
  # veszi, a ket oldal kozti eltérest egy masolt nyelvtan okozta (didi, 57482). Ures ertek = ures nev
  # (a watcher `??`-e csak a hianyzo kulcsra ad marveent).
  local rc_m=0
  local envparse="${STANDSTILL_ENV_PARSE:-$root/dist/env-parse.js}"
  main_id="$(run_node mainid "$envparse" "$root/.env")" || rc_m=$?
  case "$rc_m" in
    0) ;;
    3) main_id="marveen" ;;
    *) echo "standstill-set: a koordinator neve nem olvashato (a watcher .env-parserenek betoltese vagy a .env olvasasa nem sikerult: $envparse)" >&2; return 1 ;;
  esac
  if [ "$agent" = "$main_id" ]; then dir="$root"; else dir="$root/agents/$agent"; fi
  [ -d "$dir" ] || { echo "standstill-set: ismeretlen agens: $agent (nincs $dir)" >&2; return 1; }
  file="$dir/workcheck.json"
  [ -f "$file" ] || { echo "standstill-set: $agent-nak nincs workcheck.json-ja; a kind-ot elobb ki kell mondani, a standstill nem helyettesiti" >&2; return 1; }

  # EGY IRO AGENSENKENT (didi 57482): a build-mentes-csere-visszaolvasas egy olvas-modosit-ir sor; ket
  # egyideju hivasnal a vesztes a SAJAT mentesevel irta felul a nyertes irasat, miutan az mar OK-t
  # mondott. A zar mkdir-rel (atomi); a varakozas lejarta utan NEM ir, es megnevezi a zarat.
  lockdir="$dir/.workcheck.standstill.lock"
  local waited=0 max_wait="${STANDSTILL_LOCK_WAIT:-200}" holder stolen
  until mkdir "$lockdir" 2>/dev/null; do
    # A mkdir NEM a foglalt zar miatt bukott: nincs zar, es a mappa nem irhato (a60deb91). Varas nelkul,
    # igaz okkal; ha a zar kozben eltunt (-w igen), a ciklus ujraprobalja.
    if [ ! -e "$lockdir" ] && [ ! -w "$dir" ]; then
      echo "standstill-set: nem irhato az agens mappaja, a zar nem hozhato letre: $dir; nem irok" >&2
      return 1
    fi
    holder="$(cat "$lockdir/pid" 2>/dev/null || true)"
    if lock_is_stale "$lockdir" "$holder"; then
      # ATNEVEZESSEL vesszuk at (atomi: ket varakozo kozul egy nyer), es csak akkor toroljuk, ha a pid ugyanaz,
      # amit elavultnak lattunk; ha kozben egy ELO hivas zarat vittuk el, visszaneveztuk.
      stolen="$lockdir.stale.$$"
      if mv "$lockdir" "$stolen" 2>/dev/null; then
        if [ "$(cat "$stolen/pid" 2>/dev/null || true)" = "$holder" ]; then
          rm -rf "$stolen"
          echo "standstill-set: elavult zar torolve (zar: $lockdir, pid: ${holder:-nincs}, a folyamat nem fut)" >&2
        elif [ -e "$lockdir" ] || ! mv "$stolen" "$lockdir" 2>/dev/null; then
          echo "standstill-set: egy ELO hivas zarat elvittem, es a visszaadas nem sikerult: $stolen (kezzel kell visszanevezni: $lockdir)" >&2
          return 1
        fi
      fi
    fi
    waited=$((waited + 1))
    if [ "$waited" -gt "$max_wait" ]; then
      echo "standstill-set: egy masik hivas ir ugyanennek az agensnek (zar: $lockdir, pid: ${holder:-ismeretlen}); nem irok. Ha az a folyamat mar nem fut, a zarat kezzel kell torolni." >&2
      return 1
    fi
    sleep 0.05
  done
  echo "$$" > "$lockdir/pid"
  # NINCS RETURN trap (didi 57710, A5): az kulon ertelmezest igenyelt, hogy a masodik tuzelesnel ne vigye el
  # egy MASIK hivas friss zarat. A zart tarto resz a write_locked-ben fut, es a zar meg az atmeneti fajl
  # EGYSZER, kozvetlenul utana torlodik, minden uton (siker, megtagadas, sikertelen visszaallitas).
  # JEL (TERM, INT, HUP) alatt ugyanezt a takaritast a release_on_signal vegzi (a60deb91). A trap a zar
  # megszerzese UTAN all be (varakozas kozben nincs mit takaritani), es a takaritas ELOTT kerul le: kulonben
  # egy kesei jel egy MASIK hivas frissen letrehozott zarat torolne. A jel a mkdir es a trap kozott
  # (ezredmasodpercek) bent hagyhat egy zarat: azt a lock_is_stale veszi at.
  local rc_w=0
  trap 'release_on_signal 143' TERM
  trap 'release_on_signal 130' INT
  trap 'release_on_signal 129' HUP
  write_locked || rc_w=$?
  trap - TERM INT HUP
  rm -f "$tmp"; rm -rf "$lockdir"
  return "$rc_w"
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

  local envp="${STANDSTILL_ENV_PARSE:-$(dirname "$engine")/env-parse.js}"
  t() { STANDSTILL_ROOT="$tmp" STANDSTILL_ENGINE="${ENG:-$engine}" STANDSTILL_ENV_PARSE="${PARSE:-$envp}" bash "$SELF" "$@" >"$tmp/out" 2>&1; }
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

  # 4/b2. A WATCHER PARSERE NEM TOLTHETO BE (didi 57710, A1): megtagadas, NEM visszaeses a marveen nevre.
  # A .env a koordinatornak alpha-t nevezi; ha a hiba marveenre esne vissza, az alpha az agents/alpha fajlt
  # irna (rc 0), pedig a watcher szerint ez a gyoker fajl.
  printf 'MAIN_AGENT_ID=alpha\n' > "$tmp/.env"
  h="$(sha "$tmp/workcheck.json")"; local ah0; ah0="$(sha "$a")"
  PARSE="$tmp/nincs-ilyen-parser.js" t alpha waiting "$fut" "x"; rc=$?
  want_rc 1 "betolthetetlen parser -> megtagadja"
  grep -q 'nincs-ilyen-parser.js' "$tmp/out" && ok "megnevezi a parser utat" || no "nem nevezi meg a parser utat"
  { [ "$(sha "$tmp/workcheck.json")" = "$h" ] && [ "$(sha "$a")" = "$ah0" ]; } && ok "betolthetetlen parsernel semmilyen fajl nem valtozik" || no "betolthetetlen parsernel valtozott egy fajl"
  rm -f "$tmp/.env"

  # 4/c. A .env-NYELVTAN A WATCHERE (dist/env-parse.js), nem egy masolt sed: a .env-alakok, amelyeken a
  # regi sed elterne a watchertol (didi 57482: 16 alakbol 5). root = a gyoker fajl valtozik, agent = az
  # agents/old fajlja, refused = semmi.
  mkdir -p "$tmp/agents/old"; printf '{"kind":"none"}' > "$tmp/agents/old/workcheck.json"
  envcase() { # <leiras> <env-tartalom (printf %b)> <agens> <root|agent|refused>
    local d="$1" content="$2" ag="$3" want="$4" rh ah rn=same an=same
    printf '%b' "$content" > "$tmp/.env"
    rh="$(sha "$tmp/workcheck.json")"; ah="$(sha "$tmp/agents/old/workcheck.json")"
    t "$ag" waiting "$fut" "x"; rc=$?
    [ "$(sha "$tmp/workcheck.json")" = "$rh" ] || rn=changed
    [ "$(sha "$tmp/agents/old/workcheck.json")" = "$ah" ] || an=changed
    case "$want" in
      root)    [ "$rc" = 0 ] && [ "$rn" = changed ] && [ "$an" = same ]    && ok "$d" || no "$d: rc=$rc gyoker=$rn old=$an, vart: a gyoker fajl valtozik" ;;
      agent)   [ "$rc" = 0 ] && [ "$rn" = same ]    && [ "$an" = changed ] && ok "$d" || no "$d: rc=$rc gyoker=$rn old=$an, vart: az agents/old fajl valtozik" ;;
      refused) [ "$rc" = 1 ] && [ "$rn" = same ]    && [ "$an" = same ]    && ok "$d" || no "$d: rc=$rc gyoker=$rn old=$an, vart: megtagadas, semmi nem valtozik" ;;
    esac
    rm -f "$tmp/.env"
  }
  envcase ".env ket MAIN_AGENT_ID sora: az UTOLSO (boss) a koordinator -> boss a gyokeret irja" 'MAIN_AGENT_ID=old\nMAIN_AGENT_ID=boss\n' boss root
  envcase ".env ket MAIN_AGENT_ID sora: az ELSO (old) nem koordinator -> old a sajat fajljat irja" 'MAIN_AGENT_ID=old\nMAIN_AGENT_ID=boss\n' old agent
  envcase ".env CRLF sorvegek" 'FOO=1\r\nMAIN_AGENT_ID=boss\r\n' boss root
  envcase ".env idezojeles ertek (\")" 'MAIN_AGENT_ID="boss"\n' boss root
  envcase ".env idezojeles ertek (')" "MAIN_AGENT_ID='boss'\n" boss root
  envcase ".env sor eleji szokoz es KULCS = ertek" '  MAIN_AGENT_ID = boss  \n' boss root
  envcase ".env ures ertek: a watcher ures nevet lat, a marveen nev NEM a gyoker" 'MAIN_AGENT_ID=\n' marveen refused

  # 5. AZ ERTEKELO MEGSZOLALTATASA: hamis ertekelokkel a script NEM hihet a sajat irasanak
  local fake="$tmp/fake-engine.mjs"
  cat > "$fake" <<FAKE
import * as real from '$(node -e 'console.log(require("url").pathToFileURL(process.argv[1]).href)' "$engine")'
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
const mode = process.env.FAKE_MODE
const cf = process.env.FAKE_COUNT
let n = 1
if (cf) { n = (existsSync(cf) ? Number(readFileSync(cf, 'utf8')) : 0) + 1; writeFileSync(cf, String(n)) }
export function parseWorkCheck(t) {
  if (mode === 'slow') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FAKE_SLEEP_MS))
  const r = real.parseWorkCheck(t)
  if (mode === 'kind-flip' && r && t.includes('"set_by": "selftest-flip"')) r.kind = 'none'
  if (mode === 'reviewer-flip' && r && t.includes('"set_by": "selftest-flip"')) r.reviewer = !r.reviewer
  return r
}
export function standstillVerdict(c, now, p) {
  const v = real.standstillVerdict(c, now, p)
  if (mode === 'never-expire' && v.state === 'expired') return { state: 'active', standstill: v.standstill }
  if (mode === 'second-none' && n >= 2) return { state: 'none' }
  if (mode === 'drop-backup' && n >= 2) {
    for (const f of readdirSync(process.env.FAKE_DIR)) if (f.includes('.bak-standstill-')) unlinkSync(process.env.FAKE_DIR + '/' + f)
    return { state: 'none' }
  }
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

  # 5/b. A VISSZAALLITAS MAGA IS ELBUKHAT (a :141 ag): a mentes eltunt a visszaolvasas es a visszamasolas kozt
  h="$(sha "$a")"
  ENG="$fake" FAKE_MODE=drop-backup FAKE_DIR="$tmp/agents/alpha" FAKE_COUNT="$tmp/count-drop" t alpha waiting "$fut" "x"; rc=$?
  want_rc 1 "sikertelen visszaallitas -> hiba"
  grep -q 'visszaallitas SIKERTELEN' "$tmp/out" && grep -q 'kezzel masolando' "$tmp/out" \
    && ok "kimondja, hogy a visszaallitas sikertelen, es hogy a mentest kezzel kell visszamasolni" || no "nem mondja ki a sikertelen visszaallitast"
  grep -q 'VISSZAALLITVA' "$tmp/out" && no "sikertelen visszaallitast VISSZAALLITVA-nak mondja" || ok "nem allitja, hogy visszaallitott"
  [ "$(tmps "$tmp/agents/alpha")" = "0" ] && ok "sikertelen visszaallitas utan nem marad atmeneti fajl vagy zar" || no "atmeneti fajl vagy zar maradt"

  # 5/c. ZAR: foglalt zar mellett nem ir (es megnevezi a zarat), a fajl valtozatlan
  # ELO pid kell (a self-test sajat shellje): a halott pid-u zarat a script mar maga veszi at (5/e).
  mkdir "$tmp/agents/alpha/.workcheck.standstill.lock"; echo "$$" > "$tmp/agents/alpha/.workcheck.standstill.lock/pid"
  h="$(sha "$a")"
  STANDSTILL_LOCK_WAIT=3 t alpha waiting "$fut" "x"; rc=$?
  want_rc 1 "foglalt zar -> megtagadja"
  grep -q 'standstill.lock' "$tmp/out" && ok "megnevezi a zarat" || no "nem nevezi meg a zarat"
  grep -q "pid: $$)" "$tmp/out" && ok "megnevezi a zarat tarto folyamat pid-jet" || no "nem nevezi meg a zarat tarto pid-et"
  [ "$(sha "$a")" = "$h" ] && ok "foglalt zarnal a fajl valtozatlan" || no "foglalt zarnal a fajl valtozott"
  [ -d "$tmp/agents/alpha/.workcheck.standstill.lock" ] && ok "a masik hivas zarjat nem torolte" || no "a megtagadott hivas letorolte a masik zarat"
  rm -rf "$tmp/agents/alpha/.workcheck.standstill.lock"

  # 5/e. ELAVULT ZAR (a60deb91): halott pid-u zarat a hivas maga vesz at es ir; a pid nelkuli, FRISS zar elo
  # (a mkdir es a pid-iras kozott vagyunk), a pid nelkuli, REGI zar elavult. Mindegyik utan nem marad zar/tmp.
  local dead lk="$tmp/agents/alpha/.workcheck.standstill.lock"
  sleep 0 & dead=$!; wait "$dead" 2>/dev/null
  printf '%s' "$orig" > "$a"
  mkdir "$lk"; echo "$dead" > "$lk/pid"
  STANDSTILL_LOCK_WAIT=3 t alpha waiting "$fut" "x"; rc=$?
  want_rc 0 "halott pid-u zar -> a hivas atveszi es ir"
  grep -q 'elavult zar' "$tmp/out" && ok "kimondja, hogy elavult zarat torolt" || no "nem mondja ki az elavult zar torleset"
  grep -q '"standstill"' "$a" && ok "az elavult zar utan a standstill a fajlban van" || no "az elavult zar utan nincs standstill"
  [ "$(tmps "$tmp/agents/alpha")" = "0" ] && ok "elavult zar utan nem marad zar, atmeneti fajl vagy .stale mappa" || no "zar, atmeneti fajl vagy .stale mappa maradt"
  printf '%s' "$orig" > "$a"; h="$(sha "$a")"
  mkdir "$lk"
  STANDSTILL_LOCK_WAIT=3 t alpha waiting "$fut" "x"; rc=$?
  want_rc 1 "pid nelkuli FRISS zar elo -> megtagadja"
  [ -d "$lk" ] && [ "$(sha "$a")" = "$h" ] && ok "a pid nelkuli friss zar es a fajl valtozatlan" || no "a pid nelkuli friss zar eltunt vagy a fajl valtozott"
  touch -t 200001010000 "$lk"
  STANDSTILL_LOCK_WAIT=3 t alpha waiting "$fut" "x"; rc=$?
  want_rc 0 "pid nelkuli REGI zar -> atveszi es ir"
  [ "$(tmps "$tmp/agents/alpha")" = "0" ] && ok "pid nelkuli regi zar utan nem marad zar vagy atmeneti fajl" || no "zar vagy atmeneti fajl maradt"

  # 5/f. JEL A ZAR ALATT (a60deb91): a lassu ertekelo (fake, slow) alatt a hivas jelet kap; a SAJAT zarat es
  # atmeneti fajlt takaritja, 128+jel kodot ad, a fajl valtozatlan. A jelet a script (bash) kapja, a node
  # gyerek nem: a trap a gyerek lefutasa utan tuzel. A perl az INT-et alapertelmezettre allitja (egy hattérben
  # indult folyamat orokli a SIG_IGN-t, es azt a bash nem tudja trapelni).
  local sig sigrc spid i want
  for sig in TERM INT HUP; do
    case "$sig" in TERM) want=143 ;; INT) want=130 ;; HUP) want=129 ;; esac
    printf '%s' "$orig" > "$a"; h="$(sha "$a")"
    STANDSTILL_ROOT="$tmp" STANDSTILL_ENGINE="$fake" STANDSTILL_ENV_PARSE="$envp" FAKE_MODE=slow FAKE_SLEEP_MS=1500 \
      perl -e '$SIG{INT}="DEFAULT"; $SIG{HUP}="DEFAULT"; exec @ARGV' bash "$SELF" alpha waiting "$fut" "x" >"$tmp/sig.out" 2>&1 &
    spid=$!
    for i in $(seq 1 100); do [ -f "$lk/pid" ] && break; sleep 0.05; done
    [ -f "$lk/pid" ] || no "$sig: a zar nem jelent meg (a teszt nem tud jelet kuldeni zar alatt)"
    kill "-$sig" "$spid" 2>/dev/null
    wait "$spid" 2>/dev/null; sigrc=$?
    [ "$sigrc" = "$want" ] && ok "$sig zar alatt -> rc $want" || no "$sig zar alatt rc $sigrc (vart: $want)"
    [ ! -e "$lk" ] && ok "$sig utan a zar torolve" || no "$sig utan a zar bent maradt"
    [ "$(tmps "$tmp/agents/alpha")" = "0" ] && ok "$sig utan nem marad atmeneti fajl" || no "$sig utan atmeneti fajl maradt"
    [ "$(sha "$a")" = "$h" ] && ok "$sig utan a workcheck.json valtozatlan" || no "$sig utan a workcheck.json valtozott"
  done
  # jel egy MASIK hivas zarara: a varakozo hivas jelet kap, a tulajdonos zarat nem torli
  mkdir "$lk"; echo "$$" > "$lk/pid"
  STANDSTILL_ROOT="$tmp" STANDSTILL_ENGINE="$engine" STANDSTILL_ENV_PARSE="$envp" STANDSTILL_LOCK_WAIT=200 \
    bash "$SELF" alpha waiting "$fut" "x" >"$tmp/sig.out" 2>&1 &
  spid=$!; sleep 0.5; kill -TERM "$spid" 2>/dev/null; wait "$spid" 2>/dev/null
  [ -d "$lk" ] && ok "a varakozo hivas jelre nem torli a masik hivas zarat" || no "a varakozo hivas jelre letorolte a masik zarat"
  rm -rf "$lk"

  # 5/g. IRHATATLAN AGENS-MAPPA (a60deb91): sajat, igaz uzenet, varakozas nelkul (nem a 'masik hivas ir' szoveg).
  # root-kent a chmod nem tilt: akkor a kontrollt kihagyjuk.
  if [ "$(id -u)" != 0 ]; then
    printf '%s' "$orig" > "$a"; h="$(sha "$a")"
    chmod 555 "$tmp/agents/alpha"
    local t0 t1; t0=$SECONDS
    STANDSTILL_LOCK_WAIT=200 t alpha waiting "$fut" "x"; rc=$?
    t1=$((SECONDS - t0))
    chmod 755 "$tmp/agents/alpha"
    want_rc 1 "irhatatlan agens-mappa -> megtagadja"
    grep -q 'nem irhato' "$tmp/out" && ok "kimondja, hogy a mappa nem irhato" || no "nem mondja ki az irhatatlan mappat"
    grep -q 'masik hivas' "$tmp/out" && no "irhatatlan mappanal a 'masik hivas ir' uzenetet adja" || ok "nem allitja, hogy egy masik hivas ir"
    [ "$t1" -lt 3 ] && ok "varakozas nelkul visszater (${t1} s)" || no "irhatatlan mappanal vart ${t1} s-ot"
    [ "$(sha "$a")" = "$h" ] && ok "irhatatlan mappanal a fajl valtozatlan" || no "irhatatlan mappanal a fajl valtozott"
  fi

  # 5/d. KET EGYIDEJU HIVAS UGYANARRA AZ AGENSRE (didi 57482: 20 korbol 15-ben az egyik OK-t mondott, es a
  # standstill nem volt a fajlban). Minden korben: ha valamelyik hivas OK-t mond, a fajlban ott a standstill.
  local rnd silent=0 o1 o2 rcs
  for rnd in 1 2 3 4 5 6 7 8; do
    printf '%s' "$orig" > "$a"
    ( STANDSTILL_ROOT="$tmp" STANDSTILL_ENGINE="$engine" STANDSTILL_ENV_PARSE="$envp" bash "$SELF" alpha waiting "$fut" "p1" >"$tmp/c1" 2>&1; echo $? >"$tmp/c1.rc" ) &
    ( STANDSTILL_ROOT="$tmp" STANDSTILL_ENGINE="$engine" STANDSTILL_ENV_PARSE="$envp" bash "$SELF" alpha budget  "$fut2" "p2" >"$tmp/c2" 2>&1; echo $? >"$tmp/c2.rc" ) &
    wait
    o1="$(head -c 2 "$tmp/c1")"; o2="$(head -c 2 "$tmp/c2")"
    if { [ "$o1" = "OK" ] || [ "$o2" = "OK" ]; } && ! grep -q '"standstill"' "$a"; then silent=$((silent + 1)); fi
    rcs="$(cat "$tmp/c1.rc") $(cat "$tmp/c2.rc")"
    [ "$rcs" = "0 0" ] || { echo "  BUKO  egyideju hivasok rc-je: $rcs (vart: 0 0, egymas utan sorosan)"; sed 's/^/        /' "$tmp/c1" "$tmp/c2"; bad=1; }
  done
  [ "$silent" = 0 ] && ok "egyideju hivasok: 8 korbol 0-ban mondott valamelyik OK-t standstill nelkul" || { echo "  BUKO  egyideju hivasok: 8 korbol $silent-ban OK, de nincs standstill a fajlban"; bad=1; }
  [ "$(tmps "$tmp/agents/alpha")" = "0" ] && ok "egyideju hivasok utan nem marad atmeneti fajl vagy zar" || no "atmeneti fajl vagy zar maradt az egyideju hivasok utan"
  h="$(sha "$a")"

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
