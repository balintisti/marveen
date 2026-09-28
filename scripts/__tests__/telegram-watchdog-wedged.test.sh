#!/bin/bash
# Contract tests for telegram_progress_watchdog.py -- the wedged-turn sentry.
# Run: bash scripts/__tests__/telegram-watchdog-wedged.test.sh
#
# Locks the item-(b) fix: when a turn is WEDGED (agent up, but the reply MCP
# call is hung so the turn never ends), the watchdog must (1) react well before
# the 15-min blunt backstop and (2) deliver the agent's REAL answer, not a
# generic error. A legitimately long task (no hung reply) must NOT be touched
# before the backstop.
#
# Fully hermetic: HOME and MARVEEN_ROOT are pinned to a temp tree so the
# watchdog only ever scans test dirs (never the real ~/.claude), and all Bot API
# traffic is routed to a local stub via TELEGRAM_API_BASE.

set -u

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }
assert_eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected '$2', got '$3')"; fi; }

INSTALL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WATCHDOG="$INSTALL_DIR/scripts/hooks/telegram_progress_watchdog.py"

TMP="$(mktemp -d)"
trap 'kill "$STUB_PID" 2>/dev/null; rm -rf "$TMP"' EXIT

# --- Local Bot API stub (logs "<method> <body>" per request) -----------------
REQLOG="$TMP/requests.log"; PORTFILE="$TMP/port"
cat > "$TMP/stub.py" <<'PYEOF'
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
reqlog = sys.argv[1]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode("utf-8") if n else ""
        method = self.path.rsplit("/", 1)[-1]
        with open(reqlog, "a", encoding="utf-8") as f:
            f.write(f"{method} {body}\n")
        # The real Bot API refuses to DELETE a message older than 48 h (400) but
        # still allows an EDIT. Message id 4444 is the test's "too old" sentinel;
        # every other id keeps the old always-200 behaviour, so cases (a)-(e) are
        # untouched.
        if method == "deleteMessage" and '"message_id": 4444' in body.replace("\n", ""):
            err = json.dumps({"ok": False, "error_code": 400,
                              "description": "Bad Request: message can't be deleted"}).encode()
            self.send_response(400); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err))); self.end_headers()
            self.wfile.write(err); return
        out = {"ok": True, "result": {"message_id": 9001}}
        payload = json.dumps(out).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload))); self.end_headers()
        self.wfile.write(payload)
# HTTPServer.server_bind() calls socket.getfqdn(host), a reverse lookup. Measured
# 2026-09-24 in an agent session on this host: getfqdn("127.0.0.1") took 35.0 s,
# and the harness waits 5 s for the port file -> "FATAL: stub did not start", red
# on every run and filed among the "pre-existing" failures (card 3f638239). A
# loopback stub needs no name: bind the TCP socket and skip the lookup.
import socketserver
class QuickHTTPServer(HTTPServer):
    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = "127.0.0.1", self.server_address[1]
srv = QuickHTTPServer(("127.0.0.1", 0), H)
with open(sys.argv[2], "w") as f: f.write(str(srv.server_address[1]))
srv.serve_forever()
PYEOF
python3 "$TMP/stub.py" "$REQLOG" "$PORTFILE" &
STUB_PID=$!
for _ in $(seq 1 50); do [ -s "$PORTFILE" ] && break; sleep 0.1; done
PORT="$(cat "$PORTFILE" 2>/dev/null)"
[ -z "$PORT" ] && { echo "FATAL: stub did not start"; exit 1; }
API_BASE="http://127.0.0.1:$PORT"

CHAT="10000000001"
ANSWER="EZ_A_VALODI_VALASZ amit a usernek latnia kell"

