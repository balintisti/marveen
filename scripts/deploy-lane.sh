#!/bin/bash
# MELYIK TELEPITESI SAVBA ESIK EZ A VALTOZAS, ES EL-E MAR? (kartya a1c5d6ca)
#
# EZ A RENDSZER KET (VALOJABAN HAROM) TELEPITESI MODELLT HASZNAL EGYSZERRE, es a
# "kesz" szo mindegyikben mast jelent:
#
#   INSTANT  a futo kod a MUNKAFABOL olvassa -> a beolvasztassal AZONNAL eles,
#            build nelkul, ujrainditas nelkul, ellenorzes nelkul
#   BUILD    a szolgaltatas a dist/-bol megy -> `npm run build` + ujrainditas kell
#   INSTALL  launchd unit -> kulon `launchctl` lepes kell
#
# MIERT SZERSZAM ES NEM SZABALY. A repo dokumentacioja eddig egy SZAMOT mondott
# ("nyolc dist/ modul hivja futasidoben a scripts/-et"), es a szam elavult:
# 2026-08-23-an ujramerve 18 modul illeszkedik a `scripts/<fajl>.<kit>` mintara,
# 22 emliti egyaltalan a `scripts/`-et, es a dokumentacioban nevesitett nyolc
# nevbol NEGYNEK nincs talalata a lefordított fában. Egy szam elavul es nem szol;
# egy parancs ujramer.
#
# CONTRACT: mindig `KULCS|szoveg` sorokat ir, mindig 0-val lep ki. A hivo dont.
# (Ugyanaz a szerzodes, mint a google-health.sh es a playwright-cache-check.sh.)
#
# HASZNALAT:
#   scripts/deploy-lane.sh <ref>            # <telepitesi-HEAD>..<ref> valtozasai
#   scripts/deploy-lane.sh <base>..<ref>    # explicit tartomany
#   scripts/deploy-lane.sh --classify       # STDIN-rol fajlneveket olvas, csak besorol
set -uo pipefail

# A TELEPITESI FA: az a checkout, amibol a futo szolgaltatas olvas. NEM az, amiben
# ez a szkript epp fut -- egy worktreebol futtatva a sajat fadra nezni azt a kerdest
# valaszolna meg, ami mindig igen (a sajat agadon ott a valtozas).
INSTALL_ROOT="${MARVEEN_INSTALL_ROOT:-/Users/isti/marveen}"

