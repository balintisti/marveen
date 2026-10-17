#!/usr/bin/env bash
#
# readonly-measure.sh -- eles adaton vegzett CSAK-OLVASO meres futtathato vaza (kartya f1c119fe).
#
# MIERT LETEZIK. A CLAUDE.md „Eles adatbazis MERESE" receptje JO, es harman futtattuk egy
# ejszaka -- de az allvanyt mindenki kulon epitette ujra, es ketten ugyanabba a NEMA csapdaba
# futottunk: EGY TIPUSHIBA A MERESBEN MEGSZAKITJA A KOTEGET, tehat a `gate_after` NEM FUT LE,
# es a kimenet megkulonboztethetetlen egy szabalyos futastol. Az adat mindket esetben rendben
# nezett ki. A zaro kapu pont azt hivatott bizonyitani, hogy a meres VEGIG a zart tranzakcioban
# maradt; ha a hianya nema, a recept betartasa a szandekon all.
#
# EZERT AZ EGYETLEN SIKER-FELTETEL: KET megfigyelt
#     ERROR:  cannot execute UPDATE in a read-only transaction
# Egy is keves. Nem figyelmeztetest irunk, hanem NEM-NULLA kilepesi koddal allunk meg -- ez
# ugyanaz a kulonbseg, mint egy jelzo, ami hazudik, es egy kapu, ami megtagad.
#
# A KAPU ALAKJA: `UPDATE <tabla> SET <oszlop> = <oszlop> WHERE false`
#
#   Se WHERE-literal, se tipus. A lap `WHERE id = -1` alakja NEM-EGESZ kulcson TIPUSHIBAT ad
#   (`operator does not exist: uuid = integer`, `... text = integer`) -- az is „hiba", tehat a
#   kontroll VELETLENUL mond igazat, kikapcsolt kapu mellett is.
#
#   A CSAPDA TAGABB, MINT AHOGY A LAP ELOSZOR LEIRTA: ott UUID-problemakent szerepelt, marveen
#   viszont fuggetlenul ujramerte TEXT kulcson is, es ott ugyanugy tuzel. Vagyis BARMELY nem-egesz
#   kulcs eleg hozza -- es ezert nem az a megoldas, hogy a helyes literalt valasztjuk tipusonkent,
#   hanem hogy a kerdes megszunik. Merve ezen a vazon (t_int / t_uuid, PG 14):
#
#       read-only + WHERE false, int kulcs .... ERROR: cannot execute UPDATE ...   <- a kapu
#       read-only + WHERE false, uuid kulcs ... ERROR: cannot execute UPDATE ...   <- a kapu
#       read-only + WHERE id = -1, uuid kulcs . ERROR: operator does not exist     <- NEM a kapu
#       NEM read-only + WHERE false ........... UPDATE 0                           <- nulla kar
#
#   Az utolso sor a biztonsagi tulajdonsag: ha a kapu BARMIERT nem tuzel, az ertekadas
#   identitas es a WHERE hamis, tehat nulla sor mozdul. A kontroll nem tud karta valni attol,
#   hogy mukodik.
#
# MOTOR: **KIZAROLAG POSTGRES.** SQLite-on a zaro kapu alakja mas -- a lap merve rogziti, hogy
# ott a `CREATE TEMP TABLE` ATMEGY egy read-only kapcsolaton (a temp store kulon el), tehat ott
# valodi-tabla-irasra van szukseg. Ez a vaz nem probalja meg tobb motorra: inkabb mondja ki a
# hatarat, mint hogy egy masik motoron csendben mast merjen.
#
# Hasznalat:
#   scripts/readonly-measure.sh --sql meres.sql [--url URL | --env PATH] [--gate-table T --gate-column C]
#
set -uo pipefail