# Build a per-case agent state dir + transcript, then return the progress dir.
# kind = hung  -> last tool_use is a Telegram reply with NO result (round hung)
# kind = work  -> last tool_use is a Bash WITH a result (legit long task)
# kind = noans -> hung reply but NO assistant text (nothing to deliver)
make_case() { # name kind age_seconds [message_id]
    local name="$1" kind="$2" age="$3" mid="${4:-555}"
    local pdir="$TMP/root/agents/$name/.claude/channels/telegram/progress"
    local sdir="$TMP/root/agents/$name/.claude/channels/telegram"
    mkdir -p "$pdir"
    printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$sdir/.env"
    local tr="$sdir/transcript.jsonl"
    case "$kind" in
      hung)
        { printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"'"$ANSWER"'"}]}}';
          printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tuReply1","name":"mcp__plugin_telegram_telegram__reply"}]}}'; } > "$tr" ;;
      noans)
        printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tuReply1","name":"mcp__plugin_telegram_telegram__reply"}]}}' > "$tr" ;;
      work)
        { printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"'"$ANSWER"'"},{"type":"tool_use","id":"tuBash1","name":"Bash"}]}}';
          printf '%s\n' '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tuBash1"}]}}'; } > "$tr" ;;
    esac
    printf '[{"chat_id":"%s","message_id":%s,"transcript_path":"%s"}]\n' "$CHAT" "$mid" "$tr" \
        > "$pdir/SID.json"
    # Backdate the state file so its age exceeds the tested threshold.
    python3 - "$pdir/SID.json" "$age" <<'PY'
import os, sys, time
os.utime(sys.argv[1], (time.time()-int(sys.argv[2]),)*2)
PY
    echo "$pdir"
}
pend_exists() { [ -f "$1/SID.json" ] && echo yes || echo no; }
# REQLOG always exists (recreated per run); grep -c prints exactly one integer
# line ("0" on no match) -- no `|| echo 0` fallback (that would double the 0).
count() { grep -c "^$1 " "$REQLOG" 2>/dev/null; }
body_has() { grep -q "$1" "$REQLOG" && echo yes || echo no; }
run_wd() { # force_up wedged_up_sec
    : > "$REQLOG"
    HOME="$TMP" MARVEEN_ROOT="$TMP/root" TELEGRAM_API_BASE="$API_BASE" \
      TELEGRAM_WATCHDOG_FORCE_AGENT_UP="$1" TELEGRAM_WATCHDOG_WEDGED_UP_SEC="$2" \
      python3 "$WATCHDOG"
}

echo "telegram-watchdog-wedged tests"
echo "=============================="

# ---------------------------------------------------------------------------
# (a) Agent UP + hung reply + past the fast threshold -> deliver REAL answer
# ---------------------------------------------------------------------------
echo ""
echo "(a) Wedged (hung reply): fast, real answer"
PA="$(make_case wa hung 100)"
run_wd 1 1
assert_eq "fires fast: one real-answer sendMessage" "1" "$(count sendMessage)"
assert_eq "delivers the REAL answer text (not a generic error)" "yes" "$(body_has "EZ_A_VALODI_VALASZ")"
assert_eq "clears the placeholder (deleteMessage)" "1" "$(count deleteMessage)"
assert_eq "no generic-error edit" "0" "$(count editMessageText)"
assert_eq "state file removed after handling" "no" "$(pend_exists "$PA")"

# ---------------------------------------------------------------------------
# (b) Agent UP + NO hung reply, before the backstop -> DO NOT touch it
# ---------------------------------------------------------------------------
echo ""
echo "(b) Legit long task (no hung reply): untouched before backstop"
PB="$(make_case wb work 100)"
run_wd 1 1
assert_eq "no delivery for a legitimately working task" "0" "$(count sendMessage)"
assert_eq "no error edit for a working task" "0" "$(count editMessageText)"
assert_eq "placeholder preserved (task still running)" "yes" "$(pend_exists "$PB")"

