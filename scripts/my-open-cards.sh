#!/usr/bin/env bash
# my-open-cards.sh <agent> -- the agent's own open cards as [(id8, status), ...].
#
# WHY (card 2e78cf63): the idle wake ([tetlen-or]) used to carry this as a curl + python3 one-liner of
# ~320 characters, in every wake to every agent (195 a week), and with a RELATIVE token path
# (`store/.dashboard-token`) that exists only when the cwd is the install root -- an agent's own
# folder is not. This script is the same measurement with the path resolved from the script's own
# location, so the wake can name it in 60 characters and it works from any cwd.
#
# SAME SET AS THE OLD ONE-LINER: cards assigned to <agent>, status not done/waiting, not archived.
# It is a SNAPSHOT of the board (the wake says so); read-only (GET /api/kanban?assignee=).
#
# Exit: 0 = printed | 1 = the board could not be read (said on stderr, nothing on stdout) | 2 = usage.
# Test overrides: MY_OPEN_CARDS_API, MY_OPEN_CARDS_TOKEN_FILE.
set -uo pipefail
# C locale: in en_US collation the range a-z also matches capitals, and the name check below would pass 'Ford'.
export LC_ALL=C

agent="${1:-}"
case "$agent" in
  ''|*[!a-z0-9_-]*) echo "usage: my-open-cards.sh <agent>   (agent: lowercase letters, digits, - _)" >&2; exit 2 ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
token_file="${MY_OPEN_CARDS_TOKEN_FILE:-$here/../store/.dashboard-token}"
api="${MY_OPEN_CARDS_API:-http://localhost:3420}"

token="$(cat "$token_file" 2>/dev/null)" || { echo "my-open-cards: no dashboard token at $token_file" >&2; exit 1; }
[ -n "$token" ] || { echo "my-open-cards: empty dashboard token at $token_file" >&2; exit 1; }

# The token goes to curl in a -K config from a process substitution, never on the argv: every local user can
# read `ps -eo args=` (card 9ac56d05; src/__tests__/secrets-off-curl-argv.test.ts pins it for tracked scripts).
body="$(curl -sS --max-time 10 -f -K <(printf 'header = "Authorization: Bearer %s"\n' "$token") "$api/api/kanban?assignee=$agent")" \
  || { echo "my-open-cards: the board could not be read ($api)" >&2; exit 1; }

printf '%s' "$body" | AGENT="$agent" python3 -c "
import json, os, sys
agent = os.environ['AGENT']
d = json.load(sys.stdin)
d = d if isinstance(d, list) else d.get('cards', [])
print([(c['id'][:8], c['status']) for c in d
       if c.get('assignee') == agent and c['status'] not in ('done', 'waiting') and not c.get('archived_at')])
" || { echo "my-open-cards: the answer was not a card list" >&2; exit 1; }
