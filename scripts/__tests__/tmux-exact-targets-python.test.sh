#!/bin/bash
# TMUXEXACT for Python (card 394e0971): every list-form tmux call under scripts/
# with a -t target uses the exact form "=NAME:" (via exact_target() or a literal
# starting with "="). tmux resolves a bare -t NAME as a PREFIX when no session has
# that exact name, so watchdog-replay.py's send-keys could type into a sibling
# agent's pane (agent-foo -> agent-foo2).
#
# 1. Scanner (Python AST, not grep): no bare -t target in scripts/**/*.py.
# 2. Positive control: the scanner flags a planted bare call.
# 3. End to end with a REAL tmux, isolated by TMUX_TMPDIR (TMUX unset, socket path
#    checked before anything is touched; kill-server is never called): with only
#    agent-foo2 running, the progress watchdogs report agent-foo as NOT alive.
# Run: bash scripts/__tests__/tmux-exact-targets-python.test.sh

set -u
PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
STARTED=""
cleanup() {
  for s in $STARTED; do
    sock="$(env -u TMUX TMUX_TMPDIR="$TMP" tmux display-message -p -t "=$s:" '#{socket_path}' 2>/dev/null)"
    case "$sock" in *"$(basename "$TMP")"*) env -u TMUX TMUX_TMPDIR="$TMP" tmux kill-session -t "=$s:" 2>/dev/null ;; esac
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "python tmux targets are exact (TMUXEXACT, 394e0971)"

SCAN="$TMP/scan.py"
cat > "$SCAN" <<'PY'
import ast, sys

def exact(node):
    if isinstance(node, ast.Call):
        f = node.func
        return (f.id if isinstance(f, ast.Name) else getattr(f, "attr", "")) == "exact_target"
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value.startswith("=")
    if isinstance(node, ast.JoinedStr) and node.values:
        first = node.values[0]
        return isinstance(first, ast.Constant) and str(first.value).startswith("=")
    return False

bad = []
for path in sys.argv[1:]:
    try:
        tree = ast.parse(open(path, encoding="utf-8").read(), path)
    except SyntaxError:
        continue
    for node in ast.walk(tree):
        if not isinstance(node, (ast.List, ast.Tuple)) or len(node.elts) < 3:
            continue
        head = node.elts[0]
        if not (isinstance(head, ast.Constant) and isinstance(head.value, str)
                and head.value.rsplit("/", 1)[-1] == "tmux"):
            continue
        for i, el in enumerate(node.elts[:-1]):
            if isinstance(el, ast.Constant) and el.value == "-t" and not exact(node.elts[i + 1]):
                bad.append(f"{path}:{node.lineno}")
print("\n".join(bad))
PY

PYFILES=$(cd "$REPO" && find scripts -name '*.py' -not -path '*/node_modules/*' | sort)
OUT="$(cd "$REPO" && python3 "$SCAN" $PYFILES)"
if [ -z "$OUT" ]; then pass "no bare -t tmux target in $(echo "$PYFILES" | wc -l | tr -d ' ') python files"
else fail "bare -t tmux targets: $(echo "$OUT" | tr '\n' ' ')"; fi

cat > "$TMP/planted.py" <<'PY'
import subprocess
subprocess.run(["tmux", "send-keys", "-t", session, "Enter"])
subprocess.run(["/opt/homebrew/bin/tmux", "has-session", "-t", f"agent-{name}"])
subprocess.run(["tmux", "has-session", "-t", exact_target(session)])
subprocess.run(["tmux", "has-session", "-t", f"={name}:"])
PY
CTRL="$(python3 "$SCAN" "$TMP/planted.py" | wc -l | tr -d ' ')"
[ "$CTRL" = "2" ] && pass "control: scanner flags the 2 planted bare targets, not the 2 exact ones" \
  || fail "control: expected 2 flagged lines in the planted file, got $CTRL"

if command -v tmux >/dev/null 2>&1; then
  env -u TMUX TMUX_TMPDIR="$TMP" tmux new-session -d -s agent-foo2 'sleep 300'
  STARTED="agent-foo2"
  SOCK="$(env -u TMUX TMUX_TMPDIR="$TMP" tmux display-message -p -t '=agent-foo2:' '#{socket_path}' 2>/dev/null)"
  case "$SOCK" in
    *"$(basename "$TMP")"*)
      for hook in telegram_progress_watchdog slack_progress_watchdog; do
        R="$(env -u TMUX -u TELEGRAM_WATCHDOG_FORCE_AGENT_UP -u SLACK_WATCHDOG_FORCE_AGENT_UP TMUX_TMPDIR="$TMP" \
          python3 -c 'import importlib.util,sys
spec = importlib.util.spec_from_file_location("h", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m.tmux_session_alive("agent-foo"), m.tmux_session_alive("agent-foo2"))' "$REPO/scripts/hooks/$hook.py" 2>&1)"
        [ "$R" = "False True" ] && pass "$hook: agent-foo absent while agent-foo2 runs (prefix not taken)" \
          || fail "$hook: expected 'False True', got '$R'"
      done
      ;;
    *) fail "isolated tmux socket not under $TMP (got '$SOCK'); nothing probed" ;;
  esac
else
  echo "  SKIP: tmux not installed, end-to-end part not run"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