# ---------------------------------------------------------------------------
# (c) Agent UP + no hung reply but past the 15-min backstop -> fire
# ---------------------------------------------------------------------------
echo ""
echo "(c) Backstop: no hung reply but very old -> fire with real answer"
PC="$(make_case wc work 1000)"   # 1000s > WEDGED_SEC (900)
run_wd 1 1
assert_eq "backstop fires: one delivery" "1" "$(count sendMessage)"
assert_eq "state file removed" "no" "$(pend_exists "$PC")"

# ---------------------------------------------------------------------------
# (d) Agent DOWN + past the down grace -> fire with real answer
# ---------------------------------------------------------------------------
echo ""
echo "(d) Agent down: fire with real answer"
PD="$(make_case wd hung 200)"    # 200s > DOWN_GRACE_SEC (120)
run_wd 0 1
assert_eq "down path fires: one delivery" "1" "$(count sendMessage)"
assert_eq "delivers the real answer" "yes" "$(body_has "EZ_A_VALODI_VALASZ")"

# ---------------------------------------------------------------------------
# (e) Hung reply but NO recoverable answer -> generic error, keep placeholder
# ---------------------------------------------------------------------------
echo ""
echo "(e) Nothing to deliver: falls back to generic error edit"
PE="$(make_case we noans 100)"
run_wd 1 1
assert_eq "no real-answer send (nothing to deliver)" "0" "$(count sendMessage)"
assert_eq "rewrites placeholder into a generic error" "1" "$(count editMessageText)"
assert_eq "error text used" "yes" "$(body_has "Valami elakadt")"

# ---------------------------------------------------------------------------
# TGORPHAN908 cases: stale upper bound + round-scoped answer attribution.
# ---------------------------------------------------------------------------

# Build a case whose transcript carries TIMESTAMPED user prompts (real format).
# layout = delivered | undelivered | foreign
#   delivered:   round-1 prompt @ marker time, answer text + reply call WITH
#                result; then a later internal round with monologue text.
#   undelivered: round-1 prompt @ marker time, answer text, NO reply call;
#                then a later internal round with monologue text.
#   foreign:     only a later round's prompt (nothing at/before marker time).
make_ts_case() { # name layout age_seconds
    local name="$1" layout="$2" age="$3"
    local pdir="$TMP/root/agents/$name/.claude/channels/telegram/progress"
    local sdir="$TMP/root/agents/$name/.claude/channels/telegram"
    mkdir -p "$pdir"
    printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$sdir/.env"
    local tr="$sdir/transcript.jsonl"
    python3 - "$tr" "$layout" "$age" <<'PY'
import datetime, json, sys, time
tr, layout, age = sys.argv[1], sys.argv[2], int(sys.argv[3])
now = time.time()
def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
t1, t2 = now - age, now - age / 2
ev = []
if layout in ("delivered", "undelivered"):
    ev.append({"type": "user", "timestamp": iso(t1),
               "message": {"role": "user", "content": "csatorna-kerdes"}})
    blocks = [{"type": "text", "text": "VALODI_T1_VALASZ a csatornanak"}]
    if layout == "delivered":
        blocks.append({"type": "tool_use", "id": "tuR1",
                       "name": "mcp__plugin_telegram_telegram__reply"})
    ev.append({"type": "assistant", "message": {"role": "assistant", "content": blocks}})
    if layout == "delivered":
        ev.append({"type": "user", "message": {"role": "user",
                   "content": [{"type": "tool_result", "tool_use_id": "tuR1"}]}})
ev.append({"type": "user", "timestamp": iso(t2),
           "message": {"role": "user", "content": "belso scheduled kor"}})
ev.append({"type": "assistant", "message": {"role": "assistant",
           "content": [{"type": "text", "text": "BELSO_NAPLO Szabinak nem kuldtem semmit"}]}})
with open(tr, "w") as f:
    for e in ev:
        f.write(json.dumps(e) + "\n")
PY
    printf '[{"chat_id":"%s","message_id":555,"transcript_path":"%s"}]\n' "$CHAT" "$tr" \
        > "$pdir/SID.json"
    python3 - "$pdir/SID.json" "$age" <<'PY'
import os, sys, time
os.utime(sys.argv[1], (time.time()-int(sys.argv[2]),)*2)
PY
    echo "$pdir"
}

