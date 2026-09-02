#!/usr/bin/env bash
# agent-msg.sh -- reliable inter-agent message send for the Marveen fleet.
#
# WHY: the common `curl -s ... >/dev/null && echo sent` pattern is DANGEROUS -- curl exits 0 even when
# the server REJECTED the request (401/400/5xx), producing a SILENT send failure: the recipient never
# gets the message and two agents can wait on each other forever. The /api/messages router itself is
# fine (HTTP 200 + a message id); the bug is that the SENDER never checks the result. This helper checks
# the HTTP status AND the returned message id, and RETRIES on failure. A message counts as sent only
# when an id came back.
#
# Usage:  bash scripts/agent-msg.sh <from> <to> "<content>"
#   content: plain text (quotes / newlines OK) -- the body is built with json.dumps (no quoting pitfalls).
#   large / multi-line content may come from STDIN when the 3rd arg is "-":
#     echo "<long text>" | bash scripts/agent-msg.sh <from> <to> -
# Output: success -> "OK id=<n> queue=<depth> (~<n> perc)"; failure -> "FAIL <reason>"
# When the recipient is not running -- or could not be asked -- the server also
# returns a line saying so, and it is printed on stderr (card bbb8557c). The
# depth alone cannot say it: "4 waiting" reads as a backlog whether or not
# anybody is there to drain it.
#         + a line in store/agent-msg-failures.log, exit 1.
# The queue fields come from the POST response (2026-08-20): a message is accepted
# instantly but only DELIVERED into an idle gap in the recipient's pane, which on a
# busy agent measured 80+ minutes. At 3+ waiting the script says so on stderr and
# tells the sender to use the card instead -- the number alone would arrive after
# the send, when it can only help next time.
# A second stderr line reports the SENDER's own outbound in the same window --
# total, rate against a documented saturating rate, and this sender's share of
# the recipient's load (card f664f1a5). Every other number here is scoped to the
# recipient; a sender could not see its own sum, and the sum is what saturates.
# Every message gets a footer line: `[KULDVE: <ido> | sor: <n> | kuldo: <agens>]`.
# See the KULDESI BELYEG block below for why it is KULDVE (not MERVE) and why it
# is a footer (not a header).
# Env: MARVEEN_WEB_PORT (default 3420).
set -uo pipefail

# base dir = the parent of this script's dir (scripts/..), so it works from any CWD / any install
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${MARVEEN_WEB_PORT:-3420}"
TOKEN_FILE="$BASE/store/.dashboard-token"
URL="http://localhost:${PORT}/api/messages"
LOG="$BASE/store/agent-msg-failures.log"

FROM="${1:?from required}"; TO="${2:?to required}"; C="${3:?content required (or - for STDIN)}"
[ "$C" = "-" ] && C="$(cat)"
[ -r "$TOKEN_FILE" ] || { echo "FAIL: no token file at $TOKEN_FILE"; exit 1; }
TOKEN="$(cat "$TOKEN_FILE")"

# --- __STAMP__ SUBSTITUTION (2026-08-23, card a0fbeba0) ---
# `card-comment.sh` fills this placeholder in; this script did not, and the two
# take the SAME text from the SAME agent. Nine messages in the last 200 went out
# with a raw `__STAMP__` where a timestamp belonged (mandark measured the queue;
# my own estimate from my own files was five, and low). Nothing errored: the
# placeholder looks exactly like a filled-in field, which is the whole defect.
#
# LOUD ON FAILURE, per Marveen's condition. If `date` cannot produce a stamp we
# REFUSE rather than send the placeholder, because a silent fallback here would
# rebuild the very hole being closed. Sending is the irreversible half.
if printf '%s' "$C" | grep -q '__STAMP__'; then
  STAMP="$(date '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null || true)"
  if [ -z "$STAMP" ]; then
    echo "NEM KULDTEM: a torzs __STAMP__ helyorzot tartalmaz, de a date nem adott idobelyeget." >&2
    echo "  Ird bele az idopontot kezzel, vagy javitsd a kornyezetet -- nyers helyorzot nem kuldok el." >&2
    exit 1
  fi
  # LOUD ON SUCCESS TOO (card a0fbeba0, Marveen's condition 2). The failure
  # paths above already shout; the success stayed silent, which is the same
  # shape this card is about -- an operation whose "it worked" is
  # indistinguishable from "it did not run". The line below is read back FROM
  # THE RESULT: the count and the stamp come from the string that will actually
  # be sent, not from what the substitution meant to do.
  C="$(C="$C" STAMP="$STAMP" python3 -c '
