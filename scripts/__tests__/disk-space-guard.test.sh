#!/bin/bash
# Contract tests for scripts/disk-space-guard.sh.
# Run: bash scripts/__tests__/disk-space-guard.test.sh
#
# Exercises the threshold logic, the age-guarded allowlist reap, the critical
# alert + cooldown, and the malformed-input no-op -- all through the real script
# via its DISK_GUARD_* test hooks (no actual df / Telegram / rm of real scratch).

set -u

PASS=0; FAIL=0
TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }
assert_eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected '$2', got '$3')"; fi; }

INSTALL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
GUARD="$INSTALL_DIR/scripts/disk-space-guard.sh"

# EVERY child bash inherits this, so the eighth invocation someone adds cannot
# message the owner by forgetting a flag (didi, 2026-09-19). It was safe by
# discipline at six call sites -- and four of those six were added in the same
# hour as this line, each one remembering it. The per-call settings below are now
# harmless redundancy; nothing weakens, because the asserts read the ALERT_DRYRUN
# marker, which is still produced. A case that needs the real alert path (n) turns
# it off explicitly, which is a visible act rather than an omission.
export DISK_GUARD_ALERT_DRYRUN=1

# SHTEST807: GNU `touch_aged` is not portable -- BSD (macOS) touch
# rejects it, the fixture files were never created, and every "survives the
# reap" assert read the missing file as "deleted" (3 false FAILs + 2 more).
# `touch -t [[CC]YY]MMDDhhmm` is accepted by BSD and GNU alike.
TS_2H_AGO="$(python3 -c 'import time; print(time.strftime("%Y%m%d%H%M", time.localtime(time.time()-7200)))')"
touch_aged() { touch -t "$TS_2H_AGO" "$@"; }

# Run the guard with an isolated scratch + state dir and a usage override.
# Args: usage scratch_dir state_dir  -> prints stdout (logs + any ALERT_DRYRUN).
run_guard() {
  DISK_GUARD_USAGE_OVERRIDE="$1" DISK_GUARD_SCRATCH_DIR="$2" DISK_GUARD_STATE_DIR="$3" \
    DISK_GUARD_ALERT_DRYRUN=1 bash "$GUARD" 2>&1
}

# SHTEST807: the scratch fixture must live under the REAL /tmp -- macOS mktemp
# honours TMPDIR=/var/folders/..., which the guard's W3 location guard rightly
# refuses, so every reap assert failed before it began. State can stay anywhere.
SCRATCH_BASE="$(mktemp -d /tmp/dsg-test-XXXXXX)"
trap 'rm -rf "$TMPDIR_BASE" "$SCRATCH_BASE"' EXIT
fresh_case() { # -> echoes "scratch state" for a clean case dir
  local d s; d="$TMPDIR_BASE/case-$1"; s="$SCRATCH_BASE/case-$1"; mkdir -p "$s" "$d/state"
  echo "$s $d/state"
}

echo "disk-space-guard tests"
echo "======================"

# ---------------------------------------------------------------------------
# (a) Below reap threshold -> total no-op
# ---------------------------------------------------------------------------
echo ""
echo "(a) Below threshold"
read -r SCR ST <<<"$(fresh_case a)"
touch_aged "$SCR/health_old.bin"
OUT="$(run_guard 50 "$SCR" "$ST")"
assert_eq "below threshold: no reap log" "" "$OUT"
[ -e "$SCR/health_old.bin" ] && pass "below threshold: scratch untouched" || fail "below threshold: scratch was reaped"

