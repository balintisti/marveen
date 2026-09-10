#!/bin/bash
# Contract tests for scripts/install-telegram-progress-hook.sh
# Run: bash scripts/__tests__/install-telegram-progress-hook.test.sh
#
# Verifies that the installer:
#   (a) does NOT source the .env file (no `set -a; . .env` pattern)
#   (b) does NOT fail when .env contains an unquoted value with spaces
#   (c) does NOT execute code from a $(...) value in .env
#   (d) correctly reads SERVICE_ID / BOT_NAME with and without quoting
#   (e) falls back to defaults when .env is absent
#   (f) copies hook files to the destination (core behaviour preserved)
#
# All filesystem operations use a fully isolated temp tree -- the real
# ~/.claude directory and the real INSTALL_DIR are never touched.

set -u

PASS=0; FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }
assert_eq() {
  if [ "$2" = "$3" ]; then pass "$1"
  else fail "$1 (expected '$2', got '$3')"; fi
}
assert_zero()   { if [ "$2" -eq 0 ]; then pass "$1"; else fail "$1 (exit=$2)"; fi; }
assert_absent() { if [ ! -e "$1" ]; then pass "$2"; else fail "$2 (should not exist: $1)"; fi; }

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/install-telegram-progress-hook.sh"

# ---------------------------------------------------------------------------
# (a) Static check: no .env sourcing in the fixed script
# ---------------------------------------------------------------------------
echo ""
echo "(a) Static check: .env must NOT be sourced"
if grep -qE '^\s*(set\s+-a|source\s+.*\.env|\.\s+.*\.env)' "$SCRIPT"; then
  fail "static check: script still sources the .env (set -a / source / . .env pattern found)"
else
  pass "static check: no .env sourcing found"
fi
if grep -q 'read_env' "$SCRIPT"; then
  pass "static check: read_env function present"
else
  fail "static check: read_env function missing"
fi

# ---------------------------------------------------------------------------
# Helper: run just the read_env + var-assignment block in isolation.
# We extract the function definition from the script and inject an INSTALL_DIR
# pointing to a controlled temp dir, then echo the variables.
# ---------------------------------------------------------------------------
run_env_parse() {
  local install_dir="$1"
  # Extract the read_env function + the 5 lines that follow it (the calls).
  # The function starts with 'read_env()' and ends at the blank line before
  # SERVICE_ID assignment; we grab them all up to BOT_NAME="${BOT_NAME:-Marveen}".
  local func_block
  func_block="$(sed -n '/^read_env()/,/^BOT_NAME=.*Marveen/p' "$SCRIPT")"
  bash -c "
    set -euo pipefail
    INSTALL_DIR='$install_dir'
    $func_block
    echo \"SERVICE_ID=\$SERVICE_ID\"
    echo \"BOT_NAME=\$BOT_NAME\"
  " 2>&1
}

# ---------------------------------------------------------------------------
# (b) Unquoted space value: must not crash
# ---------------------------------------------------------------------------
echo ""
echo "(b) Unquoted space value in .env"
CASE="$TMP/case-b"
mkdir -p "$CASE"
cat > "$CASE/.env" <<'EOF'
SERVICE_ID=mysvc
OWNER_NAME=Foo Bar
BOT_NAME=MyBot
EOF
OUT="$(run_env_parse "$CASE")"
EXIT=$?
assert_zero "unquoted space: exits 0"             $EXIT
assert_eq   "unquoted space: SERVICE_ID correct"  "SERVICE_ID=mysvc" "$(echo "$OUT" | grep '^SERVICE_ID=')"
assert_eq   "unquoted space: BOT_NAME correct"    "BOT_NAME=MyBot"   "$(echo "$OUT" | grep '^BOT_NAME=')"

