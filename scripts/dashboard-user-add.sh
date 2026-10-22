#!/bin/bash
# Marveen -- dashboard felhasznalo letrehozasa (bongeszos belepeshez).
#
# MIERT LETEZIK: az `/api/*` MINDEN hivasa hitelesitest kivan (nincs loopback-mentesseg,
# `src/web/auth-gate.ts` requiresAuth). Aki bongeszobol nyitja meg a dashboardot -- pl.
# telefonrol, tailneten at --, annak SESSION kell, ahhoz pedig felhasznalo.
# Nulla felhasznalonal az `/api/auth/status` `login_available:false, setup_required:true`-t ad,
# es a feluleten minden csempe uresen marad. Nem hiba: nincs kinek belepnie.
#
# MIERT A GEPEN FUTO CLI-T HIVJA, ES NEM A HTTP-T (kartya 1befbdb3, upstream #2163, DEVKEYMINT1022):
# amint van dashboard-login, a `POST /api/auth/users` a gazda SESSIONJET kerik, a kozos
# tokent 403-mal utasitja el (a token nem kulonbozteti meg a gazdat attol, aki ugyanazt
# birtokolja). Ez a szkript eddig a tokennel hivta, tehat csak az ELSO felhasznalonal mukodott
# volna. A gepen fut (nincs HTTP, nincs token): `scripts/dashboard-user.ts add`, ugyanaz a
# jelszo-szabaly, ugyanaz a hash, ugyanaz az adatbazis, amit a futo dashboard olvas.
#
# A jelszot a CLI kerit be (ketszer, nem latszik, tty-rol), tehat NEM kerul se a parancssorba,
# se a hej-tortenetbe. Jelszo parancssorban SOHA: automatizalashoz a CLI `--password-stdin`
# kapcsoloja van (a jelszo csovon megy, nem argv-n).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# node@22 elol: a better-sqlite3 arra van forditva (a Homebrew alap node mas ABI-t ad), es
# a futo szolgaltatas is azzal megy (com.marveen.dashboard).
NODE_BIN=""
for cand in /opt/homebrew/opt/node@22/bin /usr/local/opt/node@22/bin; do
  [ -x "$cand/node" ] && { NODE_BIN="$cand"; break; }
done
[ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"

TSX="$DIR/node_modules/.bin/tsx"
[ -x "$TSX" ] || { echo "HIBA: nincs tsx: $TSX (npm install?)" >&2; exit 1; }

USERNAME="${1:-}"
if [ -z "$USERNAME" ]; then
  printf 'Felhasznalonev (betuk, szamok, . _ -): '
  read -r USERNAME
fi

if [ ! -t 0 ]; then
  echo "HIBA: a jelszot a CLI tty-n kerik be. Terminal nelkul: printf '%s' \"\$JELSZO\" | npm run dashboard-user -- add $USERNAME --password-stdin" >&2
  exit 1
fi

cd "$DIR"
exec "$TSX" scripts/dashboard-user.ts add "$USERNAME"
