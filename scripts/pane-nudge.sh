#!/usr/bin/env bash
# pane-nudge.sh -- type ONE line into an agent's stopped pane and check that a turn started.
# Card 3cf0019f (Isti's yes, TG 9841). The logic is in src/pane-nudge.ts; this file only finds
# the repo root and starts the TypeScript CLI.
#
#   bash scripts/pane-nudge.sh <agent> "<text>" [--dry-run] [--session <tmux-session>]
#   bash scripts/pane-nudge.sh --self-test
#
# It types nothing unless the pane is idle with an empty, visible input box on two reads a
# second apart. It never answers a permission prompt. Exit 0 = a turn started; every refusal
# has its own number (see NUDGE_EXIT in src/pane-nudge.ts). A manual tool: do not call it from a
# timer or a guard (that is card bd1f7b2c's job).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || { echo "pane-nudge: cannot find the repo root" >&2; exit 1; }
cd "$ROOT" || { echo "pane-nudge: cannot enter $ROOT" >&2; exit 1; }
[ -x node_modules/.bin/tsx ] || { echo "pane-nudge: node_modules/.bin/tsx is missing in $ROOT" >&2; exit 1; }
exec node_modules/.bin/tsx scripts/pane-nudge.ts "$@"