import os, sys
body = os.environ["C"]
stamp = os.environ["STAMP"]
before = body.count("__STAMP__")
out = body.replace("__STAMP__", stamp)
after = out.count(stamp)
sys.stderr.write("  __STAMP__ -> %s (%d helyen, visszaolvasva: %d)\n" % (stamp, before, after))
sys.stdout.write(out)
')"
  # Read back: a substitution that silently did nothing is the same class of bug.
  if printf '%s' "$C" | grep -q '__STAMP__'; then
    echo "NEM KULDTEM: a __STAMP__ helyettesites lefutott, de a helyorzo BENNMARADT." >&2
    exit 1
  fi
fi


# A KET IDOBELYEG MEGFER EGYMAS MELLETT, es a SORREND szandekos (friday, a koteg
# feloldasakor 2026-08-23): a `__STAMP__` a SZERZO szoveget javitja, tehat a
# szerzo sajat tartalman kell futnia -- MIELOTT barmit hozzafuzunk. A lenti
# `[KULDVE: ...]` labjegyzet ezutan kerul a vegere, es a `BODY` csak AKKOR epul,
# amikor mar mindketto rajta van. Ket kulonbozo kerdesre valaszolnak: a
# `__STAMP__` azt, AMIT a szerzo mert, a labjegyzet azt, AMIKOR a gep kuldott.

# --- KARTYA-ID FELOLDAS A KULDES ELOTT (2026-09-02, jarvis javaslata) ---
# 2026-09-02-an NEGY azonosito-alaku hibat kovettem el egy napon, es MIND A NEGYET
# lefele kaptak el, egyiket sem en. Az utolso egy KITALALT kartya-id volt egy
# uzenetben, ami epp azt allitotta, hogy megnyitottam azt a kartyat.
#
# jarvis megfogalmazasa, es ezert kod es nem szokas: "egy kartya-id MECHANIKUSAN
# feloldhato a kuldes elott". A `card-comment.sh` mar 404-el egy rossz kartyara;
# ez a script eddig ranezett sem.
#
# MIERT CSAK KARTYA-ALLITO KORNYEZETBEN: egy kartya-id es egy rovid commit-hash
# UGYANAZ a nyolc-hex alak. Minden 8-hexre tuzelve ez az or a commit-hasheken
# allandoan szolna, es par kor alatt zajja valna -- pontosan az a bukas, amit a
# lapunk mashol mar rogzit. Ezert CSAK azt nezzuk, amit a szoveg maga KARTYANAK
# nevez (`card <id>` / `kartya <id>` / `kártya <id>`, backtickkel vagy anelkul).
#
# NEM BLOKKOL, FIGYELMEZTET: egy archivalt kartyara valo jogos hivatkozas is
# feloldhatatlan, es egy fontos uzenetet nem allitunk meg egy labjegyzet miatt.
#
# ES HA NEM TUD MERNI, AZT KIMONDJA. Egy ellenorzes, ami elerhetetlen API mellett
# CSENDBEN atenged, megkulonboztethetetlen attol, hogy nincs is -- ez a lap
# vissza-visszatero alakja. Ilyenkor a sor azt mondja, hogy NEM ELLENORIZTE.
#
# A figyelmeztetes STDOUT-ra ES stderr-re is megy: a kuldok tobbsege
# `grep -E 'OK id|FAIL|NEM KULDTEM'`-mel olvassa a kimenetet, es egy csak-stderr
# sor abbol kiesik. A grep-horgony ezert: NEM FELOLDHATO KARTYA-ID.
_CARD_IDS="$(printf '%s' "$C" | grep -oiE '(card|kartya|kártya)s?[[:space:]]+`?[0-9a-f]{8}`?' | grep -oE '[0-9a-f]{8}' | sort -u)"
if [ -n "$_CARD_IDS" ]; then
  # A valasz ~2 MB. NEM megy hej-valtozoba es NEM megy kornyezeten at: a
  # kornyezet merethatara (ARG_MAX) alatt a python hivas E2BIG-gel elhal, es a
  # 2026-09-02-i elso valtozatom pontosan ezen bukott -- a "nem futott le" agra
  # esett MINDEN esetben, tehat sosem ellenorzott semmit. FAJLON keresztul megy.
  _KBF="$(mktemp -t agentmsg-kb)"
  curl -s --max-time 10 -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
       "http://localhost:${PORT}/api/kanban" -o "$_KBF" 2>/dev/null || true
  if [ ! -s "$_KBF" ] || [ "$(head -c1 "$_KBF")" != "[" ]; then
    _m="NEM FELOLDHATO KARTYA-ID: az ellenorzes NEM FUTOTT LE (a kanban API nem valaszolt). A szovegben emlitett kartya-id-k nincsenek igazolva."
    echo "$_m"; echo "$_m" >&2
  else
    _BAD="$(CARDS="$_CARD_IDS" KBF="$_KBF" python3 -c '
