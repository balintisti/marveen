#!/bin/bash
# Marveen - Ertesites kuldes Telegram-ra
# Hasznalat: ./scripts/notify.sh "Uzenet szovege"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Hiba: .env fajl nem talalhato: $ENV_FILE"
  exit 1
fi

TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
CHAT_ID=$(grep '^ALLOWED_CHAT_ID=' "$ENV_FILE" | cut -d= -f2-)
MAIN_AGENT_ID=$(grep '^MAIN_AGENT_ID=' "$ENV_FILE" | head -1 | cut -d= -f2-)
MAIN_AGENT_ID="${MAIN_AGENT_ID:-marveen}"

if [ -z "$TOKEN" ]; then
  echo "Hiba: TELEGRAM_BOT_TOKEN nincs beallitva"
  exit 1
fi

if [ -z "$CHAT_ID" ]; then
  echo "Hiba: ALLOWED_CHAT_ID nincs beallitva"
  exit 1
fi

MESSAGE="$1"
if [ -z "$MESSAGE" ]; then
  echo "Hasznalat: $0 \"uzenet\""
  exit 1
fi

# Sender attribution: notify.sh always uses the main bot token, so without this
# every notification reads as the main bot. Detect the calling agent from the
# tmux session name and prefix the message when it is NOT the main agent, so the
# reader can see who it came from. Distribution-safe: the main agent id is read
# from .env (default marveen), no hardcoded names.
SENDER=""
SESS=$(tmux display-message -p '#S' 2>/dev/null)
case "$SESS" in
  agent-*)
    SENDER="${SESS#agent-}"
    ;;
  "${MAIN_AGENT_ID}-channels"|"${MAIN_AGENT_ID}-worker")
    SENDER="$MAIN_AGENT_ID"
    ;;
  *)
    SENDER=""
    ;;
esac

if [ -n "$SENDER" ] && [ "$SENDER" != "$MAIN_AGENT_ID" ]; then
  # Capitalize the first letter (bash 3.2 portable -- no ${var^}).
  _first=$(printf '%s' "${SENDER%"${SENDER#?}"}" | tr '[:lower:]' '[:upper:]')
  SENDER_CAP="${_first}${SENDER#?}"
  MESSAGE="🤖 ${SENDER_CAP}:
${MESSAGE}"
fi

# Test-run marker: a test runner (vitest exports VITEST to every child
# process; NODE_ENV=test for other runners) that reaches this script sends a
# REAL message with the production token read from .env -- so it must be
# labelled, not suppressed (the owner wants proof the alert path works).
# Mirrors src/test-run-marker.ts.
if [ -n "${VITEST:-}" ] || [ "${NODE_ENV:-}" = "test" ]; then
  MESSAGE="[TESZT] ${MESSAGE}"
fi

# A valaszt NEM dobjuk el, es NEM jelentunk sikert a nelkul, hogy megneznenk.
# Mert eset (2026-08-25): az `ALLOWED_CHAT_ID` `0` volt, a Telegram minden hivasra
# `{"ok":false,"description":"Bad Request: chat not found"}`-ot adott, ez a szkript
# viszont `>/dev/null`-ba dobta es feltetel nelkul kiirta, hogy "Ertesites elkuldve.".
# Hat futo `dist/` modul hivja (auth-gate, reauth-healer, schedule-runner, agent-worker,
# channel-coordinator, unit-fail-notify) -- vagyis a rendszer TELJES riasztasi utja nemán
# elveszett, es sikert jelentett. A curl `0`-val ter vissza egy 400-ra is, tehat a
# kilepesi kod ONMAGABAN sem eleg: az `ok` mezot kell megnezni.
RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT_ID}" \
  --data-urlencode "text=${MESSAGE}" \
  -d "parse_mode=HTML")

HTTP_CODE=$(printf '%s' "$RESPONSE" | tail -n1)
BODY=$(printf '%s' "$RESPONSE" | sed '$d')

# `"ok":true` a torzsben ES 200-as kod -- mindketto kell.
case "$BODY" in
  *'"ok":true'*) OK_FIELD=1 ;;
  *) OK_FIELD=0 ;;
esac

if [ "$HTTP_CODE" = "200" ] && [ "$OK_FIELD" = "1" ]; then
  echo "Ertesites elkuldve."
else
  DESC=$(printf '%s' "$BODY" | sed -n 's/.*"description":"\([^"]*\)".*/\1/p')
  echo "HIBA: az ertesites NEM ment el. HTTP=${HTTP_CODE} chat_id=${CHAT_ID} ok=${OK_FIELD}${DESC:+ -- $DESC}" >&2
  exit 1
fi
