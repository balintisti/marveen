#!/usr/bin/env python3
"""PreToolUse gate: refuse a write that pushes MEMORY.md past the loader's cut.

WHY THIS EXISTS (card c837502c, didi's finding d85cfbb4 c8). The index overflow rule had
two steps -- shorten your own hook, then `--evict` with the helper -- and NEITHER FIRES AT
WRITE TIME. Measured 2026-09-05, four consecutive 30-minute samples ABOVE the ceiling and
monotonically rising (+26, +189, +452, +648), and every session started in that window
loaded a TRUNCATED index.

And the failure is SILENT TO THE WRITER: the "Only part of it was loaded" warning goes to
the NEXT READER, in a DIFFERENT session. The writer sees nothing. A rule that fires at
write time catches the careless; a rule with no gate at all catches nobody, because at the
moment of the decision it is not present.

The helpers (`memory-index-add.py`, `-trim.py`, `-fold.py`) hold a flock and enforce the
ceiling themselves. This gate exists for the paths that BYPASS them: a Write/Edit tool call
or a shell redirect straight at the file.

=== THE THRESHOLD IS 24934, NOT 25000, AND THAT IS FAIL-CLOSED

The loader's cut is a WINDOW, not a point -- measured [24934, 25037] -- and the nominal
LIMIT=25000 sits INSIDE it. A gate set to 25000 is up to 66 characters TOO LOOSE: it would
pass a write that lands in the band, where the loader MAY already cut, and the cut does not
announce itself. A gate that stands in the middle of an uncertainty window passes silently
in the window's lower half. So the gate takes the window's LOWER bound.

=== WHY THE TARGET IS MATCHED BY realpath AND NOT BY NAME

Measured 2026-09-06: TEN paths reach this one file (inode 26787002) -- the canonical
`~/.claude/projects/.../memory/MEMORY.md`, two worker homes, six
`agents/<name>/.claude-config/...` symlinks, and the coordinator's
`marveen/.channels-config/...`. A gate anchored on any single string is bypassed by the
other nine.

The mirror error is worse: the same tree holds **50 OTHER `MEMORY.md` files** on DIFFERENT
inodes (sajat-crm, angol-tanulas, edzes-alkalmazas, the Google Drive projects). A gate that
matched the BASENAME would fire on all of them -- 50 false positives on legitimate work in
other projects. realpath is what separates the ten from the fifty.

AND THE COUNT ITSELF IS THE ARGUMENT FOR NOT USING A LIST. Both of my enumerations were
undercounts, by two DIFFERENT mechanisms: `glob` skips dot-directories, so it missed the
coordinator's `.channels-config` (nine, not ten); `os.walk` does not follow symlinks, so it
saw ONE. Neither failure would have announced itself. This gate never enumerates -- it asks
`realpath`, one path at a time -- so a wrong list cannot weaken it. The numbers above are
context for the reader, not a table the code consults.

=== THE WAY OUT FOR SOMEONE ALREADY OVER

A gate that freezes the broken state is a trap, not a gate. If the file is ALREADY past a
ceiling, a write that makes it STRICTLY SMALLER is ALLOWED even while still over -- otherwise
the only people the gate stops are the ones trying to fix it. The error message names the
repair path rather than blaming the current keystroke.

=== SUB-AGENT INDEXES: 6000 CHARACTERS, WARN FIRST, REFUSE ONCE TRIMMED (card 8f7ea0be)

marveen's decision 2026-11-04 (card comment 54158), on friday's measurement 54156 (592
sessions): every sub-agent's OWN index (`.../projects/-Users-Shared-marveen-<agent>/memory/
MEMORY.md`) gets a 6000-character ceiling, because the whole index loads into EVERY session
start of that agent, and five of ten indexes were 7.8k-24.9k on 2026-11-05. marveen's own
index is NOT under this rule (his ~25k zero-sum index is deliberate, see its header): it keeps
the 24934 gate above, and the `-Users-isti-marveen` path never matches the sub-agent pattern.

THE ORDER IS THE POINT. A gate that refused from day one would refuse the NEXT memory of every
agent that is over today -- the topic file is written, its index line is refused, and the
knowledge lands nowhere. So for each index the gate first only WARNS (the write passes, the
warning goes into the model's context), and it starts REFUSING only after it has SEEN that
index at or under the ceiling once (the agent trimmed it, or it never was over). That state
is per realpath in MARVEEN_MEMORY_GATE_STATE (store/memory-gate-sub-trimmed.json), written
only from a MEASURED current size, never from a write that has not happened yet.

The way out stays open on this path too: a write that makes an over-ceiling index strictly
smaller passes. A shell write at a sub-agent index is ALLOWED with the warning (its size
cannot be computed, and refusing it would also refuse a `sed -i` trim); that is a known gap,
logged as BASH-SUB.

=== FAIL-OPEN, AND LOUDLY

Anything this gate cannot parse or size, it ALLOWS and LOGS. A gate that has quietly stopped
working must stay distinguishable from a gate that never had to fire -- which is the same
law the rest of this file is about.
"""

