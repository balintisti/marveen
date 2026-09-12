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
    memory-index-add.py [--evict] <file.md> <title> <hook>
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

# THE TWO LINK FORMS THE REACHABILITY WALK FOLLOWS -- ONE definition, used at BOTH hops.
# They are constants because hop 1 and hop 2 must not drift apart: the moment they use
# two copies of the pattern, "reachable" means two different things in one output.
MD_LINK = r'\(([^()\s]+\.md)\)'      # [title](file.md)
WIKI_LINK = '[[%s]]'                   # [[stem]]

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
# THE ARCHIVE POINTER'S OWN MARKER. It exists so the tool can find and rewrite ITS OWN line and
# nothing else: a human may legitimately mention an archive from a content line (one does today,
# on the "memoria-fajlok helye" entry), and a tool matching on the link target alone would
# rewrite that person's sentence.
#
# AND THE POINTER IS DELIBERATELY NOT AN INDEX LINE -- it does not start with "- [". Measured on
# a fixture, 2026-09-06, because all three consequences are load-bearing and none is obvious:
#   * `--check` still counts it as "linked from the index" (2 linked, UNREACHABLE 0) -- that
#     scan regexes the WHOLE file, not just index lines;
#   * it costs ZERO of the 200-line ceiling (`index lines: 1` with the pointer present);
#   * it can never be evicted, because eviction candidates must start with "- [" -- so it needs
#     no pin, and cannot archive ITSELF.
ARCHIVE_MARKER = '<!-- arch -->'
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


def archive_pointer_line(arch_name):
    return f'{ARCHIVE_MARKER} ARCHIVUM: [levagott index-sorok]({arch_name})'


def apply_archive_pointer(text, arch_name):
    """Point the tool-owned index line at `arch_name`. Returns (text, delta_chars).

    Idempotent: rewrites the existing pointer if there is one, inserts it immediately ABOVE the
    first index line otherwise. Above, because the loader cuts at the TAIL -- a pointer written
    at the end would be the first thing to fall off the prefix, and an archive pointer nobody
    loads is the bug this function exists to close.

    ONE MAINTAINED LINE, NOT ONE PER DAY, and that is a measured choice rather than a tidiness
    one. A line per archive costs ~110 characters and one LINE_LIMIT slot every day a first
    eviction happens, taken from the single tightest file in the system -- the same pressure
    that causes the evictions. Rewriting one line costs that once, then nothing.
    """
    lines = text.split('\n')
    want = archive_pointer_line(arch_name)
    for i, l in enumerate(lines):
        if ARCHIVE_MARKER in l:
            if l == want:
                return text, 0
            lines[i] = want
            break
    else:
        j = next((i for i, l in enumerate(lines) if l.startswith('- [')), len(lines))
        lines.insert(j, want)
    new = '\n'.join(lines)
    return new, len(new) - len(text)


BACKLINK_BEGIN = '<!-- korabbi-archivumok:BEGIN -->'
BACKLINK_END = '<!-- korabbi-archivumok:END -->'


