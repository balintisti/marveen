#!/usr/bin/env bash
# TTS wrapper for the fleet. Synthesizes Hungarian speech and sends it as a
# Telegram voice message via the agent's own bot token.
# Usage: tts.sh <voice> <chat_id> <text...>   (voice: imre|anna|<path-to-onnx>)
# Optional env: VOICE_STATE_DIR (defaults to global telegram channel dir).
set -euo pipefail
# Prefer a toolkit dir that has BOTH _vtools.py AND a usable venv. The source
# tree (scripts/voice) has _vtools.py but no venv -> fall back to the installed
# toolkit at ~/.local/share/marveen-voice which carries the venv.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# WHICH copy of the voice stack do we run? The test must be the venv, NOT
# `_vtools.py`: the installer copies `_vtools.py` next to the wrapper, so it is
# present in BOTH the repo checkout and the install dir. A discriminator that is
# true in both places cannot discriminate -- the repo copy then resolved DEST to
# `scripts/voice`, which the installer never populates, so it could never find an
# installed stack. Measured 2026-08-24 (card 477682a0): with the stack installed
# at the default location, the repo copy still reported it missing.
# Env name: upstream (1129adc4) reads MARVEEN_VOICE_DIR, ours and install-voice.sh
# INSTALL_DIR (voice-dest-resolution.test.ts); both are honoured, upstream's first.
INSTALLED_DIR="${MARVEEN_VOICE_DIR:-${INSTALL_DIR:-$HOME/.local/share/marveen-voice}}"
DEST=""
for _cand in "$SCRIPT_DIR" "$INSTALLED_DIR"; do
  if [[ -x "$_cand/venv/bin/python" && -f "$_cand/_vtools.py" ]]; then DEST="$_cand"; break; fi
done
if [[ -z "$DEST" ]]; then
  {
    echo "tts.sh: a hang-futtatokornyezet nincs telepitve."
    echo "  kerestem: $SCRIPT_DIR/venv/bin/python"
    echo "            $INSTALLED_DIR/venv/bin/python"
    echo "  telepites: bash scripts/install-voice.sh"
    echo "  ellenorzes utana: bash scripts/voice/canary.sh   (nem 'skip'-et kell adnia)"
  } >&2
  exit 3
fi
VOICE_ARG="${1:?usage: tts.sh <voice> <chat_id> <text...>}"; shift
CHAT_ID="${1:?missing chat_id}"; shift
TEXT="$*"
# #915: env overrides, then install-scoped once migrated, then legacy shared.
STATE_DIR="${VOICE_STATE_DIR:-${TELEGRAM_STATE_DIR:-}}"
if [ -z "$STATE_DIR" ]; then
  STATE_DIR="$(cd "$(dirname "$0")/../.." && pwd)/.claude/channels/telegram"
  [ -f "$STATE_DIR/.env" ] || STATE_DIR="$HOME/.claude/channels/telegram"
fi
case "$VOICE_ARG" in
  imre)  ONNX="$DEST/voices/hu_HU-imre-medium.onnx" ;;
  anna)  ONNX="$DEST/voices/hu_HU-anna-medium.onnx" ;;
  /*)    ONNX="$VOICE_ARG" ;;
  *)     echo "Unknown voice alias: $VOICE_ARG (use: imre, anna, or absolute path)" >&2; exit 1 ;;
esac
exec "$DEST/venv/bin/python" "$DEST/_vtools.py" speak "$ONNX" "$STATE_DIR" "$CHAT_ID" "$TEXT"
