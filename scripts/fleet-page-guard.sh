#!/usr/bin/env bash
# fleet-page-guard.sh -- ELO HIVO az agent-core-check.py ele. (kartya b493b5a5)
#
# MIERT LETEZIK. 2026-09-20-an megmertem, hogy mind a het agens LE VAN VALASZTVA
# (`agents/<nev>` symlink a `/Users/Shared/marveen-<nev>`-re, es a futo panelek
# `pane_current_path`-e ezt adja), tehat a KOZOS `CLAUDE.md` EGY olvasot er el a nyolcbol:
# a koordinator sessionjet. A flotta-szabalyokat a het lapra az `agent-core-check.py`
# 23 teherhordo mondata viszi at -- es annak a kapunak NULLA ELO HIVOJA volt.
#
# Az egyetlen hivoja a `scripts/agent-cwd-detach.sh` volt, ELOFELTETELKENT, a levalasztas
# ELOTT. Az a szkript tobbe nem fut le: az elso sora `[ -L "$SRC" ] && exit 0`, es mind a het
# agens mar symlink. Vagyis egy helyes, tesztelt, DISZKRIMINALO kapu allt ugy, hogy semmi nem
# hivta meg -- pontosan az az alak, amit a lap "megmertuk, hogy MEGVAN, es nem mertuk meg, hogy
# ODAER" neven ir le, a sajat vedelmi mechanizmusunkon.
#
# A MERT AR, ugyanaznap: a Telegram-jovahagyasi dontes 10:30-kor megszuletett es a FO lapra
# kerult; a vegrehajtohoz 13:19-kor ert oda, KEZZEL. 2 ora 49 perc, es kivulrol ugy nezett ki,
# hogy az agens nem hajlando dolgozni. A gazda haromszor kerte ugyanazt.
#
# MIERT NEM BLOKKOL, HANEM JELEZ. A drift nem a futas pillanataban keletkezik, hanem amikor
# valaki a kozos lapra ir; ez az or UTOLAG veszi eszre. Egy `exit != 0` itt senkit nem allitana
# meg -- ezert az eredmeny egy UZENET a koordinatornak, nevvel es hianyzo mondattal.
#
# A NAPLO NEM DISZ: a kartya lezarasi feltetele egy MEGFIGYELES arrol, hogy ez lefutott az en
# beavatkozasom nelkul. A konfig elolvasasa JOSLAT, a naplo-sor a megfigyeles.
#
# GENERALT BLOKK, AMI MEG NEM ERT ODA, NEM HIBA (kartya 074149c2, marveen 57647). 2026-11-10-en
# ez az or orankent "7 LAP HIANYOS"-t kuldott a koordinatornak, mert het munkamenet a build
# ELOTT indult, es az uj blokkot az iro csak INDULASKOR irja a lapra. A jelzes azt kerte, hogy
# valaki kezzel irja be: egy generalt resznel az a rossz javitas. A mero (agent-core-check.py)
# ezert kulon mondja ki, ami magatol megerkezik (rc=0, CSAK ide a naploba), es ami hiba (rc=3).
# A hiba-jelzes elso sora GEPPEL olvashato (`LAPOK: nev, nev`): abbol donti el a dashboard, hogy
# a front desk olvassa-e a koordinator helyett (src/front-desk.ts). Az "or nem tudott merni"
# (rc=4) jelzesen nincs ilyen sor, az a koordinatornal marad.
#
# FLEET_PAGE_GUARD_ROOT: teszt-varrat, elesben nincs beallitva.
set -uo pipefail
ROOT="${FLEET_PAGE_GUARD_ROOT:-/Users/isti/marveen}"
LOG="$ROOT/store/fleet-page-guard.log"
TS=$(date '+%Y-%m-%d %H:%M:%S %Z')

OUT=$(python3 "$ROOT/scripts/agent-core-check.py" 2>&1); RC=$?

