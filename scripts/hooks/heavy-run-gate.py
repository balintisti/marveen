#!/usr/bin/env python3
"""PreToolUse gate on Bash: refuse a FULL test-suite run (jest / vitest / playwright test /
npm test) that is not under scripts/heavy-run.py (card c29f01b7).

WHY (measured 2026-11-03 22:10-22:25 CET): load 96 on 12 cores, swap 9.8 of 10.2 GB, the
dashboard API timing out. Cause: three full suites run OUTSIDE heavy-run.py by one agent's
sub-agents (a jest, a vitest and an `npm test` in three worktrees); the coordinator killed
them by hand. The rule "a full suite only under heavy-run" (card a2090e75) was a habit; this
makes it a gate.

WHAT IS REFUSED: a runner invocation with NO narrowing -- no file / directory / name filter
(a positional, `-t`, `--testPathPattern`, `--grep`, `vitest related`, `xargs` input, ...).
`--testPathIgnorePatterns X` and other ignore/exclude flags do not narrow: what is left is
still the suite. `npm test` / `npm run test*` is full unless a filter follows `--`.
WHAT PASSES: a narrowed run; any run under heavy-run.py, also through a variable or shell
function defined in the same command (`H=(python3 .../heavy-run.py)`, `$HR --label x --`);
list / help / version; a syntax check (`bash -n x.sh`).

WHERE IT LOOKS: every command segment (`;`, `&&`, `||`, `|`, newline), redirections removed;
`bash -c "<code>"`; and a script RUN here (`bash x.sh`, `./x.sh`), read from a heredoc in the
same command or from disk when its path is literal (relative paths against the payload cwd).
A heredoc BODY that is only written is data, not a run.

THE SIMULATION BEFORE THE THRESHOLD (kuszob-elott-szimulalj), all agents' transcripts,
36 203 runner-mentioning Bash commands, since 2026-10-05: 11 823 narrowed, 5 379 under
heavy-run, 443 full (refused, 2.5%), 33 unparseable (pass), 43 meta. Card comment 53816.

KNOWN LIMITS, stated: a script whose path holds a variable (`bash $S/run.sh`) and was written
in an EARLIER call is not read; `npx jest $FILES` counts as narrowed (the variable may be
empty); a full suite started from inside a program (python subprocess, a package script
that is not named test*) is not seen.

FAIL-OPEN on an internal error, an unparseable command, or a missing heavy-run.py (the
correct form must exist before the wrong one is refused). Override (logged):
MARVEEN_HEAVY_GATE=allow <command>.
"""
import json
import os
import re
import shlex
import sys
import time

HEAVY_RUN = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'heavy-run.py')
OVERRIDE = re.compile(r'(?:^|[\s;&|(])MARVEEN_HEAVY_GATE=allow\b')
LOG_NAME = 'heavy-run-gate.log'


def log(kind, detail, command=''):
    try:
        path = os.environ.get('MARVEEN_HEAVY_GATE_LOG') or os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'store', LOG_NAME)
        with open(path, 'a') as fh:
            fh.write('%s %s %s | %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S %Z'), kind, detail,
                                         command.replace('\n', ' ')[:300]))
    except OSError:
        pass

PUNCT = ';&|()<>\n'
SEP_OPS = {';', '&&', '||', '|', '&', '\n', '(', ')', '|&', ';;', ';&', ';;&'}
REDIR = re.compile(r'^[<>&]*[<>][<>&]*$')       # >, >>, 2>, >&, &>, <, <<, <<<
PREFIX_WORDS = {'env', 'time', 'nohup', 'command', 'exec', 'caffeinate', 'nice', 'timeout', 'gtimeout',
                'stdbuf', 'sudo', '!', 'do', 'then', 'else', 'elif', 'if', 'while', 'until', '{', 'builtin'}
SHELLS = {'bash', 'sh', 'zsh'}
DATA_CMDS = {'grep', 'egrep', 'fgrep', 'rg', 'echo', 'printf', 'cat', 'sed', 'awk', 'git', 'ps', 'pgrep',
             'pkill', 'kill', 'killall', 'which', 'type', 'ls', 'tail', 'head', 'find', 'wc', 'sort', 'uniq',
             'cut', 'tr', 'less', 'jq', 'diff', 'test', '[', '[[', 'export', 'alias', 'declare', 'local',
             'read', 'man', 'tee', 'basename', 'dirname', 'curl', 'gh', 'touch', 'mkdir', 'cp', 'mv', 'rm',
             'ln', 'chmod', 'stat', 'file', 'lsof', 'du', 'open', 'npm-why', 'pstree', 'readlink', 'realpath', 'python3', 'python', 'node', 'perl', 'ruby', 'osascript'}
