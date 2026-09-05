#!/usr/bin/env python3
"""
ADD AN INDEX LINE TO THE SHARED MEMORY.md, AND KEEP IT UNDER THE LOADING LIMIT.

Card 5071c32b / 9855d9dc. This implements marveen's 2026-09-03 convention, which was
stated as a rule for each agent to apply by hand:

    1. the new line goes to the FRONT of the list
    2. and in the SAME motion the current LAST line MOVES to index-farkak-<date>.md,
       with its FULL TEXT, under a dated header

BOTH STEPS OR NEITHER. Only (1) and the file grows past the limit and nobody knows what
fell off the end; only (2) and the append pathology continues with fewer lines.

WHY THIS IS CODE AND NOT A RULE, and the reason is measured rather than stylistic. The
same day this convention was written, three separate intent-rules were shown not to hold
on the people who wrote them -- including "write fewer messages", re-measured a week later
by its own author with no change. What held was a gate that refused the command. So the
overflow trim is part of the add, and cannot be the step someone forgets at 2am.

WHY PREPEND. Measured 2026-09-03: the first 40 index lines had a median file mtime of
09-02 12:15, the last 40 of 09-03 07:34 -- ~19 hours newer. Under append the truncating
loader evicts the MOST RECENTLY WRITTEN material, so the lesson learned today is the first
one missing from the prefix that loads tomorrow. (Limit: mtime is last write, not creation,
so the honest claim is "the tail is the recently TOUCHED material". The direction survives
that; the precision does not.)

WHAT IT REFUSES TO DO, deliberately:
  - it will not write if the entry is already indexed (that is a duplicate, not an add)
  - it will not write if the result is still over the limit after one eviction
  - it will not evict a line whose full text it could not append to the archive first
  - it will not evict a PINNED line (see PIN_MARKER): the boundary now cuts the OLDEST end,
    and the oldest entries are the most re-read, so without pinning an automated evictor
    eats the foundations in creation order.

Usage:
    memory-index-add.py <file.md> <title> <hook>
    memory-index-add.py --check                 # report state, write nothing
"""
import fcntl
import os
import re
import sys
import datetime

MEM = os.environ.get(
    'MARVEEN_MEMORY_DIR',
    '/Users/isti/.claude/projects/-Users-isti-marveen/memory',
)
INDEX = os.path.join(MEM, 'MEMORY.md')
LIMIT = 25000          # CHARACTERS, not bytes -- didi retracted the byte reading 2026-09-03
LINE_LIMIT = 200       # AND a separate LINE ceiling: "MEMORY.md is 205 lines (limit: 200)"

# THE TWO CEILINGS BEHAVE DIFFERENTLY, and this script knew only one of them until
# didi measured it (2026-09-03):
#
#     CHARACTER ceiling -> hook-trimming solves it (~725 reference-preserving)
#     LINE ceiling      -> trimming is POWERLESS. Only CONSOLIDATION or removal touches it.
#
# Which also explains the consolidated lines as the corpus's EXISTING answer to the line
# ceiling rather than as sloppiness: 200 index lines carry 221 unique references, because
# 19 lines carry two or more. **21 references ride above the line ceiling purely because
# somebody merged them.** That is why 7 of the 10 longest are long, and why a naive median
# trim would drop 8 -- the trim attacks the very mechanism holding 21 memories in.
PIN_MARKER = '<!-- pin -->'
SNAPSHOTS = os.environ.get('MARVEEN_SNAPSHOT_REPO', '/Users/isti/Backups/rulebooks')
SNAP_INDEX = 'store/memory/-Users-isti-marveen/MEMORY.md'


