#!/usr/bin/env python3
"""PreToolUse gate on Bash: refuse a zsh parameter-expansion FLAG (`${(f)...}`, `${(@f)...}`,
`${(u)...}`) used as CODE, and name the way out (card 8c744138).

WHY (measured 2026-11-13, read-only SQLite + all agents' transcripts): the Claude Code permission
check cannot parse a zsh expansion flag. In the main chain it denies the command at once (20 of 56
uses since 2026-10-05); in a SUB-AGENT it falls back to the prompt "Dangerous rm operation not ruled
out" and PARKS there 10-15 minutes (2 of 25 uses, 3 messages 2026-11-03..13: 10007225, 10016712,
10016793). A refusal here costs one instant rewrite; the parked prompt costs the whole wait.

WHAT IS REFUSED: `${(` in code position: normal context, inside double quotes, inside `$(...)`,
and the body of an UNQUOTED heredoc (`<<EOF`: the shell expands it).
WHAT PASSES (data, not code): single-quoted text, `$'...'`, a `#` comment, a backslash-escaped
`\\${(`, a heredoc body with a QUOTED delimiter (`<<'EOF'`, `<<"EOF"`), every other command.
`${=var}` and `${~var}` are NOT refused: measured 1 denial in 280 uses.

KNOWN LIMITS, stated: `zsh -c '...'` / `bash -c '...'` single-quoted bodies and a script written in
an EARLIER call are not read (the permission check does not read them either). The measured shape
counts classified the first 400 characters of each stored command only. The false-deny cost: 23 of
the 25 sub-agent uses ran fine, so some refusals are not needed; the price is one rewrite.
A scanner misreading nested quoting inside `${...}` can mis-class text; the override covers it.

FAIL-OPEN on an internal error, a bad payload, or a non-Bash tool (exit 0, FAIL-OPEN logged).
Exit 2 = refuse (stderr goes to the model); never exit 1. Override (logged):
MARVEEN_ZSHFLAG_GATE=allow <command>.
"""
import json
import os
import re
import sys
import time

OVERRIDE = re.compile(r'(?:^|[\s;&|(])MARVEEN_ZSHFLAG_GATE=allow\b')
LOG_NAME = 'zsh-flag-gate.log'
FLAG = '${('
BODY_FLAG = re.compile(r'(?<!\\)\$\{\(')
WORD_END = ' \t\n;&|()<>'


def log(kind, detail, command=''):
    try:
        path = os.environ.get('MARVEEN_ZSHFLAG_GATE_LOG') or os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'store', LOG_NAME)
        with open(path, 'a') as fh:
            fh.write('%s %s %s | %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S %Z'), kind, detail,
                                         command.replace('\n', ' ')[:300]))
    except OSError:
        pass


def read_delimiter(cmd, i):
    """cmd[i:] follows `<<`. Returns (delimiter, quoted, strip_tabs, next_index)."""
    n = len(cmd)
    strip_tabs = False
    if i < n and cmd[i] == '-':
        strip_tabs = True
        i += 1
    while i < n and cmd[i] in ' \t':
        i += 1
    quoted = False
    word = ''
    while i < n and cmd[i] not in WORD_END:
        c = cmd[i]
        if c in '\'"':
            quoted = True
            j = cmd.find(c, i + 1)
            if j < 0:
                j = n
            word += cmd[i + 1:j]
            i = j + 1
        elif c == '\\':
            quoted = True
            word += cmd[i + 1:i + 2]
            i += 2
        else:
            word += c
            i += 1
    return word, quoted, strip_tabs, i


def take_body(cmd, i, delim, strip_tabs):
    """cmd[i:] starts the line after the heredoc operator. Returns (body_text, index_after_terminator)."""
    n = len(cmd)
    start = i
    while i <= n:
        j = cmd.find('\n', i)
        line = cmd[i:] if j < 0 else cmd[i:j]
        probe = line.lstrip('\t') if strip_tabs else line
        if probe.rstrip('\r') == delim:
            return cmd[start:i], (n if j < 0 else j + 1)
        if j < 0:
            return cmd[start:], n
        i = j + 1
    return cmd[start:], n


