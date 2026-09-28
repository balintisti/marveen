#!/usr/bin/env bash

# EZ DIAGNOSZTIKAI ESZKOZ, NEM A PRODUKCIOS UT (kartya 477682a0, marveen dontese 2026-08-28).
#
# A HANG-ATIRAT PRODUKCIOS UTJA EZ:
#     src/web/message-router.ts:668  ->  callVoiceSTT()
#     -> src/web/routes/voice.ts     ->  transcribeVoiceFile()
#     -> ~/.local/share/marveen-voice/venv/bin/python  _vtools.py transcribe
# Ez a szkript ott NEM szerepel. Merve 2026-08-28, PONTOS nevre keresve (`stt\.sh`, nem
# reszkarakterlanc): csak a sajat lancolata hivja -- install-voice.sh, canary.sh, _vtools.py --
# es egy teszt. Nulla produkcios fogyaszto.
#
# EZERT A HIBAUZENETE RENDBEN VAN, sot ez a helyes viselkedes: ha a venv nincs meg, HANGOSAN
# elhasal es MEGNEVEZI mindket keresett utat. Egy diagnosztikai eszkoznek pontosan ezt kell
# tennie -- a csendes "nem talaltam semmit" lenne a hiba.
#
# HA A HANG-ATIRAT NEM MUKODIK, ez a szkript NEM a javitando pont: a produkcios utat kell
# megnezni (a fenti lanc), es a telepitest (`scripts/install-voice.sh`).
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
# Env name: upstream (1129adc4) reads MARVEEN_VOICE_DIR, ours and install-voice.sh
# INSTALL_DIR (voice-dest-resolution.test.ts); both are honoured, upstream's first.
INSTALLED_DIR="${MARVEEN_VOICE_DIR:-${INSTALL_DIR:-$HOME/.local/share/marveen-voice}}"
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
# #915: arg, then env override, then install-scoped once migrated, then legacy.
STATE_DIR="${2:-${TELEGRAM_STATE_DIR:-}}"
if [ -z "$STATE_DIR" ]; then
  STATE_DIR="$(cd "$(dirname "$0")/../.." && pwd)/.claude/channels/telegram"
  [ -f "$STATE_DIR/.env" ] || STATE_DIR="$HOME/.claude/channels/telegram"
fi
exec "$DEST/venv/bin/python" "$DEST/_vtools.py" transcribe "$FID" "$STATE_DIR"