def archive_backlinks(arch):
    """`[[wiki]]` links from this archive to every other archive AND to the memories they hold.

    WHY THE NEWEST ARCHIVE IS THE HUB AND NOT A DATE CHAIN. `--check` resolves exactly two
    hops: a markdown `(file.md)` link from MEMORY.md, then `[[stem]]` links inside a file that
    is DIRECTLY linked from it. Measured on a fixture, 2026-09-06: with MEMORY.md linking only
    the newest and each archive naming just its predecessor, the third one back reports
    `NO PATH` -- the chain looks right and goes dark on day three. Control on the same fixture:
    the depth-2 file was NOT reported, so the meter was not simply blind.

    So every archive is named by the hub, keeping the whole history at depth 2.

    AND THE HUB MUST NAME THE MEMORIES TOO, NOT ONLY THE ARCHIVE FILES -- didi measured the gap
    on 2026-09-06, and it is THIS FUNCTION'S OWN TRAP one day later. Naming just the archives
    keeps the FILES at depth 2, but yesterday's victim is reachable only through the `[[handle]]`
    written inside YESTERDAY's archive, and that archive is itself at depth 2 -- so the handle
    sits at THREE. Reproduced independently on a two-day fixture with the shipped `--check`:
    day one's victim reports `NO PATH` while both archives report reachable.

    That is exactly the shape this file's eviction path already carries a warning about: the
    container stops being orphaned while its contents stay `NO PATH`, and the meter goes green
    ONE LEVEL UP. The first fix closed it for the SAME day only.

    Both link forms are read, because the archives written BEFORE the handle existed hold their
    entries as the original markdown index lines (09-03: 1039 lines, 09-05: 184) and would never
    otherwise get a handle -- so this heals the past as well as the future.

    THE COST LANDS WHERE THERE IS NO CEILING. Measured 2026-09-06: the union across every
    archive is 280 names, ~11 KB, and it goes into an ARCHIVE file. MEMORY.md is the scarce
    budget -- this costs it nothing, which is the same reasoning that keeps the pointer to one
    maintained line. The block is REGENERATED between its markers, not appended, so it does not
    grow without bound.
    """
    others = sorted(f for f in os.listdir(MEM)
                    if f.startswith('index-farkak-') and f.endswith('.md')
                    and os.path.join(MEM, f) != arch)
    if not others:
        return ''
    on_disk = set(os.listdir(MEM))
    held = set()
    for f in others:
        try:
            other = read(os.path.join(MEM, f))
        except OSError:
            continue                      # a meter that cannot read skips, it does not invent
        held |= set(re.findall(r'\]\(([^()\s]+\.md)\)', other))
        held |= {m + '.md' for m in re.findall(r'\[\[([^\]]+)\]\]', other)}
    held = {n for n in held
            if n in on_disk and n != 'MEMORY.md' and not n.startswith('index-farkak-')}
    body = ''.join('- [[%s]]\n' % f[:-3] for f in others)
    if held:
        body += ''.join('- [[%s]]\n' % n[:-3] for n in sorted(held))
    return (BACKLINK_BEGIN + '\nKorabbi archivumok -- ez a fajl a HUB, ezek a hivatkozasok\n'
            'tartjak oket a `--check` altal merheto ket hopon belul:\n' + body
            + BACKLINK_END + '\n')


def with_backlinks(body, arch):
    """Insert or refresh the backlink block at the TOP of an archive. Idempotent."""
    block = archive_backlinks(arch)
    if BACKLINK_BEGIN in body:
        return re.sub(re.escape(BACKLINK_BEGIN) + r'.*?' + re.escape(BACKLINK_END) + r'\n?',
                      block, body, flags=re.S)
    return block + body