# ---------------------------------------------------------------------------
# (b) At/over reap threshold -> reap aged allowlist, keep fresh + unrelated
# ---------------------------------------------------------------------------
echo ""
echo "(b) Reap threshold"
read -r SCR ST <<<"$(fresh_case b)"
touch_aged "$SCR/health_old.xml"
mkdir -p "$SCR/health_unpacked"; touch_aged "$SCR/health_unpacked"
touch "$SCR/health_fresh.xml"               # recent -> age guard protects it
touch_aged "$SCR/keepme.txt"    # not on allowlist -> protected
OUT="$(run_guard 92 "$SCR" "$ST")"
[ ! -e "$SCR/health_old.xml" ] && pass "reap: aged health_* file removed" || fail "reap: aged health file survived"
[ ! -e "$SCR/health_unpacked" ] && pass "reap: aged health_* dir removed" || fail "reap: aged health dir survived"
[ -e "$SCR/health_fresh.xml" ] && pass "reap: fresh health_* file PROTECTED by age guard" || fail "reap: fresh health file was deleted"
[ -e "$SCR/keepme.txt" ] && pass "reap: non-allowlist file PROTECTED" || fail "reap: non-allowlist file deleted"
if printf '%s' "$OUT" | grep -q "ALERT_DRYRUN"; then fail "reap (92%): must NOT alert below 95%"; else pass "reap (92%): no alert below 95%"; fi

# ---------------------------------------------------------------------------
# (c) At/over alert threshold -> critical alert via dry-run
# ---------------------------------------------------------------------------
echo ""
echo "(c) Alert threshold"
read -r SCR ST <<<"$(fresh_case c)"
OUT="$(run_guard 96 "$SCR" "$ST")"
if printf '%s' "$OUT" | grep -q "ALERT_DRYRUN"; then pass "alert: critical alert emitted at 96%"; else fail "alert: no alert at 96%"; fi
[ -f "$ST/.disk-guard-alerted" ] && pass "alert: cooldown stamp written" || fail "alert: cooldown stamp missing"

# ---------------------------------------------------------------------------
# (d) Alert cooldown -> second run within the hour does NOT re-alert
# ---------------------------------------------------------------------------
echo ""
echo "(d) Alert cooldown"
OUT2="$(run_guard 96 "$SCR" "$ST")"   # same state dir, stamp is fresh
if printf '%s' "$OUT2" | grep -q "ALERT_DRYRUN"; then fail "cooldown: re-alerted within cooldown"; else pass "cooldown: suppressed re-alert within cooldown"; fi

# ---------------------------------------------------------------------------
# (e) Malformed usage -> no-op, no crash
# ---------------------------------------------------------------------------
echo ""
echo "(e) Malformed usage"
read -r SCR ST <<<"$(fresh_case e)"
touch_aged "$SCR/health_old.bin"
OUT="$(run_guard "garbage" "$SCR" "$ST")"
if printf '%s' "$OUT" | grep -q "could not read disk usage"; then pass "malformed: logs a clean no-op"; else fail "malformed: unexpected output: $OUT"; fi
[ -e "$SCR/health_old.bin" ] && pass "malformed: scratch untouched on bad usage" || fail "malformed: reaped on bad usage"

# ---------------------------------------------------------------------------
# (f) W3 location guard -> refuse to reap a SCRATCH_DIR outside /tmp
# ---------------------------------------------------------------------------
echo ""
echo "(f) W3 location guard"
OUTSIDE="$(TMPDIR="$HOME" mktemp -d 2>/dev/null || true)"
if [ -n "$OUTSIDE" ]; then
  touch_aged "$OUTSIDE/health_outside.bin"
  run_guard 92 "$OUTSIDE" "$OUTSIDE" >/dev/null 2>&1
  [ -e "$OUTSIDE/health_outside.bin" ] && pass "W3: scratch outside /tmp is NOT reaped" || fail "W3: reaped scratch outside /tmp"
  rm -rf "$OUTSIDE"
else
  fail "W3: could not create an out-of-/tmp test dir"
fi
# A symlinked SCRATCH_DIR (even pointing into /tmp) is refused.
read -r SCR ST <<<"$(fresh_case f)"
touch_aged "$SCR/health_real.bin"
LINK="$TMPDIR_BASE/f-link"; ln -s "$SCR" "$LINK"
run_guard 92 "$LINK" "$ST" >/dev/null 2>&1
[ -e "$SCR/health_real.bin" ] && pass "W3: symlinked SCRATCH_DIR is NOT reaped" || fail "W3: reaped via symlinked SCRATCH_DIR"

