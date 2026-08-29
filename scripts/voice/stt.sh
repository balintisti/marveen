#!/usr/bin/env bash
# STT wrapper for the fleet. Transcribes a Telegram voice message (Hungarian).
# Usage: stt.sh <file_id> [state_dir]
# state_dir defaults to the agent's own telegram channel dir (cwd-based) or global.
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
if [[ -z "$DEST" ]]; then
  {
    echo "stt.sh: a hang-futtatokornyezet nincs telepitve."
    echo "  kerestem: $SCRIPT_DIR/venv/bin/python"
    echo "            $INSTALLED_DIR/venv/bin/python"
    echo "  telepites: bash scripts/install-voice.sh"
    echo "  ellenorzes utana: bash scripts/voice/canary.sh   (nem 'skip'-et kell adnia)"
  } >&2
  exit 3
fi
FID="${1:?usage: stt.sh <file_id> [state_dir]}"
STATE_DIR="${2:-$HOME/.claude/channels/telegram}"
exec "$DEST/venv/bin/python" "$DEST/_vtools.py" transcribe "$FID" "$STATE_DIR"
