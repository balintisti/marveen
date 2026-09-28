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
MAIN_AGENT_ID=$(grep '^MAIN_AGENT_ID=' "$ENV_FILE" | head -1 | cut -d= -f2-)
MAIN_AGENT_ID="${MAIN_AGENT_ID:-marveen}"

if [ -z "$TOKEN" ]; then
  echo "Hiba: TELEGRAM_BOT_TOKEN nincs beallitva"
  exit 1
fi

# CHATID0: resolve_owner_chat_id, not a raw ALLOWED_CHAT_ID read -- "0" is the
# installer placeholder, not a chat, and neither empty nor falsy. Without this
# the FALLBACK channel fails exactly where it is needed most -- it fires when
# the plugin is down, and on a placeholder install it would post to chat_id=0.
# The access.json fallback still applies here: a paired channel survives even
# while the plugin process itself is down, because it reads the same file the
# plugin wrote, not the plugin's live state. It is the MAIN install's file
# even when a sub-agent runs this script with its own TELEGRAM_STATE_DIR
# (the lib ignores that variable), and only a single paired DM entry counts.
. "$SCRIPT_DIR/lib/owner-chat.sh"
# The resolver's reason line goes to stderr as is (not captured: any stderr
# noise on the success path would otherwise become part of the chat id).
if ! CHAT_ID="$(resolve_owner_chat_id "$ENV_FILE")"; then
  echo "Hiba: ALLOWED_CHAT_ID nincs beallitva (az ok a fenti sorban)"
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
# A `tmux display-message` KLIENS NELKUL NEM URESET AD, HANEM A LEGUTOBB AKTIV SESSION NEVET.
# Merve 2026-09-20: ugyanez a sor tmux-on BELUL `marveen-channels`-t ad, a `$TMUX` valtozo
# nelkul (ahogy egy launchd job latja) `agent-deeper`-t -- mert az volt a legfrissebb aktivitasu
# session. A keret-or launchd-bol fut, tehat a gazda uzenetei `🤖 Deeper:` prefixszel mentek ki,
# es a gazda EGY AGENSNEK tulajdonitotta a rendszer sajat riasztasat. A hiba NEM allando: a
# prefix attol fugg, melyik session `session_activity` mezoje a legfrissebb, tehat futasonkent
# MAS nevet allithat.
#
# ES A "LEGFRISSEBB" ITT NEM AZT JELENTI, HOGY "AKI EPPEN DOLGOZIK" -- ezt kulon megmertem
# (2026-09-20 12:20), mert az elso megfogalmazasom ("melyik agens dolgozott utoljara") pont
# erre a rossz olvasatra csabit:
#     agent-deeper `session_activity` = 03:00:17, azaz **559 PERCE**
#     a tobbi session tegnap ~21:00
#     es deeper KOZBEN, 12:09-kor is dolgozott (kartyat zart le), anelkul hogy ez a mezo mozdult
# A `session_activity` tehat NEM az agens munkajat meri, hanem egy tmux-belso rendezest, ami
# akar fel napos is lehet. A prefix egy VELETLENSZERU nevet allitott, nem a legaktivabbat.
# A javitas: csak akkor kerdezzuk a tmux-ot, ha tenylegesen egy tmux-panelbol futunk.
# (Upstream 2adfa6cb ugyanezt javitotta, ugyanigy: no pane -> no claim about the sender.)
SESS=""
if [ -n "${TMUX:-}" ]; then
  SESS=$(tmux display-message -p '#S' 2>/dev/null)
fi
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
# TIME BOUND, added 2026-09-05 (didi measured it on card 900f88ec). This curl had no
# --max-time and no --connect-timeout: measured still waiting at 45s against an
# unreachable host, where the sibling calls in this repo use -m 10 and return on time.
# It matters more than it looks because this script is now called from the BACKUP
# FAILURE path -- an unbounded outbound call inside a failure handler turns one slow
# network into a hung scheduled job. Five other scripts here already bound their curls.
#
# UPSTREAM (NOTIFYVAK826 / NOTIFYVAKSWEEP826) moved the same contract into
# scripts/lib/send-telegram.sh. It is NOT used here, on purpose (merge 88c366f2):
# the library answers only yes/no, while this script needs the response BODY --
# the Telegram message_id goes into the ledger below (card 44730c4c) -- and checks
# the HTTP code as well as `ok`. What the library adds is kept inline: the curl
# exit code is reported by number, curl's own error text reaches stderr, and the
# bot token is redacted from anything echoed (some curl errors quote the URL).
RESPONSE=$(curl -sS --connect-timeout 10 --max-time 20 -w '\n%{http_code}' -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT_ID}" \
  --data-urlencode "text=${MESSAGE}" \
  -d "parse_mode=HTML" 2>&1)