# ---------------------------------------------------------------------------
# (g) W2 reap-age validation -> invalid env falls back to a conservative default
# ---------------------------------------------------------------------------
echo ""
echo "(g) W2 reap-age validation"
read -r SCR ST <<<"$(fresh_case g)"
touch_aged "$SCR/health_2h.bin"   # 120 min old; < the 1440 fallback
DISK_GUARD_REAP_MIN_AGE_MIN="garbage" run_guard 92 "$SCR" "$ST" >/dev/null 2>&1
[ -e "$SCR/health_2h.bin" ] && pass "W2: invalid reap-age -> conservative default, recent file kept" || fail "W2: invalid reap-age reaped a 2h-old file"
# Sanity: a valid small age still reaps the same 2h-old file.
read -r SCR2 ST2 <<<"$(fresh_case g2)"
touch_aged "$SCR2/health_2h.bin"
DISK_GUARD_REAP_MIN_AGE_MIN="30" run_guard 92 "$SCR2" "$ST2" >/dev/null 2>&1
[ ! -e "$SCR2/health_2h.bin" ] && pass "W2: valid reap-age still reaps an aged file" || fail "W2: valid reap-age failed to reap"

# ---------------------------------------------------------------------------
# (h) C — reap-age "0" must NOT reap active files (0 -> 1440 fallback)
# ---------------------------------------------------------------------------
echo ""
echo "(h) C reap-age 0 guard"
read -r SCR ST <<<"$(fresh_case h)"
touch "$SCR/health_fresh.bin"   # brand-new; -mmin +0 would match it
DISK_GUARD_REAP_MIN_AGE_MIN="0" run_guard 92 "$SCR" "$ST" >/dev/null 2>&1
[ -e "$SCR/health_fresh.bin" ] && pass "C: reap-age 0 -> 1440 fallback, fresh file kept" || fail "C: reap-age 0 reaped an active file"

# ---------------------------------------------------------------------------
# (i) D — an aged DIR with a fresh file inside is in-progress -> NOT reaped
# ---------------------------------------------------------------------------
echo ""
echo "(i) D directory-mtime guard"
read -r SCR ST <<<"$(fresh_case i)"
mkdir -p "$SCR/health_inprogress"; touch "$SCR/health_inprogress/part.xml"   # fresh file inside
touch_aged "$SCR/health_inprogress"                              # dir mtime looks old
DISK_GUARD_REAP_MIN_AGE_MIN="30" run_guard 92 "$SCR" "$ST" >/dev/null 2>&1
[ -d "$SCR/health_inprogress" ] && pass "D: aged dir with a fresh file inside is NOT reaped" || fail "D: reaped an in-progress export dir"
# Control: a dir whose files are ALL old IS reaped.
read -r SCR2 ST2 <<<"$(fresh_case i2)"
mkdir -p "$SCR2/health_done"; touch_aged "$SCR2/health_done/done.xml" "$SCR2/health_done"
DISK_GUARD_REAP_MIN_AGE_MIN="30" run_guard 92 "$SCR2" "$ST2" >/dev/null 2>&1
[ ! -d "$SCR2/health_done" ] && pass "D: fully-old dir is still reaped" || fail "D: fully-old dir not reaped"

# ---------------------------------------------------------------------------
# (j) B — cooldown stamp persists even when STATE_DIR was missing (no alert-spam)
# ---------------------------------------------------------------------------
echo ""
echo "(j) B cooldown-stamp persistence"
JBASE="$TMPDIR_BASE/j"; mkdir -p "$JBASE/scratch"; JSTATE="$JBASE/state-missing"   # JSTATE does not exist
OUTJ1="$(run_guard 96 "$JBASE/scratch" "$JSTATE")"
if printf '%s' "$OUTJ1" | grep -q "ALERT_DRYRUN"; then pass "B: alerts at 96% on first tick"; else fail "B: no alert at 96%"; fi
[ -f "$JSTATE/.disk-guard-alerted" ] && pass "B: cooldown stamp written despite missing STATE_DIR (mkdir at top)" || fail "B: stamp not written -> would re-alert 60x/h"
OUTJ2="$(run_guard 96 "$JBASE/scratch" "$JSTATE")"
if printf '%s' "$OUTJ2" | grep -q "ALERT_DRYRUN"; then fail "B: re-alerted within cooldown (stamp not honoured)"; else pass "B: second tick suppressed by cooldown"; fi

