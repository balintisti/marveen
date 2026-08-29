#!/bin/bash
# Is the SHARED Playwright browser cache actually usable? Read-only, line-based.
#
# WHY THIS EXISTS (card d1cf8ffb, measured 2026-08-23). A `playwright install`
# downloaded its 165 MiB in ~3 minutes and then STOPPED during extraction, at 84
# files / 448 KB -- twice, byte for byte the same place, every thread parked. The
# process stayed alive for 5.5 hours holding the cache lock, so every agent's e2e
# run was blocked. Nothing reported it: the failure had no signal of its own, and
# the cache is shared, so ONE stuck install stops the whole fleet.
#
# AND THE SHAPE THAT MADE IT WORSE: a half-extracted browser directory EXISTS. It
# was read as "the install finished" from a directory listing -- 1.5 MB and two
# files (ABOUT, LICENSE) against a finished size of 336 MB. A listing says the
# thing is THERE, not that it is READY. Playwright itself decides readiness on one
# marker file (INSTALLATION_COMPLETE), so that is what this checks -- plus a size
# floor, because a marker over an empty directory would lie in the other direction.
#
# CONTRACT, deliberately the same as scripts/google-health.sh: always prints
# STATUS|text lines, always exits 0. A missing cache is reported as SKIP -- NOT as
# OK. "Not measured" and "healthy" must never look alike.
set -uo pipefail

CACHE="${1:-${PLAYWRIGHT_BROWSERS_PATH:-}}"
if [ -z "$CACHE" ]; then
  case "$(uname -s)" in
    Darwin) CACHE="$HOME/Library/Caches/ms-playwright" ;;
    *)      CACHE="$HOME/.cache/ms-playwright" ;;
  esac
fi

# THE FLOOR IS MEASURED, NOT GUESSED (2026-08-23, on the live shared cache):
#   chromium-1217 ................ 343964 KB, 337 files
#   chromium_headless_shell-1217 . 193748 KB,  19 files
#   ffmpeg-1011 ..................   2548 KB,   4 files   <- the smallest REAL package
#   the stalled extraction .......    448 KB,  84 files   <- the failure
# Note what that table kills: FILE COUNT cannot separate them. The broken state had
# 84 files, TWENTY TIMES more than a perfectly healthy ffmpeg. A first version of
# this check required 10+ files and reported ffmpeg-1011 -- a package dexter had
# verified as complete -- as a failure. Only the byte size separates the two, and
# 1 MB sits between 448 KB and 2548 KB with room on both sides.
MIN_KB=1024
# The measured stall held the lock for 5.5 hours. A healthy install holds it for
# minutes, so half an hour is far outside normal and far inside the damage.
STALE_LOCK_MIN=30

if [ ! -d "$CACHE" ]; then
  echo "SKIP|nincs Playwright-gyorsitotar ($CACHE) -- NEM MERVE, nem 'rendben'"
  exit 0
fi

echo "INFO|gyorsitotar: $CACHE"

LOCK="$CACHE/__dirlock"
if [ -e "$LOCK" ]; then
  LOCK_MIN="$(python3 - "$LOCK" <<'PY'
import os,sys,time
try: print(int((time.time()-os.path.getmtime(sys.argv[1]))/60))
except Exception: print(-1)
PY
)"
  if [ "$LOCK_MIN" -ge "$STALE_LOCK_MIN" ] 2>/dev/null; then
    echo "FAIL|__dirlock ${LOCK_MIN} perce all -- egy beakadt telepites BLOKKOLJA a tobbi agens e2e-jet"
  else
    echo "INFO|__dirlock jelen van (${LOCK_MIN} perce) -- egy telepites eppen fut"
  fi
fi

FOUND=0
for DIR in "$CACHE"/*/; do
  NAME="$(basename "$DIR")"
  [ -d "$DIR" ] || continue
  # A browser PACKAGE is always <name>-<revision>. The cache also holds Playwright's
  # own bookkeeping -- `.links` (hidden, so the glob never sees it) and `b`, which
  # holds `browser@<hash>` entries. Measured on the live cache: `b` is 4 KB with one
  # file and no marker, i.e. it matches the broken-package shape exactly. Reporting
  # it would be a false alarm on healthy state -- the failure this repo keeps paying
  # for -- and the obvious "fix" for the next reader would be to delete a directory
  # Playwright maintains. So the population is stated, not assumed.
  case "$NAME" in
    *-[0-9]*) ;;
    *) echo "INFO|$NAME: nem bongeszo-csomag (a Playwright sajat nyilvantartasa) -- kihagyva"; continue ;;
  esac
  FOUND=$((FOUND + 1))
  FILES="$(find "$DIR" -type f 2>/dev/null | wc -l | tr -d ' ')"
  KB="$(du -sk "$DIR" 2>/dev/null | awk '{print $1}')"
  KB="${KB:-0}"
  if [ ! -f "$DIR/INSTALLATION_COMPLETE" ]; then
    echo "FAIL|$NAME: nincs INSTALLATION_COMPLETE marker (${FILES} fajl, ${KB} KB) -- felbeszakadt kicsomagolas, a Playwright ujra fogja tolteni"
  elif [ "$KB" -lt "$MIN_KB" ]; then
    echo "FAIL|$NAME: marker VAN, de a konyvtar ures-kozeli (${FILES} fajl, ${KB} KB) -- a marker keszet allit egy felbeszakadt kicsomagolasra"
  else
    echo "OK|$NAME: kesz (${FILES} fajl, ${KB} KB)"
  fi
done

if [ "$FOUND" -eq 0 ]; then
  echo "SKIP|a gyorsitotar letezik, de egyetlen bongeszo-konyvtar sincs benne -- NEM MERVE"
fi
exit 0
