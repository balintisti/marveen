#!/usr/bin/env bash
# git-at.sh -- egy fajl egy ADOTT AGON/COMMITON, ugy, hogy a hej ne tudja elrontani.
#
# MIERT LETEZIK (kartya e63ce68e). A `git show "$ag:$ut"` alak zsh-ban NEMAN
# elromlik: a shell a `:` utani elso betut VALTOZO-MODOSITONAK olvassa
# (`s h t r e g f q u a l` es tarsai), es az utvonal ELTUNIK. A parancs ezutan a
# puszta AGRA fut -- ami letezik --, tehat:
#
#     git cat-file -e "$b:scripts/valami.ts"    ->  0 (IGAZ) MINDEN agra
#
# Egy letezes-ellenorzes, ami nem tud nemet mondani.
#
# ES A CSAPDA A KETTOSPONT UTANI ELSO **LITERAL** BETUN MULIK, ezert kivulrol
# kiszamithatatlan (didi merte ujra 2026-08-23, zsh 5.9; sajat merssel megerositve,
# b=myref):
#     "$b:sajat-crm/x.ts"    -> myref                <- az EGESZ ut ELTUNT   (s)
#     "$b:frontend/x.ts"     -> myrefontend/x.ts     <- csonkolt             (f)
#     "$b:head/x.ts"         -> .ead/x.ts            <- a VALTOZO ERTEKE IS  (h)
#     "$b:backend/x.ts"      -> myref:backend/x.ts   <- HELYES (b nem modosito)
#     "$b:$P"                -> helyes  <- az UT VALTOZOBAN van, nincs csapda
#     "${b}:sajat-crm/x.ts"  -> helyes
#
# HAROM DOLOG KOVETKEZIK EBBOL, ES MINDHAROM SZAMIT:
#  1. NEM MINDEN `$var:` VESZELYES. Aki `backend/`-del probalja ki, azt latja, hogy
#     mukodik -- es az EGESZ szabalyt zajnak konyveli el. Ez a szabaly legnagyobb
#     ellensege, nem a csapda maga.
#  2. HA AZ UT VALTOZOBAN VAN (`"$b:$P"`), NINCS CSAPDA. A hej csak LITERAL
#     szoveget olvas modositokent.
#  3. A `:h` ESET A LEGROSSZABB: az eredmeny tovabbra is UTVONALNAK NEZ KI, csak
#     MASIK fajlra mutat. A tobbi alak legalabb feltunoen csonka.
#
# ES EZ A REPO KULONOSEN KITETT: a ket leggyakoribb utvonal-kezdet itt a
# `sajat-crm/` es a `frontend/` -- MINDKETTO modosito-betuvel kezdodik. Nem
# balszerencse, hogy harom agenst megfogott egy nap alatt.
#
# Ezt nem lehet fegyelemmel kezelni -- ezert nem szabaly lett, hanem parancs.
#
# HAROM AGENS FUTOTT BELE EGY NAP ALATT (2026-08-23), MINDHARMAN A SZABALY
# LEIRASA UTAN, ketten kozuluk EPP AZNAP irtak le. Az egyik eset egy BIZTONSAGI
# kapu allapotarol szolt, es a megnyugtato iranyba tevedett: "mind a 17 agon ott
# van" -- holott egyetlen agon sem.
#
# A MEGOLDAS ALAKJA: a ref es az ut KET KULON ARGUMENTUM. Igy a hivo kodjaban
# SOHA nem all elo a `$valami:ut` szoveg, tehat nincs mit elrontani. Nem
# emlekezni kell ra, hanem nem lehet rosszul leirni.
#
# HASZNALAT
#   bash scripts/git-at.sh show   <ref> <ut>     # a fajl tartalma
#   bash scripts/git-at.sh exists <ref> <ut>     # kilepesi kod: 0 = van, 1 = nincs
#   bash scripts/git-at.sh which  <ut> [ref...]  # MELYIK refeken van meg (soronkent)
#
# Peldak:
#   bash scripts/git-at.sh exists feat/valami scripts/secret-gate.ts && echo VAN
#   bash scripts/git-at.sh which scripts/secret-gate.ts $(git for-each-ref --format='%(refname:short)' refs/heads/)
set -euo pipefail

usage() {
  sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
  exit 64
}

cmd="${1:-}"; shift || true

case "$cmd" in
  show)
    ref="${1:?ref kell}"; path="${2:?ut kell}"
    # A KAPCSOS ZAROJEL ITT A LENYEG: lezarja a valtozonevet, tehat a kettospont
    # literal marad. Ez az EGYETLEN hely a rendszerben, ahol ez az alak leirodik.
    git show "${ref}:${path}"
    ;;
  exists)
    ref="${1:?ref kell}"; path="${2:?ut kell}"
    if git cat-file -e "${ref}:${path}" 2>/dev/null; then exit 0; else exit 1; fi
    ;;
  which)
    path="${1:?ut kell}"; shift
    [ "$#" -gt 0 ] || { echo "git-at.sh which: legalabb egy ref kell" >&2; exit 64; }
    for ref in "$@"; do
      if git cat-file -e "${ref}:${path}" 2>/dev/null; then printf '%s\n' "$ref"; fi
    done
    ;;
  *)
    usage
    ;;
esac