import json
import os
import re
import sys
import datetime

# ONE definition of the target and the ceilings, taken from the helper the gate defends.
MEM = os.environ.get(
    'MARVEEN_MEMORY_DIR',
    '/Users/isti/.claude/projects/-Users-isti-marveen/memory',
)
INDEX = os.path.join(MEM, 'MEMORY.md')

# The measured cut window is [24934, 25037]; the helper's nominal LIMIT (25000) sits inside
# it. Fail-closed means the LOWER bound.
CHAR_CEILING = 24934
LINE_CEILING = 200          # the separate line ceiling the loader also applies

LOG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'store', 'memory-gate.log')
OVERRIDE_ENV = 'MARVEEN_MEMORY_GATE'

WRITE_TOOLS = ('Write', 'Edit', 'NotebookEdit')

# Sub-agent indexes (card 8f7ea0be). Matched on the REALPATH, like the coordinator index, so
# the per-agent `.claude-config` symlinks and the canonical tree are one file.
SUB_CHAR_CEILING = 6000
SUB_INDEX = re.compile(r'/projects/-Users-Shared-marveen-(?P<agent>[A-Za-z0-9_-]+)/memory/MEMORY\.md$')
STATE = os.environ.get('MARVEEN_MEMORY_GATE_STATE', os.path.join(os.path.dirname(LOG),
                                                                  'memory-gate-sub-trimmed.json'))

# Shell shapes that WRITE a path. Deliberately narrow: the helpers open the file in Python
# and never appear here, so this pattern's population is exactly the bypass path.
REDIRECT = re.compile(r'>>?\s*(?P<p>[^\s;|&<>]+)')
TEE = re.compile(r'\btee\b(?:\s+-\w+)*\s+(?P<p>[^\s;|&<>]+)')
SED_I = re.compile(r'\bsed\b[^;|&]*?\s-i\b[^;|&]*?\s(?P<p>[^\s;|&<>]+)\s*$', re.M)
CP_MV = re.compile(r'\b(?:cp|mv|install)\b(?:\s+-\w+)*\s+\S+\s+(?P<p>[^\s;|&<>]+)')


def log(verdict, detail):
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, 'a', encoding='utf-8') as fh:
            fh.write('%s\t%s\t%s\n' % (
                datetime.datetime.now().isoformat(timespec='seconds'), verdict, detail))
    except Exception:
        pass


def same_file(path):
    """True when `path` denotes the guarded index -- by realpath, never by name."""
    if not path:
        return False
    p = os.path.expanduser(str(path).strip().strip('"\''))
    if not p:
        return False
    if not os.path.isabs(p):
        p = os.path.abspath(p)
    try:
        return os.path.realpath(p) == os.path.realpath(INDEX)
    except OSError:
        return False


