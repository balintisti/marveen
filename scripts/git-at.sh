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
# ES A CSAPDA A PATH ELSO BETUJEN MULIK, ezert kivulrol kiszamithatatlan:
#     "$b:scripts/..."     -> `s` modosito  -> NEMAN nyel
#     "$b:shared/..."      -> `s` modosito  -> hangosan bukik
#     "$b:.gitignore"      -> `.` nem az    -> veletlenul HELYES
#     "$b:docs/..."        -> `d` nem az    -> veletlenul HELYES
# Vagyis ugyanaz a leirt alak hol mukodik, hol nem, es a kulonbseg egy betu.
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