if [ "$RC" -eq 0 ]; then
  # Az OSSZEGZO sor a naploba: latszik belole, hogy MIT allitott, nem csak hogy lefutott.
  # A KONTROLL-sor IS tartalmazza a "23/23"-at, tehat egy csupasz `grep -c` NYOLCAT szamolna
  # hetre. Ezert a szamlalas az AGENS-sorokra horgonyzott (a nev utan `N,NNN kar.` all).
  N=$(printf '%s\n' "$OUT" | grep -cE '^  [a-z]+ +[0-9,]+ kar\.')
  # Ami indulaskor erkezik, az NEVVEL all a naploban: errol uzenet nem megy, ez az egyetlen nyoma.
  WAIT=$(printf '%s\n' "$OUT" | grep -E '^NINCS HIBAS LAP ' | sed -E 's/^NINCS HIBAS LAP \([0-9]+ lap\): //')
  if [ -n "$WAIT" ]; then
    printf '%s  OK rc=0  %s agens-lap, hibas nincs; %s\n' "$TS" "$N" "$WAIT" >> "$LOG"
  else
    printf '%s  OK rc=0  %s agens-lap, mind teljes\n' "$TS" "$N" >> "$LOG"
  fi
  exit 0
fi

printf '%s  HIANYOS rc=%s\n%s\n' "$TS" "$RC" "$OUT" >> "$LOG"

# A jelzes a koordinatorhoz megy. Az `agent-msg.sh` az EGYETLEN ut: a nyers curl 0-val ter
# vissza egy 401/400-ra is, es egy nema kuldes-hiba itt pont a vedelmet tunteti el.
# rc=4: a MERO nem futott (hianyzo/ures/hibas forras-lista, kartya 83c47d59). Az a cim, hogy
# "a lap hianyos", ilyenkor a nem letezo bajt nevezne meg, a meglevot (a vak orat) elhallgatna.
# A hibas lapok neve a mero SAJAT soraban all (`HIBAS-LAPOK: a, b`). Ha nincs ilyen sor, vagy
# nem pontosan ez az alakja, a fejlec nev nelkul megy ki, es a jelzes a koordinatornal marad.
NAMES=$(printf '%s\n' "$OUT" | sed -nE 's/^HIBAS-LAPOK: ([a-z0-9_-]+(, [a-z0-9_-]+)*)$/\1/p' | tail -1)
HEAD="[fleet-page-guard] EGY VAGY TOBB AGENS-LAP NEM HORDOZZA A TEHERHORDO MONDATOKAT."
[ -n "$NAMES" ] && HEAD=$(printf '[fleet-page-guard] LAPOK: %s\nEGY VAGY TOBB AGENS-LAP NEM HORDOZZA A TEHERHORDO MONDATOKAT.' "$NAMES")
[ "$RC" -eq 4 ] && HEAD="[fleet-page-guard] AZ AGENS-LAP OR NEM TUDOTT MERNI (rc=4): a lapokrol MOST semmit nem tudunk."
MSG=$(printf '%s\n\n%s\n\n%s\n' \
  "$HEAD" \
  "$OUT" \
  "A kozos CLAUDE.md EGY olvasot er el (mind a het agens levalasztva), tehat ami ott all, az
ODA NEM JUT EL. A javitas KANARI es SZAKASZ hianyara: ird be a hianyzo mondatot a nevezett
lap(ok)ba, flock alatt, horgonyosan. GENERALT blokkot kezzel NE irj: azt az iro (a dashboard)
irja az agens indulasakor; ami itt HIANYZIK-kent all, ott az iro mar futott es megsem irta meg,
az a keret hibaja, kartyara valo. Utana: python3 scripts/agent-core-check.py  (kartya b493b5a5)")

# Through alert-coordinator.sh (card 906e9159): --force to the coordinator, the owner as the
# fallback. A plain agent-msg.sh call went silent whenever the coordinator's queue was full.
printf '%s' "$MSG" | bash "$ROOT/scripts/alert-coordinator.sh" >> "$LOG" 2>&1
exit "$RC"
