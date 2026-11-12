#!/usr/bin/env python3
"""card-boundary-signal.py -- shows the context guard's stop signal at a card boundary (card 00262e3f).

WHY: an agent that moves its own card out of in_progress with a large context is about to be
restarted fresh by the guard, but only once it stands idle. Nothing tells it so: it picks up the
next card, and the cheap moment is gone. The kanban route decides AT THE MOVE whether the restart
can happen (src/web/card-boundary-signal.ts, decideSignalAtMove) and, if so, leaves a signal file
for the agent. This hook is how the text reaches the agent in the same turn: the move is a Bash
call, and this runs right after it.

HOW (PostToolUse, matcher Bash):
  no <agent>.json in the signal directory ... exit 0, silent. This is every call of every agent
                                              that is not armed, and the cost of the hook.
  a signal, already shown (<agent>.shown) ... exit 0, silent: it is shown ONCE.
  a signal older than SHOW_WINDOW_S ......... exit 0, silent: the facts it rested on are old. The
                                              guard drops it on its next sweep and says so.
  otherwise ................................. write <agent>.shown (the hook's clock, epoch ms),
                                              print the text on stderr, exit 2.

WHAT exit 2 MEANS HERE: in PostToolUse it delivers the stderr text to the model as a
hook_blocking_error (measured for memory-frontmatter-bash-gate.py, 2.1.284). It undoes nothing: the
move has happened. The mark is written BEFORE the text is printed: a text printed with no mark would
come back on every later call.

The hook does not decide anything and does not read the board: the text is whatever the dashboard
wrote. It only checks that the file is this agent's and still fresh.

FAIL-OPEN: any error of the hook itself (stdin, an unreadable file, a mark that cannot be written)
never blocks the call and shows nothing: exit 0 and one line to store/hook-errors.log. This hook
never exits 1.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = 'card-boundary-signal'
# The same number as SHOW_WINDOW_MS in src/web/card-boundary-signal.ts.
SHOW_WINDOW_S = 120


def _log(message, exc=None):
    try:
        sys.path.insert(0, HERE)
        import hook_errlog
        hook_errlog.report(HOOK, message, exc)
    except Exception:
        pass


def _signal_dir():
    override = os.environ.get('CARD_BOUNDARY_SIGNAL_DIR')
    if override:
        return override
    return os.path.join(os.path.realpath(os.path.join(HERE, '..', '..')), 'store', 'card-boundary-signals')


def _outstanding(directory):
    """Agents with a signal file. A missing directory is the normal state: nobody was ever signalled."""
    try:
        names = os.listdir(directory)
    except FileNotFoundError:
        return []
    return [n[:-5] for n in names if n.endswith('.json') and not n.endswith('.answered.json')]


def main():
    directory = _signal_dir()
    outstanding = _outstanding(directory)
    if not outstanding:
        return 0

    # Somebody has a signal. Only from here on is stdin read and anything imported.
    import json
    import re
    import time
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        return 0
    if payload.get('hook_event_name') not in (None, 'PostToolUse'):
        return 0
    sys.path.insert(0, HERE)
    from ledger_lib import agent_id_from_payload
    agent = agent_id_from_payload(payload)
    if not isinstance(agent, str) or not re.match(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$', agent):
        return 0
    if agent not in outstanding:
        return 0

    shown = os.path.join(directory, agent + '.shown')
    if os.path.exists(shown):
        return 0
    with open(os.path.join(directory, agent + '.json'), encoding='utf-8') as fh:
        signal = json.load(fh)
    if not isinstance(signal, dict) or signal.get('agent') != agent:
        return 0
    text = signal.get('text')
    issued = signal.get('issuedAtMs')
    if not isinstance(text, str) or not text.strip() or isinstance(issued, bool) or not isinstance(issued, (int, float)):
        return 0
    now_ms = int(time.time() * 1000)
    if now_ms - issued > SHOW_WINDOW_S * 1000:
        return 0

    tmp = '%s.%d.tmp' % (shown, os.getpid())
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(str(now_ms))
    os.replace(tmp, shown)
    sys.stderr.write(text.rstrip('\n') + '\n')
    return 2


if __name__ == '__main__':
    try:
        code = main()
    except Exception as exc:  # fail-open: the tool call has already run, and nothing was shown
        _log('hook failed, nothing shown', exc)
        code = 0
    sys.exit(code)