import json,os
ids={c["id"][:8] for c in json.load(open(os.environ["KBF"],encoding="utf-8"))}
print(" ".join(t for t in os.environ["CARDS"].split() if t not in ids))' 2>/dev/null || true)"
    if [ -n "$_BAD" ]; then
      _m="NEM FELOLDHATO KARTYA-ID: $_BAD -- a szoveg kartyanak nevezi, de a tablan nincs ilyen. Ha commit-hash, fogalmazd at; ha archivalt kartya, hagyd figyelmen kivul."
      echo "$_m"; echo "$_m" >&2
    fi
  fi
  rm -f "$_KBF"
fi

# --- PREFLIGHT: the recipient's queue BEFORE we add to it (2026-08-21) ---
# The post-send warning below is real but arrives too late: by the time the
# sender reads it the message is already in the queue, so the rule depends on
# them remembering it NEXT time. Measured that day: mandark had 4 pending
# messages, ALL mine, sent within 40 minutes -- each individually justified,
# and the sum is what saturates. So the check moved BEFORE the send.
#
# Read straight from SQLite, not from the POST response: the running dashboard
# is an older build that does not return the `queue` field at all, so the
# server-side depth silently never arrives. A guard that depends on a field the
# server may not send is not a guard.
#
# status='pending' ONLY -- `!= 'delivered'` also counts `failed`, which never
# delivers. That mistake made dexter's empty queue look like 9 waiting messages
# for a whole morning, and the sender stayed silent for no reason.
#
# FAIL-OPEN on measurement error, and SAY SO: a broken probe must not block a
# message. Override a real backlog with --force as the 4th argument.
FORCE="${4:-}"
DEPTH_PRE=""
if [ "$FORCE" != "--force" ]; then
  # Three numbers out of one read: the ROW COUNT (today's threshold), the
  # WAITING TEXT, and the TEXT DELIVERED IN THE LAST 3 HOURS across ALL senders.
  #
  # WHY THE LAST TWO (card 0e3959e4, marveen measured it, jarvis re-measured it
  # independently): the threshold counts rows, but what fills a recipient's
  # context is TEXT, and the load ADDS UP across senders. In the measured window
  # jarvis took 40 131 characters from four senders, the queue never went above
  # 3, and the agent restarted on context -- while every sender's own check
  # stayed green the whole time. Each sender could only see its own traffic.
  #
  # THESE TWO ARE PRINTED, NOT ENFORCED. Which number should block a send, and
  # at what value, is a policy decision about the coordination layer, and it is
  # the coordinator's to make -- not something this helper should invent. What
  # it can do is end the blindness: no sender could previously see the sum.
  #
  # AND MY OWN OUTBOUND, WHICH NO SENDER COULD SEE AT ALL (card f664f1a5,
  # marveen measured it on himself). The two lines above are both scoped to the
  # RECIPIENT: the queue depth, and the recipient's total inbound. Neither says
  # how much of it is MINE, and neither says what I am sending to EVERYONE ELSE.
  # Measured 2026-08-28 07:2x on the live board, 3-hour window: marveen was at
  # 126 073 chars to 7 recipients (42 024 chars/hour) while every single one of
  # his per-send checks read green, because each one only ever showed the
  # recipient's side. Of dexter's 42 373 inbound chars, 33 649 (79%) were his --
  # and the line he saw said "3 senders", which reads like shared load.
  #
  # The reference rate is the one documented saturation in CLAUDE.md: 53
  # messages / 92 889 chars / 6 hours = 15 481 chars/hour, the rate at which an
  # agent measurably filled up on 2026-08-20. It is a HISTORICAL DATUM, not a
  # threshold -- re-derive it if a better-measured saturation is recorded. Its
  # only job is to give the number a denominator: "35 822 chars" says nothing,
  # "0.8x the rate that saturated someone" is an assertion.
  #
  # PRINTED, NOT ENFORCED -- same discipline as the two numbers above. Whether a
  # sender's own rate should ever BLOCK a send, and at what value, is a policy
  # decision about the coordination layer and the coordinator's to make. What
  # this ends is the blindness, which is what the card asked for.
  PRE="$(BASE="$BASE" TO="$TO" FROM="$FROM" python3 -c '