def sub_index(path):
    """(agent, realpath) when `path` is a sub-agent's own index, else None."""
    if not path:
        return None
    p = os.path.expanduser(str(path).strip().strip('"\''))
    if not p:
        return None
    if not os.path.isabs(p):
        p = os.path.abspath(p)
    try:
        rp = os.path.realpath(p)
    except OSError:
        return None
    if rp == os.path.realpath(INDEX):
        return None
    m = SUB_INDEX.search(rp)
    if not m or m.group('agent') == 'marveen':
        return None
    return m.group('agent'), rp


def load_state():
    try:
        with open(STATE, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def mark_trimmed(rp, agent, chars):
    """Record that this index was SEEN at or under the ceiling (a measured size, not a plan)."""
    st = load_state()
    if rp in st:
        return
    st[rp] = {'agent': agent, 'seen_under': datetime.datetime.now().isoformat(timespec='seconds'),
              'chars': chars}
    tmp = STATE + '.tmp'
    try:
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        with open(tmp, 'w', encoding='utf-8') as fh:
            json.dump(st, fh, indent=1, sort_keys=True)
        os.replace(tmp, STATE)
        log('SUB-TRIMMED', '%s %s: seen at %s chars' % (agent, rp, chars))
    except OSError as exc:
        log('FAIL-OPEN', 'state not written for %s: %s' % (rp, exc))


def sub_warn_text(agent, chars, lines, cur_chars):
    return (
        "MEMORIA-KAPU (al-agens, %s): FIGYELMEZTETES -- az iras ATMEGY, de a sajat MEMORY.md "
        "indexed a plafon FOLOTT lesz: %s karakter / %s sor (most %s), a plafon %s karakter / %s "
        "sor (marveen dontese, kartya 8f7ea0be). Az egesz index MINDEN munkamenet-inditaskor "
        "betoltodik. VAGD LE a sajatodat: a regi vagy ritkan hivatkozott index-sorokat vidd at egy "
        "archiv fajlba a memory/ mappaban (a temafajlok maradnak, csak az index-sor megy), amig "
        "%s ala nem er. Amint a kapu egyszer a plafon alatt latta az indexed, a plafon fole vivo "
        "irast MEGTAGADJA (a szigoruan kisebbre vivo iras mindig atmegy)." % (
            agent, chars, lines, cur_chars, SUB_CHAR_CEILING, LINE_CEILING, SUB_CHAR_CEILING))


def warn(text):
    """Non-blocking: the write passes, the text reaches the model AND the session."""
    print(json.dumps({'systemMessage': text,
                      'hookSpecificOutput': {'hookEventName': 'PreToolUse',
                                             'additionalContext': text}}))
    sys.exit(0)


def refuse_sub(agent, reason, chars, lines, cur_chars, cur_lines):
    sys.stderr.write(
        "MEMORIA-KAPU (al-agens, %s): TILTVA -- ez az iras a sajat MEMORY.md indexedet a plafon "
        "FOLE vinne.\n\n"
        "  %s\n"
        "  most:  %s karakter | %s sor\n"
        "  utana: %s karakter | %s sor\n"
        "  plafon: %s karakter | %s sor (marveen dontese, kartya 8f7ea0be)\n\n"
        "MIERT TILT ES NEM FIGYELMEZTET: a kapu mar latta ezt az indexet a plafon alatt, tehat "
        "van hely, csak elobb vagni kell. A temafajl, amit most irtal, MEGMARAD: csak az "
        "index-sora var.\n\n"
        "A HELYES UT: elobb VAGD az indexet (regi vagy ritkan hivatkozott sorok egy archiv fajlba "
        "a memory/ mappaban, vagy tobb sor osszevonasa egybe), AZTAN ird be az uj sort. Egy iras, "
        "ami SZIGORUAN KISEBBRE viszi a fajlt, mindig atmegy.\n\n"
        "HA TENYLEG EZ KELL -- a felelosseg a tied, a naplo megorzi:\n"
        "    %s=allow <a parancs>\n" % (
            agent, reason, cur_chars, cur_lines, chars, lines, SUB_CHAR_CEILING, LINE_CEILING,
            OVERRIDE_ENV))
    sys.exit(2)


def sub_gate(tool, ti, agent, rp):
    """The sub-agent branch of main(); always exits."""
    try:
        with open(rp, encoding='utf-8') as fh:
            now = fh.read()
    except OSError:
        now = None
    c_chars, c_lines = measure(now) if now is not None else (0, 0)
    if c_chars <= SUB_CHAR_CEILING and c_lines <= LINE_CEILING:
        mark_trimmed(rp, agent, c_chars)
    trimmed = rp in load_state()

    if tool == 'Bash':
        log('BASH-SUB', '%s %s (unsized, allowed)' % (agent, rp))
        if c_chars > SUB_CHAR_CEILING or c_lines > LINE_CEILING:
            warn(sub_warn_text(agent, '?', '?', c_chars))
        sys.exit(0)

    after = resulting_text(tool, ti, now)
    if after is None:
        log('FAIL-OPEN', '%s on %s index: result not computable' % (tool, agent))
        sys.exit(0)
    chars, lines = measure(after)
    over = []
    if chars > SUB_CHAR_CEILING:
        over.append('%s karakter > %s' % (chars, SUB_CHAR_CEILING))
    if lines > LINE_CEILING:
        over.append('%s sor > %s' % (lines, LINE_CEILING))
    if not over:
        sys.exit(0)
    if now is not None and chars < c_chars and lines <= c_lines:
        log('ALLOW-IMPROVING-SUB', '%s %s: %s -> %s chars' % (agent, tool, c_chars, chars))
        sys.exit(0)
    if os.environ.get(OVERRIDE_ENV) == 'allow':
        log('OVERRIDE-SUB', '%s %s: %s' % (agent, tool, '; '.join(over)))
        sys.exit(0)
    if not trimmed:
        log('WARN-SUB', '%s %s: %s (never seen under, warning only)' % (agent, tool, '; '.join(over)))
        warn(sub_warn_text(agent, chars, lines, c_chars))
    log('DENY-SUB', '%s %s: %s' % (agent, tool, '; '.join(over)))
    refuse_sub(agent, '; '.join(over), chars, lines, c_chars, c_lines)


def measure(text):
    lines = text.split('\n')
    n_lines = len(lines) - 1 if lines and lines[-1] == '' else len(lines)
    return len(text), n_lines


def current():
    try:
        with open(INDEX, encoding='utf-8') as fh:
            return fh.read()
    except OSError:
        return None


def resulting_text(tool, ti, now):
    """The file content this call would leave behind, or None when not computable."""
    if tool == 'Write':
        return ti.get('content')
    if tool == 'Edit':
        if now is None:
            return None
        old, new = ti.get('old_string'), ti.get('new_string')
        if old is None or new is None:
            return None
        if old not in now:
            return None                      # the edit will fail anyway; not ours to judge
        return now.replace(old, new) if ti.get('replace_all') else now.replace(old, new, 1)
    return None


def bash_targets(command):
    """Paths this shell command would WRITE, restricted to the guarded index."""
    hits = []
    for name, rx in (('redirect', REDIRECT), ('tee', TEE), ('sed -i', SED_I), ('cp/mv', CP_MV)):
        for m in rx.finditer(command):
            if same_file(m.group('p')):
                hits.append('%s -> %s' % (name, m.group('p')))
    return hits


def refuse(reason, chars, lines, cur_chars, cur_lines):
    sys.stderr.write(
        "MEMORIA-KAPU: TILTVA -- ez az iras a MEMORY.md indexet a betolto vagasa FOLE vinne.\n\n"
        "  %s\n"
        "  most:  %s karakter | %s sor\n"
        "  utana: %s karakter | %s sor\n"
        "  plafon: %s karakter (a mert vagasi ablak [24934, 25037] ALSO hatara) | %s sor\n\n"
        "MIERT 24934 ES NEM 25000: a betolto vagasa ABLAK, es a 25000 AZON BELUL ul. Egy\n"
        "25000-re allitott kapu az ablak also feleben NEMAN atengedne -- es a vagas nem\n"
        "jelenti be magat az ironak, csak a KOVETKEZO munkamenet olvasojanak.\n\n"
        "A HELYES UT (mindharom zarolt, es magatol tartja a plafont):\n"
        "    python3 scripts/memory-index-add.py --check            # allapot, nem ir\n"
        "    python3 scripts/memory-index-add.py <agens> <kat> ...  # `--evict`: egy be, egy ki\n"
        "    python3 scripts/memory-index-trim.py <sor>             # EGY sort zsugorit helyben\n"
        "    python3 scripts/memory-index-fold.py <host> <uj> <sor...>  # sorokat VON OSSZE\n\n"
        "HA MAR A PLAFON FOLOTT VAGY: egy iras, ami SZIGORUAN KISEBBRE viszi a fajlt, ATMEGY\n"
        "ezen a kapun akkor is, ha meg mindig a plafon folott van. A kijarat nyitva.\n\n"
        "HA TENYLEG EZ KELL -- a felelosseg a tied, a naplo megorzi:\n"
        "    %s=allow <a parancs>\n" % (
            reason, cur_chars, cur_lines, chars, lines, CHAR_CEILING, LINE_CEILING,
            OVERRIDE_ENV))
    sys.exit(2)


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        log('FAIL-OPEN', 'unparseable hook payload: %s' % exc)
        sys.exit(0)

    try:
        tool = str(payload.get('tool_name') or '')
        ti = payload.get('tool_input') or {}

        if tool == 'Bash':
            command = str(ti.get('command') or '')
            hits = bash_targets(command)
            if not hits:
                for rx in (REDIRECT, TEE, SED_I, CP_MV):
                    for m in rx.finditer(command):
                        sub = sub_index(m.group('p'))
                        if sub:
                            sub_gate(tool, ti, *sub)
                sys.exit(0)
            if os.environ.get(OVERRIDE_ENV) == 'allow':
                log('OVERRIDE', '; '.join(hits))
                sys.exit(0)
            now = current()
            c_chars, c_lines = measure(now) if now is not None else (0, 0)
            log('DENY-BASH', '; '.join(hits))
            refuse('a hej KOZVETLENUL ir a fajlba, a helper zarat megkerulve: '
                   + '; '.join(hits) + '\n  (a meret nem szamolhato elore, ezert fail-closed)',
                   '?', '?', c_chars, c_lines)

        if tool not in WRITE_TOOLS:
            sys.exit(0)
        if not same_file(ti.get('file_path')):
            sub = sub_index(ti.get('file_path'))
            if sub:
                sub_gate(tool, ti, *sub)
            sys.exit(0)

        now = current()
        after = resulting_text(tool, ti, now)
        if after is None:
            log('FAIL-OPEN', '%s on the index: result not computable' % tool)
            sys.exit(0)

        chars, lines = measure(after)
        c_chars, c_lines = measure(now) if now is not None else (0, 0)

        over = []
        if chars > CHAR_CEILING:
            over.append('%s karakter > %s' % (chars, CHAR_CEILING))
        if lines > LINE_CEILING:
            over.append('%s sor > %s' % (lines, LINE_CEILING))
        if not over:
            sys.exit(0)

        # THE WAY OUT: already over, and this write strictly improves it.
        if now is not None and chars < c_chars and lines <= c_lines:
            log('ALLOW-IMPROVING', '%s: %s -> %s chars (still over, but smaller)'
                % (tool, c_chars, chars))
            sys.exit(0)

        if os.environ.get(OVERRIDE_ENV) == 'allow':
            log('OVERRIDE', '%s: %s' % (tool, '; '.join(over)))
            sys.exit(0)

        log('DENY', '%s: %s' % (tool, '; '.join(over)))
    except Exception as exc:
        log('FAIL-OPEN', 'internal error: %s' % exc)
        sys.exit(0)

    refuse('; '.join(over), chars, lines, c_chars, c_lines)


if __name__ == '__main__':
    main()
