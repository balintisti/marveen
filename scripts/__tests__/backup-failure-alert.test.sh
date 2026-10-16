#!/usr/bin/env bash
# backup.sh's failure alert must REACH THE SEND: when verification fails (exit 6)
# the alert goes through the real scripts/agent-msg.sh and ends as a POST to
# /api/messages. The call's stdout and stderr are swallowed on purpose, so a
# refused call (e.g. a positional body, exit 5 since card 16d66942) would lose
# the alert about a failed backup without a trace. Synthetic repo, a recording
# HTTP server on a free localhost port, no real dashboard, no real store.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../backup.sh"
MSG="$HERE/../agent-msg.sh"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 -- got '$2', want '$3'"; fail=$((fail+1)); fi; }

T="$(mktemp -d "${TMPDIR:-/tmp}/bk-alert.XXXXXX")"
SRV_PID=""
cleanup() { [ -n "$SRV_PID" ] && { kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; }; chmod -R u+rw "$T" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

# Recording server: every request becomes one JSON line in $T/requests.jsonl.
# GET answers an empty list, POST /api/messages answers an accepted row.
cat > "$T/srv.py" <<'PY'
import http.server, json, sys
log, portfile = sys.argv[1], sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def _rec(self, body):
        with open(log, "a") as f:
            f.write(json.dumps({"method": self.command, "path": self.path, "body": body}) + "\n")
    def do_GET(self):
        self._rec("")
        self._send(b"[]")
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        self._rec(self.rfile.read(n).decode("utf-8", "replace"))
        self._send(json.dumps({"id": 4242, "status": "pending"}).encode())
    def _send(self, b):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)
    def log_message(self, *a):
        pass
s = http.server.HTTPServer(("127.0.0.1", 0), H)
open(portfile, "w").write(str(s.server_address[1]))
s.serve_forever()
PY
python3 "$T/srv.py" "$T/requests.jsonl" "$T/port" & SRV_PID=$!
for _ in $(seq 1 50); do [ -s "$T/port" ] && break; sleep 0.1; done
PORT="$(cat "$T/port" 2>/dev/null)"
[ -n "$PORT" ] || { echo "FAIL recording server did not start"; exit 1; }

R="$T/repo"
mkdir -p "$R/scripts" "$R/store/sub" "$R/home/.claude/skills/x" "$R/home/.claude/scheduled-tasks/y"
echo s > "$R/home/.claude/skills/x/SKILL.md"; echo s > "$R/home/.claude/scheduled-tasks/y/SKILL.md"
echo db > "$R/store/claudeclaw.db"
echo test-token > "$T/token"
cp "$SRC" "$R/scripts/backup.sh"; cp "$MSG" "$R/scripts/agent-msg.sh"; chmod +x "$R/scripts/agent-msg.sh"
git -C "$R" init -q && git -C "$R" add -A && git -C "$R" -c user.name=t -c user.email=t@t commit -qm init
# An unreadable file makes staging incomplete -> verification fails -> exit 6 + alert.
echo x > "$R/store/sub/unreadable.txt"; chmod 000 "$R/store/sub/unreadable.txt"

( cd "$R" && HOME="$R/home" BACKUP_DIR="$R/bk" KEEP=1 \
    MARVEEN_API_BASE="http://127.0.0.1:$PORT" MARVEEN_TOKEN_FILE="$T/token" \
    bash scripts/backup.sh >"$T/out.log" 2>&1 ); rc=$?
chmod 600 "$R/store/sub/unreadable.txt"

check "failed verification -> exit 6" "$rc" "6"
POSTS="$(python3 - "$T/requests.jsonl" <<'PY'
import json, sys
n = 0
try:
    for line in open(sys.argv[1]):
        r = json.loads(line)
        if r["method"] != "POST" or r["path"] != "/api/messages":
            continue
        b = json.loads(r["body"])
        if b.get("to") == "marveen" and "[MENTES]" in b.get("content", "") and "ELBUKOTT" in b.get("content", ""):
            n += 1
except FileNotFoundError:
    pass
print(n)
PY
)"
check "  ... and the alert reached POST /api/messages, addressed to the main agent" "$POSTS" "1"
check "  ... and backup.sh did not report a queueing failure" "$(grep -c 'could not queue the failure alert' "$T/out.log")" "0"

echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
