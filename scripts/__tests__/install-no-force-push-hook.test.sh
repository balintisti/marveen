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

# ===========================================================================
# 8-13. A DEPLOY-AG: a fo worktree AKTUALIS aga (kartya 33b40c03).
# SAJAT repo, mert itt a fo worktree agat KIMONDOTTAN allitjuk be. A fenti REPO
# a HOST `init.defaultBranch`-en all (ezen a gepen `master`, ami veletlenul mar
# a nev-listan van) -- egy teszt, ami host-configtol fugg, pont azt a fajta
# vak megfelelest hordozza, ami ellen ez az egesz or keszult.
REPO3="$TMP/repo3"; mkdir -p "$REPO3/scripts"
git init -q "$REPO3"; git -C "$REPO3" config user.email t@t; git -C "$REPO3" config user.name t
cp "$INSTALLER" "$REPO3/scripts/"
echo one > "$REPO3/a"; git -C "$REPO3" add a; git -C "$REPO3" commit -qm one
git -C "$REPO3" branch -M deploybranch
B3=$(git -C "$REPO3" rev-parse HEAD)
echo two > "$REPO3/a"; git -C "$REPO3" commit -qam two
T3=$(git -C "$REPO3" rev-parse HEAD)
git -C "$REPO3" checkout -q -b sidebranch "$B3"
echo three > "$REPO3/c"; git -C "$REPO3" add c; git -C "$REPO3" commit -qm three
D3=$(git -C "$REPO3" rev-parse HEAD)
git -C "$REPO3" checkout -q deploybranch
bash "$REPO3/scripts/install-no-force-push-hook.sh" >/dev/null
G3="$REPO3/.git/hooks/pre-push.d/10-no-force-push-protected"
# a heredocba agyazott or szintaxisat a telepito `bash -n`-je NEM ellenorzi
check "8. a telepitett or szintaktikailag ep" "$(bash -n "$G3" 2>&1 || echo HIBA)" ""
# ES A `bash -n` NEM LAT BELE A `$( )`-BE: egy ott allo szintaktikai hiba CSAK
# FUTASIDOBEN derul ki (merve 2026-09-10 -- egy `case ... ;; esac` egy parancs-
# behelyettesitesben `bash -n`-re ATMEGY, es futaskor hasal el). Ezert az or FUSSON
# is egy artalmatlan payloaddal: a stderr-nek uresnek kell lennie.
noise="$(printf 'refs/heads/x %s refs/heads/nemvedett %s\n' "$T3" "$B3" | (cd "$REPO3" && bash "$G3" 2>&1 >/dev/null))"
check "8. az or FUTASIDOBEN sem panaszkodik" "$noise" ""
check "8. a fo worktree aga TENYLEG deploybranch" "$(git -C "$REPO3" symbolic-ref --short HEAD)" "deploybranch"

# masodik argumentum = a CWD, amibol az or fut (a hook a PUSHOLO worktree cwd-jet kapja)
g3() { printf '%s\n' "$1" | (cd "${2:-$REPO3}" && bash "$G3" >/dev/null 2>&1); echo $?; }
check "9. NEM fast-forward a DEPLOY-agra -> BLOKK"      "$(g3 "refs/heads/x $T3 refs/heads/deploybranch $D3")" "1"
check "9. KONTROLL fast-forward a deploy-agra -> atmegy" "$(g3 "refs/heads/x $T3 refs/heads/deploybranch $B3")" "0"
check "9. KONTROLL egy HARMADIK ag -> atmegy"           "$(g3 "refs/heads/x $T3 refs/heads/sidebranch $D3")" "0"
ovr3=$(printf '%s\n' "refs/heads/x $T3 refs/heads/deploybranch $D3" | (cd "$REPO3" && ALLOW_FORCE_PUSH=1 bash "$G3" >/dev/null 2>&1); echo $?)
check "9. ALLOW_FORCE_PUSH=1 a deploy-agon is felold"   "$ovr3" "0"