def find_flag(cmd):
    """Index of the first `${(` in code position, or -1."""
    n = len(cmd)
    # frames: ['n', depth] normal context ($( ) frames count parens), ['d'] double-quote context
    stack = [['n', None]]
    pending = []
    i = 0
    while i < n:
        c = cmd[i]
        top = stack[-1]
        if c == '\\':
            i += 2
            continue
        if cmd.startswith(FLAG, i):
            return i
        if top[0] == 'd':
            if c == '"':
                stack.pop()
            elif cmd.startswith('$(', i):
                stack.append(['n', 1])
                i += 1
            i += 1
            continue
        if c == "'":
            j = cmd.find("'", i + 1)
            i = n if j < 0 else j + 1
            continue
        if c == '$' and cmd.startswith("$'", i):
            j = i + 2
            while j < n and cmd[j] != "'":
                j += 2 if cmd[j] == '\\' else 1
            i = j + 1
            continue
        if c == '"':
            stack.append(['d'])
            i += 1
            continue
        if c == '#' and (i == 0 or cmd[i - 1] in ' \t\n;&|('):
            j = cmd.find('\n', i)
            i = n if j < 0 else j
            continue
        if c == '$' and cmd.startswith('$(', i):
            stack.append(['n', 1])
            i += 2
            continue
        if c == '(' and top[1] is not None:
            top[1] += 1
        elif c == ')' and top[1] is not None:
            top[1] -= 1
            if top[1] == 0:
                stack.pop()
        elif c == '<' and cmd.startswith('<<', i) and not cmd.startswith('<<<', i):
            delim, quoted, strip_tabs, i = read_delimiter(cmd, i + 2)
            if delim:
                pending.append((delim, quoted, strip_tabs))
            continue
        elif c == '\n' and pending:
            i += 1
            for delim, quoted, strip_tabs in pending:
                body, after = take_body(cmd, i, delim, strip_tabs)
                if not quoted:
                    m = BODY_FLAG.search(body)
                    if m:
                        return i + m.start()
                i = after
            pending = []
            continue
        i += 1
    return -1


REFUSAL = """ZSH EXPANSION-FLAG GATE: REFUSED -- this command uses a zsh parameter-expansion flag ({shape}) as code (card 8c744138).
WHY: the Claude Code permission check cannot parse a zsh expansion flag. In the main chain it is auto-denied; in a sub-agent it parks on "Dangerous rm operation not ruled out" for 10-15 minutes (3 times 2026-11-03..13).
FIX (rewrite, no flag):
  git diff --name-only ... | while IFS= read -r f; do ...; done
  git status --short | awk '{{print $2}}' | xargs git add --
  list to a file, then python3 or "$(cat file)"; or explicit paths
Text that only MENTIONS the flag: single-quote it, or use a quoted heredoc (<<'EOF').
Override, logged (only if the flag is really needed): MARVEEN_ZSHFLAG_GATE=allow <command>
"""


def main():
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict) or payload.get('tool_name') != 'Bash':
            return 0
        tool_input = payload.get('tool_input')
        command = tool_input.get('command') if isinstance(tool_input, dict) else None
        if not isinstance(command, str) or not command:
            return 0
        pos = find_flag(command)
    except Exception as exc:  # fail open: a gate bug must never block work
        log('FAIL-OPEN', '%s: %s' % (type(exc).__name__, exc), raw)
        return 0
    if pos < 0:
        return 0
    shape = command[pos:pos + 12].replace('\n', ' ')
    if OVERRIDE.search(command):
        log('OVERRIDE', 'at %d' % pos, command)
        sys.stderr.write('zsh expansion-flag gate: allowed by MARVEEN_ZSHFLAG_GATE=allow (logged)\n')
        return 0
    log('DENY', 'at %d' % pos, command)
    sys.stderr.write(REFUSAL.format(shape=shape))
    return 2


if __name__ == '__main__':
    sys.exit(main())