def usage():
    lines = __doc__.strip().splitlines()
    i = next(i for i, l in enumerate(lines) if l.strip() == 'Usage:')
    return '\n'.join(lines[i:])


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
    # THE POINTER IS PART OF THE BILL, and it has to be counted BEFORE the victim is chosen.
    # `over_by` used to be the whole story; now the same motion also writes an index line, so a
    # victim picked against the old figure can be evicted, the pointer added, and the file left
    # over the limit anyway -- a memory spent for nothing, which is precisely the outcome the
    # `big_enough` filter below exists to prevent. Counting it here keeps that guarantee true.
    arch = archive_path()
    _, pointer_cost = apply_archive_pointer(text, os.path.basename(arch))
    over_by = len(text) - LIMIT + pointer_cost
    big_enough = [i for i in candidates if len(lines[i]) + 1 >= over_by]
    if not big_enough:
        # NAME THE SURCHARGE WHEN IT IS PART OF THE BILL. Without this the reader is sent to
        # trim hooks -- an editorial pass that CANNOT close a gap the pointer opened, because
        # the pointer is written on the next run too. A refusal that names the wrong remedy is
        # the failure mode this file already carries a card for (4b94fefa).
        surcharge = ('' if not pointer_cost else
                     f'\n{pointer_cost} of those characters are the one-off archive pointer '
                     f'this run must also write (there is none yet). It is written ONCE; after '
                     f'that it is rewritten in place at zero cost. If the trim below cannot '
                     f'free the room, the pointer needs {pointer_cost} characters from '
                     f'somewhere before --evict can complete.')
        raise SystemExit(
            f'REFUSING: over by {over_by} characters, and no single unpinned line is that '
            'long. This needs an editorial pass on hook length, not an eviction.\n'
            'THE TOOL FOR THAT IS scripts/memory-index-trim.py -- it shrinks ONE line in '
            'place and refuses prose edits. Do NOT hand-edit MEMORY.md: six agents share '
            'that one file.' + surcharge)

    victim_i = min(big_enough, key=rank)

    victim = lines[victim_i]
    header = f'\n## Levagva {datetime.datetime.now():%Y-%m-%d %H:%M} -- a betoltesi hatar miatt\n'
    existing = read(arch) if os.path.exists(arch) else ''
    if victim in existing:
        body = existing                      # already recorded; do not duplicate
    else:
        body = existing + header + victim + '\n'
    # AND THE ARCHIVED ENTRY NEEDS A [[wiki]] HANDLE, not just its original line. The line is
    # preserved verbatim -- but verbatim means a markdown `(name.md)` link, and `--check`
    # follows only `[[stem]]` on its second hop. Without this the ARCHIVE stops being orphaned
    # while every memory INSIDE it stays `NO PATH`: the meter goes green one level up and the
    # thing the card is about is untouched. Caught by test 7 asserting through the shipped
    # meter instead of a substring. Consolidated lines name several memories, so take them all.
    handles = [f'[[{t[:-3]}]]' for t in re.findall(r'\(([^()\s]+\.md)\)', victim)]
    handles = [h for h in handles if h not in body]
    if handles:
        body += '  ' + ' '.join(handles) + '\n'
    body = with_backlinks(body, arch)
    with open(arch, 'w', encoding='utf-8') as fh:
        fh.write(body)
    # ONLY after the archive write succeeded -- the eviction must never outrun the record.
    if victim not in read(arch):
        raise SystemExit('REFUSING: archive does not contain the victim after writing')

    del lines[victim_i]
    # AND ONLY NOW THE POINTER, for the same reason the archive is written first: the index must
    # never name an archive that does not yet hold the line. Before this, `--evict` created a
    # dated archive that NOTHING linked -- the eviction succeeded, the text was preserved in
    # full, and it was unreachable. Measured 2026-09-06: the day's archive had 1 inbound
    # reference and it was a hand repair; the tool wrote none (card cc666d39).
    out, _ = apply_archive_pointer('\n'.join(lines), os.path.basename(arch))
    return out, victim


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == '--check':
        # `--unreachable` is a MODIFIER of --check, not a second command, and an unknown
        # extra argument is refused rather than ignored. Both halves are deliberate: the
        # 2026-09-05 incident in this file was a refusal that NAMED an exit which did not
        # exist, and silently treating `--unreachabl` as plain --check would be the same
        # shape -- the reader believes the door is there and reads a truncated list.
        extra = sys.argv[2:]
        if extra not in ([], ['--unreachable']):
            raise SystemExit(usage())
        show_all = extra == ['--unreachable']
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
            linked = set(re.findall(MD_LINK, text)) & names
            # A BODY THAT COULD NOT BE READ IS NOT AN EMPTY BODY. The handler below already
            # refuses to report zero when the DIRECTORY cannot be read; the per-file read
            # used to degrade to '' silently, which is the same zero one level down -- an
            # unreadable body contributes no outbound links, so it pushes OTHER files
            # toward NO PATH. Counted now, and the verdict says the number is a FLOOR.
            bodies, unread = {}, []
            for f in names:
                try:
                    bodies[f] = read(os.path.join(MEM, f))
                except OSError:
                    bodies[f] = ''
                    unread.append(f)
            # HOP 2 FOLLOWS BOTH LINK FORMS -- marveen's ruling, card a22c40d5 (2026-09-06
            # 05:28, one of its reasons corrected 05:35). It used to follow `[[stem]]` only,
            # while the ARCHIVES name their contents in MARKDOWN -- so the meter reported
            # NO PATH for files a reader reaches in a single click.
            # THE DECISION DID NOT REST ON THE SIZE OF THE ERROR but on WHO follows these
            # links: recall is a KEYWORD SEARCH (`GET /api/memories?q=`), so the link graph
            # has NO machine consumer. Its consumer is a READER, and a reader follows both
            # forms identically. (The price was measured twice and moved: 146 files on the
            # pre-merge tree, 3 after -- and the ruling is independent of which.)
            # NUMBERS MEASURED BEFORE THIS CHANGE ARE NOT COMPARABLE WITH NUMBERS AFTER IT:
            # 176 / 30 / 27 / 181 all come from the wiki-only definition.
            outbound = {i: set(re.findall(MD_LINK, bodies[i])) for i in linked}
            def reachable_at_hop2(f):
                stem = WIKI_LINK % f[:-3]
                return any(stem in bodies[i] or f in outbound[i] for i in linked)
            unreachable = [f for f in sorted(names - linked) if not reachable_at_hop2(f)]
            print(f'memories: {len(names)} | linked from the index: {len(linked)} | '
                  f'reachable only via an inbound link: {len(names) - len(linked) - len(unreachable)} | '
                  f'UNREACHABLE: {len(unreachable)}')
            # A NUMBER WITHOUT ITS DEFINITION IS NOT A CLAIM (marveen's second condition on
            # the same card). This line is not cosmetic: the change above re-interprets every
            # earlier count, and without it the two definitions are indistinguishable in the
            # output.
            print('    definition: hop 1 = markdown link from the index; '
                  'hop 2 = inbound [[wiki]] OR markdown link from a directly linked memory; '
                  'depth 3+ is unreachable')
            # THE LEGEND NO LONGER SPELLS THE TOKEN. It used to end "counts as NO PATH",
            # so the cheapest possible check -- `--check | grep -c 'NO PATH'` -- counted
            # the DEFINITION as a finding and returned one more than the listed names.
            # A meter whose own output lands in the measured set (card 3bdaa5e8).
            if unread:
                print(f'    UNREACHABLE IS A FLOOR: {len(unread)} memory file(s) could not be '
                      f'read, so their outbound links are invisible to this walk')
            # A DELIBERATE CUT MUST SAY SO. Five names were printed out of any number, with
            # nothing marking the cut, so the list read as the population -- and the damage
            # is in the REASSURING direction: someone checking whether `--evict` broke a
            # link looks for it here, does not find it, and reads that as 'nothing broke'.
            # Measured 2026-09-10 by didi on exactly that question, and again 09-12: five
            # shown against 72 real.
            shown = unreachable if show_all else unreachable[:5]
            for f in shown:
                print(f'    NO PATH: {f}')
            if len(shown) < len(unreachable):
                print(f'    ... and {len(unreachable) - len(shown)} more NOT SHOWN -- this list is '
                      f'TRUNCATED, absence from it proves nothing. Full list: --check --unreachable')
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

    # `--evict` WAS NAMED BY THE REFUSAL BELOW AND NEVER EXISTED (card 4b94fefa, measured
    # 2026-09-05). argv accepted only `--check` or exactly three arguments, so BOTH
    # `--evict` and `--evict f t h` fell through to the usage line, and `evict_tail()` --
    # complete, defensive, and already carrying three fixed bugs -- was never called.
    # Two agents hit that wall the same day and each responded by NOT saving a measured
    # lesson. A refusal that names an exit which does not exist costs more than a refusal
    # with no exit at all: the reader believes the door is there and stops looking.
    argv = sys.argv[1:]
    allow_evict = '--evict' in argv
    if allow_evict:
        argv = [a for a in argv if a != '--evict']
    if len(argv) != 3:
        # AND THE USAGE MESSAGE NOW PRINTS THE USAGE. It was `splitlines()[-3]`, a
        # POSITIONAL anchor into the docstring, which resolves to the bare word "Usage:"
        # -- the whole output an agent got for a wrong invocation. It is also why adding a
        # line to that block silently shifts what the error prints. Anchored on the marker.
        raise SystemExit(usage())

    fname, title, hook = argv
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
        # THE WIRING (card 4b94fefa). Deliberately ONE eviction and no more: the docstring
        # promises "it will not write if the result is still over the limit after one
        # eviction", and a loop would quietly spend several memories on a single add.
        #
        # It runs BEFORE both refusals rather than inside either, because the two ceilings
        # want the same remedy from `--evict` and only differ in what they say when it is
        # absent. The LINE ceiling is the reason this is not restricted to characters:
        # trimming is powerless against it, so removal is one of the only two answers the
        # docstring names, and refusing there while naming `--evict` would rebuild exactly
        # the bug this card is about.
        #
        # protect=new_line keeps the entry being added from becoming its own victim -- a
        # measured bug the function already guards, passed explicitly so it stays true here.
        if allow_evict and (len(s) > LIMIT or len(index_lines(s)) > LINE_LIMIT):
            s, evicted = evict_tail(s, protect=new_line)
            if len(s) > LIMIT or len(index_lines(s)) > LINE_LIMIT:
                raise SystemExit(
                    f'REFUSING: still over after one eviction '
                    f'({len(index_lines(s))}/{LINE_LIMIT} lines, {len(s)}/{LIMIT} chars). '
                    f'One add must not spend two memories.\n'
                    f'The evicted line IS already recorded in '
                    f'{os.path.basename(archive_path())} -- the archive write happens '
                    f'first by design, so nothing was lost, but the index was NOT changed.')
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
                '*** The trimming tool is scripts/memory-index-trim.py (one line, in place).\n'
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