# flags that take a separate value token (so the value is not a positional filter)
VALUE_FLAGS = {
    '--reporter', '--reporters', '--config', '-c', '--root', '-r', '--dir', '--pool', '--maxWorkers',
    '--minWorkers', '-w', '--outputFile', '--environment', '--shard', '--testTimeout', '--project',
    '--mode', '--coverageDirectory', '--coverageReporters', '--selectProjects', '--rootDir', '--workers',
    '-j', '--retries', '--timeout', '--prefix', '--workspace', '--hookTimeout', '--teardownTimeout',
    '--seed', '--globalSetup', '--setupFiles', '--testSequencer', '--max-failures', '-x', '--repeat-each',
    '--output', '--trace', '--maxConcurrency', '--browser', '--testEnvironment', '--coverageProvider',
    '--logHeapUsage', '--projects', '--color', '--colors', '--update-snapshots',
}
IGNORE_FLAG = re.compile(r'(?i)^--[\w.-]*(ignore|exclude)[\w.-]*$')   # --testPathIgnorePatterns X: still full
NARROW_FLAGS = {'-t', '--testNamePattern', '--testPathPattern', '--testPathPatterns', '--findRelatedTests',
                '--related', '--changed', '--onlyChanged', '-o', '--grep', '-g', '--testRegex', '--testMatch',
                '--lastCommit', '--onlyFailures', '-f', '--test-name-pattern', '--only-changed',
                '--last-failed', '--runTestsByPath', '--changedSince'}
META_FLAGS = {'--help', '-h', '--version', '-v', '--listTests', '--showConfig', '--list', '--clearCache'}
META_SUBCMDS = {'list', 'init'}
MAX_SCRIPT_BYTES = 256 * 1024


def heredoc_bodies(cmd):
    """(command with heredoc bodies removed, {target-file-as-written: body})."""
    out, files, lines, i = [], {}, cmd.split('\n'), 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        i += 1
        for _, delim in re.findall(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1", line):
            start = i
            while i < len(lines) and lines[i].strip() != delim:
                i += 1
            body = '\n'.join(lines[start:i])
            i += 1
            m = re.search(r"(?:>|tee\s+(?:-a\s+)?)\s*(['\"]?)([^\s'\";|&<>]+)\1", line.split('<<')[0] + ' ' + line.split(delim, 1)[-1])
            if m:
                files[m.group(2)] = body
    return '\n'.join(out), files


def tokens(cmd):
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=PUNCT)
    lex.whitespace = ' \t\r'
    lex.whitespace_split = True
    lex.commenters = '#'
    return list(lex)


def segments(toks):
    seg = []
    for t in toks:
        if t in SEP_OPS or (t and set(t) <= set(';&|()\n')):
            if seg:
                yield seg
            seg = []
        else:
            seg.append(t)
    if seg:
        yield seg


def drop_redirections(seg):
    """Remove redirection operators with their target (`> f`, `2>&1`, `&> f`, `< f`)."""
    out, i = [], 0
    while i < len(seg):
        t = seg[i]
        if REDIR.match(t):
            if out and out[-1].isdigit():          # the fd number of `2>`
                out.pop()
            i += 2                                  # the operator and its target (`1` of `>&1` too)
            continue
        out.append(t)
        i += 1
    return out


def _runner(seg, i):
    """If seg[i:] starts a runner (after npx/npm exec), return (kind, args); else None."""
    w = seg[i]
    base = w.rsplit('/', 1)[-1]
    if base in ('npx', 'bunx', 'pnpx'):
        i += 1
        while i < len(seg) and seg[i].startswith('-'):
            i += 1
        if i >= len(seg):
            return None
        w = seg[i]
        base = w.rsplit('/', 1)[-1]
    elif base == 'npm' and i + 1 < len(seg) and seg[i + 1] == 'exec':
        i += 2
        while i < len(seg) and seg[i].startswith('-'):
            i += 1
        if i >= len(seg):
            return None
        w = seg[i]
        base = w.rsplit('/', 1)[-1]
    if base in ('vitest', 'jest'):
        return base, seg[i + 1:]
    if base == 'playwright' and i + 1 < len(seg) and seg[i + 1] == 'test':
        return 'playwright', seg[i + 2:]
    if base in ('npm', 'yarn', 'pnpm'):
        j = i + 1
        while j < len(seg) and seg[j].startswith('-'):
            j += 2 if seg[j] in ('--prefix', '-w', '--workspace', '-C', '--dir', '--filter') else 1
        if j < len(seg) and seg[j] in ('test', 't', 'tst'):
            return 'npm-test', seg[j + 1:]
        if j < len(seg) and seg[j] in ('run', 'run-script') and j + 1 < len(seg) and seg[j + 1].startswith('test'):
            return 'npm-test', seg[j + 2:]
        if base in ('yarn', 'pnpm') and j < len(seg) and seg[j].startswith('test'):
            return 'npm-test', seg[j + 1:]
    return None


