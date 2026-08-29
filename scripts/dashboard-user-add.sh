#!/bin/bash
# Marveen -- dashboard felhasznalo letrehozasa (bongeszos belepeshez).
#
# MIERT LETEZIK: az `/api/*` MINDEN hivasa hitelesitest kiван (nincs loopback-mentesseg,
# `src/web/auth-gate.ts` requiresAuth). Aki bongeszobol nyitja meg a dashboardot -- pl.
# telefonrol, tailneten at --, annak SESSION kell, ahhoz pedig felhasznalo.
# Nulla felhasznalonal az `/api/auth/status` `login_available:false, setup_required:true`-t ad,
# es a feluleten minden csempe uresen marad. Nem hiba: nincs kinek belepnie.
#
# A jelszot `read -s`-sel keri be, tehat NEM kerul se a parancssorba, se a hej-tortenetbe,
# es a POST-ot python kuldi, tehat a jelszo hej-behelyettesitesen sem megy at.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN_FILE="$DIR/store/.dashboard-token"
PORT="$(grep -E '^WEB_PORT=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
PORT="${PORT:-3420}"

[ -f "$TOKEN_FILE" ] || { echo "HIBA: nincs dashboard-token: $TOKEN_FILE" >&2; exit 1; }

USERNAME="${1:-}"
if [ -z "$USERNAME" ]; then
  printf 'Felhasznalonev (betuk, szamok, . _ -): '
  read -r USERNAME
fi

printf 'Jelszo (legalabb 10 karakter): '
read -rs PASSWORD; echo
printf 'Jelszo megegyszer: '
read -rs PASSWORD2; echo

if [ "$PASSWORD" != "$PASSWORD2" ]; then
  echo "HIBA: a ket jelszo nem egyezik. Semmi nem tortent." >&2
  exit 1
fi

export MV_USER="$USERNAME" MV_PASS="$PASSWORD" MV_TOKEN="$(cat "$TOKEN_FILE")" MV_PORT="$PORT"
unset PASSWORD PASSWORD2

python3 - <<'PY'
import json, os, urllib.request, urllib.error, sys
body = json.dumps({"username": os.environ["MV_USER"], "password": os.environ["MV_PASS"]}).encode()
req = urllib.request.Request(
    f"http://127.0.0.1:{os.environ['MV_PORT']}/api/auth/users",
    data=body,
    headers={"Content-Type": "application/json",
             "Authorization": "Bearer " + os.environ["MV_TOKEN"]},
)
try:
    r = urllib.request.urlopen(req)
    d = json.loads(r.read())
    print(f"OK: a(z) '{d['user']['username']}' felhasznalo letrejott (id={d['user']['id']}).")
    print("Mostantol be tudsz lepni a dashboardra bongeszobol.")
except urllib.error.HTTPError as e:
    try:
        msg = json.loads(e.read()).get("error", "(nincs indoklas)")
    except Exception:
        msg = "(a valasz nem JSON)"
    print(f"NEM JOTT LETRE. HTTP {e.code}: {msg}", file=sys.stderr)
    sys.exit(1)
PY