def first_seen():
    """When each memory FIRST appeared in the index, from the snapshot history.

    jarvis measured this against mtime, 2026-09-03: first-seen gives 3/199 non-monotonic
    steps, mtime gives 49/199. mtime is LAST WRITE, so an old memory edited today looks
    new -- the limit I wrote into this file myself, now quantified by someone else.

    DEGRADES LOUDLY, NOT SILENTLY. If the snapshot repo is absent this returns None and the
    caller says so, rather than quietly falling back to the noisier proxy and reporting a
    confident answer. jarvis's floor also applies: the history starts 09-02 12:23, so
    everything older shares that date and the in-degree tie-break decides among them.
    """
    import subprocess
    if not os.path.isdir(os.path.join(SNAPSHOTS, '.git')):
        return None
    try:
        shas = subprocess.run(
            ['git', '-C', SNAPSHOTS, 'log', '--format=%H', '--reverse', '--', SNAP_INDEX],
            capture_output=True, text=True, timeout=60).stdout.split()
    except Exception:
        return None
    seen = {}
    for order, sha in enumerate(shas):
        body = subprocess.run(
            ['git', '-C', SNAPSHOTS, 'show', f'{sha}:{SNAP_INDEX}'],
            capture_output=True, text=True).stdout
        for f in set(re.findall(r'([^\s()\[\]]+\.md)', body)):
            seen.setdefault(f, order)
    return seen


def in_degree():
    """How many OTHER memories wikilink each file. LOW means peripheral.

    The corrected (c), marveen 2026-09-03: among the oldest, evict the LOW in-degree entry.
    The earlier rule said the opposite -- "high in-degree is cheap to lose, the corpus
    reaches it anyway" -- and it is true, which is why the inversion took a day to see:
    in-degree answers BOTH "recoverable without its line" and "most re-read", and those
    two point the same entries in opposite directions. Centrality won.
    """
    from collections import Counter
    deg = Counter()
    files = [f for f in os.listdir(MEM)
             if f.endswith('.md') and f != 'MEMORY.md' and not f.startswith('index-farkak')]
    stems = {f[:-3]: f for f in files}
    for f in files:
        try:
            body = read(os.path.join(MEM, f))
        except Exception:
            continue
        for st in set(re.findall(r'\[\[([^\]]+)\]\]', body)):
            if st in stems and stems[st] != f:
                deg[stems[st]] += 1
    return deg


def archive_path():
    return os.path.join(MEM, f'index-farkak-{datetime.date.today().isoformat()}.md')


def read(p):
    with open(p, encoding='utf-8') as fh:
        return fh.read()


def index_lines(text):
    return [l for l in text.split('\n') if l.startswith('- [')]


def state():
    s = read(INDEX)
    return s, index_lines(s), len(s)


