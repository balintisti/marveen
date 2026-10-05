#!/usr/bin/env bash
# A FLAG IN THE CONTENT SLOT IS NOT A MESSAGE (friday, 2026-10-05, msg 23761/23763).
#
# WHAT THIS GUARDS. `--force` is the FOURTH argument of agent-msg.sh. Put in the
# third slot (`agent-msg.sh a b --force - <<EOF`), the helper used to send the
# word "--force" as the body, never read STDIN, and print `OK id=` -- the real
# text was lost while the sender believed it had gone. Measured over the whole
# history (23762 messages): 3 such bodies, all "--force", all mistakes, none on
# purpose. Two of them went out on the morning this was written.
#
# Run:  bash scripts/__tests__/agent-msg-flag-as-content.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HELPER="${HELPER_BIN:-$ROOT/scripts/agent-msg.sh}"
FAILS=0; N=0
ok() { N=$((N+1)); if [ "$2" = "0" ]; then echo "PASS  $1"; else echo "FAIL  $1${3:+  -- $3}"; FAILS=$((FAILS+1)); fi; }

# Every "nothing was sent" assertion below would also hold for a missing helper.
[ -r "$HELPER" ] || { echo "FATAL: the helper is missing: $HELPER" >&2; exit 2; }

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/msgflag.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT
BIN="$SANDBOX/bin"; mkdir -p "$BIN"
printf 'test-token\n' > "$SANDBOX/token"

# curl stub: nothing leaves the machine, and every call is RECORDED.
cat > "$BIN/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >> "${CURL_CALLS:-/dev/null}"
printf '{"id":4242}\n200'
STUB
chmod +x "$BIN/curl"
for t in python3 sed tail cat printf date mktemp rm; do
  p="$(command -v "$t" 2>/dev/null)" && ln -sf "$p" "$BIN/$t"
done

send() {  # send <stdin-text> <args after from/to...>
  local in="$1"; shift
  : > "$SANDBOX/calls.txt"
  OUT="$(printf '%s' "$in" | env PATH="$BIN:$PATH" CURL_CALLS="$SANDBOX/calls.txt" \
             MARVEEN_TOKEN_FILE="$SANDBOX/token" \
             /bin/bash "$HELPER" igor hex "$@" 2>"$SANDBOX/err.txt")"
  RC=$?
  ERR="$(cat "$SANDBOX/err.txt")"
  CALLED="$([ -s "$SANDBOX/calls.txt" ] && echo yes || echo no)"
}
sent_body_has() { grep -qF -- "$1" "$SANDBOX/calls.txt"; }

# POSITIVE CONTROL: plain text still goes out, and the stub records it.
send "" "a plain report"
ok "control: plain text is sent" "$([ "$RC" = 0 ] && [ "$CALLED" = yes ] && sent_body_has "a plain report" && echo 0 || echo 1)" "rc=$RC called=$CALLED"
ok "control: the body check can say no" "$(sent_body_has "text that was never sent" && echo 1 || echo 0)"

# THE CASE: --force in the content slot, with the real text on STDIN.
send "the real text that would be lost" --force -
ok "--force as the 3rd argument is refused (exit 3)" "$([ "$RC" = 3 ] && echo 0 || echo 1)" "rc=$RC"
ok "  ...and nothing is sent" "$([ "$CALLED" = no ] && echo 0 || echo 1)"
ok "  ...and the error names the 4th-position form" "$(printf '%s' "$ERR" | grep -qF -- '- --force' && echo 0 || echo 1)" "$ERR"

send "" --force
ok "--force alone is refused, nothing sent" "$([ "$RC" = 3 ] && [ "$CALLED" = no ] && echo 0 || echo 1)" "rc=$RC called=$CALLED"

send "" --anything-else
ok "any single --flag in the content slot is refused" "$([ "$RC" = 3 ] && [ "$CALLED" = no ] && echo 0 || echo 1)" "rc=$RC"

# THE RIGHT FORM still works: content first, --force fourth.
send "the real text" - --force
ok "'- --force' sends the STDIN text" "$([ "$RC" = 0 ] && [ "$CALLED" = yes ] && sent_body_has "the real text" && echo 0 || echo 1)" "rc=$RC called=$CALLED"

# Text that merely STARTS with -- is a message, not a flag.
send "" "--force was the wrong slot, resend please"
ok "multi-word text starting with -- is sent" "$([ "$RC" = 0 ] && [ "$CALLED" = yes ] && echo 0 || echo 1)" "rc=$RC"

# The way out: the bare word itself, on STDIN.
send "--force" -
ok "the bare word on STDIN is sent (the documented way out)" "$([ "$RC" = 0 ] && [ "$CALLED" = yes ] && sent_body_has "--force" && echo 0 || echo 1)" "rc=$RC"

echo "RESULT: $((N-FAILS))/$N passed"
[ "$FAILS" = 0 ]
