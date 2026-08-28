#!/usr/bin/env bash
# pre-push-secret-check.sh -- a push ELOTTI titok-ellenorzes, a MEGLEVO kapuval.
#
# MIERT LETEZIK (kartya dd5e07b4, mert eset 2026-08-28). A lapon egy KEZI recept allt:
# `git ls-tree <ag> | grep <minta>`, agankent ciklusban. Kettot nem tudott:
#
#   1. NEM NEZTE MEG, HOGY A BEMENET LETEZIK-E. Egy elgepelt agnevre a `git ls-tree`
#      a STDERR-re irt `fatal: Not a valid object name`-et, a ciklus szamlaloja nullan
#      maradt, es a verdikt "talalat: nincs" lett. Egy NEM LETEZO ag pontosan ugy nezett
#      ki, mint egy tiszta ag. A mero jo volt, a kontroll jo volt -- a BEMENET nem letezett.
#   2. NEM KULONBOZTETTE MEG a "nem vizsgaltam"-ot a "tiszta"-tol.
#
# Mindkettot tudja viszont a repo sajat kapuja (`scripts/secret-gate.ts`, EVIDGUARD818),
# amit a pre-commit hook es a CI is hiv. Merve ugyanaznap:
#     --range origin/main..<letezo ag>      -> exit 1 + "NOT SCANNED, therefore NOT CLEARED"
#     --range origin/main..<NEM letezo ag>  -> exit 2 + "an undeterminable set is a failure,
#                                                        not a pass"
# Ezert ez a szkript NEM ellenoriz maga: FELOLDJA a refeket, aztan DELEGAL.
# marveen megfogalmazasa a lapon: egy dokumentalt kezi masolat egy meglevo eszkozrol nem
# redundancia, hanem egy MASODIK, GYENGEBB IGAZSAG ugyanarrol.
#
# A KAPU MERT KORLATJA, ES AMIT EZ A SZKRIPT TESZ VELE: a `--range` a NEVEKET a diffbol
# veszi, a TARTALMAT viszont a MUNKAFABOL olvassa. Egy ki nem csekkolt ag fajljaira ezert
# "NOT SCANNED"-et ad (fail-closed, tehat nem veszelyes -- csak hasznalhatatlan). Ha a
# vizsgalt ref NEM a jelenlegi HEAD, ez a szkript ideiglenes worktreet nyit ra, ott futtat,
# es utana eltakaritja.
#
# HASZNALAT:
#   bash scripts/pre-push-secret-check.sh <ag-vagy-ref> [<bazis>]      # bazis: origin/main
# KILEPESI KODOK (a kapuei, valtozatlanul):
#   0 tiszta | 1 talalat VAGY nem vizsgalt fajl | 2 a halmaz nem meghatarozhato
#
# ES EGY MEGJEGYZES A HIVOKNAK, mert ket agens futott bele ugyanaznap (friday x3, marveen x1):
#   `... | tail -3; echo "exit=$?"`  a TAIL kodjat irja ki, nem a szkriptet.
#   A `$?` a csovezetek UTOLSO tagjara vonatkozik, es ezt a hej nem jelzi.
#   Helyes alak:  bash scripts/pre-push-secret-check.sh <ag> > /tmp/out 2>&1; rc=$?
#   Csovezetekben:  set -o pipefail   vagy   "${PIPESTATUS[0]}"
set -euo pipefail

REF="${1:-}"
BASE="${2:-origin/main}"
ROOT="$(git rev-parse --show-toplevel)"

if [ -z "$REF" ]; then
  echo "hasznalat: pre-push-secret-check.sh <ag-vagy-ref> [<bazis>]" >&2
  exit 2
fi

# 1) A BEMENET FELOLDASA -- ez az a lepes, ami a mert esetbol hianyzott.
#    A verdikt melle a fa SHA-ja kerul, tehat a kimenet MEGMONDJA, MIT vizsgalt.
if ! REF_SHA=$(git -C "$ROOT" rev-parse --verify --quiet "${REF}^{commit}"); then
  echo "pre-push-secret-check: a ref NEM OLDHATO FEL: ${REF}" >&2
  echo "  Ez NEM 'tiszta': egy nem letezo bemenetet nem vizsgaltunk meg." >&2
  echo "  (Merve 2026-08-28: a korabbi kezi recept ilyenkor 'talalat: nincs'-et irt ki.)" >&2
  exit 2
fi
if ! BASE_SHA=$(git -C "$ROOT" rev-parse --verify --quiet "${BASE}^{commit}"); then
  echo "pre-push-secret-check: a BAZIS nem oldhato fel: ${BASE}" >&2
  echo "  Probald: git fetch origin main" >&2
  exit 2
fi

echo "pre-push-secret-check: ${REF} = ${REF_SHA} | bazis ${BASE} = ${BASE_SHA}" >&2

HEAD_SHA=$(git -C "$ROOT" rev-parse HEAD)
run_gate() {  # $1 = munkakonyvtar
  ( cd "$1" && npx --no-install tsx "$ROOT/scripts/secret-gate.ts" --range "${BASE_SHA}..${REF_SHA}" )
}

if [ "$REF_SHA" = "$HEAD_SHA" ]; then
  # A ref MAR ki van csekkolva: a kapu a munkafabol olvashat.
  run_gate "$ROOT"
else
  # Kulonben ideiglenes worktree. HOME ALATT, nem /tmp-ben: a hook-path guard a
  # /tmp alatti fakat elutasitja, es akkor a kapu egy MASIK hibaba futna bele.
  WT="$HOME/.marveen-secretcheck-$$"
  cleanup() { git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  git -C "$ROOT" worktree add --detach --quiet "$WT" "$REF_SHA"
  ln -sfn "$ROOT/node_modules" "$WT/node_modules"
  run_gate "$WT"
fi
