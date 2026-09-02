#!/usr/bin/env bash
#
# tenant-second-user-watch.sh -- a NEVEZO, amin tobb mai HIGH lelet sulya all.
#
# MIERT LETEZIK. didi merte 2026-09-02-an: minden szervezetnek PONTOSAN EGY felhasznaloja van
# (29 user / 29 org), es a `UserInvitation` tablanak SOHA nem volt sora. Ez a nevezo tobb mai
# lelet alatt: a 110 kapuzatlan iro vegpont, a 4903 elsodleges cim, a 729 arva ertek, a
# Megtekinto-szerepkor leletei -- MA egyikhez sincs masodik fel a berlon belul, aki kihasznalja.
#
# **Ez ALLAPOT-allitas, tehat romlando** -- es az elso ELFOGADOTT MEGHIVASSAL fordul, csendben.
# Semmi nem figyelte. Ez a script figyeli.
#
# MIERT `command`-TIPUSU UTEMEZES, ES NEM HEARTBEAT. friday merte 2026-09-02-an, en
# ujramertem a `/api/schedules`-bol: 13 utemezesbol PONTOSAN 2 `command`-tipusu, es PONTOSAN
# az a ketto hordoz `health` objektumot (verdict + kor + indok). A masik 11 (task / heartbeat /
# dream-engine) egyet sem -- semmi nem ir nekik futas-bizonyitekot.
#   Egy heartbeat-figyelo tehat CSENDBEN elhalhatna, es a csendje bajt-azonos lenne azzal, hogy
#   "meg mindig nulla". Pont az a bukasi mod, amit ennel a kerdesnel nem engedhetunk meg.
#
# A FAIL-CLOSED SZERZODES, ES EZ A SCRIPT LENYEGE:
#
#   exit 0  =  MERTEM, ES NULLA.        (a kapu ketszer tuzelt, a nevezo nem-nulla, a szamlalo 0)
#   exit 2  =  MERTEM, ES NEM NULLA.    -> a nevezo megdolt, a leletek sulyat ujra kell nezni
#   exit 3+ =  NEM MERTEM.              -> es ez SOHA nem olvasodhat "tisztanak"
#
# A `NEM MERTEM` es a `NULLA` megkulonboztetese nem stilus: e nelkul egy elszakadt adatbazis-
# kapcsolat ugyanugy nez ki, mint egy egeszseges berlo-hatar. A meres az eles adatbazisrol
# KIZAROLAG OSSZESITETT SZAMOKAT olvas -- egyetlen sor tartalma sem kerul ki --, es a
# `readonly-measure.sh` zart, csak-olvaso tranzakciojan keresztul, ket megfigyelt kapu-tuzelessel.
#
# Hasznalat:
#   scripts/tenant-second-user-watch.sh [--env PATH] [--sql PATH] [--state PATH]
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="/Users/isti/Projektek/sajat-crm/sajat-crm/backend/api/.env"
SQL_FILE="$ROOT/scripts/sql/tenant-second-user.sql"
DEFAULT_SQL="$ROOT/scripts/sql/tenant-second-user.sql"
STATE_FILE="$ROOT/store/tenant-second-user-watch.state"
# A riasztas cimzettje kapcsolo, KIZAROLAG azert, hogy a riaszto ut MAGA is tesztelheto legyen
# hamis riasztas nelkul. Ugyanaz az indok, mint a vaz `RM_TEST_NO_READONLY` kapcsolojanal:
# egy or, aminek a jelzo-utjat soha nem sutottuk el, egy meg nem probalt felteteles ag.
NOTIFY_TO="marveen"
# A helper es a dashboard-token a TELEPITETT fanal lakik (`store/` gitignore-olt, worktreeben
# nincs). Kimondva es kapcsolhatoan, mert az elso probam epp itt bukott el: a riaszto ut
# lefutott, az uzenet NEM ment ki, es a script kilepesi kodja ettol meg helyes maradt volna.
MARVEEN_ROOT="/Users/isti/marveen"

