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
set -uo pipefail
ROOT=/Users/isti/marveen
LOG="$ROOT/store/fleet-page-guard.log"
TS=$(date '+%Y-%m-%d %H:%M:%S %Z')

OUT=$(python3 "$ROOT/scripts/agent-core-check.py" 2>&1); RC=$?

if [ "$RC" -eq 0 ]; then
  # Az OSSZEGZO sor a naploba: latszik belole, hogy MIT allitott, nem csak hogy lefutott.
  # A KONTROLL-sor IS tartalmazza a "23/23"-at, tehat egy csupasz `grep -c` NYOLCAT szamolna
  # hetre. Ezert a szamlalas az AGENS-sorokra horgonyzott (a nev utan `N,NNN kar.` all).
  N=$(printf '%s\n' "$OUT" | grep -cE '^  [a-z]+ +[0-9,]+ kar\.')
  printf '%s  OK rc=0  %s agens-lap, mind teljes\n' "$TS" "$N" >> "$LOG"
  exit 0
fi

printf '%s  HIANYOS rc=%s\n%s\n' "$TS" "$RC" "$OUT" >> "$LOG"

# A jelzes a koordinatorhoz megy. Az `agent-msg.sh` az EGYETLEN ut: a nyers curl 0-val ter
# vissza egy 401/400-ra is, es egy nema kuldes-hiba itt pont a vedelmet tunteti el.
MSG=$(printf '%s\n\n%s\n\n%s\n' \
  "[fleet-page-guard] EGY VAGY TOBB AGENS-LAP NEM HORDOZZA A TEHERHORDO MONDATOKAT." \
  "$OUT" \
  "A kozos CLAUDE.md EGY olvasot er el (mind a het agens levalasztva), tehat ami ott all, az
ODA NEM JUT EL. A javitas: ird be a hianyzo mondatot a nevezett lap(ok)ba, flock alatt,
horgonyosan, es futtasd ujra ezt: python3 scripts/agent-core-check.py  (kartya b493b5a5)")

# Through alert-coordinator.sh (card 906e9159): --force to the coordinator, the owner as the
# fallback. A plain agent-msg.sh call went silent whenever the coordinator's queue was full.
printf '%s' "$MSG" | bash "$ROOT/scripts/alert-coordinator.sh" >> "$LOG" 2>&1
exit "$RC"