SQL_FILE=""; URL=""; ENV_FILE=""; GATE_TABLE=""; GATE_COLUMN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sql) SQL_FILE="${2:-}"; shift 2 ;;
    --url) URL="${2:-}"; shift 2 ;;
    --env) ENV_FILE="${2:-}"; shift 2 ;;
    --gate-table) GATE_TABLE="${2:-}"; shift 2 ;;
    --gate-column) GATE_COLUMN="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,45p' "$0"; exit 0 ;;
    *) echo "ismeretlen kapcsolo: $1" >&2; exit 64 ;;
  esac
done

[ -n "$SQL_FILE" ] || { echo "NEM MERTEM: --sql kotelezo (a meres SQL-fajlja)" >&2; exit 64; }
[ -f "$SQL_FILE" ] || { echo "NEM MERTEM: nincs ilyen fajl: $SQL_FILE" >&2; exit 64; }

# --- A HIVO SQL-JE NEM LEPHET KI A BUROKBOL -- kartya f978316e. A burok (lent) egy READ ONLY
# tranzakcio; a hivo fajlja `\i`-vel KOZEPEN fut. Egy COMMIT/END/ROLLBACK a hivo fajljaban LEZARJA
# a burkot, es ami utana jon, AUTOCOMMITBAN fut, csak-olvaso vedelem nelkul -- a zaro kapu ekkor
# elmarad (1 tuzeles, exit 4), de az iras MAR MEGTORTENT. Ugyanigy egy `\c` mas kapcsolatra valt,
# a `\!` hejat futtat. Ezert ezeket FUTAS ELOTT elutasitjuk, nem utolag merjuk.
#
# EGY MENETBEN LEXEL, BALROL JOBBRA, mert a psql is igy olvas. Az elozo, regex-sorozatos szuro
# egymas utan vette ki a kommenteket es a literalokat, es egy aposztrof egy `--` kommentben, egy
# "it's" azonositoban vagy egy E'\'' literalban elnyelte a kovetkezo COMMIT-ot: didi helyi
# Postgresen mind a harommal irt egy sort (38602). A `$$...$$` torzset sem ismerte, ezert a DO
# blokk END-jet kilepesnek vette. A psql `:valtozo` behelyettesitese SQL-t csempeszhet a szuro
# moge (`\set q COMMIT` + `:q;`), a meta-parancs argumentumaban a backtick hejat futtat, a `\\`
# utan uj meta-parancs jon: ezeket is elutasitjuk. Lezaratlan literal/komment: elutasitas (a
# psql a burok sorait nyelne bele).
# A PGOPTIONS='-c default_transaction_read_only=on' NEM pot: a Supabase pooler ezt az egy GUC-ot
# elnyeli (rulebook/delta-crm.md, "KET ALAK, AMI VEDELEMNEK LATSZIK").
# A HATAR, kimondva: standard_conforming_strings=on-t feltetelez (a PG alapertelmezese). Nem latja
# a dinamikus SQL-t (EXECUTE egy DO-blokkban) es egy CALL-olt eljaras sajat COMMIT-jat; ezek ellen
# a READ ONLY tranzakcio maga ved (tranzakcio-blokkon belul a DO/CALL nem zarhat tranzakciot, es
# egy olvaso tranzakcioban nem is ir).
TXN_HIT="$(python3 - "$SQL_FILE" <<'PYX'
import re,sys
src=open(sys.argv[1],encoding='utf-8',errors='replace').read()
Q,DQ,BT=chr(39),chr(34),chr(96)
ID=re.compile(r'[A-Za-z0-9_$\x80-\U0010ffff]')
DOLLAR=re.compile(r'\$(?:[A-Za-z_\x80-\U0010ffff][A-Za-z0-9_\x80-\U0010ffff]*)?\$')
META_OK=re.compile(r'(?:echo|qecho|warn|pset|set|unset|x|a|t|T|f|H|C|timing|conninfo|encoding|l\+?|z|d[A-Za-z]*[+S]*|s[fv]\+?)$')
hits=[]; code=[]; i=0; n=len(src)
def ln(p): return src.count('\n',0,p)+1
def quoted(i,q,esc):
    j=i+1
    while j<n:
        if esc and src[j]=='\\': j+=2; continue
        if src[j]==q:
            if j+1<n and src[j+1]==q: j+=2; continue
            return j+1
        j+=1
    return -1