while [ $# -gt 0 ]; do
  case "$1" in
    --env)   ENV_FILE="${2:-}"; shift 2 ;;
    --sql)   SQL_FILE="${2:-}"; shift 2 ;;
    --state) STATE_FILE="${2:-}"; shift 2 ;;
    --notify-to) NOTIFY_TO="${2:-}"; shift 2 ;;
    --marveen-root) MARVEEN_ROOT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; exit 64 ;;
    *) echo "ismeretlen kapcsolo: $1" >&2; exit 64 ;;
  esac
done

OUT="$(mktemp)"; trap 'rm -f "$OUT"' EXIT

# A kapu-celt KIMONDOM, nem a vazra bizom a talalgatast: az `information_schema`-bol valasztott
# elso tabla ag-fuggo, es egy nevezetlen kapu-cel eppen azt a bizonyitekot gyengiti, amiert a
# kapu letezik. A `User.id` letezese a sema-ellenorzesbol jon (origin/main = 8562eebc).
bash "$ROOT/scripts/readonly-measure.sh" \
  --sql "$SQL_FILE" --env "$ENV_FILE" \
  --gate-table User --gate-column id > "$OUT" 2>&1
RC=$?

if [ "$RC" -ne 0 ]; then
  echo "NEM MERTEM (readonly-measure exit $RC). Ez NEM azt jelenti, hogy nulla."
  sed 's/^/  | /' "$OUT"
  exit 3
fi

value_of() { awk -F'|' -v k="$1" '$1 ~ k {gsub(/ /,"",$2); print $2}' "$OUT" | head -1; }
SECOND="$(value_of 'orgs_with_second_user')"
INVITES="$(value_of 'invitations_ever')"
ORGS="$(value_of 'orgs_total')"
USERS="$(value_of 'users_total')"

# A NEVEZO-KONTROLL. Ha barmelyik hianyzik vagy nulla, a lekerdezes nem a valodi tablat nezte,
# es a szamlalo nullaja semmit nem allit. Fail-closed: ez NEM MERTEM, nem "tiszta".
for pair in "orgs_with_second_user:$SECOND" "invitations_ever:$INVITES" "orgs_total:$ORGS" "users_total:$USERS"; do
  name="${pair%%:*}"; val="${pair##*:}"
  case "$val" in ''|*[!0-9]*) echo "NEM MERTEM: a(z) '$name' erteket nem tudtam kiolvasni ('$val')."; sed 's/^/  | /' "$OUT"; exit 4 ;; esac
done
if [ "$ORGS" -eq 0 ] || [ "$USERS" -eq 0 ]; then
  echo "NEM MERTEM: a NEVEZO nulla (orgs_total=$ORGS, users_total=$USERS) -- a lekerdezes nem a"
  echo "valodi tablat nezte. A szamlalo nullaja ilyenkor nem allit semmit."
  exit 5
fi

# Kiirva, nem `a || b && c` alakban: az a sorrend helyes, de egy or, aminek a dontő sorat
# ket percig kell fejben kiertekelni, pont ott olvasodik felre, ahol szamit.
VERDICT="clear"
if [ "$SECOND" -gt 0 ] || [ "$INVITES" -gt 0 ]; then VERDICT="breached"; fi
echo "berlok masodik felhasznaloval: $SECOND   meghivasok valaha: $INVITES"
echo "NEVEZO (kontroll): $ORGS szervezet / $USERS felhasznalo -- nem-nulla, tehat a meres latott adatot"

PREV="none"; [ -f "$STATE_FILE" ] && PREV="$(cat "$STATE_FILE" 2>/dev/null || echo none)"
# A 'breached-undelivered' SZANDEKOSAN nem szamit ertesitettnek: az ertesites megkiserlese
# nem ertesites.
mkdir -p "$(dirname "$STATE_FILE")" && printf '%s\n' "$VERDICT" > "$STATE_FILE"

if [ "$VERDICT" = "clear" ]; then
  echo "OK: a nevezo all -- egyetlen berlon belul sincs masodik fel."
  exit 0
fi