# ---------------------------------------------------------------------------
# (k) THE df LINE ITSELF -- the one line every other case in this file hides
#
# Every case above goes through run_guard, which sets DISK_GUARD_USAGE_OVERRIDE,
# so the VOLUME CHOICE was the only uncovered line in the guard -- and it was the
# wrong one: DISK_PATH="/" while the reaper works under SCRATCH_DIR. On macOS /
# is the read-only system volume (7%) and /tmp -> /private/tmp lives on
# /System/Volumes/Data (62%), measured 2026-09-19, card fbbbca3c (didi found it).
# These cases run `--probe`, which deliberately IGNORES the override, so the real
# `df` executes.
#
# ON A SINGLE-VOLUME HOST (typical Linux, /tmp on /) the mount assert is VACUOUS.
# That is correct and intended -- the defect is macOS-shaped. What is not vacuous
# anywhere is the last assert: that the probe refuses the override, i.e. that df
# really ran. Without it the three asserts above could all pass on a fake number.
# ---------------------------------------------------------------------------
echo ""
echo "(k) real df path (no usage override)"
KSCR="$SCRATCH_BASE/case-k"; mkdir -p "$KSCR"

PROBE="$(DISK_GUARD_SCRATCH_DIR="$KSCR" DISK_GUARD_USAGE_OVERRIDE=101 DISK_GUARD_ALERT_DRYRUN=1 bash "$GUARD" --probe 2>&1)"
P_MOUNT="$(printf '%s' "$PROBE" | sed -n 's/.*mount=\([^ ]*\).*/\1/p')"
P_USAGE="$(printf '%s' "$PROBE" | sed -n 's/.*usage=\([0-9]*\).*/\1/p')"
EXP_MOUNT="$(df -P "$KSCR" | awk 'NR==2 {print $6}')"
EXP_USAGE="$(df -P "$KSCR" | awk 'NR==2 {gsub("%","",$5); print $5}')"
ROOT_MOUNT="$(df -P / | awk 'NR==2 {print $6}')"

[ -n "$P_MOUNT" ] && pass "k: probe reports a mount point ($P_MOUNT)" || fail "k: probe printed no mount -- got: $PROBE"
[ "$P_MOUNT" = "$EXP_MOUNT" ] && pass "k: measures the SCRATCH_DIR volume, not a constant" || fail "k: measures '$P_MOUNT' but the scratch dir lives on '$EXP_MOUNT'"
[ "$P_USAGE" = "$EXP_USAGE" ] && pass "k: usage equals df of the scratch volume (${P_USAGE}%)" || fail "k: usage '$P_USAGE' != df '$EXP_USAGE'"
case "$P_USAGE" in
  (''|*[!0-9]*) fail "k: probe reported no numeric usage ('$P_USAGE') -- the assert below would pass on emptiness" ;;
  (101|10[2-9]|1[1-9][0-9]|[2-9][0-9][0-9]*) fail "k: probe usage '$P_USAGE' is not a percentage -- the override leaked through" ;;
  (*) pass "k: probe ignores DISK_GUARD_USAGE_OVERRIDE, real percentage (${P_USAGE}%)" ;;
esac
if [ "$EXP_MOUNT" = "$ROOT_MOUNT" ]; then
  echo "  NOTE: single-volume host ($ROOT_MOUNT) -- the mount assert is vacuous here, by design"
fi

