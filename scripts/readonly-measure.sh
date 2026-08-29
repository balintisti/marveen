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
#   Se WHERE-literal, se tipus. A lap `WHERE id = -1` alakja UUID kulcson TIPUSHIBAT ad
#   (`operator does not exist: uuid = integer`) -- az is „hiba", tehat a kontroll VELETLENUL
#   mond igazat, kikapcsolt kapu mellett is. Merve ezen a vazon (t_int / t_uuid, PG 14):
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

# --- Kapu-cel. Ha a hivo nem adja meg, keresunk egy alaptablat a public semaban. A tablat es az
# oszlopot KIIRJUK: a kontroll ervenyessege azon all, hogy tudjuk, MIT irt volna.
if [ -z "$GATE_TABLE" ] || [ -z "$GATE_COLUMN" ]; then
  # A felderito lekerdezes IS csak-olvaso tranzakcioban megy: ne legyen egyetlen
  # kapcsolat sem, amit ez a script nyit es amelyik irni tudna.
  found="$(psql "$URL" -tAF'|' -c "
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
psql "$URL" -f "$WRAPPED" > "$OUT" 2>&1
cat "$OUT"

GATE_HITS="$(grep -c 'cannot execute UPDATE in a read-only transaction' "$OUT" || true)"
echo
echo "kapu-tuzelesek: $GATE_HITS  (a siker feltetele PONTOSAN 2: nyito ES zaro)"

if [ "$GATE_HITS" -eq 2 ]; then
  echo "OK: a meres vegig a csak-olvaso tranzakcioban maradt."
  exit 0
fi

if [ "$GATE_HITS" -eq 0 ]; then
  echo "NEM MERTEM: a NYITO kapu sem tuzelt -- a kapcsolat NEM csak-olvaso. Semmit nem fogadok el belole." >&2
  exit 3
fi

echo "NEM MERTEM: a ZARO KAPU NEM FUTOTT LE ($GATE_HITS/2)." >&2
echo "  Ez pontosan az az eset, ami ket agensnel NEMA volt: egy hiba a meresben megszakitja a" >&2
echo "  koteget, a tranzakcio megszakadt allapotba kerul, es a zaro kapu el sem indul." >&2
echo "  Az ADAT, amit fentebb latsz, NEM BIZONYITOTTAN a zart tranzakciobol jon. Nezd meg a" >&2
echo "  fenti hibat a meres SQL-jeben, javitsd, es merj ujra." >&2
exit 4