echo ""
echo "(f) Stale (28 days): dropped silently, no API call at all"
PF="$(make_case wf hung $((28 * 86400)))"
run_wd 1 1
assert_eq "no real-answer send for a dead round" "0" "$(count sendMessage)"
assert_eq "no error edit for a dead round" "0" "$(count editMessageText)"
assert_eq "no delete attempt past Telegram's 48h window" "0" "$(count deleteMessage)"
assert_eq "state file removed (cleanup, not collection)" "no" "$(pend_exists "$PF")"

echo ""
echo "(g) Stale but <48h: placeholder deleted, nothing delivered"
PG="$(make_case wg hung 100000)"   # ~27.7h: > 24h stale, < 47h delete window
run_wd 1 1
assert_eq "no real-answer send" "0" "$(count sendMessage)"
assert_eq "no error edit" "0" "$(count editMessageText)"
assert_eq "placeholder deleted while still possible" "1" "$(count deleteMessage)"
assert_eq "state file removed" "no" "$(pend_exists "$PG")"

echo ""
echo "(h) Round's reply already delivered: silent clear, NO resend of anything"
PH="$(make_ts_case wh delivered 1000)"
run_wd 1 1
assert_eq "no resend (answer already reached the channel)" "0" "$(count sendMessage)"
assert_eq "no error edit" "0" "$(count editMessageText)"
assert_eq "internal monologue never sent" "no" "$(body_has "BELSO_NAPLO")"
assert_eq "placeholder cleaned up" "1" "$(count deleteMessage)"
assert_eq "state file removed" "no" "$(pend_exists "$PH")"

echo ""
echo "(i) Answer scoped to the marker's round, not the transcript's last text"
PI="$(make_ts_case wi undelivered 1000)"
run_wd 1 1
assert_eq "backstop fires: one delivery" "1" "$(count sendMessage)"
assert_eq "delivers the marker round's own text" "yes" "$(body_has "VALODI_T1_VALASZ")"
assert_eq "later internal turn's text NOT sent" "no" "$(body_has "BELSO_NAPLO")"
assert_eq "state file removed" "no" "$(pend_exists "$PI")"

echo ""
echo "(j) Timestamped transcript with no prompt at the marker: unattributable"
PJ="$(make_ts_case wj foreign 1000)"
run_wd 1 1
assert_eq "no text delivery (nothing attributable)" "0" "$(count sendMessage)"
assert_eq "internal text NOT leaked" "no" "$(body_has "BELSO_NAPLO")"
assert_eq "falls back to generic error" "1" "$(count editMessageText)"
assert_eq "state file removed" "no" "$(pend_exists "$PJ")"

# ---------------------------------------------------------------------------
# (k) Placeholder older than 48 h: deleteMessage is refused (400) -> the
#     placeholder MUST be edited instead. Without the fallback the "Dolgozom
#     rajta" line stays for ever directly ABOVE the answer we just delivered --
#     a permanent false "still working" marker, which is worse than silence.
#     Measured on the live log 2026-09-10: 14 such 400s in one watchdog run.
# ---------------------------------------------------------------------------
echo ""
echo "(k) Delete refused (>48h): placeholder is EDITED, not left standing"
PK="$(make_case wk hung 100 4444)"
run_wd 1 1
assert_eq "still delivers the real answer" "1" "$(count sendMessage)"
assert_eq "delete was attempted first" "1" "$(count deleteMessage)"
assert_eq "falls back to an edit when delete is refused" "1" "$(count editMessageText)"
# ASCII-only anchor on purpose: the payload says "megérkezett" and an
# unaccented pattern matches NOTHING. This assertion was written unaccented
# first and went red for that reason alone -- the accent blind spot on our own
# meter, caught here only because it is a POSITIVE assertion. "lentebb" is
# ASCII, unique to DELIVERED_TEXT, and absent from ERROR_TEXT.
assert_eq "the edit says the answer arrived (not the generic error)" "yes" "$(body_has "lentebb")"
assert_eq "does NOT reuse the generic error text" "no" "$(body_has "Valami elakadt")"
assert_eq "state file removed (the turn is finished either way)" "no" "$(pend_exists "$PK")"
# Card 3f638239: the log must carry the Bot API's OWN reason, not only "HTTP Error 400".
# The stub answers this case with description "Bad Request: message can't be deleted".
assert_eq "the delete failure is logged WITH the API's reason" "yes" \
  "$(grep -q "placeholder delete failed (mid=4444): HTTP 400: Bad Request: message can't be deleted" "$PK/debug.log" && echo yes || echo no)"

