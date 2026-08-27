#!/bin/bash

# -v / --verbose: kiirja a siker-sort is. Alapertelmezesben csendes, lasd lentebb.
# --outline <skill>: kiirja EGY skill szekcio-cimeit es a FELKOVER bevezetoit.
#
# Ez nem detektor, hanem a KET LISTA masodik listaja (didi merese, 2026-08-22). Aznap ket agens
# ugyanazt a lecket irta ugyanabba a skill-magba fel oran belul -- egyikuk sem volt hanyag, csak
# mindketten a sajat fejukbol dolgoztak, es NEM VOLT MIHEZ HASONLITANI.
#
# Miert nem a duplikatum-szuro: didi megmerte a skill-fan (47 skill, 271 szekcio). Egy PROZAS
# szekcio SZO SZERINTI masolata 0.00 pontot kap (nincs benne fajlnev, kartya-id, vegpont), mikozben
# husz-egynehany NEM-duplikatum par 10 folott all -- a rangsor FORDITOTT. Egy lecke pedig eppen
# prozas. A szuro a kanbanra jo, ide nem.
#
# Miert nem a globalis indexbe: az Level 0 kontextus, minden korben betoltodik. 271 szekcio-cim
# ott alland koltseg egy olyan informacioert, ami evente parszor kell.
#
# Es miert a FELKOVER bevezetok is: a mai eset egyik fele NEM `##` cim volt, hanem egy `**...**`
# bekezdes egy meglevo szekcion belul. Egy csak-cimekre nezo lista azt sem fogta volna meg.
if [ "${1:-}" = "--outline" ]; then
  _skill="${2:-}"
  if [ -z "$_skill" ]; then echo "hasznalat: skill-index.sh --outline <skill-nev>" >&2; exit 64; fi
  _f="$HOME/.claude/skills/$_skill/SKILL.md"
  if [ ! -f "$_f" ]; then echo "nincs ilyen skill: $_skill" >&2; exit 66; fi
  echo "$_skill  ($(wc -l < "$_f" | tr -d ' ') sor)"
  grep -nE '^#{2,3} |^\*\*[^*]+\*\*' "$_f" | sed 's/^/  /'
  for _r in "$HOME/.claude/skills/$_skill/references/"*.md; do
    [ -f "$_r" ] || continue
    echo "  -- references/$(basename "$_r")  ($(wc -l < "$_r" | tr -d ' ') sor)"
    grep -nE '^#{2,3} ' "$_r" | sed 's/^/    /'
  done
  exit 0
fi

VERBOSE=0
_args=()
for _a in "$@"; do
  case "$_a" in
    -v|--verbose) VERBOSE=1 ;;
    *) _args+=("$_a") ;;
  esac
done
set -- "${_args[@]+"${_args[@]}"}"
# Skill Index Generator
# Generates a Level 0 index of all available skills (name + description only)
# This keeps token usage low while making all skills discoverable
#
# Usage: skill-index.sh [AGENT_DIR]
#   Without arg: generates global index at ~/.claude/skills/.skill-index.md
#   With AGENT_DIR: generates merged index (global + agent-specific) at
#                   <AGENT_DIR>/.claude/skills/.skill-index.md
#                   (backward-compatible format for no-arg callers)

GLOBAL_SKILLS_DIR="$HOME/.claude/skills"