# --- A besorolas. Ez a fuggveny a lelke: kulon all, hogy tesztelheto legyen. ---
#
# A SAVOK NEM IZLES KERDESEI, MERVE VANNAK (2026-08-23, a telepitett dist/-en):
#   scripts/  -> 18 futasideju modul hivja a MUNKAFA fajljait (config.js, env.js,
#                quota-gate.js, web/schedule-runner.js, web/agent-process.js, ...)
#   web/      -> src/web.ts: `WEB_DIR = join(PROJECT_ROOT, 'web')`, es a
#                PROJECT_ROOT = `join(__dirname, '..')` a dist/-bol, tehat a MUNKAFA
#   update.sh -> a self-update maga; a kovetkezo frissitest mar az uj valtozat vezeti
classify() {
  case "$1" in
    src/__tests__/*)  echo "NEUTRAL" ;;   # teszt: nem fut a szolgaltatasban
    src/*)            echo "BUILD" ;;
    scripts/*|web/*)  echo "INSTANT" ;;
    update.sh|*.sh)   echo "INSTANT" ;;   # gyoker-szintu szkript: futasidoben hivhato
    *.plist)          echo "INSTALL" ;;
    *)                echo "NEUTRAL" ;;   # doksi, seed, konfig-minta, teszt-fixture
  esac
}

if [ "${1:-}" = "--classify" ]; then
  # A `|| [ -n "$f" ]` NEM kozmetika: zaro ujsor NELKULI bemenetnel a `read`
  # nem-nulla kodot ad, es a ciklustorzs LE SEM FUT az utolso sorra. Merve
  # (2026-08-23, a sajat tesztem fogta meg): egyetlen fajlnevvel etetve a
  # szkript NULLA sort irt ki, exit 0-val -- vagyis nema veszteseg egy olyan
  # eszkozben, aminek epp az a dolga, hogy ne vesszen el semmi.
  while IFS= read -r f || [ -n "$f" ]; do [ -n "$f" ] && echo "$(classify "$f")|$f"; done
  exit 0
fi

ARG="${1:-HEAD}"
if [[ "$ARG" == *".."* ]]; then RANGE="$ARG"; else
  INSTALL_HEAD="$(git -C "$INSTALL_ROOT" rev-parse HEAD 2>/dev/null)"
  if [ -z "$INSTALL_HEAD" ]; then
    echo "SKIP|a telepitesi fa nem olvashato ($INSTALL_ROOT) -- NEM MERVE, nem 'rendben'"
    exit 0
  fi
  # A KOZOS OSTOL merunk, nem a telepitesi HEAD-tol. Merve, sajat hibabol
  # (2026-08-23): ha a ref MOGOTTE van a telepitesnek, a `HEAD..ref` alak a
  # telepites sajat valtozasait listazza VISSZAFELE -- vagyis a kerdesre
  # ("mit hoz ez az ag?") pont az ellenkezojet valaszolja, magabiztosan.
  # HA A REF MAR BENNE VAN a telepitesi fa agaban, a kozos os MAGA a ref, tehat a
  # tartomany URES lenne -- es egy ures lista ugy nezne ki, mintha az ag semmit nem
  # hozott volna. Ez a legrosszabb valasz: pont akkor hallgatna, amikor a valasz
  # "IGEN, mar el". Ezert itt kimondjuk a tenyt, es a fajl-listahoz explicit
  # tartomanyt kerunk -- a fork-pontot NEM talalgatjuk.
  if git -C "$INSTALL_ROOT" merge-base --is-ancestor "$ARG" "$INSTALL_HEAD" 2>/dev/null; then
    echo "INFO|a ref MAR BENNE VAN a telepitesi fa agaban ($(git -C "$INSTALL_ROOT" rev-parse --short HEAD))"
    # NINCS visszaperjel a szovegben: idezojeles echo-ban a hej PARANCSKENT futtatna
    # (a repo CLAUDE.md-je ezt mar leirja uzenetekre; itt sajat magamon fogott meg,
    # 2026-08-23 -- a kimenetben "ami ebben a refben ,  vagy ," allt, mert a
    # `scripts/` es a tobbi backtickes szo LEFUTOTT es a helyere URES sztring kerult).
    echo "ALLAPOT|INSTANT: ami ebben a refben scripts/, web/ vagy update.sh, az MAR AZONNAL HAT"
    echo "INFO|a fajl-listahoz adj explicit tartomanyt: deploy-lane.sh <base>..<ref>"
    exit 0
  fi
  MB="$(git merge-base "$INSTALL_HEAD" "$ARG" 2>/dev/null)"
  [ -z "$MB" ] && MB="$INSTALL_HEAD"
  RANGE="$MB..$ARG"
fi

FILES="$(git diff --name-only "$RANGE" 2>/dev/null)"
if [ -z "$FILES" ]; then
  echo "INFO|$RANGE: nulla valtozott fajl"
  exit 0
fi

echo "INFO|tartomany: $RANGE"
N_INSTANT=0; N_BUILD=0; N_INSTALL=0; N_NEUTRAL=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  L="$(classify "$f")"
  case "$L" in
    INSTANT) N_INSTANT=$((N_INSTANT+1)); echo "INSTANT|$f" ;;
    BUILD)   N_BUILD=$((N_BUILD+1)) ;;
    INSTALL) N_INSTALL=$((N_INSTALL+1)); echo "INSTALL|$f" ;;
    *)       N_NEUTRAL=$((N_NEUTRAL+1)) ;;
  esac
done <<< "$FILES"
echo "INFO|savok: INSTANT=$N_INSTANT BUILD=$N_BUILD INSTALL=$N_INSTALL NEUTRAL=$N_NEUTRAL"

# --- ES AZ ALLAPOT: a sav MIKOR hat, ehhez a telepiteshez kepest ---
#
# A "kesz" harom kulonbozo mondata a CLAUDE.md-bol szo szerint, mert a kartyakon
# ezeket kell hasznalni. Enelkul a "beolvadt" mindharom esetben igaznak latszik,
# es csak az elsoben jelenti azt, hogy a felhasznalo szamara MEGTORTENT.
REF="${RANGE##*..}"
REF_SHA="$(git rev-parse "$REF" 2>/dev/null)"
INSTALL_HEAD="$(git -C "$INSTALL_ROOT" rev-parse HEAD 2>/dev/null)"

if [ "$N_INSTANT" -gt 0 ]; then
  if [ -n "$REF_SHA" ] && git -C "$INSTALL_ROOT" merge-base --is-ancestor "$REF_SHA" "$INSTALL_HEAD" 2>/dev/null; then
    echo "ALLAPOT|INSTANT: a telepitesi fa agan van -> AZONNAL HAT (build es ujrainditas nelkul)"
  else
    echo "ALLAPOT|INSTANT: NINCS a telepitesi fa agan -> a beolvasztas PILLANATABAN lesz eles"
  fi
fi

if [ "$N_BUILD" -gt 0 ]; then
  BUILT="$(cat "$INSTALL_ROOT/dist/.built-commit" 2>/dev/null | tr -d '[:space:]')"
  if [ -z "$BUILT" ]; then
    echo "ALLAPOT|BUILD: a dist/.built-commit nem olvashato -- NEM MERVE (nem 'kesz')"
  elif [ -n "$REF_SHA" ] && git -C "$INSTALL_ROOT" merge-base --is-ancestor "$REF_SHA" "$BUILT" 2>/dev/null; then
    echo "ALLAPOT|BUILD: benne van a futo buildben ($BUILT) -> HAT"
  else
    echo "ALLAPOT|BUILD: BUILDRE VAR (a futo build alapja: ${BUILT:0:12})"
  fi
fi

if [ "$N_INSTALL" -gt 0 ]; then
  echo "ALLAPOT|INSTALL: TELEPITESRE VAR -- a plist beolvasztasa nem telepiti (launchctl kell)"
fi

# ES HA EGYIK SAV SEM ERINTETT: MONDJUK KI. Kulonben a szerszam NEM IR SEMMIT, es a
# hivo oldalan a "nincs allapot-sor" megkulonboztethetetlen attol, hogy le sem futott.
# Merve a sajat agaimon (2026-08-23): negy teszt-only ag ALLAPOT-sor nelkul jott vissza,
# es a tablazatomban "nulla valtozas"-kent latszott -- pedig ket fajlt valtoztat.
# A helyes valasz nem a csend, hanem: nincs telepitesi hatasa.
if [ "$N_INSTANT" -eq 0 ] && [ "$N_BUILD" -eq 0 ] && [ "$N_INSTALL" -eq 0 ]; then
  echo "ALLAPOT|NINCS TELEPITESI HATAS: mind a $N_NEUTRAL valtozott fajl semleges (teszt, doksi, seed)"
fi

exit 0