# ---------------------------------------------------------------------------
# Card 4bc31b06: the wedged-backstop measured the time since the PROMPT, not the
# time since the agent last did anything. deeper's batch rounds run 15-40 min
# without a finished answer, so the backstop fired inside nearly every one of
# them -- six times on 2026-09-28 -- and sent Isti whatever text it scraped.
# The live transcript also showed WHICH text: Isti's messages reached the busy
# session as `attachment/queued_command` events (not `type:user` prompts), and a
# compaction summary IS a `type:user` string, so the round was anchored on an
# older prompt and an older report went out. Two placeholders in one marker sent
# that text twice.
#
# Builder: events as JSON on stdin, each with "ago" (seconds before now) turned
# into a real timestamp. Optional 4th arg: a subagent file's age in seconds.
make_ev_case() { # name marker_age_seconds n_placeholders [subagent_age]
    local name="$1" age="$2" n="$3" sub="${4:-}"
    local pdir="$TMP/root/agents/$name/.claude/channels/telegram/progress"
    local sdir="$TMP/root/agents/$name/.claude/channels/telegram"
    mkdir -p "$pdir"
    printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$sdir/.env"
    local tr="$sdir/sess.jsonl"
    python3 -c '
import datetime, json, sys, time
now = time.time()
with open(sys.argv[1], "w") as f:
    for e in json.load(sys.stdin):
        ago = e.pop("ago", None)
        if ago is not None:
            e["timestamp"] = datetime.datetime.fromtimestamp(now - ago, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        f.write(json.dumps(e) + "\n")
' "$tr"
    if [ -n "$sub" ]; then
        mkdir -p "$sdir/sess/subagents"
        echo '{}' > "$sdir/sess/subagents/agent-x.jsonl"
        python3 -c 'import os,sys,time; os.utime(sys.argv[1], (time.time()-int(sys.argv[2]),)*2)' \
            "$sdir/sess/subagents/agent-x.jsonl" "$sub"
    fi
    python3 -c '
import json, sys
print(json.dumps([{"chat_id": sys.argv[1], "message_id": 600 + i, "transcript_path": sys.argv[2]}
                  for i in range(int(sys.argv[3]))]))' "$CHAT" "$tr" "$n" > "$pdir/SID.json"
    python3 -c 'import os,sys,time; os.utime(sys.argv[1], (time.time()-int(sys.argv[2]),)*2)' \
        "$pdir/SID.json" "$age"
    echo "$pdir"
}
TG_TAG='<channel source=\"plugin:telegram:telegram\" chat_id=\"10000000001\" message_id=\"947\">'

echo ""
echo "(l) 30-min round, tool calls every minute: the backstop does NOT fire"
PL="$(make_ev_case wl 1800 1 <<'EOF'
[{"type":"user","ago":1800,"message":{"role":"user","content":"kotegmunka indul"}},
 {"type":"assistant","ago":1700,"message":{"role":"assistant","content":[{"type":"text","text":"KOZTES_ALLAPOT"},{"type":"tool_use","id":"b1","name":"Bash"}]}},
 {"type":"user","ago":1650,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"b1"}]}},
 {"type":"assistant","ago":60,"message":{"role":"assistant","content":[{"type":"tool_use","id":"b2","name":"Bash"}]}},
 {"type":"user","ago":30,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"b2"}]}}]
