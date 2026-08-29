#!/usr/bin/env bash
# install-launchd-unit.sh <label> -- render + install + load ONE com.marveen.* launchd unit.
#
# WHY (card 9f89c7e1, measured 2026-08-27). Every loaded com.marveen.* unit had an
# UNTRACKED plist, while the single plist in the repo was the one NOT loaded. The
# two sets were disjoint: not forgetfulness, a MISSING PATH. Whoever installs
# writes into ~/Library/LaunchAgents by hand; whoever commits adds a file nobody
# installs. This script is that path.
#
# It does NOT change how any unit behaves. Templates are byte-exact copies of the
# installed plists with two placeholders substituted, and every one was verified
# to round-trip byte-identically before being committed. If a template ever fails
# to round-trip, that is a finding to report -- not something to quietly align.
set -euo pipefail

LABEL="${1:-}"
[ -n "$LABEL" ] || { echo "hasznalat: $(basename "$0") com.marveen.<nev>" >&2; exit 64; }

# A SABLON a szkript MELLETT van, a cel-utvonal MARVEEN_ROOT-bol jon. A ketto
# kulonbozhet (worktreebol telepitesz az eles fara), es ha a sablont is
# MARVEEN_ROOT alatt keresnem, a legelso -- meg be nem olvasztott -- telepites
# "nincs sablon"-nal allna meg.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARVEEN_ROOT="${MARVEEN_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
TEMPLATE="$SCRIPT_DIR/${LABEL}.plist.template"
TARGET_DIR="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
TARGET="$TARGET_DIR/${LABEL}.plist"

[ -f "$TEMPLATE" ] || { echo "HIBA: nincs sablon: $TEMPLATE" >&2; exit 1; }

mkdir -p "$TARGET_DIR"
rendered=$(sed "s|__MARVEEN_ROOT__|${MARVEEN_ROOT}|g; s|__HOME__|${HOME}|g" "$TEMPLATE")

if [ -f "$TARGET" ] && [ "$rendered" = "$(cat "$TARGET")" ]; then
  echo "$LABEL: a unit mar naprakesz"
else
  printf '%s' "$rendered" > "$TARGET"
  echo "$LABEL: telepitve -> $TARGET"
  launchctl unload "$TARGET" 2>/dev/null || true
  launchctl load "$TARGET"
  echo "$LABEL: ujratoltve"
fi

# ELLENORZES, NEM FELTETELEZES -- es NEM `launchctl list | grep -q`.
# `set -o pipefail` mellett az a forma PONT AKKOR BUKIK, AMIKOR TALAL: a `grep -q`
# az elso talalatnal kilep es lezarja a csovet, a `launchctl list` EPIPE-pel
# nem-nulla kodot ad, es a pipefail azt teszi a pipeline kodjava. Merve
# 2026-08-27: ugyanaz a parancs `bash -c` alatt TALAL, `set -euo pipefail` alatt
# NEM. Egy ellenorzes, ami hibat jelent pontosan akkor, amikor igaz.
loaded=$(launchctl list 2>/dev/null || true)
case "$loaded" in
  *"$LABEL"*) echo "$LABEL: OK, betoltve" ;;
  *) echo "HIBA: $LABEL NINCS a launchctl listaban a telepites utan" >&2; exit 2 ;;
esac
