#!/usr/bin/env bash
# install-skills-snapshot-hook.sh -- wire skills-snapshot-on-write.sh into the
# USER-level Claude Code settings, idempotently.
#
# WHY A SCRIPT AND NOT A VERSIONED settings.json (card de00fd2b, 2026-08-27).
# ~/.claude/settings.json is in no repository and in no snapshot -- the fourth
# unversioned-and-live case measured today. The obvious fix, versioning it, was
# considered and REFUSED: the file carries secret-shaped values (3 hits on
# token|secret|key, 2 long hex blobs, 1 Bearer), and a secret that reaches a git
# history OUTLIVES its rotation. "The repo is local" is itself a measurement,
# and measurements expire.
#
# So this keeps the CAPABILITY rather than the file: the settings can be rebuilt
# on a fresh machine without anyone touching the secrets. Same shape as
# install-launchd-unit.sh, for the same reason.
#
# This does NOT make the rest of settings.json recoverable. That is a separate
# question and belongs on its own card, not smuggled in here.
#
# Usage:
#   install-skills-snapshot-hook.sh            install (or report already-wired)
#   install-skills-snapshot-hook.sh --check    report only, change nothing
#   Removal is by hand: drop the matching entry from the PostToolUse array.
set -euo pipefail

SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The COMMAND points at the main checkout, not at this script's own directory:
# installing from a worktree must still wire the deployed path, or the hook dies
# with the worktree.
HOOK_CMD="${SKILLS_HOOK_CMD:-bash /Users/isti/marveen/scripts/hooks/skills-snapshot-on-write.sh}"
MATCHER="${SKILLS_HOOK_MATCHER:-Bash|Write|Edit|MultiEdit|NotebookEdit}"
TIMEOUT="${SKILLS_HOOK_TIMEOUT:-30}"
MODE="${1:-install}"

[ -f "$SETTINGS" ] || { echo "HIBA: nincs settings fajl: $SETTINGS" >&2; exit 1; }

# The hook script must exist BEFORE it is wired in. A settings entry pointing at
# a missing file is the quiet failure this whole card is about.
HOOK_PATH="${HOOK_CMD##* }"
if [ ! -f "$HOOK_PATH" ]; then
  echo "HIBA: a hook-szkript nem letezik: $HOOK_PATH" >&2
  echo "  (a beolvasztas ELOTT allsz? a telepitest az utan futtasd)" >&2
  exit 1
fi

python3 - "$SETTINGS" "$HOOK_CMD" "$MATCHER" "$TIMEOUT" "$MODE" <<'PY'
import json, os, shutil, sys, time

settings, cmd, matcher, timeout, mode = sys.argv[1:6]
timeout = int(timeout)

with open(settings, encoding='utf-8') as fh:
    raw = fh.read()
data = json.loads(raw)

hooks = data.setdefault('hooks', {})
post = hooks.setdefault('PostToolUse', [])

# BEFORE-COUNT. The point of this number is not the hook we are adding: it is
# every OTHER hook already wired in. If it moves, we broke someone else's.
def entry_count(arr):
    return sum(len(e.get('hooks', [])) for e in arr if isinstance(e, dict))
before_events = {k: entry_count(v) for k, v in hooks.items() if isinstance(v, list)}

already = any(
    any(cmd in str(h.get('command', '')) for h in e.get('hooks', []))
    for e in post if isinstance(e, dict)
)

if already:
    print('skills-snapshot-hook: mar be van kotve -- nem nyultam a fajlhoz')
    sys.exit(0)
if mode == '--check':
    print('skills-snapshot-hook: NINCS bekotve (--check, nem valtoztattam)')
    sys.exit(3)

post.append({
    'matcher': matcher,
    'hooks': [{'type': 'command', 'command': cmd, 'timeout': timeout}],
})

backup = '%s.bak-%s' % (settings, time.strftime('%Y%m%d-%H%M%S'))
shutil.copy2(settings, backup)

tmp = settings + '.tmp'
with open(tmp, 'w', encoding='utf-8') as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
    fh.write('\n')
os.replace(tmp, settings)

# READ BACK FROM DISK. The in-memory object proves nothing about what landed --
# the same lesson as the kanban comment endpoint echoing its own input.
with open(settings, encoding='utf-8') as fh:
    check = json.load(fh)
cpost = check.get('hooks', {}).get('PostToolUse', [])
ok = any(
    any(cmd in str(h.get('command', '')) for h in e.get('hooks', []))
    for e in cpost if isinstance(e, dict)
)
after_events = {k: entry_count(v) for k, v in check.get('hooks', {}).items() if isinstance(v, list)}
expected = dict(before_events)
expected['PostToolUse'] = expected.get('PostToolUse', 0) + 1

if not ok or after_events != expected:
    shutil.copy2(backup, settings)
    print('HIBA: a visszaolvasas nem egyezik -- VISSZAALLITVA a mentesbol', file=sys.stderr)
    print('  vart: %s' % expected, file=sys.stderr)
    print('  kapott: %s' % after_events, file=sys.stderr)
    sys.exit(2)

print('skills-snapshot-hook: bekotve -> %s' % settings)
print('  mentes: %s' % backup)
print('  hook-esemenyek (elotte -> utana): %s -> %s' % (before_events, after_events))
PY
