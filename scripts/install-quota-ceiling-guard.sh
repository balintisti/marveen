#!/usr/bin/env bash
# install-quota-ceiling-guard.sh -- render + install + load the quota-ceiling guard's launchd unit.
#
# WHY THIS EXISTS (card 34b2f8a3, measured 2026-08-27). The guard itself was
# running every ten minutes while BOTH its source and its unit lived outside the
# repository. The source is committed now (22256f7); this is the other half.
#
# The half that matters on a NEW MACHINE: `~/Library/LaunchAgents/` is not part
# of the repo, so a clone gives you the script and no way to know anything ever
# ran it. Measured on this install: SEVEN loaded com.marveen.* units, and the
# plist of every single one was untracked -- while the ONE plist that IS in the
# repo (com.marveen.idle-reporter.plist) is not loaded. Everything that runs is
# unversioned; the one versioned thing does not run.
#
# Idempotent: safe to run repeatedly. Renders the template, installs it only if
# the content differs, and reloads only then.
set -euo pipefail

# A SABLON a szkript MELLETT van, a cel-utvonal viszont MARVEEN_ROOT-bol jon.
# A ketto kulonbozhet (pl. worktreebol telepitesz az eles fara), es ha a sablont is
# MARVEEN_ROOT alatt keresnem, egy meg nem beolvasztott sablonnal a telepites
# "nincs sablon"-nal allna meg -- pont akkor, amikor eloszor kellene.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARVEEN_ROOT="${MARVEEN_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
LABEL="com.marveen.quota-ceiling-guard"
TEMPLATE="$SCRIPT_DIR/${LABEL}.plist.template"
TARGET="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}/${LABEL}.plist"

[ -f "$TEMPLATE" ] || { echo "HIBA: nincs sablon: $TEMPLATE" >&2; exit 1; }
[ -x "$MARVEEN_ROOT/scripts/quota-ceiling-guard.sh" ] || {
  echo "HIBA: a szkript nem futtathato: $MARVEEN_ROOT/scripts/quota-ceiling-guard.sh" >&2; exit 1; }

mkdir -p "$(dirname "$TARGET")"
rendered=$(sed "s|__MARVEEN_ROOT__|${MARVEEN_ROOT}|g" "$TEMPLATE")

if [ -f "$TARGET" ] && [ "$rendered" = "$(cat "$TARGET")" ]; then
  echo "a unit mar naprakesz: $TARGET"
else
  printf '%s' "$rendered" > "$TARGET"
  echo "telepitve: $TARGET"
  launchctl unload "$TARGET" 2>/dev/null || true
  launchctl load "$TARGET"
  echo "ujratoltve: $LABEL"
fi

# ELLENORZES, NEM FELTETELEZES: a fajl megleteet a `launchctl list` nem helyettesiti,
# es forditva sem. Egy telepites, ami nem nezi meg, hogy a unit TENYLEG betoltodott-e,
# ugyanaz a nema siker, mint minden mas ezen a lapon.
# NEM `launchctl list | grep -q` -- MERT AZ `set -o pipefail` MELLETT PONT AKKOR BUKIK,
# AMIKOR TALAL (merve, 2026-08-27, ebben a szkriptben). A `grep -q` az elso talalatnal
# kilep es lezarja a csovet; a `launchctl list` ettol EPIPE-pel nem-nulla kodot ad, es a
# `pipefail` azt teszi a pipeline kodjava. Vagyis a sikeres illesztes HIBAKENT jelenik meg.
# Ugyanaz a csalad, mint a `cmd | tail && echo ok`: a cso elnyeli a valodi allapotot.
loaded=$(launchctl list 2>/dev/null || true)
case "$loaded" in
  *"$LABEL"*) echo "OK: $LABEL betoltve (launchctl list)" ;;
  *) echo "HIBA: $LABEL NINCS a launchctl listaban a telepites utan" >&2; exit 2 ;;
esac