# 10. A WORKTREE-CSAPDA. Ez a KET eset ELLENTETES iranyba bukna a kezenfekvo
# `git rev-parse --abbrev-ref HEAD` alakkal: az elso ATENGEDNE a deploy-agat,
# a masodik BLOKKOLNA az agens sajat agat -- amit szandekosan engedunk. Egyiranyu
# proba barmelyiket atengedne.
WT3="$TMP/wt3"
git -C "$REPO3" worktree add -q "$WT3" sidebranch
check "10. a worktree MAS agon all"                      "$(git -C "$WT3" symbolic-ref --short HEAD)" "sidebranch"
check "10. WORKTREEBOL: nem-ff a DEPLOY-agra -> BLOKK"   "$(g3 "refs/heads/x $T3 refs/heads/deploybranch $D3" "$WT3")" "1"
check "10. WORKTREEBOL: nem-ff a SAJAT agara -> atmegy"  "$(g3 "refs/heads/x $D3 refs/heads/sidebranch $T3" "$WT3")" "0"

# 11. DETACHED fo worktree: a common HEAD nyers SHA-t tart, tehat nincs deploy-ag.
# A main/master vedelme viszont VALTOZATLAN -- egy bovites nem vehet el.
git -C "$REPO3" checkout -q --detach "$T3"
check "11. detached: a deploy-vedelem KIKAPCSOL"         "$(g3 "refs/heads/x $T3 refs/heads/deploybranch $D3")" "0"
check "11. detached: a main vedelme VALTOZATLAN"         "$(g3 "refs/heads/x $T3 refs/heads/main $D3")" "1"
git -C "$REPO3" checkout -q deploybranch

# 12. ALKONYVTARBOL. A `--git-common-dir` innen `../.git`-et ad, tehat egy
# `--show-toplevel`-hez oldott alak `<gyoker>/../.git`-et szamolna, ami NEM LETEZIK
# (merve 2026-09-10). Ezert `cd`+`pwd`, horgony nelkul.
check "12. ALKONYVTARBOL futtatva is BLOKKOL"            "$(g3 "refs/heads/x $T3 refs/heads/deploybranch $D3" "$REPO3/scripts")" "1"

# 13. VEGPONTTOL VEGPONTIG, VALODI PUSH-SAL egy HELYI bare tavolira (halozat
# nelkul, semmi koze egyetlen valodi remotehoz). A fenti esetek a PAYLOAD alakjat
# merik; ez azt meri, hogy a git tenylegesen ezt a ref-nevet adja at ES hogy a
# dispatcher tovabbadja az ornek.
BARE="$TMP/bare.git"; git init -q --bare "$BARE"
git -C "$REPO3" remote add local "$BARE"
git -C "$REPO3" push -q local deploybranch >/dev/null 2>&1
check "13. az elokeszito push megtortent" \
  "$(git -C "$BARE" rev-parse --verify -q refs/heads/deploybranch >/dev/null && echo van || echo nincs)" "van"
git -C "$REPO3" reset -q --hard "$B3"; echo rewritten > "$REPO3/a"
git -C "$REPO3" commit -qam rewritten
push_rc=$(git -C "$REPO3" push --force local deploybranch >/dev/null 2>&1; echo $?)
check "13. VALODI force-push a deploy-agra -> MEGTAGADVA" "$([ "$push_rc" != 0 ] && echo blokk || echo atment)" "blokk"
check "13. es a tavoli csucs NEM mozdult"                 "$(git -C "$BARE" rev-parse refs/heads/deploybranch)" "$T3"
push_ok=$(git -C "$REPO3" push --force local HEAD:refs/heads/masikag >/dev/null 2>&1; echo $?)
check "13. KONTROLL: valodi push egy MASIK agra -> atmegy" "$push_ok" "0"

[ "$fails" -eq 0 ] && { echo "All install-no-force-push tests passed."; exit 0; }
echo "$fails FAILED" >&2; exit 1