import os, sqlite3, time
try:
    c = sqlite3.connect("file:" + os.environ["BASE"] + "/store/claudeclaw.db?mode=ro", uri=True)
    to = os.environ["TO"]
    me = os.environ["FROM"]
    n, chars = c.execute(
        "select count(*), coalesce(sum(length(content)),0) from agent_messages"
        " where to_agent=? and status=?", (to, "pending")).fetchone()
    since = int(time.time()) - 180 * 60
    rc, rs = c.execute(
        "select coalesce(sum(length(content)),0), count(distinct from_agent)"
        " from agent_messages where to_agent=? and created_at>=?", (to, since)).fetchone()
    # Mine, same window: across ALL recipients, and this recipient only.
    mc, mn, mt = c.execute(
        "select coalesce(sum(length(content)),0), count(*), count(distinct to_agent)"
        " from agent_messages where from_agent=? and created_at>=?", (me, since)).fetchone()
    mh, = c.execute(
        "select coalesce(sum(length(content)),0) from agent_messages"
        " where from_agent=? and to_agent=? and created_at>=?", (me, to, since)).fetchone()
    line = ""
    if mc > 0:
        rate = mc / 3.0
        SATURATING_RATE = 15481.0  # 92889 chars / 6 h, CLAUDE.md 2026-08-20
        share = ""
        if rc > 0 and mh > 0:
            share = " | ebbol %s-nek %d kar (%d%%)" % (to, mh, round(100.0 * mh / rc))
        line = ("  [en] %s: 3 oraban %d kar %d db %d cimzettnek = %d kar/ora, "
                "a telito rata %.1fx-e%s" % (me, mc, mn, mt, round(rate), rate / SATURATING_RATE, share))
    print("\t".join(str(x) for x in (n, chars, rc, rs, mc, mn, mt, mh, line)))
