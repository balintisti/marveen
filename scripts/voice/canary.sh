#!/usr/bin/env bash
# Weekly self-test for the voice stack: Piper synthesizes a known Hungarian
# sentence, faster-whisper transcribes it straight back, and the transcript
# is compared to the expected text. Purely local -- no Telegram/network call,
# never touches stt.sh/tts.sh's live state. Exits 0 on pass, 1 on fail/mismatch.
# Usage: canary.sh [voice] [expected text...]   (voice: imre|anna|<path-to-onnx>, default imre)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# WHICH copy of the voice stack do we run? The test must be the venv, NOT
# `_vtools.py`: the installer copies `_vtools.py` next to the wrapper, so it is
# present in BOTH the repo checkout and the install dir. A discriminator that is
# true in both places cannot discriminate -- the repo copy then resolved DEST to
# `scripts/voice`, which the installer never populates, so it could never find an
# installed stack. Measured 2026-08-24 (card 477682a0): with the stack installed
# at the default location, the repo copy still reported it missing.
INSTALLED_DIR="${INSTALL_DIR:-$HOME/.local/share/marveen-voice}"
DEST=""
for _cand in "$SCRIPT_DIR" "$INSTALLED_DIR"; do
  if [[ -x "$_cand/venv/bin/python" && -f "$_cand/_vtools.py" ]]; then DEST="$_cand"; break; fi
done
# Graceful skip when the (opt-in) voice stack is not installed ANYWHERE: a
# missing venv must read as "nothing to test", not as a weekly false-alarm.
# The skip is only honest once BOTH candidates have been looked at -- before
# this fix it fired from the repo path even with the stack installed, so the
# one guard built to catch a missing install could never fire.
if [[ -z "$DEST" ]]; then
  echo "skip: voice stack not installed (no venv at $SCRIPT_DIR or $INSTALLED_DIR)"
  exit 0
fi
VOICE_ARG="${1:-imre}"
if [[ $# -gt 0 ]]; then shift; fi
TEXT="${*:-Ez egy heti hangteszt, minden rendben van.}"
case "$VOICE_ARG" in
  imre)  ONNX="$DEST/voices/hu_HU-imre-medium.onnx" ;;
  anna)  ONNX="$DEST/voices/hu_HU-anna-medium.onnx" ;;
  /*)    ONNX="$VOICE_ARG" ;;
  *)     echo "Unknown voice alias: $VOICE_ARG (use: imre, anna, or absolute path)" >&2; exit 1 ;;
esac
exec "$DEST/venv/bin/python" "$DEST/_vtools.py" canary "$ONNX" "$TEXT"