EOF
)"
run_wd 1 1
assert_eq "no delivery while the agent is still working" "0" "$(count sendMessage)"
assert_eq "no error edit while the agent is still working" "0" "$(count editMessageText)"
assert_eq "placeholder preserved" "yes" "$(pend_exists "$PL")"

echo ""
echo "(l2) CONTROL: the same round, but the agent went quiet 1000 s ago -> fires"
PL2="$(make_ev_case wl2 1800 1 <<'EOF'
[{"type":"user","ago":1800,"message":{"role":"user","content":"kotegmunka indul"}},
 {"type":"assistant","ago":1000,"message":{"role":"assistant","content":[{"type":"text","text":"MEGALLT_KOR_VALASZA"},{"type":"tool_use","id":"b1","name":"Bash"}]}},
 {"type":"user","ago":1000,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"b1"}]}}]
EOF
)"
run_wd 1 1
assert_eq "backstop fires on a genuinely stalled round" "1" "$(count sendMessage)"
assert_eq "delivers that round's text" "yes" "$(body_has "MEGALLT_KOR_VALASZA")"

echo ""
echo "(l3) Inbound messages queued at a stalled session are NOT agent activity"
PL3="$(make_ev_case wl3 1800 1 <<EOF
[{"type":"user","ago":1800,"message":{"role":"user","content":"kotegmunka indul"}},
 {"type":"assistant","ago":1000,"message":{"role":"assistant","content":[{"type":"text","text":"MEGALLT_KOR_VALASZA"}]}},
 {"type":"queue-operation","ago":20,"operation":"enqueue","content":"$TG_TAG kesobbi uzenet"}]
EOF
)"
run_wd 1 1
assert_eq "an enqueue does not keep a stalled round alive" "1" "$(count sendMessage)"

echo ""
echo "(r) Main transcript quiet, but a subagent wrote 30 s ago: does NOT fire"
PR="$(make_ev_case wr 1800 1 30 <<'EOF'
[{"type":"user","ago":1800,"message":{"role":"user","content":"kotegmunka indul"}},
 {"type":"assistant","ago":1000,"message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Task"}]}}]
EOF
)"
run_wd 1 1
assert_eq "no delivery while a subagent works" "0" "$(count sendMessage)"
assert_eq "placeholder preserved" "yes" "$(pend_exists "$PR")"

echo ""
echo "(n) A QUEUED prompt anchors the round: the older report is never sent"
PN="$(make_ev_case wn 1000 1 <<EOF
[{"type":"user","ago":7200,"message":{"role":"user","content":"regi kor"}},
 {"type":"assistant","ago":7000,"message":{"role":"assistant","content":[{"type":"text","text":"REGI_930_JELENTES"}]}},
 {"type":"attachment","ago":1000,"attachment":{"type":"queued_command","prompt":"$TG_TAG uj kerdes"}},
 {"type":"assistant","ago":990,"message":{"role":"assistant","content":[{"type":"text","text":"UJ_KERDES_VALASZA"}]}}]
EOF
)"
run_wd 1 1
assert_eq "one delivery" "1" "$(count sendMessage)"
assert_eq "the queued prompt's own answer is delivered" "yes" "$(body_has "UJ_KERDES_VALASZA")"
assert_eq "the older report is NOT sent" "no" "$(body_has "REGI_930_JELENTES")"

echo ""
echo "(n2) Queued prompt, nothing answered after it: generic error, no old text"
PN2="$(make_ev_case wn2 1000 1 <<EOF
[{"type":"user","ago":7200,"message":{"role":"user","content":"regi kor"}},
 {"type":"assistant","ago":7000,"message":{"role":"assistant","content":[{"type":"text","text":"REGI_930_JELENTES"}]}},
 {"type":"attachment","ago":1000,"attachment":{"type":"queued_command","prompt":"$TG_TAG uj kerdes"}}]