except Exception:
    print("\t" * 8)' 2>/dev/null)"
  DEPTH_PRE="$(printf '%s' "$PRE" | cut -f1)"
  CHARS_PRE="$(printf '%s' "$PRE" | cut -f2)"
  RECENT_CHARS="$(printf '%s' "$PRE" | cut -f3)"
  RECENT_SENDERS="$(printf '%s' "$PRE" | cut -f4)"
  MINE_LINE="$(printf '%s' "$PRE" | cut -f9)"
  if [ -n "$RECENT_CHARS" ] && [ "$RECENT_CHARS" -gt 0 ] 2>/dev/null; then
    echo "  [sor] $TO: $DEPTH_PRE var (${CHARS_PRE} kar) | 3 oraban ${RECENT_CHARS} kar ${RECENT_SENDERS} feladotol" >&2
  fi
  # Printed INDEPENDENTLY of the recipient line: a first message to a quiet
  # agent is exactly the case where my own running total is the only warning
  # available, and hiding it behind the recipient's traffic would suppress it
  # there.
  if [ -n "$MINE_LINE" ]; then
    printf '%s\n' "$MINE_LINE" >&2
  fi
  if [ -z "$DEPTH_PRE" ]; then
    echo "FIGYELEM: a sor melyseget NEM tudtam megmerni (adatbazis nem olvashato). Kuldok, de vakon." >&2
  elif [ "$DEPTH_PRE" -ge 3 ] 2>/dev/null; then
    echo "NEM KULDTEM. $TO soraban mar $DEPTH_PRE uzenet var, es a pending azt jelenti, hogy az" >&2
    echo "  elozot EL SEM OLVASTA -- egy ujabb level nem gyorsitja, csak a telitest hozza kozelebb." >&2
    echo "  Ird a kartyara kommentkent. Az uzenet tol, a kartya huzat." >&2
    echo "  Ha tenyleg most kell mennie:  bash scripts/agent-msg.sh $FROM $TO \"...\" --force" >&2
    exit 2
  fi
fi

# --- KULDESI BELYEG (2026-08-23) ---
#
# WHY: the fleet rule says every handed-over measurement carries WHEN it was
# taken, ON WHAT STATE, and WHAT WOULD INVALIDATE IT. For kanban comments the
# timestamp is already in the TOOL -- card-comment.sh substitutes __STAMP__, so
# it cannot be forgotten. For inter-agent messages there was nothing, and that
# is where most handovers happen. A rule that only holds where it was already
# enforced is not a rule.
#
# `KULDVE`, NOT `MERVE`, and the difference is the whole point (Marveen caught
# this before it shipped): the helper knows only when it SENT. Someone who
# measures at 23:37 and sends at 23:44 would get a `MERVE: 23:44` header that
# is FALSE -- and written by a machine, so more convincing than a human's
# mistake. An automatism that labels the wrong field is worse than none: the
# missing datum becomes a credible lie. Writing down when the MEASUREMENT
# happened stays the author's job; the tool stamps only what it knows.
#
# And the pair is worth more than either half: with the measurement time in the
# body and the send time here, THE DIFFERENCE IS ITSELF INFORMATION. Measured
# tonight: 7 minutes in one case, 80 in another.
#
# FOOTER, NOT HEADER -- and this is a measured decision, not a preference.
# Two consumers match on the START of the content:
#   src/web/routes/messages.ts:210  !content.startsWith(COMPLETION_REPORT_PREFIX)
#       -- the ping-pong breaker for completion reports
#   src/db.ts getDispatchedPendingStats  content NOT LIKE '[Eredmény]%'
#       -- feeds the soft-restart gate; on 2026-08-12 counting acks as blocking
#          work made the main agent permanently ineligible for a soft restart
# A prefix would shift any `[Eredmény] ...` sent through this helper out of both
# patterns and re-open a documented incident. Nothing parses the END.
STAMP_TIME="$(date '+%Y-%m-%d %H:%M %Z')"
if [ "$FORCE" = "--force" ]; then
  STAMP_QUEUE="sor: nem merve (--force)"