while i<n:
    ch=src[i]; nx=src[i+1] if i+1<n else ''
    if ch=='-' and nx=='-':
        j=src.find('\n',i); i=n if j<0 else j; continue
    if ch=='/' and nx=='*':
        d=1; j=i+2
        while j<n and d:
            if src.startswith('/*',j): d+=1; j+=2
            elif src.startswith('*/',j): d-=1; j+=2
            else: j+=1
        if d: hits.append('%d: lezaratlan /* komment'%ln(i)); break
        code.append(' '); i=j; continue
    if ch in (Q,DQ):
        esc=ch==Q and i>0 and src[i-1] in 'eE' and not (i>1 and ID.match(src[i-2]))
        j=quoted(i,ch,esc)
        if j<0: hits.append('%d: lezaratlan %s'%(ln(i),ch)); break
        code.append(ch*2); i=j; continue
    if ch=='$' and not (i>0 and ID.match(src[i-1])):
        m=DOLLAR.match(src,i)
        if m:
            j=src.find(m.group(0),m.end())
            if j<0: hits.append('%d: lezaratlan %s'%(ln(i),m.group(0))); break
            code.append(Q+Q); i=j+len(m.group(0)); continue
    if ch=='\\':
        m=re.match(r'[A-Za-z]+[+S]*|[^\sA-Za-z]?',src[i+1:])
        name=m.group(0); j=src.find('\n',i); j=n if j<0 else j
        args=src[i+1+len(name):j]
        if not META_OK.match(name): hits.append('%d: \\%s'%(ln(i),name))
        elif BT in args or chr(92) in args: hits.append('%d: \\%s argumentumaban backtick vagy backslash'%(ln(i),name))
        code.append(';'); i=j; continue
    if ch==':' and nx!=':' and not (i>0 and src[i-1]==':') and re.match('[A-Za-z_'+Q+DQ+']',nx):
        hits.append('%d: :%s (psql-valtozo)'%(ln(i),re.match(r'[^\s;]*',src[i+1:]).group(0)[:20])); i+=1; continue
    code.append(ch); i+=1
TXN=re.compile(r'(?is)^\s*(commit|end|abort|begin|start\s+transaction|rollback(?!\s+(?:work\s+|transaction\s+)?to\b)|set\s+(?:session\s+characteristics|transaction)|prepare\s+transaction)\b')
for st in ''.join(code).split(';'):
    m=TXN.match(st)
    if m: hits.append(re.sub(r'\s+',' ',m.group(1)).upper())
print('; '.join(hits))
PYX
)"
if [ -n "$TXN_HIT" ]; then
  echo "NEM MERTEM: a meres SQL-je kilepne a csak-olvaso burokbol: $TXN_HIT" >&2
  echo "  A tranzakciot a burok nyitja es zarja; a fajlban ne legyen COMMIT/END/ROLLBACK/BEGIN, se \\c, \\!, \\i, se :valtozo." >&2
  echo "  Engedett meta-parancsok: \\echo \\qecho \\warn \\pset \\set \\unset \\x \\a \\t \\timing \\d* \\l \\z \\sf \\sv (backtick nelkul)." >&2
  echo "  Egy spekulativ blokk hibaja ellen NEM kell sajat SAVEPOINT: a burok ON_ERROR_ROLLBACK-kal fut." >&2
  exit 64
fi

