#!/usr/bin/env bash
# upstream-sync-report.sh -- MER es JELENT az upstream lemaradasrol. SOHA nem olvaszt be.
#
# WHY (card c83eb6b6). The cost of falling behind does not grow linearly: ten
# commits is an afternoon, a hundred is a week, a thousand is never. Today's
# state has no guard, so its decay would not be an event.
#
# WHY IT FETCHES FIRST, AND WHY THAT IS THE WHOLE POINT (measured 2026-08-27).
# `origin/develop` is a LOCAL ref. The card was written on a measurement of
# "1 commit behind" taken at 14:1x; re-measured after a fetch the same day it
# was FORTY-NINE, and NONE of those 49 commits was newer than 12:17 -- the ref
# had simply not been updated since 08-24 14:30 (git reflog). The number was
# not wrong about what it measured; the population was three days old.
# So: fetch, and if the fetch FAILS, say so instead of reporting a stale ref as
# a fresh answer.
#
# WHY IT DOES NOT MERGE. An automatic `git merge` in the main checkout is
# exactly the move the deployment-lane section warns about: `scripts/` and
# `web/` take effect IMMEDIATELY, with no build and no restart. Merging stays a
# human/agent decision.
set -uo pipefail

ROOT="${MARVEEN_ROOT:-/Users/isti/marveen}"
UPSTREAM="${UPSTREAM_REF:-origin/develop}"
cd "$ROOT" 2>/dev/null || { echo "upstream-sync: nincs ilyen fa: $ROOT"; exit 1; }

# A MI TERULETUNK -- a kartya sorolja fel. Utvonal-mintak, nem talalgatas.
OURS_RE='scripts/hooks/|context-guard|schedule-runner|vault|approval|agent-scaffold|agent-process|idle-agent|pane-state|skill-index'
# BIZTONSAGI JELOLOK. EZ EGY DETEKTOR, NEM ITELET -- lasd a jelentes vegen.
# `grep -Ei`, NEM `-P`: a macOS BSD grepjenek NINCS `-P` kapcsoloja. Az elso
# valtozatom azt hasznalta, a grep HIBARA futott, es a `|| true` elnyelte -- a
# jelentesbe "(nincs talalat)" kerult. Egy detektor, ami ELSZALL, nulla leletet
# jelent, es az megkulonboztethetetlen egy valodi nullatol. Ezert all lent a
# kilepesi kod HAROM aga kulon (0 talalt / 1 nincs / >=2 HIBA).
SEC_RE='security|vulnerab|CVE-|injection|escalat|sandbox escape|secret leak|auth bypass|path traversal'

echo "=== UPSTREAM-SZINKRON ($(date '+%Y-%m-%d %H:%M %Z')) ==="
echo

last_fetch=$(git reflog show "$UPSTREAM" --date=format:'%Y-%m-%d %H:%M' 2>/dev/null | head -1 | sed -n 's/.*@{\(.*\)}:.*/\1/p')
if git fetch -q origin 2>/dev/null; then
  echo "A tavoli ref frissitve MOST. (Elozo frissites: ${last_fetch:-ismeretlen}.)"
else
  echo "FIGYELEM: A FETCH NEM SIKERULT. Az alabbi szamok a HELYI ref-en allnak,"
  echo "  ami ${last_fetch:-ismeretlen} ota nem frissult -- tehat NEM a mai allapotot mondjak."
fi
echo

behind=$(git rev-list --count "$UPSTREAM" ^HEAD 2>/dev/null || echo '?')
ahead=$(git rev-list --count HEAD ^"$UPSTREAM" 2>/dev/null || echo '?')

# A SZOVEG MONDJA KI AZ IRANYT, NEM A SZAMPAR. A kartya kikotese, es mert okbol:
# a `--left-right --count` BAL szama az, ami CSAK a BAL oldalon van -- marveen ezt
# 2026-08-27-en forditva olvasta, es egy strategiai javaslatot epitett ra, amit
# vissza kellett vonnia. Egy "1 | 176" sor barmelyik iranyba olvashato; egy
# "egy committal vagyunk mogotte" nem.
if [ "$behind" = "0" ]; then
  echo "LEPEST TARTUNK: nincs olyan commit az upstreamen, ami nalunk ne lenne."
else
  echo "LEMARADASBAN VAGYUNK: ${behind} olyan commit van az upstreamen, ami NALUNK NINCS."
fi
echo "(Es ${ahead} sajat commitunk van, ami az upstreamen nincs -- ez nem lemaradas, ez a mi munkank.)"
echo

if [ "${behind:-0}" != "0" ] && [ "${behind:-0}" != "?" ]; then
  echo "--- AMI MINKET ERINT (${OURS_RE//|/, }) ---"
  hit=0
  while IFS= read -r sha; do
    files=$(git show --name-only --format='' "$sha" 2>/dev/null | grep -E "$OURS_RE" | head -3 | tr '\n' ' ')
    [ -n "$files" ] || continue
    hit=$((hit+1))
    printf '  %s  %s\n' "$(git log -1 --format='%h %s' "$sha" | cut -c1-88)" ""
    printf '      -> %s\n' "$files"
  done < <(git rev-list "$UPSTREAM" ^HEAD)
  [ "$hit" -eq 0 ] && echo "  (egyik sem erint minket a fenti utvonalak szerint)"
  echo

  echo "--- BIZTONSAGI JELOLO A COMMIT-UZENETBEN ---"
  sec=$(git log --format='%h %s' "$UPSTREAM" ^HEAD | grep -Ei "$SEC_RE"); rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "$sec" | sed 's/^/  /'
  elif [ "$rc" -eq 1 ]; then
    echo "  (nincs talalat -- a detektor LEFUTOTT es nem talalt semmit)"
  else
    echo "  A DETEKTOR NEM FUTOTT LE (grep exit ${rc}). NEM tudom, van-e biztonsagi javitas."
  fi
  echo
  echo "  A JELOLO EGY DETEKTOR, NEM ITELET: a commit-UZENET szavaira illeszt, tehat"
  echo "  egy biztonsagi javitas semleges uzenettel NEM latszik. A nulla talalat azt"
  echo "  jelenti, hogy egyik uzenet SEM hasznalta ezeket a szavakat -- nem azt, hogy"
  echo "  nincs biztonsagi javitas a ${behind} commit kozott."
  echo
fi

echo "--- MIT NEM CSINALTAM ---"
echo "Nem olvasztottam be semmit. A merge emberi/agens dontes: a fo checkoutban a"
echo "\`scripts/\` es a \`web/\` AZONNAL hat, build es ujrainditas nelkul."