# ---------------------------------------------------------------------------
# (c) $(...) value in .env: must NOT execute it
# ---------------------------------------------------------------------------
echo ""
echo "(c) \$(...) command substitution in .env -- no execution"
CANARY="$TMP/canary"
CASE="$TMP/case-c"
mkdir -p "$CASE"
cat > "$CASE/.env" <<EOF
SERVICE_ID=safe
DANGER_KEY=\$(touch "$CANARY")
BOT_NAME=SafeBot
EOF
OUT="$(run_env_parse "$CASE")"
EXIT=$?
assert_zero "cmd-injection: exits 0"              $EXIT
assert_eq   "cmd-injection: SERVICE_ID correct"   "SERVICE_ID=safe"  "$(echo "$OUT" | grep '^SERVICE_ID=')"
assert_eq   "cmd-injection: BOT_NAME correct"     "BOT_NAME=SafeBot" "$(echo "$OUT" | grep '^BOT_NAME=')"
assert_absent "$CANARY" "cmd-injection: canary NOT created"

# ---------------------------------------------------------------------------
# (d) Quoted values: both forms are stripped correctly
# ---------------------------------------------------------------------------
echo ""
echo "(d) Quoted values in .env"
CASE="$TMP/case-d"
mkdir -p "$CASE"
cat > "$CASE/.env" <<'EOF'
SERVICE_ID="double-quoted"
BOT_NAME='single-quoted'
EOF
OUT="$(run_env_parse "$CASE")"
EXIT=$?
assert_zero "quoted: exits 0"                       $EXIT
assert_eq   "quoted: double-quote stripped"  "SERVICE_ID=double-quoted" "$(echo "$OUT" | grep '^SERVICE_ID=')"
assert_eq   "quoted: single-quote stripped"  "BOT_NAME=single-quoted"   "$(echo "$OUT" | grep '^BOT_NAME=')"

# ---------------------------------------------------------------------------
# (e) Missing .env -> defaults
# ---------------------------------------------------------------------------
echo ""
echo "(e) Missing .env -> defaults"
CASE="$TMP/case-e"
mkdir -p "$CASE"
# No .env file
OUT="$(run_env_parse "$CASE")"
EXIT=$?
assert_zero "no .env: exits 0"                  $EXIT
assert_eq   "no .env: SERVICE_ID=marveen"  "SERVICE_ID=marveen" "$(echo "$OUT" | grep '^SERVICE_ID=')"
assert_eq   "no .env: BOT_NAME=Marveen"    "BOT_NAME=Marveen"   "$(echo "$OUT" | grep '^BOT_NAME=')"

# ---------------------------------------------------------------------------
# (f) MAIN_AGENT_ID fallback when SERVICE_ID absent
# ---------------------------------------------------------------------------
echo ""
echo "(f) MAIN_AGENT_ID fallback"
CASE="$TMP/case-f"
mkdir -p "$CASE"
cat > "$CASE/.env" <<'EOF'
MAIN_AGENT_ID=myagent
BOT_NAME=MyBot
EOF
OUT="$(run_env_parse "$CASE")"
EXIT=$?
assert_zero "MAIN_AGENT_ID fallback: exits 0"                           $EXIT
assert_eq   "MAIN_AGENT_ID fallback: SERVICE_ID resolves to myagent" \
            "SERVICE_ID=myagent" "$(echo "$OUT" | grep '^SERVICE_ID=')"

# ---------------------------------------------------------------------------
# (g) Hook files are copied when the full script runs (behaviour preserved)
# We drive the full script with a fake INSTALL_DIR + HOME + stub hook sources.
# Daemon install is left to run; on macOS launchctl is a no-op here, on Linux
# systemd --user is unavailable so it prints a warning and exits 0.
# ---------------------------------------------------------------------------
echo ""
echo "(g) Full script: hook files are copied to DEST_DIR"
CASE="$TMP/case-g"
INSTALL_G="$CASE/marveen"
HOME_G="$CASE/home"
HOOKS_SRC_G="$INSTALL_G/scripts/hooks"
mkdir -p "$HOOKS_SRC_G" "$HOME_G/.claude/hooks"
for f in telegram_progress.py telegram_progress_clear.py \
          telegram_progress_reply_clear.py telegram_progress_watchdog.py \
          telegram_fallback_send.py; do
  printf '#!/usr/bin/env python3\n# stub\n' > "$HOOKS_SRC_G/$f"