# ---------------------------------------------------------------------------
# (l) THE DECISION ITSELF -- main(), on a real measurement, with NO usage override
#
# Case (k) above proves the right measurement EXISTS in the script. It does not
# prove the GUARD USES IT: --probe is a separate path. didi mutated only the
# non-override branch of disk_usage() to `df -P /` -- leaving --probe and the
# DISK_PATH derivation untouched -- and the suite stayed 26/26 green while the
# guard measured the system volume again. Presence, not correspondence; the same
# shape as the original defect, one level up.
#
# So this case sets NO DISK_GUARD_USAGE_OVERRIDE and instead lowers the reap
# threshold, which makes main() act on the REAL df reading and log its own
# decision. The assert is against that line, not against a probe.
#
# Vacuous on a single-volume host, like (k), and for the same reason.
# ---------------------------------------------------------------------------
echo ""
echo "(l) main() decides on the real measurement (no usage override)"
LSCR="$SCRATCH_BASE/case-l"; mkdir -p "$LSCR"
LSTATE="$TMPDIR_BASE/l-state"; mkdir -p "$LSTATE"
EXP_L="$(df -P "$LSCR" | awk 'NR==2 {gsub("%","",$5); print $5}')"
OUTL="$(DISK_GUARD_SCRATCH_DIR="$LSCR" DISK_GUARD_STATE_DIR="$LSTATE" \
        DISK_GUARD_REAP_THRESHOLD=1 DISK_GUARD_ALERT_DRYRUN=1 bash "$GUARD" 2>&1)"
L_USAGE="$(printf '%s' "$OUTL" | sed -n 's/.*\] disk \([0-9]*\)% >=.*/\1/p' | head -1)"

case "$L_USAGE" in
  (''|*[!0-9]*) fail "l: main() logged no decision line -- got: $(printf '%s' "$OUTL" | head -2)" ;;
  (*) pass "l: main() acted on a real reading (${L_USAGE}%), no override set" ;;
esac
[ "$L_USAGE" = "$EXP_L" ] && pass "l: the DECISION used the scratch volume (df says ${EXP_L}%)" || fail "l: main() decided on '$L_USAGE'% but the scratch volume is at '${EXP_L}'%"
printf '%s' "$OUTL" | grep -q "reaping scratch under $LSCR" && pass "l: reaps under the same dir it measured" || fail "l: reap target is not the measured dir"

# The threshold hook must not become a way to disable the guard by typo. Both bad
# directions: a non-number must not read as 0 (reap every tick), and 900 must not
# silently mean never. Both fall back to 90, so at 62% neither reaps.
OUTL2="$(DISK_GUARD_SCRATCH_DIR="$LSCR" DISK_GUARD_STATE_DIR="$LSTATE" \
         DISK_GUARD_REAP_THRESHOLD=abc DISK_GUARD_ALERT_DRYRUN=1 bash "$GUARD" 2>&1)"
printf '%s' "$OUTL2" | grep -q "reaping scratch" && fail "l: garbage threshold read as 0 -- would reap every tick" || pass "l: garbage threshold falls back to the default (no reap)"
# 900 needs the usage override, and here it is the RIGHT tool: the thing under
# test is the threshold validation, not the volume choice. Without the override
# this assert cannot fail at all -- at any real usage (<= 100) both a clamped 90
# and an unclamped 900 produce the same silence, so the test would measure
# nothing. (It did. Caught by mutation, 2026-09-19: removing the clamp left the
# suite 34/34 green.)
OUTL3="$(DISK_GUARD_SCRATCH_DIR="$LSCR" DISK_GUARD_STATE_DIR="$LSTATE" \
         DISK_GUARD_USAGE_OVERRIDE=95 DISK_GUARD_REAP_THRESHOLD=900 \
         DISK_GUARD_ALERT_DRYRUN=1 bash "$GUARD" 2>&1)"
printf '%s' "$OUTL3" | grep -q "reaping scratch" && pass "l: out-of-range threshold falls back to the default (95% still reaps)" || fail "l: 900 accepted -- the guard would never reap, silently"

# ---------------------------------------------------------------------------
# (m) a DERIVED measure path can be missing -- say which path, do nothing
# ---------------------------------------------------------------------------
echo ""
echo "(m) missing scratch dir names itself and no-ops"
OUTM="$(DISK_GUARD_SCRATCH_DIR="$TMPDIR_BASE/nincs-ilyen-dir" DISK_GUARD_STATE_DIR="$LSTATE" \
        DISK_GUARD_ALERT_DRYRUN=1 bash "$GUARD" 2>&1)"; RCM=$?