def evict_tail(text, protect=None):
    """Move the OLDEST non-pinned index line into today's archive, full text.

    BY AGE, NOT BY POSITION, and that is a correction the test found rather than the
    design. The convention says "evict the tail", which is right ONCE the file is fully
    prepend-ordered. It is exactly inverted during the transition: measured 2026-09-03,
    the first 10 index lines had a median mtime of 08-29 13:30 and the last 10 of
    09-03 12:51, because the file was built by APPEND. Evicting the positional tail today
    takes the freshest lesson -- the first run would have archived one written 8 minutes
    earlier -- which is the pathology prepend was introduced to stop.

    Selecting by AGE is correct in both regimes, so there is no transition to finish
    and no one-time reversal of a contested shared file.

    AND THE AGE KEY IS first_seen(), NOT mtime -- these two paragraphs said mtime until
    2026-09-05, describing an implementation this file no longer has. The primary path
    reads FIRST APPEARANCE from the snapshot history (see first_seen); mtime is the
    FALLBACK, taken only when that history is missing, and it announces itself on stderr.
    The correction is didi's measurement of my sentence, and the mistake is the shape this
    repo names elsewhere: a docblock that keeps describing the code it was written against.

    THE LIMIT THEREFORE MOVED, and it now belongs to the fallback: mtime is LAST WRITE,
    not creation, so an old memory edited today survives longer -- a defensible bias, but
    a bias. jarvis quantified it, 2026-09-03: mtime gives 49/199 non-monotonic steps
    against first-seen's 3/199. On the primary path that bias is gone.

    WHAT LIMITS THE PRIMARY PATH INSTEAD: the history starts 09-02 12:23, so everything
    older shares that timestamp and the in-degree tie-break decides among them. A memory
    never seen in the history sorts as NEWEST (10**9), which protects a just-written line
    from being evicted by the run that added it.
    """
    lines = text.split('\n')
    # THE NEW LINE IS NEVER ITS OWN VICTIM, and this is a bug the test found rather than
    # the design. Without the guard the freshly inserted entry is a candidate like any
    # other, and when it is the ONLY line long enough to close the gap it evicts ITSELF:
    # the command reports "added" AND "evicted", the file is unchanged, and the memory you
    # just wrote lands in the archive instead of the index. A silent no-op wearing the
    # shape of success.
    candidates = [
        i for i, l in enumerate(lines)
        if l.startswith('- [') and PIN_MARKER not in l and l != protect
    ]
    if not candidates:
        raise SystemExit('REFUSING: no unpinned index line to evict')

    seen = first_seen()
    if seen is None:
        print('WARNING: snapshot history unavailable -- falling back to mtime, which is '
              'LAST WRITE and measurably noisier (49/199 vs 3/199 non-monotonic). '
              'The choice below is weaker than it looks.', file=sys.stderr)
    deg = in_degree()

    def rank(i):
        m = re.search(r'\]\(([^)]+\.md)\)', lines[i])
        if not m:
            return (-1, -1)              # unparseable: evict first, it indexes nothing
        fn = m.group(1)
        p = os.path.join(MEM, fn)
        if seen is not None:
            age_key = seen.get(fn, 10 ** 9)   # never seen in history == newest
        else:
            age_key = os.path.getmtime(p) if os.path.exists(p) else 0
        # OLDEST first, then LOWEST in-degree -- the corrected (c).
        return (age_key, deg.get(fn, 0))

    # AND IT MUST ACTUALLY RECOVER ENOUGH CHARACTERS (marveen, 2026-09-03). Picking by age
    # alone can select a SHORT line: the index then reads 200 lines, looks correct, and the
    # character ceiling still truncates. The line count is the reassuring number and the
    # character count is the binding one.
    #
    # So: consider only candidates whose removal actually brings the file under the limit,
    # and take the oldest of THOSE. If none qualifies, refuse rather than evict something
    # that does not fix the problem -- an eviction that leaves the file over the limit has
    # spent a memory and bought nothing.
    over_by = len(text) - LIMIT
    big_enough = [i for i in candidates if len(lines[i]) + 1 >= over_by]
    if not big_enough:
        raise SystemExit(
            f'REFUSING: over by {over_by} characters, and no single unpinned line is that '
            'long. This needs an editorial pass on hook length, not an eviction.')

    victim_i = min(big_enough, key=rank)

    victim = lines[victim_i]
    arch = archive_path()
    header = f'\n## Levagva {datetime.datetime.now():%Y-%m-%d %H:%M} -- a betoltesi hatar miatt\n'
    existing = read(arch) if os.path.exists(arch) else ''
    if victim in existing:
        body = existing                      # already recorded; do not duplicate
    else:
        body = existing + header + victim + '\n'
    with open(arch, 'w', encoding='utf-8') as fh:
        fh.write(body)
    # ONLY after the archive write succeeded -- the eviction must never outrun the record.
    if victim not in read(arch):
        raise SystemExit('REFUSING: archive does not contain the victim after writing')

    del lines[victim_i]
    return '\n'.join(lines), victim