elif [ -z "${DEPTH_PRE:-}" ]; then
  # Say it, do not omit it: a missing field reads as "nothing to report".
  STAMP_QUEUE="sor: nem merheto"
else
  STAMP_QUEUE="sor: $DEPTH_PRE"
fi
C="$C

[KULDVE: $STAMP_TIME | $STAMP_QUEUE | kuldo: $FROM]"

BODY="$(FROM="$FROM" TO="$TO" C="$C" python3 -c 'import json,os; print(json.dumps({"from":os.environ["FROM"],"to":os.environ["TO"],"content":os.environ["C"]}))')"

attempt=0; max=3; CODE=""; ID=""
while [ "$attempt" -lt "$max" ]; do
  attempt=$((attempt+1))
  RESP="$(curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "$BODY" -w $'\n%{http_code}' 2>/dev/null || true)"
  CODE="$(printf '%s' "$RESP" | tail -n1)"
  JSON="$(printf '%s' "$RESP" | sed '$d')"
  # Two values out of one parse: the id (proof it was accepted) and the
  # recipient's queue state (how long "accepted" is from "arrived"). Tab
  # separated so an empty queue field cannot shift the id.
  PARSED="$(printf '%s' "$JSON" | python3 -c 'import sys,json
try:
  d = json.load(sys.stdin)
  if not isinstance(d, dict): raise ValueError
  q = d.get("queue") or {}
  depth = q.get("queueDepth", "")
  delay = q.get("estimatedDelaySec")
  # NULL delay means "no delivery history yet", which is NOT "instant" -- keep
  # the distinction visible instead of printing a misleading 0.
  mins = "" if delay is None else str(max(1, round(delay / 60)))
  # The advice text is composed server-side so the threshold and the wording
  # live in ONE place. Newlines become \x1f here and are restored on print:
  # a multi-line field would shift every column after it.
  advice = (q.get("advice") or "").replace("\n", "\x1f")
  print("\t".join([str(d.get("id", "")), str(depth), mins, advice]))
except Exception:
  print("\t\t\t")' 2>/dev/null)"
  ID="$(printf '%s' "$PARSED" | cut -f1)"
  DEPTH="$(printf '%s' "$PARSED" | cut -f2)"
  MINS="$(printf '%s' "$PARSED" | cut -f3)"
  ADVICE="$(printf '%s' "$PARSED" | cut -f4)"
  if { [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; } && [ -n "$ID" ]; then
    # The "OK id=<n>" prefix is a contract -- callers and CLAUDE.md grep for it.
    # Anything new goes after it.
    LINE="OK id=$ID"
    [ -n "$DEPTH" ] && LINE="$LINE queue=$DEPTH"
    [ -n "$MINS" ] && LINE="$LINE (~${MINS} perc)"
    echo "$LINE"
    # Printing the number is not enough: the sender has already sent by the
    # time they read it, and a rule they must REMEMBER for next time is not a
    # rule. So the server says what to do, at the moment the evidence is in
    # front of them -- and it says it only where it applies: a busy recipient
    # and an absent one need opposite advice (card bbb8557c).
    #
    # The threshold and the wording used to live here as well as on the server.
    # One rule written in two places drifts, and the copy nobody edits is the
    # one that ends up lying, so this side now only prints what it is given.
    if [ -n "$ADVICE" ]; then
      printf '%s\n' "$ADVICE" | tr '\037' '\n' >&2
    fi
    exit 0
  fi
  sleep 1
done
echo "FAIL from=$FROM to=$TO http=${CODE:-?} id='$ID' (after $max tries)"
printf '%s\tFAIL\tfrom=%s\tto=%s\thttp=%s\tresp=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$FROM" "$TO" "${CODE:-?}" "$(printf '%s' "${JSON:-}" | head -c 200)" >> "$LOG" 2>/dev/null || true
exit 1