def judge(kind, args):
    if kind == 'npm-test':
        if '--' not in args:                       # only what follows `--` reaches the runner
            return 'full'
        args = args[args.index('--') + 1:]
    if kind == 'vitest' and args and args[0] in META_SUBCMDS:
        return 'meta'
    if kind == 'vitest' and args and args[0] in ('run', 'watch', 'related', 'dev', 'bench'):
        if args[0] == 'related':
            return 'narrowed'
        args = args[1:]
    k = 0
    while k < len(args):
        a = args[k]
        flag = a.split('=', 1)[0]
        if flag in META_FLAGS:
            return 'meta'
        if flag in NARROW_FLAGS:
            return 'narrowed'
        if a.startswith('-'):
            takes_value = flag in VALUE_FLAGS or IGNORE_FLAG.match(flag)
            if '=' not in a and takes_value and k + 1 < len(args) and not args[k + 1].startswith('-'):
                k += 2
                continue
            k += 1
            continue
        return 'narrowed'                          # a positional = a file / path filter
    return 'full'


VAR_REF = re.compile(r'^\$\{?=?([A-Za-z_][A-Za-z0-9_]*)\}?$')   # $H ${H} ${=H} $=H (zsh split)


def wrapper_names(cmd):
    """Variables and shell functions defined in this command whose text runs heavy-run.py."""
    names = set()
    assign = re.compile(r"""(?:^|[\s;&|(])(?:export\s+|local\s+)?([A-Za-z_][A-Za-z0-9_]*)=(\([^)]*\)|"[^"]*"|'[^']*'|\S*)""")
    for m in assign.finditer(cmd):
        val = m.group(2).strip('"\'()')
        ref = VAR_REF.match(val.split()[0]) if val.split() else None
        if 'heavy-run.py' in val or (ref and ref.group(1) in names):
            names.add(m.group(1))
    for m in re.finditer(r'(?:^|[\s;&|(])(?:function\s+)?([A-Za-z_][A-Za-z0-9_-]*)\s*\(\)\s*\{', cmd):
        depth, j = 0, m.end() - 1
        while j < len(cmd):
            depth += {'{': 1, '}': -1}.get(cmd[j], 0)
            if depth == 0:
                break
            j += 1
        if 'heavy-run.py' in cmd[m.end():j] or any(n in cmd[m.end():j] for n in names if n):
            names.add(m.group(1))
    return names


def classify(cmd, depth=0, scripts=None, wrappers=None, cwd=None):
    body, files = heredoc_bodies(cmd)
    scripts = dict(scripts or {}, **files)
    wrappers = set(wrappers or ()) | wrapper_names(cmd)
    try:
        toks = tokens(body)
    except ValueError:
        return [('unparsed', cmd[:200])]
    found = []
    for raw in segments(toks):
        seg = drop_redirections(raw)
        if not seg:
            continue
        text = ' '.join(seg)
        # walk the command position past assignments, prefixes and the heavy-run wrapper
        i, wrapped = 0, False
        while i < len(seg):
            w, base = seg[i], seg[i].rsplit('/', 1)[-1]
            if re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', w):
                i += 1
            elif base == 'heavy-run.py' or w in wrappers or (VAR_REF.match(w) and VAR_REF.match(w).group(1) in wrappers):
                wrapped = True
                i += 1
                while i < len(seg) and seg[i].startswith('-'):
                    i += 2 if seg[i] == '--label' else 1
            elif base in ('python3', 'python') and i + 1 < len(seg) and seg[i + 1].endswith('heavy-run.py'):
                i += 1
            elif base in PREFIX_WORDS:
                i += 1
                while i < len(seg) and (seg[i].startswith('-') or re.match(r'^\d+[smhd]?$', seg[i])):
                    i += 1
            else:
                break
        if i >= len(seg):
            continue
        base = seg[i].rsplit('/', 1)[-1]
        if base in ('cd', 'pushd') and i + 1 < len(seg) and '$' not in seg[i + 1] and cwd is not None:
            cwd = os.path.normpath(os.path.join(cwd, os.path.expanduser(seg[i + 1])))
            continue
        # nested shell code: bash -c "<code>"
        if base in SHELLS and i + 2 < len(seg) and seg[i + 1] in ('-c', '-lc', '-ec', '-xc') and depth < 3:
            inner = classify(seg[i + 2], depth + 1, scripts, wrappers, cwd)
            found += [('wrapped', s) if wrapped and v == 'full' else (v, s) for v, s in inner]
            continue
        # a script file run here: written by a heredoc in this same command, or already on disk
        target = None
        if base in SHELLS:
            j = i + 1
            flags = []
            while j < len(seg) and seg[j].startswith('-'):
                flags.append(seg[j])
                j += 1
            if any(f.startswith('-') and not f.startswith('--') and 'n' in f for f in flags):
                continue                            # `bash -n x.sh`: a syntax check runs nothing
            target = seg[j] if j < len(seg) else None
        elif re.search(r'\.(sh|bash|zsh)$', seg[i]) or seg[i] in scripts:
            target = seg[i]
        if target and depth < 3:
            code = scripts.get(target)
            if code is None:                        # `$PWD/x.sh` run, `x.sh` written: match by file name
                same = [v for k, v in scripts.items() if k.rsplit('/', 1)[-1] == target.rsplit('/', 1)[-1]]
                code = same[0] if len(same) == 1 else None
            path = os.path.join(cwd or '', os.path.expanduser(target))
            if code is None and '$' not in target and os.path.isfile(path):
                try:
                    if os.path.getsize(path) <= MAX_SCRIPT_BYTES:
                        code = open(path, errors='replace').read()
                except OSError:
                    code = None
            if code is not None:
                inner = classify(code, depth + 1, scripts, wrappers, cwd)
                found += [('wrapped', s) if wrapped and v == 'full' else (v, s) for v, s in inner]
            continue
        if base == 'xargs':
            r = None
            for j in range(i + 1, len(seg)):
                r = r or _runner(seg, j)
            if r:
                found.append(('wrapped' if wrapped else 'narrowed', text))   # xargs appends a file list
            continue
        r = _runner(seg, i)
        if r is None and base not in DATA_CMDS:
            # a runner passed as arguments (a shell function `step jest "$D" npx jest`, xargs, ...)
            for j in range(i + 1, len(seg)):
                if seg[j].rsplit('/', 1)[-1] == 'heavy-run.py' or seg[j] in wrappers or (VAR_REF.match(seg[j]) and VAR_REF.match(seg[j]).group(1) in wrappers):
                    wrapped = True
                b = seg[j].rsplit('/', 1)[-1]
                # a bare `jest` word here is a label (`step jest ...`); only a launcher or a .bin path starts one
                if b in ('npx', 'npm', 'yarn', 'pnpm', 'bunx') or (b in ('vitest', 'jest') and '/' in seg[j]):
                    r = _runner(seg, j)
                    if r:
                        break
        if r is None:
            continue
        kind, args = r
        found.append(('wrapped' if wrapped else judge(kind, args), text))
    return found