EOF
)"
run_wd 1 1
assert_eq "no text delivery" "0" "$(count sendMessage)"
assert_eq "the older report is NOT sent" "no" "$(body_has "REGI_930_JELENTES")"
assert_eq "generic error instead" "1" "$(count editMessageText)"

echo ""
echo "(n4) Text written just BEFORE the queued prompt is not its answer"
# Inside the anchor slack, so the time floor alone lets it through: only
# reading the queued prompt as the round's opening keeps it out.
PN4="$(make_ev_case wn4 1000 1 <<EOF
[{"type":"user","ago":7200,"message":{"role":"user","content":"regi kor"}},
 {"type":"assistant","ago":1050,"message":{"role":"assistant","content":[{"type":"text","text":"KOZTES_MUNKASZOVEG"}]}},
 {"type":"attachment","ago":1000,"attachment":{"type":"queued_command","prompt":"$TG_TAG uj kerdes"}}]
EOF
)"
run_wd 1 1
assert_eq "the mid-work text is NOT sent as the answer" "no" "$(body_has "KOZTES_MUNKASZOVEG")"
assert_eq "generic error instead" "1" "$(count editMessageText)"

echo ""
echo "(n3) No prompt near the marker at all: text older than the marker is never an answer"
PN3="$(make_ev_case wn3 1000 1 <<'EOF'
[{"type":"user","ago":7200,"message":{"role":"user","content":"regi kor"}},
 {"type":"assistant","ago":7000,"message":{"role":"assistant","content":[{"type":"text","text":"REGI_930_JELENTES"}]}}]
EOF
)"
run_wd 1 1
assert_eq "the older report is NOT sent" "no" "$(body_has "REGI_930_JELENTES")"
assert_eq "generic error instead" "1" "$(count editMessageText)"

echo ""
echo "(o) A compaction inside the round does not end it"
# The compaction lands well past the anchor slack (500 s into the round), where the
# old reading took its summary for the NEXT prompt and closed the window.
PO="$(make_ev_case wo 2000 1 <<'EOF'
[{"type":"user","ago":2000,"message":{"role":"user","content":"csatorna-kerdes"}},
 {"type":"system","ago":1500,"subtype":"compact_boundary"},
 {"type":"user","ago":1500,"isCompactSummary":true,"message":{"role":"user","content":"This session is being continued from a previous conversation."}},
 {"type":"assistant","ago":1490,"message":{"role":"assistant","content":[{"type":"text","text":"TOMORITES_UTANI_VALASZ"}]}}]
EOF
)"
run_wd 1 1
assert_eq "the post-compaction answer is delivered" "yes" "$(body_has "TOMORITES_UTANI_VALASZ")"

echo ""
echo "(p) Two placeholders in one chat: the answer goes out ONCE"
PP="$(make_ev_case wp 1000 2 <<'EOF'
[{"type":"user","ago":1000,"message":{"role":"user","content":"csatorna-kerdes"}},
 {"type":"assistant","ago":990,"message":{"role":"assistant","content":[{"type":"text","text":"EGYSZER_KELL"}]}}]
EOF
)"
run_wd 1 1
assert_eq "exactly one sendMessage" "1" "$(count sendMessage)"
assert_eq "both placeholders removed" "2" "$(count deleteMessage)"
assert_eq "no error edit" "0" "$(count editMessageText)"
# Measurable next time (deeper: the log carried only the label, never the text):
# the sent message's own id, the text's length and a short hash.
assert_eq "the log names the sent message id, length and hash" "yes" \
  "$(grep -qE "sent_mid=9001 len=12 sha=[0-9a-f]{12}" "$PP/debug.log" && echo yes || echo no)"

# ---------------------------------------------------------------------------
echo ""
echo "=============================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -gt 0 ]; then echo "FAILED: $FAIL tests"; exit 1; fi
echo "All tests passed."
