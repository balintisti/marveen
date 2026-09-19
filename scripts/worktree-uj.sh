#!/usr/bin/env bash
# worktree-uj.sh -- BIZTONSAGOS `git worktree add`, harom beepitett ellenorzessel.
#
# MIERT LETEZIK. 2026-09-17 09:3x-kor marveen ezt irta:
#
#     git worktree add "$W" -b <ag> "$SHA" 2>&1 | tail -3 || { echo "NEM JOTT LETRE"; exit 1; }
#
# A `worktree add` ELHASALT (`fatal: '...' already exists`), de az `rc` a `tail`-e volt: 0. Az `||`
# ag SOHA nem futott le, a lanc tovabbment, es a kovetkezo lepes NYOLC FAJLT masolt bele egy MAR
# LETEZO, IDEGEN worktree-be -- felulirva egy kovetett fajlt egy masik agens agan. A kar veletlenul
# nulla lett, mert az a fa TISZTA volt; ha be nem olvasztott munka all rajta, adatvesztes.
#
# A `CLAUDE.md` ezt a csapdat SZO SZERINT tiltja ("Kornyezetet EPITO parancs SOHA ne alljon cso
# mogott egy `&&` lancban"), es a szabalyt EPP AZ szegte meg, aki ket oraval korabban bontotta ki
# azt a szakaszt. Ezert nem szabaly lett belole, hanem ez a fajl. Kartya: 5d2b94a9.
#
# HAROM ELLENORZES, ES EGYIKET SEM LEHET ELFELEJTENI:
#   1. A CEL-UT MAR LETEZIK? -> MEGTAGADJA, es kiirja, MELYIK AG van ott. Ez az egyetlen
#      ellenorzes, ami a fenti esetet megelozte volna.
#   2. CSO NINCS: a `git worktree add` kimenete nem megy cson at, tehat az `rc` a SAJATJA.
#   3. SHA-VAL, nem ref-fel: egy `origin/develop`-pal letrehozott worktree BEALLITJA az idegen
#      upstreamet, es onnantol egy csupasz `git push` egy IDEGEN NYILVANOS projektbe menne. A lap
#      kulon rogziti, hogy ezt a hibas configot EPP a dokumentalt "biztonsagos" recept termelte.
#
# HASZNALAT:
#   bash scripts/worktree-uj.sh <ut> <uj-ag-neve> [<alap-ref, alapertelmezes: HEAD>]
#   bash scripts/worktree-uj.sh --self-test
#
# KILEPESI KOD: 0 = letrejott | 1 = megtagadva vagy hiba | 2 = hasznalati hiba
set -uo pipefail

self_test() {
  local tmp rc bad=0
  tmp="$(mktemp -d)"
  # 1. LETEZO ut -> MEGTAGADAS (ez a lenyeg)
  mkdir -p "$tmp/letezik"
  ( main "$tmp/letezik" proba-ag HEAD ) >/dev/null 2>&1; rc=$?
  [ "$rc" = 1 ] && echo "  OK    letezo utat MEGTAGAD (rc=1)" || { echo "  BUKO  letezo ut: rc=$rc, vart 1"; bad=1; }
  # 2. NEGATIV KONTROLL: hianyzo argumentum -> hasznalati hiba, NEM csendes siker
  ( main "$tmp/uj" ) >/dev/null 2>&1; rc=$?
  [ "$rc" = 2 ] && echo "  OK    hianyzo argumentum -> rc=2" || { echo "  BUKO  hianyzo arg: rc=$rc, vart 2"; bad=1; }
  # 3. NEGATIV KONTROLL: ervenytelen ref -> hiba, NEM letrejott worktree
  ( main "$tmp/uj2" proba-ag2 nincs-ilyen-ref-12345 ) >/dev/null 2>&1; rc=$?
  [ "$rc" = 1 ] && echo "  OK    ervenytelen ref -> rc=1" || { echo "  BUKO  rossz ref: rc=$rc, vart 1"; bad=1; }
  rm -rf "$tmp"
  [ "$bad" = 0 ] && echo "SELF-TEST PASS (3/3)" || echo "SELF-TEST FAIL"
  return "$bad"
}

main() {
  local ut="${1:-}" ag="${2:-}" alap="${3:-HEAD}"
  if [ -z "$ut" ] || [ -z "$ag" ]; then
    sed -n '/^# HASZNALAT:/,/^# KILEPESI/p' "$0" >&2
    return 2
  fi
  # 1. A CEL-UT MAR LETEZIK?
  if [ -e "$ut" ]; then
    echo "MEGTAGADVA: '$ut' MAR LETEZIK -- NEM irok bele." >&2
    local benne
    benne="$(git worktree list 2>/dev/null | awk -v p="$ut" '$1==p {print}')"
    if [ -n "$benne" ]; then
      echo "  Ez egy ELO worktree:  $benne" >&2
      echo "  Ha masolnal bele, MAS AGENS be nem olvasztott munkajat irnad felul." >&2
    else
      echo "  Nem worktree, de letezik. Nezd meg, mi van benne, mielott barmit teszel." >&2
    fi
    return 1
  fi
  # 3. SHA-VAL, nem ref-fel -- kulon lepes, hogy a hibaja LATHATO legyen
  local sha
  if ! sha="$(git rev-parse --verify "${alap}^{commit}" 2>/dev/null)"; then
    echo "MEGTAGADVA: a(z) '$alap' nem oldhato fel commitra EBBEN a repoban." >&2
    return 1
  fi
  # 2. CSO NINCS: az `rc` a `git worktree add` sajatja
  if ! git worktree add "$ut" -b "$ag" "$sha"; then
    echo "A WORKTREE NEM JOTT LETRE -- ALLJ. (a fenti git-hibauzenet a magyarazat)" >&2
    return 1
  fi
  echo "LETREJOTT: $ut  ag=$ag  alap=$sha  (upstream NINCS beallitva -- SHA-rol jott)"
  echo "TIPP: ha node_modules kell, KLONOZD, ne symlinkeld:  cp -Rc node_modules \"$ut/\""
  return 0
}

if [ "${1:-}" = "--self-test" ]; then self_test; exit $?; fi
main "$@"; exit $?