def refused(cmd):
    return [s for v, s in classify(cmd) if v == 'full']


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        log('FAIL-OPEN', 'unparseable hook payload: %s' % exc)
        sys.exit(0)
    if str(payload.get('tool_name') or '') != 'Bash':
        sys.exit(0)
    try:
        command = str((payload.get('tool_input') or {}).get('command') or '')
        # a script run here (`bash x.sh`, `./x.sh`) may hold the runner even if its path does not
        if not re.search(r'vitest|jest|playwright|test|\.(?:sh|bash|zsh)\b|\b(?:bash|sh|zsh)\b', command):
            sys.exit(0)
        if not os.path.isfile(HEAVY_RUN):
            log('FAIL-OPEN', 'heavy-run.py missing at %s' % HEAVY_RUN, command)
            sys.exit(0)
        found = classify(command, cwd=str(payload.get('cwd') or '') or os.getcwd())
        if any(v == 'unparsed' for v, _ in found):
            log('FAIL-OPEN', 'unparseable shell syntax', command)
        full = [s for v, s in found if v == 'full']
        if not full:
            sys.exit(0)
        if OVERRIDE.search(command):
            log('OVERRIDE', '; '.join(full), command)
            sys.stderr.write('HEAVY-RUN GATE: allowed by MARVEEN_HEAVY_GATE=allow (logged).\n')
            sys.exit(0)
        log('DENY', '; '.join(full), command)
    except SystemExit:
        raise
    except Exception as exc:
        log('FAIL-OPEN', 'internal error: %r' % exc)
        sys.exit(0)
    sys.stderr.write(
        'HEAVY-RUN GATE: REFUSED -- a FULL test suite outside heavy-run.py (card c29f01b7).\n\n'
        + '\n'.join('  - %s' % s[:200] for s in full)
        + '\n\n'
        'A full suite runs only under the fleet limit (2026-11-03: three of them at once took the\n'
        'machine to load 96 and 10 GB swap). The correct form, with the Bash tool\'s\n'
        'run_in_background:\n'
        '    python3 %s --label "<agent> <card> <what>" -- <the command above>\n'
        'Add --short only if it ends within 15 minutes. A NARROWED run passes without the wrapper:\n'
        'name the test files / directories, or -t / --testPathPattern / --grep.\n'
        'If the suite really must run outside the limit (your responsibility, logged):\n'
        '    MARVEEN_HEAVY_GATE=allow <the command>\n' % HEAVY_RUN
    )
    sys.exit(2)


if __name__ == '__main__':
    main()
