#!/usr/bin/env bash
# seat-set.sh -- move ONE agent's model and/or Claude plan, verified on the new process.
# Card 336501d7. The logic is in src/seat-set.ts; this file only finds the repo root and starts
# the TypeScript CLI.
#
#   bash scripts/seat-set.sh <agent> [--model <id>] [--plan elso|masodik]            (dry run)
#   bash scripts/seat-set.sh <agent> --model <id> --plan masodik --apply --by <who>  (write)
#   bash scripts/seat-set.sh <agent> --verify     (read-only: does the RUNNING process hold the config's seat?)
#
# Dry run is the default. It never restarts a busy pane (config written, exit 10: takes effect at
# next restart), never prints a token, never writes a token file, and refuses marveen, unknown
# agents/models and anything that is not a plan. Exit codes: see SEAT_EXIT in src/seat-set.ts.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || { echo "seat-set: cannot find the repo root" >&2; exit 1; }
cd "$ROOT" || { echo "seat-set: cannot enter $ROOT" >&2; exit 1; }
[ -x node_modules/.bin/tsx ] || { echo "seat-set: node_modules/.bin/tsx is missing in $ROOT" >&2; exit 1; }
exec node_modules/.bin/tsx scripts/seat-set.ts "$@"
