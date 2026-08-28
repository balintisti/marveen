#!/bin/bash
# TUD-E FRISSULNI EZ A TELEPITES? Csak-olvaso proba, JSON-ban (kartya bae4df49).
#
# MIERT KULON SZKRIPT, ES NEM `update.sh --check`. A felmeresemben meg az utobbit
# javasoltam; a format megvaltoztattam, es ezt kimondom. Az `update.sh` ezer sor,
# es MAGA A FRISSITESI UT -- egy diagnosztika kedveert belenyulni pontosan az a
# kockazat, amit a diagnosztika elkerulni hivatott. Egy kulon, semmit nem iro
# szkript ugyanazt meri, es nem tud elrontani semmit.
#
# MIERT KELL EGYALTALAN: a frissitesi ut hibaja definicio szerint KESON derul ki
# -- akkor, amikor mar frissiteni kellene. 2026-08-23-an megmerve: ez a telepites
# MAR nem tudott frissulni (a kovetett ag nincs az originon), es senki nem tudott
# rola. Egy egyszeri teszt azt bizonyitja, hogy AKKOR mukodott; ez a proba
# utemezheto, es addig szol, amig olcso.
#
# Szerzodes, mint a `calendar-agenda.sh`-nal: MINDIG 0-val lep ki, MINDIG JSON.
# A kilepesi kod NEM hordozza a verdiktet -- egy hivo nem veszitheti el az OKOT
# azzal, hogy a statuszt nezi.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${UPDATE_REMOTE:-origin}"

emit() { python3 -c 'import json,sys; print(json.dumps(json.loads(sys.argv[1])))' "$1" 2>/dev/null || printf '%s\n' "$1"; exit 0; }
jstr() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1" 2>/dev/null || printf '"%s"' "$1"; }

cd "$ROOT" 2>/dev/null || emit '{"ok":false,"error":"a telepitesi gyoker nem elerheto"}'
git rev-parse --git-dir >/dev/null 2>&1 || emit '{"ok":false,"error":"nem git-repo"}'

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
OKOK=""; READY=1
add() { OKOK="$OKOK${OKOK:+,}$(jstr "$1")"; READY=0; }

# 1. Leválasztott HEAD: nincs mit pullolni.
if [ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ]; then
  add "levalasztott HEAD -- nincs ag, amit frissiteni lehetne"
  emit "{\"ok\":true,\"ready\":false,\"branch\":null,\"remote\":$(jstr "$REMOTE"),\"reasons\":[$OKOK]}"
fi

# 2. Letezik-e az ag a tavolin. Ez az, ami MA megfogja ezt a telepitest.
if ! git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
  add "a(z) '$BRANCH' ag nem letezik a(z) '$REMOTE' tavolin"
fi

# 3. Ahead-szam. A "NEM MERHETO" SAJAT eset, nem nulla -- ez a mai lecke
#    (update.sh:332, ahol a `|| echo 0` egy bukast megnyugtato ertekke alakitott).
if AHEAD="$(git rev-list --count '@{u}..HEAD' 2>/dev/null)"; then
  [ "${AHEAD:-0}" -gt 0 ] && add "a checkout $AHEAD helyi committal elore van az upstreamhez kepest -- ff-frissites nem lehetseges"
else
  AHEAD="null"
  add "az ahead-szam NEM MERHETO (a(z) '$BRANCH' agnak nincs beallitott upstreamje) -- ez NEM ugyanaz, mint a nulla"
fi

# 4. Piszkos munkafa: nem blokkolo (az update.sh stashel), de a jelentesben ott a helye.
DIRTY="$(git status --porcelain --untracked-files=no 2>/dev/null | wc -l | tr -d ' ')"

printf '{"ok":true,"ready":%s,"branch":%s,"remote":%s,"ahead":%s,"dirty_files":%s,"reasons":[%s]}\n' \
  "$([ "$READY" = 1 ] && echo true || echo false)" "$(jstr "$BRANCH")" "$(jstr "$REMOTE")" "${AHEAD:-null}" "${DIRTY:-0}" "$OKOK"
exit 0