# --- URL feloldas. A `.env` Prisma-URL-jet a libpq VISSZAUTASITJA valtoztatas nelkul
# (`invalid URI query parameter: "connection_limit"`), es a hibauzenet az URL-rol szol, tehat
# elsore hitelesitesi hibanak latszik. A query-reszt levagjuk, `sslmode=require`-t teszunk oda.
# Az URL-t SEHOL nem irjuk ki -- jelszot tartalmaz.
if [ -z "$URL" ]; then
  if [ -n "${DATABASE_URL:-}" ]; then URL="$DATABASE_URL"
  elif [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
    URL="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')"
  fi
fi
[ -n "$URL" ] || { echo "NEM MERTEM: nincs adatbazis-URL (--url, DATABASE_URL vagy --env)" >&2; exit 64; }
BASE_URL="${URL%%\?*}"
if [ "$BASE_URL" != "$URL" ]; then URL="${BASE_URL}?sslmode=require"; fi

# THE PASSWORD MUST NOT REACH argv -- card 38bd8366. This helper runs against
# PRODUCTION by design and is invoked whenever anyone measures it, so its window
# is wider than the daily backup's even though each run is shorter. Same split,
# same one definition.
#
# WHAT THIS DOES NOT COVER, said plainly: a caller who passes `--url` with a
# password on ITS OWN command line has already put it on argv before this script
# runs. Prefer `--env-file` or `DATABASE_URL` in the environment.
# Two paths, and a missing helper REFUSES rather than falling through -- the
# same reasoning as in `delta-crm-backup.sh`: continuing would put the password
# back on argv, which is the defect.
PG_LIB="$(dirname "${BASH_SOURCE[0]}")/lib/pg-argv-safe.sh"
[ -f "$PG_LIB" ] || PG_LIB="/Users/isti/marveen/scripts/lib/pg-argv-safe.sh"
if [ ! -f "$PG_LIB" ]; then
  echo "readonly-measure: hianyzik scripts/lib/pg-argv-safe.sh -- a jelszo az argv-n maradna, nem futok" >&2
  exit 2
fi
# shellcheck source=/dev/null
. "$PG_LIB"
pg_split_password "$URL"

# --- Kapu-cel. Ha a hivo nem adja meg, keresunk egy alaptablat a public semaban. A tablat es az
# oszlopot KIIRJUK: a kontroll ervenyessege azon all, hogy tudjuk, MIT irt volna.
if [ -z "$GATE_TABLE" ] || [ -z "$GATE_COLUMN" ]; then
  # A felderito lekerdezes IS csak-olvaso tranzakcioban megy: ne legyen egyetlen
  # kapcsolat sem, amit ez a script nyit es amelyik irni tudna.
  found="$(psql "$PG_URL_NOPASS" -tAF'|' -c "
    BEGIN TRANSACTION READ ONLY;
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position
    LIMIT 1" 2>/dev/null | tail -1)"
  # `tail -1`, mert a READ ONLY tranzakcio nyitasa egy `BEGIN` SORT is kiir a kimenet elejere,
  # es a `${found%%|*}` azt is beleveszi a tablanevbe. Merve: enelkul a kapu egy nem letezo
  # relaciora mutat, MINDHAROM kontroll 0 tuzelest ad -- egyenletesen, ami epp az elhasalt
  # mero alairasa. (Az irany viszont jo volt: FAIL-CLOSED, exit 3, nem hamis siker.)
  [ -n "$found" ] || { echo "NEM MERTEM: nem talaltam kapu-celt a public semaban (adj --gate-table/--gate-column)" >&2; exit 65; }
  GATE_TABLE="${found%%|*}"; GATE_COLUMN="${found##*|}"
fi

GATE_SQL="UPDATE \"$GATE_TABLE\" SET \"$GATE_COLUMN\" = \"$GATE_COLUMN\" WHERE false;"

# RM_TEST_NO_READONLY: KIZAROLAG a vaz sajat negativ tesztjehez -- elhagyja a READ ONLY-t, hogy
# bizonyithato legyen, hogy a script MEGTAGADJA a merest egy nem vedett kapcsolaton. Ugyanaz az
# indok, mint a suite-meret or env-feluliroinal: kulonben maga az or nem tesztelheto.
if [ "${RM_TEST_NO_READONLY:-}" = "1" ]; then BEGIN_STMT="BEGIN;"; else BEGIN_STMT="BEGIN TRANSACTION READ ONLY;"; fi

WRAPPED="$(mktemp)"; OUT="$(mktemp)"
trap 'rm -f "$WRAPPED" "$OUT"' EXIT
{
  echo "\\set ON_ERROR_STOP off"
  echo "$BEGIN_STMT"
  # Minden utasitas sajat implicit savepointban: egy elgepelt oszlopnev a HIVO fajljaban csak
  # a sajat utasitasat dobja el, a tranzakciot nem abortalja, tehat a zaro kapu le tud futni
  # (enelkul 1/2 tuzeles es exit 4, a mar kiirt eredmeny elveszett). kartya f978316e.
  echo "\\set ON_ERROR_ROLLBACK on"
  echo "SAVEPOINT gate_before;"
  echo "$GATE_SQL"
  echo "ROLLBACK TO SAVEPOINT gate_before;"
  echo "\\i $SQL_FILE"
  echo "SAVEPOINT gate_after;"
  echo "$GATE_SQL"
  echo "ROLLBACK TO SAVEPOINT gate_after;"
  echo "ROLLBACK;"
} > "$WRAPPED"

echo "kapu-cel: \"$GATE_TABLE\".\"$GATE_COLUMN\"  (SET oszlop = oszlop WHERE false)"
psql "$PG_URL_NOPASS" -f "$WRAPPED" > "$OUT" 2>&1
cat "$OUT"

GATE_HITS="$(grep -c 'cannot execute UPDATE in a read-only transaction' "$OUT" || true)"
echo
echo "kapu-tuzelesek: $GATE_HITS  (a siker feltetele PONTOSAN 2: nyito ES zaro)"

if [ "$GATE_HITS" -eq 2 ]; then
  echo "OK: a meres vegig a csak-olvaso tranzakcioban maradt."
  exit 0
fi

if [ "$GATE_HITS" -eq 0 ]; then
  # KET KULONBOZO OK, EGY KILEPESI KOD. A nyito kapu hianya ketfele lehet: (a) NEM VOLT kapcsolat
  # (DNS-hiba, `Connection refused`, idotullepes, hitelesites) -- ekkor a kapu mar csak azert sem
  # tuzelhetett, mert a tranzakcio el sem indult --, vagy (b) volt kapcsolat, es a kapu NEM tuzelt:
  # az a csak-olvaso vedelem hianya. Kartya 15d61c9d: (a)-ra is a (b) szoveg ment ki, es egy DNS-hiba
  # utan egy nem letezo „nem csak-olvaso" hibat kezdtek keresni. A kilepesi kod marad 3 (fail-closed,
  # a hivok csak a nem-nullat nezik); a KULONBSEG a szovegben van.
  # A felismeres: a psql CSATLAKOZASI hibaja `psql: error: ...` (regebbi psql-nel `psql: could not
  # ...`) sorkent jelenik meg, a szkript-hibak viszont `psql:<fajl>:<sor>: ERROR:` alakuak (nincs
  # szokoz a ket kettospont kozott), tehat a ketto nem keveredik.
  CONN_ERR="$(grep -m1 -E '^psql: ' "$OUT" || true)"
  if [ -n "$CONN_ERR" ]; then
    echo "NEM MERTEM: nincs kapcsolat (atmeneti lehet, probald ujra; ha marad: URL / hitelesites). Semmit nem fogadok el belole." >&2
    echo "  $CONN_ERR" >&2
    exit 3
  fi
  echo "NEM MERTEM: a NYITO kapu sem tuzelt -- a kapcsolat NEM csak-olvaso. Semmit nem fogadok el belole." >&2
  exit 3
fi

echo "NEM MERTEM: a ZARO KAPU NEM FUTOTT LE ($GATE_HITS/2)." >&2
echo "  Ez pontosan az az eset, ami ket agensnel NEMA volt: egy hiba a meresben megszakitja a" >&2
echo "  koteget, a tranzakcio megszakadt allapotba kerul, es a zaro kapu el sem indul." >&2
echo "  Az ADAT, amit fentebb latsz, NEM BIZONYITOTTAN a zart tranzakciobol jon. Nezd meg a" >&2
echo "  fenti hibat a meres SQL-jeben, javitsd, es merj ujra." >&2
exit 4
