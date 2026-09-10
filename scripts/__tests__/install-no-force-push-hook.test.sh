#!/usr/bin/env bash
# install-no-force-push-hook.sh -- telepito ES viselkedes teszt (kartya f2b369ff).
#
# MIERT SCRATCH REPO ES NEM A SAJAT FANK: ez a telepito a `.git/hooks` ala ir.
# A `install-telegram-progress-hook.test.sh` mert esete (2026-09-05) pontosan az
# volt, hogy egy teszt a VALODI installert futtatta HOME-felulirassal, es a
# launchd-be a VALODI domainbe regisztralt -- a felulirt kornyezet nem tette
# inertte. Itt nincs launchctl, de a tanulsag ugyanaz: sajat, eldobhato repo.
#
# Futtatas: bash <ezafajl>     Exit 0 = mind atment.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
INSTALLER="$HERE/../install-no-force-push-hook.sh"
fails=0
ok()   { printf 'ok   %s\n' "$1"; }
bad()  { printf 'FAIL %s: %s\n' "$1" "$2"; fails=$((fails+1)); }
check(){ [ "$2" = "$3" ] && ok "$1" || bad "$1" "got [$2] want [$3]"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"; mkdir -p "$REPO/scripts"
git init -q "$REPO"; git -C "$REPO" config user.email t@t; git -C "$REPO" config user.name t
cp "$INSTALLER" "$REPO/scripts/"
echo one > "$REPO/a"; git -C "$REPO" add a; git -C "$REPO" commit -qm one
BASE=$(git -C "$REPO" rev-parse HEAD)
echo two > "$REPO/a"; git -C "$REPO" commit -qam two
TIP=$(git -C "$REPO" rev-parse HEAD)
# egy DIVERGENS csucs: a BASE-bol nyilik, tehat a TIP NEM leszarmazottja
git -C "$REPO" checkout -q -b other "$BASE"; echo three > "$REPO/b"
git -C "$REPO" add b; git -C "$REPO" commit -qm three
DIVERGENT=$(git -C "$REPO" rev-parse HEAD)
git -C "$REPO" checkout -q -

H="$REPO/.git/hooks"
bash "$REPO/scripts/install-no-force-push-hook.sh" >/dev/null
check "1. a dispatcher letrejott"        "$([ -x "$H/pre-push" ] && echo x)" "x"
check "1. az or letrejott es futtathato" "$([ -x "$H/pre-push.d/10-no-force-push-protected" ] && echo x)" "x"

# IDEMPOTENCIA: a masodik futas nem duplikal es nem archivalja a SAJAT dispatcheret
sum1=$(shasum "$H/pre-push" "$H/pre-push.d/10-no-force-push-protected" | awk '{print $1}' | tr '\n' ' ')
bash "$REPO/scripts/install-no-force-push-hook.sh" >/dev/null
sum2=$(shasum "$H/pre-push" "$H/pre-push.d/10-no-force-push-protected" | awk '{print $1}' | tr '\n' ' ')
check "2. az idempotencia-mero NEM ureset hasonlit" "$([ -n "${sum1// /}" ] && echo x)" "x"
check "2. ketszer futtatva azonos tartalom" "$sum1" "$sum2"
check "2. a sajat dispatchert NEM archivalta" "$([ -e "$H/pre-push.d/00-preexisting-local" ] && echo van || echo nincs)" "nincs"

# VISELKEDES -- a payload alakja: <local_ref> <local_sha> <remote_ref> <remote_sha>
run_guard() { printf '%s\n' "$1" | (cd "$REPO" && bash "$H/pre-push.d/10-no-force-push-protected" >/dev/null 2>&1); echo $?; }
check "3. NEM fast-forward a main-re -> BLOKK"      "$(run_guard "refs/heads/x $TIP refs/heads/main $DIVERGENT")" "1"
check "3. KONTROLL fast-forward a main-re -> atmegy" "$(run_guard "refs/heads/x $TIP refs/heads/main $BASE")" "0"
check "3. KONTROLL master is vedett"                 "$(run_guard "refs/heads/x $TIP refs/heads/master $DIVERGENT")" "1"
check "4. HATOKOR: ugyanez develop-ra -> atmegy"     "$(run_guard "refs/heads/x $TIP refs/heads/develop $DIVERGENT")" "0"
Z=0000000000000000000000000000000000000000
check "5. UJ tavoli ag (remote=0) -> atmegy"         "$(run_guard "refs/heads/x $TIP refs/heads/main $Z")" "0"
check "5. ag-TORLES (local=0) -> atmegy"             "$(run_guard "refs/heads/x $Z refs/heads/main $DIVERGENT")" "0"
ovr=$(printf '%s\n' "refs/heads/x $TIP refs/heads/main $DIVERGENT" | (cd "$REPO" && ALLOW_FORCE_PUSH=1 bash "$H/pre-push.d/10-no-force-push-protected" >/dev/null 2>&1); echo $?)
check "6. ALLOW_FORCE_PUSH=1 felold"                 "$ovr" "0"

# IDEGEN pre-push MEGORZESE -- kulon repo, mert a fenti mar a mienket hordozza
REPO2="$TMP/repo2"; mkdir -p "$REPO2/scripts"; git init -q "$REPO2"
cp "$INSTALLER" "$REPO2/scripts/"
printf '#!/bin/sh\necho idegen\n' > "$REPO2/.git/hooks/pre-push"; chmod +x "$REPO2/.git/hooks/pre-push"
bash "$REPO2/scripts/install-no-force-push-hook.sh" >/dev/null
check "7. az IDEGEN hook megorzodott, lancszemkent" \
  "$(grep -c idegen "$REPO2/.git/hooks/pre-push.d/00-preexisting-local" 2>/dev/null || echo 0)" "1"
check "7. es a dispatcher a helyere kerult" \
  "$(grep -c marveen-pre-push-dispatcher "$REPO2/.git/hooks/pre-push" 2>/dev/null || echo 0)" "1"

[ "$fails" -eq 0 ] && { echo "All install-no-force-push tests passed."; exit 0; }
echo "$fails FAILED" >&2; exit 1
