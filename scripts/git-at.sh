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
#   bash scripts/git-at.sh exists <ref> <ut>     # 0 = van, 1 = nincs, 3 = NEM MERHETO
#   bash scripts/git-at.sh -C <repo> exists ...  # MELYIK fat kerdezed (agens-cwd ellen)
#   bash scripts/git-at.sh which  <ut> [ref...]  # MELYIK refeken van meg (soronkent)
#
# Peldak:
#   bash scripts/git-at.sh exists feat/valami scripts/secret-gate.ts && echo VAN
#   bash scripts/git-at.sh which scripts/secret-gate.ts $(git for-each-ref --format='%(refname:short)' refs/heads/)
set -euo pipefail

# A HAROM KIMENET SZETVALASZTASA (kartya d8d5b92c, mandark merte 2026-09-03).
#
# A `git cat-file -e "$ref:$ut" 2>/dev/null` HAROM allapotot lapitott egyetlen
# `exit 1`-be, nema stderrel:
#   (a) az ut tenyleg nincs abban a refben        -> VALODI nemleges
#   (b) a ref nem oldodik fel EBBEN a repoban     -> ROSSZ REPO, nem valasz
#   (c) egyaltalan nem vagyunk git repoban        -> nem merheto
#
# Mert eset: az agens-cwd a SAJAT agens-konyvtara (marveen repo), es minden
# Bash-hivas utan oda all vissza -- egy Delta-CRM utat tehat a marveen repoban
# keresett, ahol az tenyleg nincs. A valasz "NINCS" volt, nulla stderrel,
# bajt-azonosan egy igaz nemlegessel.
#
# A (b) es (c) mostantol EXIT 3, es KIIRJA, MELYIK repoban keresett.
#
# ES AMI EBBOL NEM KOVETKEZIK -- lemertem, mielott keszet mondtam volna: a
# ref-ellenorzes a MERT ESETET NEM fogja meg. Az `origin/main` MINDKET repoban
# feloldodik (a marveen repo origin-ja a Szotasz-upstream), tehat a rossz repoban
# is ervenyes ref, csak MAS FA. Ezert ket tovabbi valtozas kell:
#   - egy NEMLEGES valasz mostantol kiirja a stderr-re, MELYIK repoban es MELYIK
#     refen nezett -- a hamis negativ igy ondiagnosztizalo lesz;
#   - `-C <repo>` kapcsolo, hogy a hivo KIMONDHASSA, melyik fat kerdezi.
# Az exit-kod nem valtozik: 1 = nincs ott, 3 = nem merheto.
repo_root() { git rev-parse --show-toplevel 2>/dev/null || true; }

require_ref() {
  local ref="$1" root
  root="$(repo_root)"
  if [ -z "$root" ]; then
    printf 'git-at.sh: %s NEM git repo -- a valasz nem "nincs", hanem "NEM MERHETO". (exit 3)\n' "$PWD" >&2
    exit 3
  fi
  if ! git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null 2>&1; then
    printf 'git-at.sh: a(z) "%s" ref NEM oldodik fel itt: %s\n' "$ref" "$root" >&2
    printf 'git-at.sh: ez NEM azt jelenti, hogy a fajl nincs meg -- valoszinuleg rossz repo. (exit 3)\n' >&2
    exit 3
  fi
}

usage() {
  sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
  exit 64
}

# `-C <repo>`: a hivo KIMONDJA, melyik fat kerdezi. Enelkul a valasz az AKTUALIS
# konyvtar repojarol szol, ami egy agens-sessionben sosem az, amire gondol.
if [ "${1:-}" = "-C" ]; then
  target="${2:?-C utan repo-ut kell}"; shift 2
  cd "$target" || { printf 'git-at.sh: nem tudok belepni ide: %s (exit 3)\n' "$target" >&2; exit 3; }
fi

cmd="${1:-}"; shift || true

case "$cmd" in
  show)
    ref="${1:?ref kell}"; path="${2:?ut kell}"
    require_ref "$ref"
    # A KAPCSOS ZAROJEL ITT A LENYEG: lezarja a valtozonevet, tehat a kettospont
    # literal marad. Ez az EGYETLEN hely a rendszerben, ahol ez az alak leirodik.
    git show "${ref}:${path}"
    ;;
  exists)
    ref="${1:?ref kell}"; path="${2:?ut kell}"
    require_ref "$ref"
    if git cat-file -e "${ref}:${path}" 2>/dev/null; then exit 0; fi
    # A NEMLEGES VALASZ MEGNEVEZI A FAT. Enelkul egy igaz "nincs ott" es egy rossz
    # repoban feltett kerdes bajt-azonos -- ez volt a lelet (kartya d8d5b92c).
    printf 'git-at.sh: NINCS "%s" a(z) "%s" refen ITT: %s\n' "$path" "$ref" "$(repo_root)" >&2
    exit 1
    ;;
  which)
    path="${1:?ut kell}"; shift
    [ "$#" -gt 0 ] || { echo "git-at.sh which: legalabb egy ref kell" >&2; exit 64; }
    # Egy fel nem oldodo ref itt NEM kihagyando: a csendes kihagyas pontosan az
    # a hamis nemleges, amirol ez a kartya szol. Kiirjuk, es a vegen exit 3.
    unresolved=0
    for ref in "$@"; do
      if ! git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null 2>&1; then
        printf 'git-at.sh which: a(z) "%s" ref nem oldodik fel itt (%s) -- KIHAGYVA, nem "nincs benne"\n' \
          "$ref" "$(repo_root)" >&2
        unresolved=1
        continue
      fi
      if git cat-file -e "${ref}:${path}" 2>/dev/null; then printf '%s\n' "$ref"; fi
    done
    [ "$unresolved" = "0" ] || exit 3
    ;;
  *)
    usage
    ;;
esac