def main():
    if len(sys.argv) == 2 and sys.argv[1] == '--check':
        text, lines, n = state()
        print(f'index lines: {len(lines)} | characters: {n} | '
              f'{"OVER by " + str(n - LIMIT) if n > LIMIT else "headroom " + str(LIMIT - n)}')

        # THE THIRD CONDITION (jarvis, 2026-09-03). Reachability is not enough, and
        # neither is transitive reachability: a line can be present, resolvable through
        # the archive, and still sit PAST the character where the loader stops. Measured
        # that day: the whole-file traversal said 0 unreachable while the first-200
        # traversal said 1 -- an entry written at 14:16 sitting on line 201.
        #
        # This is what a restore into the tail produces, and it is why both of the
        # earlier meters went green on a repair that delivered nothing: they asked
        # "is it in the file", not "is it in the part that loads".
        # A line that STARTS before the cut and RUNS PAST it is truncated mid-hook, and
        # counting only lines that begin after the cut misses exactly those. My first
        # version did, and reported "OVER by 144" and "beyond: 0" in the same breath --
        # two statements that cannot both be true. Walk offsets instead.
        # AND THE CUT IS THE EARLIER OF **TWO** CEILINGS -- jarvis found this live at 17:33
        # on 2026-09-03, and the shape is the one this whole block was written against.
        # The walk below used to compare offsets against LIMIT only. There are two
        # ceilings (see LIMIT / LINE_LIMIT at the top), and a file can be far inside one
        # while past the other: measured fixture 250 lines / 6926 chars reported
        # "beyond: 0" and "headroom 18074" in the same breath, while the loader dropped
        # 50 lines. CONTROL: the same meter reports 41 on a char-overflow fixture, so it
        # was not blind -- it was measuring the wrong ceiling.
        # The live cost was exactly the failure this file exists to prevent: a hand
        # prepend took the index to 201 lines and SILENTLY evicted the newest entry.
        all_lines = text.split('\n')
        # A TRAILING NEWLINE IS NOT A LINE. Caught by this block's own output on the live
        # file minutes after the fix: it printed "0 beyond" and "201/200 lines" in the same
        # sentence -- two statements that cannot both be true, which is exactly the
        # self-contradiction that flags a broken meter elsewhere on this page.
        n_lines = len(all_lines) - 1 if all_lines and all_lines[-1] == '' else len(all_lines)
        char_cut = LIMIT
        line_cut = float('inf')
        if n_lines > LINE_LIMIT:
            # offset one past the end of the LINE_LIMIT-th line (newlines included)
            line_cut = sum(len(l) + 1 for l in all_lines[:LINE_LIMIT]) - 1
        cut = min(char_cut, line_cut)
        which = ('both ceilings' if char_cut == line_cut else
                 'the CHARACTER ceiling' if cut == char_cut else 'the LINE ceiling')

        pos, cut_off, whole = 0, [], []
        for line in all_lines:
            start, end = pos, pos + len(line)
            pos = end + 1                     # +1 for the newline
            if not line.startswith('- ['):
                continue
            if start >= cut:
                whole.append(line)
            elif end > cut:
                cut_off.append(line)
        total = len(whole) + len(cut_off)
        if total:
            print(f'BEYOND THE LOADED PREFIX: {total} index line(s) -- present, '
                  f'possibly reachable, and NOT LOADED '
                  f'({len(cut_off)} truncated mid-line, {len(whole)} entirely past the cut) '
                  f'-- cut by {which} at offset {cut}')
            for l in (cut_off + whole)[:5]:
                print(f'    {l[:95]}')
        # AND THE POPULATION THE LINE-COUNT CANNOT SEE: THE MEMORIES THEMSELVES.
        # didi measured the gap on 2026-09-03: one write dropped 26 references while BOTH
        # watched numbers said it went fine -- lines UNCHANGED (the 200 ceiling everyone
        # watches) and characters DOWN (which reads as recovered headroom). The reference
        # count is the thing that moved, and it was printed nowhere. That write was
        # deliberate and cost zero real links, but an ACCIDENTAL one is byte-identical in
        # both meters. So: count what the index points at, and what nothing points at.
        try:
            names = {f for f in os.listdir(MEM) if f.endswith('.md') and f != 'MEMORY.md'}
            linked = set(re.findall(r'\(([^()\s]+\.md)\)', text)) & names
            bodies = {}
            for f in names:
                try:
                    bodies[f] = read(os.path.join(MEM, f))
                except OSError:
                    bodies[f] = ''
            unreachable = [
                f for f in sorted(names - linked)
                if not any('[[%s]]' % f[:-3] in bodies[i] for i in linked)
            ]
            print(f'memories: {len(names)} | linked from the index: {len(linked)} | '
                  f'reachable only via an inbound [[link]]: {len(names) - len(linked) - len(unreachable)} | '
                  f'UNREACHABLE: {len(unreachable)}')
            for f in unreachable[:5]:
                print(f'    NO PATH: {f}')
        except OSError as exc:
            # A meter that cannot read says so; it does not report zero.
            print(f'memories: NOT MEASURED ({exc})')

        if total:
            pass
        else:
            # NAME THE BINDING CEILING even when clean. A zero that does not say what it
            # measured is the state that produced this bug: the old line read "inside the
            # limit", singular, and nobody asked which one.
            print(f'beyond the loaded prefix: 0 -- every index line is inside BOTH ceilings '
                  f'({n_lines}/{LINE_LIMIT} lines, {n}/{LIMIT} chars; '
                  f'binding: {which})')
        return

    if len(sys.argv) != 4:
        raise SystemExit(__doc__.strip().splitlines()[-3].strip())

    fname, title, hook = sys.argv[1], sys.argv[2], sys.argv[3]
    if not os.path.exists(os.path.join(MEM, fname)):
        raise SystemExit(f'REFUSING: {fname} does not exist in {MEM}')

    # AN EXCLUSIVE LOCK AROUND THE READ **AND** THE WRITE -- marveen, 2026-09-03, and it is
    # the difference between this script helping and this script causing the very bug the
    # thread was about.
    #
    # APPEND is safe without a lock: it never holds a copy of the file, so it cannot drop
    # anyone's line. PREPEND necessarily does hold one. Read, modify in memory, write back
    # -- and any line another agent added in between is gone. A temp file plus os.replace
    # does NOT fix this: rename prevents a TORN file, not a LOST update.
    #
    # So the lock spans from the read to the write, and truncate() is required because a
    # shorter rewrite would otherwise leave the old tail behind the new content.
    with open(INDEX, 'r+', encoding='utf-8') as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)

        s = fh.read()
        if fname in s:
            raise SystemExit(
                f'REFUSING: {fname} is already in the index (duplicate, not an add)')

        new_line = f'- [{title}]({fname}) — {hook}'
        lines = s.split('\n')
        first = next(i for i, l in enumerate(lines) if l.startswith('- ['))
        lines.insert(first, new_line)
        s = '\n'.join(lines)

        # OVERFLOW IS NO LONGER AN EVICTION -- marveen, 2026-09-03, retracting the entry-
        # removal rule after measuring the alternative:
        #
        #     trimming the 10 longest hooks to the median .... -1006 characters
        #     removing one entry ............................. -123 characters (average)
        #
        # Ten hooks trimmed is worth eight entries removed AND loses no memory at all. The
        # longest line is 300 characters against a 124 average, so the slack is real.
        #
        # Entry removal is now the LAST resort and an EDITORIAL decision, which is exactly
        # the kind of thing a script must not make silently. So this refuses and shows the
        # trim candidates instead. Use --evict only when a human has decided.
        evicted = None
        # LINE overflow first, because the advice is DIFFERENT and trimming cannot help.
        # COUNTED WITH index_lines(), NOT `s.count('\n- [')`. The file's FIRST line is an
        # index line, so the newline-prefixed count misses it and the guard was off by one --
        # it let the index reach 201 while reporting 201. Two counting methods for one
        # ceiling, and the guard had the wrong one. Same shape as everything else today.
        if len(index_lines(s)) > LINE_LIMIT:
            n = len(index_lines(s))
            raise SystemExit(
                f'REFUSING: this add would make the index {n} lines against a {LINE_LIMIT} '
                f'line ceiling.\n'
                f'*** HOOK-TRIMMING CANNOT HELP HERE. Characters and lines are separate '
                f'ceilings;\n*** trimming prose recovers characters and ZERO lines.\n'
                f'The answer to a LINE overflow is CONSOLIDATION -- merge this entry onto a '
                f'related\nline (costs characters, which trimming can supply, and zero lines) '
                f'-- or removal,\nwhich is editorial. 19 lines already carry 2+ references; '
                f'that is the corpus\nanswering this same ceiling.')

        if len(s) > LIMIT:
            over = len(s) - LIMIT
            # THE NEW LINE IS EXCLUDED FROM THE STATISTICS ABOUT EXISTING LINES -- the same
            # contamination as the self-eviction bug, found the same way. A long new hook
            # otherwise lands in its own "10 longest" list, inflates the recoverable figure
            # with its own bulk, and suppresses the exhaustion warning precisely when the
            # overflow is worst.
            idx = [l for l in index_lines(s) if l != new_line]
            median = sorted(len(l) for l in idx)[len(idx) // 2]
            longest = sorted(idx, key=len, reverse=True)[:10]

            # And if the NEW hook is itself the outlier, the answer is not "trim ten other
            # people's lines".
            if len(new_line) > median * 2:
                raise SystemExit(
                    f'REFUSING: your own line is {len(new_line)} characters against a median '
                    f'of {median}. Shorten THIS hook before asking the index to make room -- '
                    f'the overflow is {over} characters and your line is most of it.')
            # REFERENCE-PRESERVING -- didi's invariant, 2026-09-03, and not a refinement.
            # The longest lines are long BECAUSE they are CONSOLIDATED: 7 of the top 10 carry
            # more than one memory, and the extra `.md` references sit at the END, exactly
            # where a median trim cuts. A naive trim of the top 10 would have dropped EIGHT
            # memories out of the index AS A FORMATTING CHANGE -- worse than removing one on
            # purpose, because nothing about it looks like an eviction.
            #
            #     THE INVARIANT: the reference set is IDENTICAL before and after. Cut prose.
            #     Never cut `.md`.
            #
            # So this counts only PROSE that can go while every reference stays. The naive
            # figure was 1006; the honest one is lower, and the promise must match it.
            def trimmable(line):
                refs = re.findall(r'[^\s()\[\]]+\.md', line)
                # 12 chars per reference is an ALLOWANCE for `[](...)` syntax and separators,
                # not a measurement. It under-counts what is protected, so the result is an
                # UPPER BOUND on what can be cut -- the safe direction for a promise, and the
                # reason the caller prints "AT MOST". didi's measured figure on the live file
                # was 725 where this approximation gives ~976; if that gap matters, measure,
                # do not tune this constant until someone has.
                protected = sum(len(r) for r in refs) + 12 * len(refs)
                return max(0, len(line) - max(median, protected))
            recover = sum(trimmable(l) for l in longest)
            report = '\n'.join(f'    {len(l):4}  {l[:88]}' for l in longest[:6])

            # THE EXHAUSTION CONDITION (computress, 2026-09-03). The distribution has a long
            # TAIL, not a few outliers: the 10 longest give ~1006 characters, the next 20 only
            # ~847. So past roughly the 30 longest you are trimming AVERAGE lines, and the rule
            # stops being cheap.
            #
            # That point is not a failure -- it is the signal that the file wants a GENERATED
            # index rather than another trim. It is printed HERE, in the refusal, because this
            # is where someone is standing when it becomes true; a stopping rule that lives on
            # a card is read by people who already knew to look.
            next20 = sorted(idx, key=len, reverse=True)[10:30]
            recover30 = recover + sum(trimmable(l) for l in next20)
            exhausted = over > recover30
            tail_note = (
                '\n*** PAST THE CHEAP TRIMS: this add needs more than the 30 longest hooks can '
                'give\n*** (top 10 ~%d, next 20 ~%d). Trimming further eats AVERAGE lines.\n'
                '*** This is the signal the index wants GENERATING, not another trim.'
                % (recover, recover30 - recover)
            ) if exhausted else ''

            raise SystemExit(
                f'REFUSING: this add would put the index {over} characters over the limit.\n'
                f'Do NOT remove an entry for {over} characters -- trimming hooks costs no '
                f'memory at all.\n'
                f'The 10 longest hooks trimmed to the median ({median}) would recover '
                f'AT MOST ~{recover} characters of prose (UPPER BOUND -- the link-syntax\n'
                f'allowance below is a guess; didi measured 725 reference-preserving on the\n'
                f'live index 2026-09-03, against a naive 1006. Do not treat this as a promise).\n'
                f'*** CUT PROSE, NEVER `.md`. The longest lines are long because they are '
                f'CONSOLIDATED;\n*** their extra references sit at the END, where a naive trim '
                f'cuts. The reference set must be\n*** IDENTICAL before and after -- a naive '
                f'trim of these ten would drop EIGHT memories.\n'
                f'Longest lines:\n{report}\n'
                f'(Entry removal is an editorial decision, not this script\'s: --evict.)'
                + tail_note)

        fh.seek(0)
        fh.write(s)
        fh.truncate()
        # lock released on close, after the content is durable in the file object

    print(f'added: {new_line[:90]}')
    if evicted:
        print(f'evicted to {os.path.basename(archive_path())}: {evicted[:90]}')
    print(f'index lines: {len(index_lines(s))} | characters: {len(s)} '
          f'| headroom {LIMIT - len(s)}')


if __name__ == '__main__':
    main()
