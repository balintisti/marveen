#!/bin/bash
# AZ ELFOGADASI FELTETEL, SZO SZERINT AHOGY A KARTYA KERI (5cf210d6):
#
#     `git add -f .env` UTAN a kapu BLOKKOL,  `.env.example` UTAN NEM.
#
# Es azert VEGPONTTOL VEGPONTIG, nem `scanFile`-lal: a kartya azt kerdezi, mi
# tortenik egy COMMITNAL, es a ket dolog kozott ott van a CLI, a `git diff
# --cached` es a fajl-olvasas. Az egysegteszt a mintat bizonyitja, ez a lancot.
#
# A `.env` tartalma szandekosan JELENTEKTELEN: ha valodi titok-alakot tennenk
# bele, a teszt akkor is atmenne, ha a NEV-szabaly egyaltalan nem letezne --
# a tartalom-detektor fogna meg. Az alany itt a NEV.
# A CIMKEKBEN NINCS VISSZAPERJEL: dupla idezojelben az PARANCSHELYETTESITES,
# es a cimke NEMAN csonkul ("(a)  -> BLOKKOL"), mikozben a teszt ATMEGY.
# Ma harmadszor futottam bele ugyanebbe -- mindharomszor a VISSZAOLVASAS fogta meg.
set -u
PASS=0; FAIL=0
pass(){ PASS=$((PASS+1)); echo "  PASS: $1"; }
fail(){ FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$REPO_ROOT/scripts/secret-gate.ts"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

cd "$TMP"
git init -q .
git config user.email t@t; git config user.name t
git config core.hooksPath /dev/null   # a sajat hookjaink ne fussanak bele ebbe a repoba
echo "base" > README.md; git add README.md
git -c core.hooksPath=/dev/null commit -qm base

run_gate() { ( cd "$TMP" && npx --no-install tsx "$GATE" --staged >"$TMP/out.txt" 2>&1 ); echo $?; }

echo "secret-gate: az elfogadasi feltetel (.env kontra .env.example)"
echo "============================================================="

# --- KONTROLL ELOSZOR: egy artalmatlan fajl ATMEGY -------------------------
# Enelkul minden alabbi "blokkol" allitas teljesulne egy olyan kapun is, ami
# MINDENT blokkol -- vagy egy olyanon, ami el sem indul.
echo "hello" > plain.txt; git add plain.txt
rc="$(run_gate)"
[ "$rc" = "0" ] && pass "KONTROLL: tiszta fajl -> a kapu ATENGEDI (rc=0)" \
                || fail "KONTROLL: tiszta fajlra is elbukott (rc=$rc): $(head -3 "$TMP/out.txt")"
git reset -q

# --- (a) .env BLOKKOL ------------------------------------------------------
printf 'PORT=3000\n' > .env
git add -f .env
rc="$(run_gate)"
[ "$rc" != "0" ] && pass "(a) git add -f .env -> BLOKKOL (rc=$rc)" \
                 || fail "(a) a .env ATMENT, pedig blokkolnia kellene"
grep -q 'credential filename' "$TMP/out.txt" \
  && pass "(a) es a NEV-szabaly nevezi meg magat az indoklasban" \
  || fail "(a) blokkolt, de nem a nev-szabaly: $(grep -m2 -i 'blocked\|reason' "$TMP/out.txt")"
git reset -q; rm -f .env

# --- (b) .env.example NEM BLOKKOL ------------------------------------------
printf 'PORT=3000\n# ide jon a kulcs\n' > .env.example
git add -f .env.example
rc="$(run_gate)"
[ "$rc" = "0" ] && pass "(b) .env.example -> ATMEGY (rc=0)" \
                || fail "(b) a .env.example BLOKKOLT, pedig nem kellene: $(head -5 "$TMP/out.txt")"
git reset -q

# --- (c) ES A KIVETEL CSAK A NEVRE SZOL ------------------------------------
# Ha ez atmenne, a kivetel nem szukitene, hanem VAKITANA: egy valodi kulcs
# a peldafajlban eszrevetlen maradna.
# A kulcs-alak DARABOKBOL all ossze: igy a literal nincs benne ebben a fajlban,
# es NEM kell ALLOWLISTED_PATHS bejegyzes -- az a fajlt minden vizsgalat alol
# kivenne, es egy kesobbi VALODI hiba is elbujna benne.
FAKE_KEY="sk""_live_51H8xQwErTyUiOpAsDfGhJkLz"
printf 'STRIPE=%s\n' "$FAKE_KEY" > .env.example
git add -f .env.example
rc="$(run_gate)"
[ "$rc" != "0" ] && pass "(c) valodi titok-alak a .env.example-ben MEGIS blokkol (rc=$rc)" \
                 || fail "(c) a kivetel ELVAKITOTTA a tartalom-vizsgalatot -- ez a rosszabbik hiba"
git reset -q

echo
echo "============================================================="
echo "Results: $PASS/$((PASS+FAIL)) passed"
[ "$FAIL" -gt 0 ] && { echo "FAILED: $FAIL"; exit 1; }
echo "All tests passed."