[ "$RCM" = 0 ] && pass "m: missing measure path is a no-op, not a crash (rc=0)" || fail "m: rc=$RCM"
printf '%s' "$OUTM" | grep -q "could not read disk usage of '$TMPDIR_BASE/nincs-ilyen-dir'" && pass "m: the log names the path it could not read" || fail "m: log does not name the path -- got: $OUTM"
printf '%s' "$OUTM" | grep -q "reaping scratch" && fail "m: reaped on an unreadable measurement" || pass "m: nothing reaped on an unreadable measurement"

# ---------------------------------------------------------------------------
# (n) A PLANTED PERCENTAGE MUST NOT REACH THE OWNER
#
# DISK_GUARD_USAGE_OVERRIDE exists for tests. Without the dryrun flag it used to
# carry a fake full disk all the way to the Telegram Bot API. This case turns the
# dryrun OFF on purpose -- the only place in the file that does -- and proves the
# guard refuses on its own rather than because someone remembered a flag.
#
# TG env is pointed at an EMPTY file, so even if the refusal is broken the alert
# cannot send: alert_owner finds no token and returns before curl. A test of a
# refusal has to be safe in the state where the refusal is broken.
# ---------------------------------------------------------------------------
echo ""
echo "(n) a planted percentage cannot alert the owner"
NSCR="$SCRATCH_BASE/case-n"; mkdir -p "$NSCR"
NSTATE="$TMPDIR_BASE/n-state"; mkdir -p "$NSTATE"
NTG="$TMPDIR_BASE/n-empty-telegram.env"; : > "$NTG"

OUTN="$(DISK_GUARD_SCRATCH_DIR="$NSCR" DISK_GUARD_STATE_DIR="$NSTATE" \
        DISK_GUARD_USAGE_OVERRIDE=96 DISK_GUARD_TG_ENV="$NTG" \
        DISK_GUARD_ALERT_DRYRUN= bash "$GUARD" 2>&1)"
printf '%s' "$OUTN" | grep -q "ALERT REFUSED" && pass "n: refuses to alert on a planted percentage" || fail "n: no refusal -- got: $(printf '%s' "$OUTN" | tail -2)"
printf '%s' "$OUTN" | grep -q "owner alerted" && fail "n: it alerted the owner on a fake disk" || pass "n: the owner was not alerted"
printf '%s' "$OUTN" | grep -q "DISK_GUARD_ALLOW_FAKE_ALERT=1" && pass "n: the refusal names the way out" || fail "n: refusal does not say how to test the wiring on purpose"
[ -f "$NSTATE/.disk-guard-alerted" ] && fail "n: a refused alert consumed the cooldown hour" || pass "n: a refused alert does not consume the cooldown"

# The way out must actually work, or the refusal is a wall. With consent given the
# guard proceeds to the real alert path -- and stops at the empty TG env, which is
# why this is safe to assert. It must NOT be the refusal that stops it.
OUTN2="$(DISK_GUARD_SCRATCH_DIR="$NSCR" DISK_GUARD_STATE_DIR="$NSTATE" \
         DISK_GUARD_USAGE_OVERRIDE=96 DISK_GUARD_TG_ENV="$NTG" \
         DISK_GUARD_ALLOW_FAKE_ALERT=1 DISK_GUARD_ALERT_DRYRUN= bash "$GUARD" 2>&1)"
printf '%s' "$OUTN2" | grep -q "ALERT REFUSED" && fail "n: consent did not open the gate" || pass "n: consent opens the gate"
printf '%s' "$OUTN2" | grep -q "no bot token or owner chat id configured" && pass "n: with consent it reaches the real alert path (stopped by the empty env, not by the gate)" || fail "n: did not reach the alert path -- got: $(printf '%s' "$OUTN2" | tail -2)"

