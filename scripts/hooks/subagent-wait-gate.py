#!/usr/bin/env python3
"""PreToolUse gate on Bash: a SUB-AGENT may not start one call that can outlive its
5-minute prompt cache (card b6035163).

WHY (measured 2026-11-12, 574 sub-agent transcripts, 9.5 days, 22 698 sub-agent Bash calls):
a sub-agent's prompt cache lives 5 minutes. When ONE tool call keeps it silent for longer,
the next request re-writes its whole context at 1.25x instead of reading it at 0.1x. 341 such
re-writes cost 70.6 weighted million tokens (3.1% of the fleet in the audited week), and 313
of them (92%) had the same cause: a foreground Bash call that asked for a timeout above 4.5
minutes and really ran past it (a test run, a wait loop). The rule "a sub-agent works, it does
not wait" existed and was not kept, so this makes it a gate.

WHAT IS REFUSED: a Bash call made BY A SUB-AGENT whose `timeout` is above LIMIT_MS, unless
it is `run_in_background` (that call returns at once; 0 re-writes followed one).
WHO IS A SUB-AGENT: the PreToolUse payload of a Task/Agent-tool child carries `agent_id`
and `agent_type`; the main session's payload carries neither (scripts/hooks/egress-gate.mjs
reads the same pair). A payload with neither is the main session and PASSES: the main
session's cache is the 1-hour one, a long call does not cost it a re-write.
MEASURED LIVE (2026-11-12, Claude Code 2.1.314): a general-purpose child's Bash call with a
300 000 ms timeout was refused and logged with its agent_type, its 60 000 ms call ran, and the
main session's own 300 000 ms call ran. NO TEST CAN PIN THIS: if an upgrade renames the two
fields, the gate refuses nobody and every test stays green. Measure it again after an
upgrade; a DENY count that falls to zero is the first thing to distrust.

WHERE IT IS WIRED: templates/settings.json.template, the PreToolUse Bash group, so every
fleet agent's settings get it at the next dashboard start (ensureAgentHooks). NOT in the main
agent's tracked project settings: none of the 341 re-writes came from its children.

REFUSED, NOT CAPPED: lowering the timeout behind the caller's back would kill a 6-minute
run at 4.5 minutes, which is lost work. A refusal costs one round and nothing has started.
THE WAY OUT is in the message: ask for less if it fits; if it does not, start it detached
and look at it with short calls (each look is a cache READ and resets the 5 minutes), or
hand the command back to the parent.

THE SIMULATION BEFORE THE THRESHOLD (kuszob-elott-szimulalj), same corpus: the rule refuses
1 525 calls, 348 of which really ran past the limit; it catches 313 of the 341 re-writes.
NOT COVERED, stated: a parent that re-opens a finished sub-agent after 5 minutes (22 of the
341); a call that runs long on a timeout it did not ask for (5); a tool other than Bash.

FAIL-OPEN: an unreadable payload or an internal error lets the call through and writes a
FAIL-OPEN line. This gate saves tokens; it must never be the reason work stops.

LOG: store/subagent-wait-gate.log (MARVEEN_SUBAGENT_WAIT_GATE_LOG overrides it), one line per
DENY and per FAIL-OPEN. The count of DENY lines is the gate's own uptake meter.
"""
import json
import os
import sys
import time

# 4.5 minutes: half a minute under the cache's 5, because the gap that matters runs from the
# request that STARTS the call to the request that follows it, and that includes model time.
LIMIT_MS = 270000
LOG_NAME = 'subagent-wait-gate.log'


def log(kind, detail, command=''):
    try:
        path = os.environ.get('MARVEEN_SUBAGENT_WAIT_GATE_LOG') or os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'store', LOG_NAME)
        with open(path, 'a') as fh:
            fh.write('%s %s %s | %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S %Z'), kind, detail,
                                         command.replace('\n', ' ')[:300]))
    except OSError:
        pass


def is_sub_agent(payload):
    """True only for a Task/Agent-tool child: either marker present and non-empty."""
    return bool(str(payload.get('agent_id') or '').strip() or str(payload.get('agent_type') or '').strip())


def timeout_ms(tool_input):
    """The requested timeout as a number, or None when there is none to judge.

    A numeric string is read as its number: the tool schema wants a number, but a gate that
    only knows one spelling is a gate with a way round it.
    """
    value = tool_input.get('timeout')
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def decide(payload):
    """(refuse, requested_ms). Pure: the tests drive this and the process both."""
    if str(payload.get('tool_name') or '') != 'Bash':
        return False, None
    if not is_sub_agent(payload):
        return False, None
    tool_input = payload.get('tool_input')
    if not isinstance(tool_input, dict):
        # A sub-agent's Bash call the gate cannot read: main() lets it through and says so.
        raise ValueError('tool_input is %s, not an object' % type(tool_input).__name__)
    if tool_input.get('run_in_background') is True:
        return False, None
    requested = timeout_ms(tool_input)
    if requested is None or requested <= LIMIT_MS:
        return False, requested
    return True, requested


def shown(requested):
    """A number for the message and the log; never raises (int(inf) would)."""
    try:
        return str(int(requested))
    except (OverflowError, ValueError):
        return str(requested)


def message(requested):
    return (
        'SUB-AGENT WAIT GATE: REFUSED -- this Bash call asks for a timeout of %s ms, and a\n'
        'sub-agent call may not be able to outlive the 5-minute prompt cache (limit %d ms,\n'
        'card b6035163). Nothing was started.\n\n'
        'WHY: when one call keeps you silent for more than 5 minutes, your next request\n'
        're-writes your whole context instead of reading it from the cache.\n\n'
        'WHAT TO DO:\n'
        '  1. It ends within 4.5 minutes: send the SAME command with "timeout": %d or less.\n'
        '  2. It may take longer (a test suite, a build, waiting on something): do NOT just\n'
        '     lower the timeout, the run would be killed half way. Either\n'
        '       a) start it detached, with its output and a DONE marker in files:\n'
        '            nohup sh -c \'<command> > run.log 2>&1; echo $? > run.DONE\' >/dev/null 2>&1 &\n'
        '          then look at it with separate short calls (each at most 4.5 minutes; every\n'
        '          call you make resets the 5 minutes), or\n'
        '       b) finish your turn now and hand the command back to your parent: say what to\n'
        '          run and what to read from its output.\n'
        % (shown(requested), LIMIT_MS, LIMIT_MS)
    )


def main():
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError('payload is %s, not an object' % type(payload).__name__)
    except Exception as exc:
        log('FAIL-OPEN', 'unparseable hook payload: %s' % exc)
        sys.exit(0)
    try:
        refuse, requested = decide(payload)
        if not refuse:
            sys.exit(0)
        tool_input = payload.get('tool_input') or {}
        log('DENY', 'timeout=%s agent_type=%s' % (shown(requested), str(payload.get('agent_type') or '?')[:40]),
            str(tool_input.get('command') or ''))
    except SystemExit:
        raise
    except Exception as exc:
        log('FAIL-OPEN', 'could not judge the call: %r' % exc)
        sys.exit(0)
    sys.stderr.write(message(requested))
    sys.exit(2)


if __name__ == '__main__':
    main()