done
echo '{"hooks":{}}' > "$HOME_G/.claude/settings.json"
cat > "$INSTALL_G/.env" <<'EOF'
SERVICE_ID=testbot
OWNER_NAME=Foo Bar
BOT_NAME=TestBot
EOF

# A SZKRIPTET A FIXTURE INSTALL-DIRBE MASOLJUK, ES AZT FUTTATJUK (kartya 5ced33f1).
#
# AMI ITT KORABBAN ALLT, ES AMIERT NEM MERT SEMMIT. A `install-telegram-progress-hook.sh` a SAJAT
# helyebol oldja fel az install-dirt (`INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"`, :38), es
# a `.env`-et onnan olvassa (:44). A teszt viszont a REPO valodi szkriptjet futtatta, tehat:
#
#   - az `INSTALL_DIR` a REPO GYOKERE lett, nem a fentebb felepitett `$INSTALL_G`
#   - a szkript az ELO `/Users/isti/marveen/.env`-et olvasta, nem a fixture-t
#   - a fentebb kirakott stub hookokat a `rm -rf "$INSTALL_G/scripts/hooks"` TOROLTE, mikozben a
#     kovetkezo komment azt allitotta, hogy azokat hasznaljuk -- a masolas a REPO valodi hookjaibol
#     tortent
#   - es a "clean .env" injektalas egy NEM LETEZO konyvtarba irt (`/tmp/marveen-hook-fix/`), tehat
#     a `cat` ELHASALT; `set -e` nincs, igy a bukas nema maradt
#
# Merve 2026-09-05: a fajl igy is **23 passed, 0 failed** volt. Az `assert_zero "... with clean
# .env"` allitas IGAZ volt -- csak nem azert, amit a NEVE mond: nem volt semmilyen injektalt .env.
#
# A JAVITAS a szandekot valositja meg, nem a tunetet takaritja el: a szkript MASOLATA a fixture
# `scripts/` konyvtaraba kerul, tehat az `INSTALL_DIR` a `$INSTALL_G`-re oldodik fel, a fixture
# `.env`-jet olvassa, es a fentebb kirakott STUB hookokat masolja. Ez az az alak, amit a regi
# komment leirt, es amit a kod nem csinalt.
SCRIPT_G="$INSTALL_G/scripts/$(basename "$SCRIPT")"
cp "$SCRIPT" "$SCRIPT_G"

# A TELEPITO `launchctl`-t HIV, ES AZ ATER AZ ELO GEPRE (kartya 8b7569db).
#
# A LELET (didi talalta, marveen es en fuggetlenul ujramertuk): a `HOME` felulirasa a PLIST HELYET
# mozgatja, a launchd DOMAINT nem. A telepito :204-205 `launchctl unload/load "$PLIST"`-et hiv,
# es az a LIVE `gui/501`-be regisztral -- egy temp konyvtarbol, amit a teszt utana TOROL.
# Eredmeny: ket ELFOGLALT label (`com.marveen.` es `com.testbot.telegram-progress-watchdog`),
# 60 masodpercenkent ujraindulva, `exit 2`-vel, egy mar nem letezo plistre mutatva.
# Merve 2026-09-05: runs=25 mindkettonel, es NO. A fajl sajat kommentje az ellenkezojet feltetelezi
# ("on macOS launchctl is a no-op here").
#
# A JAVITAS NEM A LEPES KIHAGYASA, HANEM EGY STUB A PATH-ON. Ket okbol jobb:
#   - a produkcios telepitohoz NEM nyulunk (nincs teszt-only kapcsolo a szallitott kodban)
#   - a daemon-lepes MERHETOVE valik: ma lathatatlan mellekhatas, ezutan allithato teny
STUB_BIN="$CASE/bin"
mkdir -p "$STUB_BIN"
LC_LOG="$CASE/launchctl-calls.log"
cat > "$STUB_BIN/launchctl" <<'STUBEOF'
#!/usr/bin/env bash
# Teszt-stub. NEM nyul a launchd domainhez; csak rogziti, mivel hivtak.
printf '%s\n' "$*" >> "${LC_LOG:?}"
exit 0
STUBEOF
chmod +x "$STUB_BIN/launchctl"
export LC_LOG
# A stub hookok MARADNAK: a masolas forrasa ez, nem a repo valodi hooks konyvtara.
if [ -d "$HOOKS_SRC_G" ]; then pass "full script: a stub hookok megvannak a futtatas elott"
else fail "full script: a stub hookok ELTUNTEK a futtatas elott (a fixture romlott el)"; fi