# Az ATMENET az esemeny, nem az allapot: kulonben minden futas ujrakuldene ugyanazt, es a
# huszadik utan senki nem olvasna el. Az ALLAPOT viszont minden futasban kiirodik (fent).
if [ "$PREV" = "breached" ]; then
  echo "VALTOZATLANUL megdolt (mar ertesitve) -- nem kuldok ujra."
  exit 2
fi

# AZ ATMENET az esemeny, nem az allapot: kulonben minden futas ujrakuldene ugyanazt, es a
# huszadik utan senki nem olvasna el. Az ALLAPOT viszont minden futasban kiirodik (fent).
echo "VALTOZAS: a nevezo MEGDOLT. Ertesites megy egyszer."
# A SZAMOK EREDETE A TORZSBEN UTAZIK, NEM A FEJLECBEN -- ES EZ MERT DEFEKTUS-JAVITAS.
# 2026-09-02 13:50-kor a sajat proba-riasztasom (fixture-SQL, kitalalt 3/7) VISSZAERT hozzam
# egy kesobbi fordulóban, es SEMMI nem volt benne, ami elvalasztotta volna egy valoditol.
# Ha marveenhez megy, vagy ha egy restart utan olvasom, tobb HIGH leletet sulyoztunk volna
# ujra KITALALT szamokon. A lap sajat torvenye: a legerosebb mondat utazik, a fejlec nem --
# tehat a proba-jelolesnek MAGABAN a mondatban kell allnia.
PROV=""
if [ "$SQL_FILE" != "$DEFAULT_SQL" ]; then
  PROV="[PROBA -- NEM ELES SZAM] A szamok NEM az alapertelmezett lekerdezesbol jonnek, hanem innen: $SQL_FILE. Ne sulyozz ujra semmit ez alapjan. "
fi
# A KIKULDENDO SZOVEG MINDIG KIIRODIK, MIELOTT ELMEGY. Ket okbol, es mindketto mert:
#  - a `exit 6` ag azt kéri, hogy "kezzel kell tovabbadni" -- eddig a szoveget NEM adta oda hozza
#  - kulonben a proba-jeloles agat nem lehet ellenorizni kikuldes NELKUL, es egy jelolest, amit
#    csak valodi kuldessel lehet tesztelni, senki nem fog tesztelni
ALERT_BODY="${PROV}A tenant-nevezo megdolt: $SECOND berlonek van masodik felhasznaloja, $INVITES meghivas letezik. Tobb mai HIGH lelet sulya ezen a nullan allt (110 kapuzatlan iro vegpont, 4903 elsodleges cim, 729 arva ertek, Megtekinto-szerepkor). Ujra kell nezni oket."
echo "--- a riasztas szovege, ahogy elmegy ---"
echo "$ALERT_BODY"
echo "----------------------------------------"
SEND_OUT="$(printf '%s\n' "$ALERT_BODY" \
  | bash "$MARVEEN_ROOT/scripts/agent-msg.sh" mandark "$NOTIFY_TO" - 2>&1)"
echo "$SEND_OUT" | grep -E 'OK id|FAIL|NEM KULDTEM' || true

# A KEZBESITES BUKASA NEM LEHET NEMA, ES EZ MERT DEFEKTUS-JAVITAS: az elso probam pontosan
# igy futott le -- az or HELYESEN jelzett, az uzenet NEM ment ki, es a kilepesi kod ugyanaz a
# 2 maradt. Egy or, aminek a jelzo-utja csendben elbukik, rosszabb, mint amelyik nem letezik:
# a kartyan ott all, hogy figyelve van.
if ! printf '%s' "$SEND_OUT" | grep -q 'OK id='; then
  echo "A NEVEZO MEGDOLT, ES AZ ERTESITES NEM MENT KI. Kezzel kell tovabbadni." >&2
  # Az allapot NEM marad 'breached': kulonben a kovetkezo futas mar "mar ertesitve"-nek
  # olvasna, es az egyetlen kikuldesi kiserlet is elveszne.
  printf '%s\n' "breached-undelivered" > "$STATE_FILE"
  exit 6
fi
exit 2