# ---------------------------------------------------------------------------
# (o) ONLY ONE MEASUREMENT IMPLEMENTATION MAY EXIST
#
# WHAT 40/40 DOES NOT MEAN, and this is the sentence to read before trusting the
# number: it does not mean the volume choice is pinned in production. Case (l)
# runs with DISK_GUARD_REAP_THRESHOLD SET, so a defect conditioned on that hook
# being ABSENT is invisible to it -- and such a defect appears only in production,
# where the hook is never set. didi measured both halves on 2026-09-19: wrong
# volume only when the hook is unset gives 39/40 (caught by (m), which is the one
# case that runs hook-free -- the edge case turned out to carry part of the
# binding), and wrong volume when the hook is unset AND the measured path exists
# gives 40/40, fully green. Reproduced here before this case was written.
#
# This case is deliberately the WEAKER kind -- it reads the source instead of
# running it -- because the property being protected is not behaviour but
# UNIQUENESS: there must be no second measurement implementation for a hook to
# hide behind. A behavioural test cannot express "and nowhere else".
#
# Populations are DERIVED, not listed: every df invocation and every DISK_PATH
# assignment in the file, so a new one cannot be added without this case seeing
# it. Comments are stripped first, or the guard riots on its own explanation.
#
# AND WHAT THIS CASE STILL DOES NOT MEAN, measured rather than assumed
# (2026-09-19, didi raised the question, three variants run here):
#
#   assembled command name (local D=d; D="${D}f"), RIGHT volume ..... 44/44 green
#                                                                     -- and harmless: it measures
#                                                                        the right thing
#   assembled name, WRONG volume, unconditional ..................... 41/44 RED via (k) and (l)
#   assembled name + conditioned on the hook being absent
#     + on the path existing + WRONG volume ......................... 44/44 GREEN -- survives
#
# So the defect can still be reintroduced, but only with ALL THREE pieces at once:
# the command name hidden from the source pattern, the defect conditioned on the
# test hook's absence, AND conditioned on the path existing. Any two of the three
# are caught. That is the limit of every regex-based structural guard, and it
# takes intent -- pasting a literal df back is the realistic regression, and that
# one is red. 44/44 does not mean the defect cannot come back; it means it cannot
# come back by accident.
# ---------------------------------------------------------------------------
echo ""
echo "(o) one measurement implementation (source-level)"
GSRC="$(grep -v '^[[:space:]]*#' "$GUARD")"
DF_ALL="$(printf '%s\n' "$GSRC" | grep 'df ' || true)"
DF_N="$(printf '%s\n' "$DF_ALL" | grep -c 'df ' || true)"
# THE ARGUMENT, NOT A MENTION OF IT. The first version of this line asked whether
# the df line CONTAINS "$DISK_PATH", which `df -P "$(dirname "$DISK_PATH")"` also
# satisfies -- a plausible well-meaning edit ("measure the parent so it works when
# the dir does not exist yet"), not an evasion. Measured 2026-09-19: that shape left
# (o) silent and only (m) caught it. Presence instead of correspondence, inside the
# guard written to stop exactly that.
DF_BAD="$(printf '%s\n' "$DF_ALL" | grep -vF 'df -P "$DISK_PATH"' | grep 'df ' || true)"
DP_ALL="$(printf '%s\n' "$GSRC" | grep -E '(^|[[:space:]])DISK_PATH=' || true)"
DP_N="$(printf '%s\n' "$DP_ALL" | grep -c 'DISK_PATH=' || true)"

# Positive control FIRST: a meter that finds no df at all would pass every assert
# below by emptiness, and a stripped-to-nothing source looks exactly like a clean one.
[ "$DF_N" -ge 1 ] && pass "o: the meter sees the df calls ($DF_N of them)" || fail "o: found no df call at all -- the meter is broken, not the source clean"
[ -z "$DF_BAD" ] && pass "o: every df measures \$DISK_PATH, no literal path" || fail "o: a df call does not measure \$DISK_PATH: $DF_BAD"
[ "$DP_N" = "1" ] && pass "o: DISK_PATH is assigned exactly once" || fail "o: DISK_PATH assigned $DP_N times -- two assignments can drift: $DP_ALL"
printf '%s' "$DP_ALL" | grep -q 'DISK_PATH="\$SCRATCH_DIR"' && pass "o: and it is derived from SCRATCH_DIR" || fail "o: DISK_PATH is not derived from SCRATCH_DIR: $DP_ALL"

# ---------------------------------------------------------------------------
echo ""
echo "======================"
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -gt 0 ]; then echo "FAILED: $FAIL tests"; exit 1; fi
echo "All tests passed."