if [ $# -ge 1 ]; then
  AGENT_DIR="$1"
  AGENT_SKILLS_DIR="$AGENT_DIR/.claude/skills"
  OUTPUT="$AGENT_SKILLS_DIR/.skill-index.md"
  MERGED=1
  mkdir -p "$AGENT_SKILLS_DIR"
else
  AGENT_DIR=""
  AGENT_SKILLS_DIR=""
  OUTPUT="$GLOBAL_SKILLS_DIR/.skill-index.md"
  MERGED=0
fi

if [ ! -d "$GLOBAL_SKILLS_DIR" ]; then
  echo "No global skills directory found at $GLOBAL_SKILLS_DIR"
  exit 0
fi

echo "# Skill Index (Level 0)" > "$OUTPUT"
echo "" >> "$OUTPUT"

if [ "$MERGED" = "1" ]; then
  echo "Ez az ágensspecifikus skill index: globális (~/.claude/skills) és ágensspecifikus (.claude/skills) skilleket egyaránt tartalmaz." >> "$OUTPUT"
  echo "Ha egy skill releváns, olvasd be a teljes SKILL.md-t (Level 1)." >> "$OUTPUT"
  echo "Ha segédfájlokra is szükség van, nézd meg a scripts/ és references/ mappákat (Level 2)." >> "$OUTPUT"
  echo "" >> "$OUTPUT"
  echo "| Skill | Leírás | Scope |" >> "$OUTPUT"
  echo "|-------|--------|-------|" >> "$OUTPUT"
else
  echo "Ez az összes elérhető skill rövid indexe. Csak a nevet és leírást tartalmazza (Level 0)." >> "$OUTPUT"
  echo "Ha egy skill releváns, olvasd be a teljes SKILL.md-t (Level 1)." >> "$OUTPUT"
  echo "Ha segédfájlokra is szükség van, nézd meg a scripts/ és references/ mappákat (Level 2)." >> "$OUTPUT"
  echo "" >> "$OUTPUT"
  echo "| Skill | Leírás |" >> "$OUTPUT"
  echo "|-------|--------|" >> "$OUTPUT"
fi

SKILL_COUNT=0

index_skills_dir() {
  local dir="$1"
  local scope="$2"  # only used when MERGED=1
  for skill_dir in "$dir"/*/; do
    [ -d "$skill_dir" ] || continue
    local skill_md="$skill_dir/SKILL.md"
    [ -f "$skill_md" ] || continue

    local name
    name=$(grep -m1 "^name:" "$skill_md" 2>/dev/null | sed 's/^name: *//' | tr -d '"' | tr -d "'")
    if [ -z "$name" ]; then
      name=$(basename "$skill_dir")
    fi

    local desc
    desc=$(grep -m1 "^description:" "$skill_md" 2>/dev/null | sed 's/^description: *//' | tr -d '"' | tr -d "'" | cut -c1-120)
    if [ -z "$desc" ]; then
      desc="(nincs leírás)"
    fi

    if [ "$MERGED" = "1" ]; then
      echo "| \`$name\` | $desc | $scope |" >> "$OUTPUT"
    else
      echo "| \`$name\` | $desc |" >> "$OUTPUT"
    fi
    SKILL_COUNT=$((SKILL_COUNT + 1))
  done
}

index_skills_dir "$GLOBAL_SKILLS_DIR" "global"

if [ "$MERGED" = "1" ] && [ -d "$AGENT_SKILLS_DIR" ]; then
  index_skills_dir "$AGENT_SKILLS_DIR" "agent"
fi

echo "" >> "$OUTPUT"
echo "_${SKILL_COUNT} skill indexelve. Generálva: $(date '+%Y-%m-%d %H:%M')_" >> "$OUTPUT"

# CSENDES A SIKERES UTON (2026-08-22, didi javaslata, es a ket elnemitas okabol).
# Ket agens egymastol fuggetlenul futtatta ezt a szkriptet `>/dev/null 2>&1` alakban --
# NEM a figyelmeztetes miatt, hanem hogy EZT a sort elrejtse. A `2>&1` aztan a
# figyelmeztetest is elvitte. A ket stream szetvalasztasa helyes volt, csak nem elegendo:
# a hivo nem stream-enkent gondolkodik, hanem "ne irjon semmit"-ben.
#
# Ezert a siker-sor mostantol CSAK `-v`/`--verbose` eseten irodik ki. Igy a hivonak nincs
# MIERT elnemitania, es a figyelmeztetes eleve nem kerul veszelybe. A reflexet nem tulelni
# kell, hanem megszuntetni az okat.
#
# ES AMIERT EZ NEM NEMA SIKER: a "lefutott-e" kerdesre a KILEPESI KOD felel (0 = kesz,
# 3 = kesz + hatar-atlepes, minden mas = hiba). Egy szkript, ami hallgat ES nincs
# kilepesi kodja, tenyleg megkulonboztethetetlen lenne attol, hogy el sem indult.
if [ "${VERBOSE:-0}" = "1" ]; then
  echo "Skill index generated: $OUTPUT ($SKILL_COUNT skills)"
fi

# ---- meret-or -------------------------------------------------------------
# MIERT: a skill-hatar (500 sor) eddig CSAK azon allt, hogy valakinek eszebe jut
# megmerni. 2026-08-21 13:45-kor jelentettem, hogy a harom bontott skill 132/226/186
# sor -- 2026-08-22 04:30-ra az egyik 576 lett, es a hatar-atlepes SEHOL nem latszott.
# Isti szabalya: ha egy megoldas azon all, hogy valaki megjegyez valamit, az nem megoldas.
SKILL_LINE_LIMIT="${SKILL_LINE_LIMIT:-500}"

# ---- ALAPVONAL: MIT MERUNK, ES MIT NEM (2026-08-23, Marveen dontese) ---------
#
# A hatar eddig a TELJES magot merte. Egy fajlnal (felderites-ket-listas-proba) ez
# olyan szoveget is szamolt, ami a BELEPESI ALAK ELOTT irodott: 47 szabaly-blokkbol
# 17 fuzi ossze a szabalyt es a tortenetet EGY mondatba, osszesen 86 sorban.
# Friday megmerte, hogy ezek SZO SZERINT nem athelyezhetok: 17-bol 1. A tobbihez
# atfogalmazas kellene, az pedig a szerzojuk dontese.
#
# Ezert a mero KETTEVALASZTVA merjen: a NOVEKEDES az, amiert mostantol felelunk;
# a legacy szam ATTOL MEG MINDEN FUTASNAL OTT ALL. Ez NEM mentesites -- egy
# alapvonal-mentesseg pontosan az az alak, ami tagulni tud anelkul, hogy barki
# eszrevenne (didi merte ma este a KNOWN_INLINE-nal: egy kivetel, ami TAGABB lett
# a kivetelezett esetnel, es a tagulasa nem hibauzenetkent, hanem HIANYZO
# RIASZTASKENT jelent meg). Ezert all melle a KEMENY FELSO KORLAT is.
#
# Alapvonal: 2026-08-24 09:57, felderites-ket-listas-proba = 491 sor -- a `references/`
# BONTAS UTANI mert meret. (Elotte 513 volt, egy 08-23 02:3x-i meresbol.)
#
# MIERT VALTOZOTT: a bontas 549 -> 491 volt, az alapvonal viszont 513 maradt, es ezzel a bontas
# 58 soros nyeresege NOVEKEDESI KERETTE valt -- a fajl 528-ig nohetett volna hang nelkul, es ot
# oran belul 510-en allt. A bontas igy nem a nyereseget rogzitette, hanem helyet csinalt az
# ujranovesnek.
# A SZABALY: minden sikeres `references/` bontas utan az alapvonal a bontas UTANI mert meret lesz.
# A nyereseget a kapu rogziti, nem az emlekezet. Barmelyik szerzo barmikor atfogalmazhatja a sajatjat,
# es akkor ez a szam CSOKKENTHETO -- de nem kotelezo.
# Env-bol felulirhato, hogy a ket uj ag TESZTELHETO legyen ismert allapotokon.
SKILL_BASELINE_NAMES="${SKILL_BASELINE_NAMES:-felderites-ket-listas-proba}"
# 491 -> 504 (2026-08-27). KET KIMONDOTT dontes, ket szerzo, egy szamban -- es azert
# all itt mindketto kulon, mert egy nevtelen alapvonal-emeles pontosan az az alak, amit
# ez a kapu megelozni hivatott.
#   +4  friday: uj 12. alak -- "egy szerszam, ami VERDIKTET ad, maga is kivan kontrollt"
#       (835384e6). Ugyanabban a korben ket szakasz `references/`-be kerult, tehat a
#       fajl 506 -> 495 lett: a BOVITES MELLETT IS CSOKKENT.
#   +9  didi: a "tul szep nulla" harmadik jele -- amikor a SZAMLALO pont kiadja a
#       NEVEZOT (100%, vagy a kiegeszito kontroll pont nulla). Valodi uj alak, nem
#       atfogalmazas: a meglevo szabaly azert nem fogta volna meg, mert o LELETET
#       keresett, tehat a 100% az ELLENKEZOJE volt annak, amit vart -- a jel kizarolag
#       az EGYBEESESBEN volt.
# A kulonbseg nem a szam, hanem hogy le van-e irva, MIERT: bontas MELLEKHATASAKENT
# tagulni SOHA; kimondott dontessel, valodi uj tartalomra IGEN. Kartya: d1190641.
# 504 -> 474 (2026-08-27, friday). BONTAS utani rogzites, nem emeles.
# A fajl 519-en allt (+15, PONT a kapun), es ma HAROM agens jelezte kulon-kulon;
# ketten emiatt NEM irtak be egy-egy jogos sort. Ot alak (4., 5., 6., 7., 10.)
# kikerult a `references/alakok.md`-be, a magban a NEVUK maradt: 519 -> 474.
# A valasztas ISMETLODES szerint tortent, nem kor szerint -- a 2-3 esetes alakok
# mentek ki, a 7-9 esetesek maradtak. A hely azoke, amik sokszor jottek elo.
# Az uj alapvonal a bontas utani meret ES a regi alapvonal MINIMUMA (474 < 504),
# a mai szabaly szerint: a nyereseget a kapu rogziti, nem az emlekezet. A masik
# irany -- 504-en hagyni -- 30 sor nema visszanovest engedne.
# 504 -> 474 -> 489 (2026-08-27). A HARMADIK emeles ugyanazon a napon, es KIMONDOTT dontes:
# ma NEGY szerzo tett bele osszesen 15 sor VALODI uj szabalyt (nem atfogalmazast), es ketten
# NEM tudtak beirni egy-egy jogos sort, mert a keret elfogyott. Marveen sajat sora is emiatt
# kerult vissza a magbol a `references/`-be.
# MIERT NEM VAGAS: friday es dexter FUGGETLENUL atnezte a sajat bejegyzeseit a kikotessel, hogy
# tomoriteni CSAK akkor szabad, ha a rovidebb alak UGYANANNYIT mond -- es egyik sem fert bele.
# "Ha vagok belole, nem tomoritek, hanem csonkitok." (dexter) Ma harom vagas mar volt ezen a
# fajlon; a negyedik futoszalag lenne.
# EZ NEM A KAPU KUDARCA: a keret pont azt erte el, hogy MINDEN betoldas kimondott dontes legyen.
# A VALODI valasz a mag ATRENDEZESE (66 szabaly egy fajlban mar kategoria, nem fajl) -- az kulon
# kartyan all. Ez az emeles addig old fel, nem helyette.
SKILL_BASELINE_LINES="${SKILL_BASELINE_LINES:-436}"
# Mennyit nohet a mag az alapvonal ota. A belepesi alak szerint egy uj lecke 2-3 sor
# a magban, tehat 15 ~ ot uj lecke, mielott torleszteni kell.
SKILL_GROWTH_LIMIT="${SKILL_GROWTH_LIMIT:-15}"
# KEMENY FELSO KORLAT, a novekedestol FUGGETLENUL. Enelkul egy alapvonal-emeles
# csendben barmeddig tolhatna a hatart.
SKILL_HARD_LIMIT="${SKILL_HARD_LIMIT:-600}"

# A MASODIK SZAM: KARAKTER A SOR MELLE (kartya 83cac1ed, didi merese 2026-08-27).
# A sorszam a MERTEK, a karakter a VEDETT dolog. Mert eset: egy fajl 504 sorrol 504 sorra
# "valtozott", kozben +300 karakterrel -- egy ket sorra tordelt bekezdes egy sorra huzva,
# es a felszabadult sorra egy uj bekezdes. A sor-alapu or ebbol SEMMIT nem latott.
# A baseline PAR: a ket szam UGYANABBOL a fajl-allapotbol valo, kulonben az atlag hazudik.
SKILL_BASELINE_CHARS="${SKILL_BASELINE_CHARS:-32848}"

baseline_for() {
  # egyetlen nev ma; tobbnel szokoz-elvalasztott lista es azonos sorrendu szamok
  local want="$1" i=1 name
  for name in $SKILL_BASELINE_NAMES; do
    if [ "$name" = "$want" ]; then
      echo "$SKILL_BASELINE_LINES" | cut -d' ' -f"$i"
      return 0
    fi
    i=$((i+1))
  done
  echo ""
}

OVER_LIMIT=0
OVER_LIST=""
for f in "$GLOBAL_SKILLS_DIR"/*/SKILL.md; do
  [ -f "$f" ] || continue
  n=$(wc -l < "$f" | tr -d ' ')
  skill=$(basename "$(dirname "$f")")
  base=$(baseline_for "$skill")
  if [ -n "$base" ]; then
    growth=$((n - base))
    # A csokkenes NE `+-87`-kent jelenjen meg: egy rosszul formazott szam
    # ugyanugy elveszi a bizalmat, mint egy rossz szam.
    if [ "$growth" -ge 0 ]; then growth_s="+${growth}"; else growth_s="${growth}"; fi
    # MINDIG MINDKET SZAM. A legacy nem tunik el attol, hogy nem erte miatt bukunk.
    if [ "$growth" -gt "$SKILL_GROWTH_LIMIT" ]; then
      OVER_LIMIT=$((OVER_LIMIT+1))
      OVER_LIST="${OVER_LIST}  ${skill}  ${n} sor (alapvonal ${base}, novekedes ${growth_s} > ${SKILL_GROWTH_LIMIT})\n"
    elif [ "$n" -gt "$SKILL_HARD_LIMIT" ]; then
      OVER_LIMIT=$((OVER_LIMIT+1))
      OVER_LIST="${OVER_LIST}  ${skill}  ${n} sor -- KEMENY FELSO KORLAT (${SKILL_HARD_LIMIT}) atlepve\n"
    else
      # FELTETEL NELKUL, NEM `-v` MOGOTT (didi merese, 2026-08-24). Ez az `if [ -n "$base" ]`
      # agon BELUL all, tehat CSAK alapvonalas skillre fut -- ma pontosan EGY ilyen van, a
      # kimenet EGY sorral no, nem 54-gyel.
      #
      # MIERT: a `-v` NELKUL csak a kilepesi kod latszik, a `VERBOSE=1` env pedig INERT (a :35
      # feltetel nelkul nullazza). Aznap a mag 491->499->510->504->506->500->512-513 palyat jart
      # be, es az or vegig `exit 0`-t mondott -- marveen tizenotnel tobbszor futtatta ugy, hogy
      # a szamot egyszer sem latta. Az erdekes eset epp az, amikor a fajl a HATAR ALATT VAN es
      # MOZOG; azt a `-v` mogott elrejteni annyi, mint nem merni.
      #
      # Ez az EGYETLEN lepcso a negybol, ami nem all a fegyelmen: nem kell hozza sem kapcsolo,
      # sem env, sem proza, amit valakinek be kell gepelnie.
      # ES A MARADEK KERET IS, NEM CSAK AZ ERTEK (mandark merte 2026-08-27, didi
      # vette eszre). A sor eddig megmondta, MENNYI a novekedes, es nem mondta meg,
      # hogy MENNYI FER MEG. Aki a "+15"-ot latta, nem tudta belole, hogy EGYETLEN
      # sor valasztja el a riasztastol -- mandark ezt a hatart meg is merte, a
      # fajlhoz nem nyulva: SKILL_GROWTH_LIMIT=14 mellett (ami aritmetikailag a
      # +16-os eset) a kimenet MASIK agra valt, es a kilepesi kod 0 -> 3.
      #
      # A kar iranya az, ami miatt ez nem kozmetika: a riasztast NEM az kapja, aki a
      # keretet elhasznalta, hanem a KOVETKEZO, aki egy jogos sort beir.
      #
      # KET korlat van, es a SZUKEBBET kell mondani, kulonben a szam megint tobbet
      # iger, mint amennyi igaz: a novekedesi keret (limit - novekedes) es a kemeny
      # felso korlat (HARD_LIMIT - sorok). Ha a kemeny korlat a szukebb, a sor ki is
      # mondja, melyik kotott meg -- egy szam a kotoereje nelkul ugyanaz a hiba,
      # mint egy szam populacio nelkul.
      # A KARAKTER-MERO: NEM MASODIK KERET, HANEM A SORSZAM OSZINTESEGE.
      # Egy sima karakter-keret nem zarna be a rest: a mert eset +300 karakter volt,
      # egy "15 sornyi" karakter-keret (~1100) atengedte volna. A kerdes nem az, hogy
      # mennyi karakter jott, hanem hogy a SORSZAM MEGMAGYARAZZA-E.
      #     A       = alapvonal_karakter / alapvonal_sor      (atlagos sorhossz)
      #     excess  = d_karakter - d_sor * A                  (amit a sorszam NEM magyaraz)
      # es CSAK NOVEKEDESRE nezzuk. A szimmetrikus alak megbukna a negativ kontrollon:
      # a mai valodi bontas (504->436 sor, 37773->32848 kar) +427 excess-t ad, mert az
      # elvitt sorok az ATLAGNAL ROVIDEBBEK voltak -- a kepletbol az jon ki, hogy "nem
      # eleg karakter tunt el". Egy or, ami a BONTASRA tuzel, pont a helyes valtozast
      # buntetne.
      #
      # MIERT FIGYELMEZTETES ES NEM BUKAS. A lelet az volt, hogy a sor-alapu or ebbol
      # SEMMIT NEM LATOTT -- a hiany a LATHATOSAG, nem a tiltas. Es merve: a mai
      # allapot (444 sor / 34032 kar) a 436/32848 alapvonalhoz kepest AZONNAL tuzelne,
      # mert a `description:` EGYETLEN hosszu sor. Egy or, ami az elso napon jogos
      # munkara blokkol, egy heten belul zaj. Ha a jelzes tul halknak bizonyul, a
      # kilepesi kodra emelni egy sor -- visszafele viszont mar nem lehet.
      _chars=$(wc -c < "$f" | tr -d ' ')
      _basec="${SKILL_BASELINE_CHARS:-0}"
      if [ "${_basec:-0}" -gt 0 ] && [ "$base" -gt 0 ]; then
        _avg=$((_basec / base))
        _dchar=$((_chars - _basec))
        _excess=$((_dchar - growth * _avg))
        if [ "$_dchar" -gt 0 ] && [ "$_excess" -gt "$_avg" ]; then
          echo "MERET-OR: ${skill}  A SORSZAM NEM MONDJA MEG A MERETET: ${_excess} karakternyi tobblet, amit a ${growth_s} sor nem magyaraz (atlagos sorhossz ${_avg})."
        fi
      fi
      # A KEMENY AG MA ALSZIK, ES EZT KI KELL MONDANI (didi merte 2026-08-27).
      # A feltetelbol a FAJLMERET KIESIK, tehat csak a harom konstanson mulik:
      #     HARD - n < LIMIT - (n - BASE)   <=>   HARD < LIMIT + BASE
      # Ma: 600 < 15 + 436 = 451 -> HAMIS, tehat az ag NEM TUD tuzelni. Numerikus
      # kontroll n=1..600-ra: nulla talalat. A teszt a KONSTANSOKAT a szkriptbol
      # olvassa, tehat ez a szam nem tud elavulni ugy, hogy a teszt zold marad. Elove BASE >= 586-tol valik (585-nel
      # meg 600 < 600, hamis).
      # NEM torlom: az alapvonal MA HAROMSZOR mozdult (474 -> 489 -> 436), es ha
      # atlepi a kuszobot, a "35 sor maradt" hamis igeret lenne. De egy ag, ami
      # sosem tuzel, megkulonboztethetetlen egy helyestol -- ezert a dormancia
      # TESZTTEL van rogzitve (skill-index.test.ts), es a
      # teszt akkor bukik, amikor az ag FELEBRED. Igy nem eszrevetlenul valik
      # elove, hanem szolva.
      _room_growth=$((SKILL_GROWTH_LIMIT - growth))
      _room_hard=$((SKILL_HARD_LIMIT - n))
      if [ "$_room_hard" -lt "$_room_growth" ]; then
        _room="${_room_hard} sor maradt (a KEMENY korlat kot: ${SKILL_HARD_LIMIT})"
      else
        _room="${_room_growth} sor maradt (keret ${SKILL_GROWTH_LIMIT})"
      fi
      echo "MERET-OR: ${skill}  ${n} sor / ${_chars} karakter (alapvonal ${base}, novekedes ${growth_s} -- ${_room})"
    fi
  elif [ "$n" -gt "$SKILL_LINE_LIMIT" ]; then
    OVER_LIMIT=$((OVER_LIMIT+1))
    OVER_LIST="${OVER_LIST}  ${skill}  ${n} sor\n"
  fi
done

# POZITIV KONTROLL: egy or, ami sosem tud tuzelni, ugyanugy "mukodik", mint egy helyes.
# Ellenorizzuk, hogy a szamlalo-ag EGYALTALAN elerheto-e egy biztosan tullepo bemenettel.
_probe=$(printf 'x\n%.0s' $(seq 1 $((SKILL_LINE_LIMIT+1))) | wc -l | tr -d ' ')
# ES KONTROLL A KET UJ AGRA IS. Egy or, aminek uj aga van, de az az ag sosem
# tuzel, pontosan ugy nez ki, mint egy helyes or -- ez ma este haromszor jott elo.
# Agankent EGY ismert eset: egy alapvonalas skill, ami a novekedesre bukna, es egy,
# ami a kemeny korlatra.
_probe_growth=$(( (513 + SKILL_GROWTH_LIMIT + 1) - 513 ))
_probe_hard=$(( SKILL_HARD_LIMIT + 1 ))
_arms_ok=1
[ "$_probe_growth" -gt "$SKILL_GROWTH_LIMIT" ] || _arms_ok=0
[ "$_probe_hard" -gt "$SKILL_HARD_LIMIT" ] || _arms_ok=0
[ -n "$(baseline_for felderites-ket-listas-proba)" ] || _arms_ok=0
if [ "$_probe" -le "$SKILL_LINE_LIMIT" ] || [ "$_arms_ok" -ne 1 ]; then
  echo "MERET-OR: a pozitiv kontroll ELBUKOTT (szamlalas vagy egy uj ag nem mukodik) -- az or NEM megbizhato." >&2
elif [ "$OVER_LIMIT" -gt 0 ]; then
  echo "" >&2
  echo "MERET-OR: ${OVER_LIMIT} skill lepte tul a hatarat:" >&2
  printf "%b" "$OVER_LIST" >&2
  echo "  -> references/ bontas javasolt. A LEGFRISSEBB szekciok vannak a fajl vegen," >&2
  echo "     tehat epp azok jutnak el a legkevesebb olvasohoz." >&2
else
  if [ "${VERBOSE:-0}" = "1" ]; then
    echo "MERET-OR: minden skill a sajat hatara alatt (alapvonalas: novekedes <= ${SKILL_GROWTH_LIMIT} es teljes <= ${SKILL_HARD_LIMIT}; a tobbi: <= ${SKILL_LINE_LIMIT}). Pozitiv kontroll: OK."
  fi
fi

# ES A LEPES, AMI NELKUL A FENTI EGESZ NEMA MARADHAT (2026-08-22, merve, es a hiba az enyem):
# a figyelmeztetes stderr-re megy, ami HELYES -- de ma ejjel ketszer futtattam ezt a szkriptet
# `>/dev/null 2>&1` alakban, hogy az "index generated" sort elrejtsem, es ezzel a FIGYELMEZTETEST
# is eldobtam. Ugyanabban a ket fordulóban vittem a felderites-ket-listas-proba fajlt 611 -> 634 ->
# 643 sorra. Az or hibatlanul dolgozott, es senki nem hallotta.
#
# Egy uzenet, ami CSAK szoveg, annyira hangos, amennyire a HIVO engedi. Egy kilepesi kod nem az:
# tulel egy `>/dev/null 2>&1`-et is, es megallit egy `&&` lancot. Ezert a hatar-atlepes mostantol
# 3-as kilepesi kod. A 3 SAJAT ertek, nem 1: egy valodi generalasi hiba tovabbra is megkulonboztetheto
# marad attol, hogy az index elkeszult ES a hatar-or talalt valamit.
if [ "${OVER_LIMIT}" -gt 0 ]; then
  exit 3
fi