# 1) A spaces-OWNER_NAME eset: a fentebb kiirt fixture .env-vel (OWNER_NAME='Foo Bar').
OUT="$(HOME="$HOME_G" PATH="$STUB_BIN:$PATH" bash "$SCRIPT_G" 2>&1)"
assert_zero "full script: exits 0 spaces-t tartalmazo OWNER_NAME mellett" $?

# 2) A "clean .env" eset: MOST TENYLEG oda irjuk, ahonnan a szkript olvas.
cat > "$INSTALL_G/.env" <<'ENVEOF'
SERVICE_ID=testbot
BOT_NAME=TestBot
ENVEOF
OUT2="$(HOME="$HOME_G" PATH="$STUB_BIN:$PATH" bash "$SCRIPT_G" 2>&1)"
assert_zero "full script: exits 0 with clean .env" $?

# ES A BIZONYITEK, HOGY A FIXTURE-BOL MASOLT, NEM A REPOBOL: a stubok tartalma felismerheto.
# Enelkul ez az allitas akkor is atmenne, ha a szkript a repo valodi hookjait masolta volna --
# epp az a hiba, amit ez a javitas zar be.
for f in telegram_progress.py telegram_progress_clear.py \
          telegram_progress_reply_clear.py telegram_progress_watchdog.py \
          telegram_fallback_send.py; do
  if [ -f "$HOME_G/.claude/hooks/$f" ]; then pass "full script: $f copied"
  else fail "full script: $f NOT copied"; fi
done
if grep -q '^# stub$' "$HOME_G/.claude/hooks/telegram_progress.py" 2>/dev/null; then
  pass "full script: a masolat a FIXTURE stubjabol jott, nem a repo valodi hookjabol"
else
  fail "full script: a masolt fajl NEM a fixture stubja -- a szkript mashonnan masolt"
fi

# A DAEMON-LEPES MOSTANTOL MERT, NEM LATHATATLAN.
# Ha ez az allitas valaha PIROS lesz ugy, hogy a naplo URES, az azt jelenti, hogy a telepito mar
# nem hiv launchctl-t -- az VALTOZAS, nem hiba, es akkor ezt az esetet frissiteni kell.
# Ha PIROS lesz ugy, hogy a stub NEM futott le, akkor a PATH-injekcio romlott el, es a hivas
# megint az ELO gepre ment.
if [ -s "$LC_LOG" ]; then
  pass "full script: a launchctl hivas a STUB-ba ment ($(wc -l < "$LC_LOG" | tr -d ' ') hivas)"
else
  fail "full script: a stub NEM kapott hivast -- vagy nem hiv launchctl-t, vagy az ELO gepre ment"
fi
# ES A LENYEG: a hivas a FIXTURE plistjere vonatkozzon, ne egy elo utvonalra.
if grep -q "$HOME_G" "$LC_LOG" 2>/dev/null; then
  pass "full script: a launchctl a FIXTURE plistjere hivodott"
else
  fail "full script: a launchctl NEM a fixture plistjere hivodott -- $(head -2 "$LC_LOG" 2>/dev/null | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
echo ""
echo "===================================================="
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