CURL_EXIT=$?
# Never let the token reach a log/journal: redact before any echo.
RESPONSE="${RESPONSE//${TOKEN}/<token>}"

HTTP_CODE=$(printf '%s' "$RESPONSE" | tail -n1)
BODY=$(printf '%s' "$RESPONSE" | sed '$d')

# `"ok":true` a torzsben ES 200-as kod ES curl exit 0 -- mindharom kell.
case "$BODY" in
  *'"ok":true'*) OK_FIELD=1 ;;
  *) OK_FIELD=0 ;;
esac

if [ "$CURL_EXIT" -eq 0 ] && [ "$HTTP_CODE" = "200" ] && [ "$OK_FIELD" = "1" ]; then
  echo "Ertesites elkuldve."
  # A LEDGERBE IS BE KELL KERULNIE (kartya 44730c4c). Ez a szkript a TARTALEK ut: akkor fut,
  # amikor az MCP `reply` tool nincs meg -- vagyis pont akkor, amikor a rendszer mar serult.
  # Eddig SEMMIT nem irt a `conversation_log`-ba, tehat egy igy kikuldott uzenet SZERKEZETILEG
  # lathatatlan maradt annak, aki a ledgerbol olvassa ki, mit tud mar a gazda -- es a lap epp
  # arra tanit, hogy onnan olvassuk.
  #
  # FAIL-OPEN, ES EZ NEM LAZASAG: a levelet MAR ELKULDTUK. Ha a naplozas elbukik (nincs python3,
  # zarolt DB, hianyzo tabla), a szkript akkor is SIKERT jelent, mert a kuldes tenyleg sikerult.
  # Egy elbukott naplozasbol hibat csinalni annyi lenne, mint egy KEZBESITETT uzenetet
  # elveszettnek jelenteni -- rosszabb, mint a lathatatlansag, amit javitunk.
  # A hiba ettol nem nema: a stderr-re kimegy egy sor.
  LEDGER_MSG_ID=$(printf '%s' "$BODY" | sed -n 's/.*"message_id":\([0-9]*\).*/\1/p' | head -1)
  LEDGER_AGENT="${SENDER:-$MAIN_AGENT_ID}"
  # A hooks-konyvtarat a BASH adja at: o tudja a sajat helyet (`SCRIPT_DIR`, :5). Egy python
  # oldali kitalalas itt pont az a tippelt ut lenne, amirol ez a repo kulon kartyat vezet.
  MSG_FOR_LEDGER="$MESSAGE" CHAT_FOR_LEDGER="$CHAT_ID" \
  AGENT_FOR_LEDGER="$LEDGER_AGENT" MID_FOR_LEDGER="$LEDGER_MSG_ID" \
  HOOKS_DIR="$SCRIPT_DIR/hooks" \
  python3 - <<'PYLEDGER' 2>/dev/null || echo "FIGYELEM: az uzenet ELMENT, de a ledgerbe nem sikerult beirni." >&2
import os, sys
sys.path.insert(0, os.environ["HOOKS_DIR"])
import ledger_lib
mid = os.environ.get("MID_FOR_LEDGER") or None
ledger_lib.log_outbound(
    os.environ["AGENT_FOR_LEDGER"],
    os.environ["CHAT_FOR_LEDGER"],
    os.environ["MSG_FOR_LEDGER"],
    int(mid) if mid and mid.isdigit() else None,
)
PYLEDGER
elif [ "$CURL_EXIT" -ne 0 ]; then
  echo "HIBA: az ertesites NEM ment el: transport failure (curl exit ${CURL_EXIT}): ${RESPONSE}" >&2
  exit 1
else
  # The reason is read from the WHOLE response, not just BODY: diagnostics only,
  # the success test above stays strict.
  DESC=$(printf '%s' "$RESPONSE" | sed -n 's/.*"description":"\([^"]*\)".*/\1/p' | head -1)
  echo "HIBA: az ertesites NEM ment el. HTTP=${HTTP_CODE} chat_id=${CHAT_ID} ok=${OK_FIELD}${DESC:+ -- $DESC}" >&2
  exit 1
fi
