#!/usr/bin/env python3
r"""Shared reader for the kanban VERDIKT convention -- the one this fleet kept re-writing by hand.

WHY THIS FILE EXISTS. didi measured it on 2026-09-12: the mandatory parser form exists ONLY as
prose (37 mentions in a 41,000-character reference), and NOTHING in the tracked tree parses it --
7 files mention VERDIKT, 0 parse the kanban convention; agents/ 0; her own tools/ 0.
CONTROL, both halves: `git ls-files agents/` = 0 (so those trees are invisible to git grep) and
`find agents -maxdepth 1 -type d` = 7 (so the tree is not empty) -- together they rule out the
zero being a blind meter.

THE COST IS WHAT DECIDED THE OUTCOME, NOT THE CARE. Same rule, same day, two agents: didi opened
the reference and got the bold-tolerant anchor; marveen did not and got the strict one, then
"fixed" his own conformant bold line and taught the wrong lesson on a card. Every sweep brings its
own parser and the set never grows one AT THE CLASS -- the same shape this fleet records for
guards.

THE FORM IS NOT INVENTED HERE. Every step below is transcribed from
`rulebook/kanban-verdikt-konvencio.md` ("A KOTELEZO PARSER-ALAK, mind a negy eseten igazolva").
If the convention changes, THAT file is the source and this one follows it -- do not edit the
steps here from memory.

  0.   anchor `^\**VERDIKT:` -- emphasis IS allowed (7 live cards stood only in bold; the strict
       anchor under-measured didi's 24-item sample by 40%). The match must begin at column 0,
       the `**` included: an INDENTED `VERDIKT:` is a quotation, not a verdict.
  0/b. strip the `VERDIKT:` prefix -- without it step 4 rejects correctly written lines
       (measured: 0 conformant of 34 pairs; 3 after stripping).
  1.   per AUTHOR, the LAST such line.
  2.   `re.split(r'\||--|\.', body, 1)[0]`, `.strip().upper()`, trailing punctuation dropped.
       Three separators, each for a measured reason: `|` the recommended form, `--` the PREVIOUS
       prescribed form (without it all 33 open verdicts were unreadable), `.` the sentence-final
       period a Hungarian writer adds before continuing.
  3.   accent-normalise (NFD, drop category `Mn`).
  4.   EXACT equality against the two tokens. NOT `in`, NOT `startswith` -- "NINCS NYITOTT TETEL"
       CONTAINS "NYITOTT TETEL", so a substring test classifies every correct NINCS as NYITOTT.
       That is the first form anyone writes.
  5.   anything else is NEM MERHETO -- which is neither a verdict nor "no open item".

WHAT THIS TOOL DELIBERATELY DOES NOT DECIDE: whether a card is done. `MIND NINCS` means no
CHECKER has an open item, which is NOT the same thing -- the owner may not have spoken, or the
union of the scopes may be smaller than the card. The scopes are RETURNED so a human can read
them; the tool refuses to collapse that into a verdict.

USAGE
  python3 scripts/verdict-parse.py <card-id-prefix>     # breakdown for one card
  python3 scripts/verdict-parse.py --selftest           # the convention's own measured cases
  from verdict_parse import parse_verdicts              # {author: (token, scope, created_at)}
"""
import os
import re
import sqlite3
import sys
import unicodedata

DB = os.environ.get('MARVEEN_DB', '/Users/isti/marveen/store/claudeclaw.db')

ANCHOR = re.compile(r'^\*{0,2}VERDIKT:', re.M)
NINCS, NYITOTT, UNMEASURABLE = 'NINCS NYITOTT TETEL', 'NYITOTT TETEL', 'NEM MERHETO'


def _strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn')


def classify(line):
    """One line -> (token, scope). `token` is NINCS / NYITOTT / NEM MERHETO."""
    if not ANCHOR.match(line):          # step 0: column 0, `**` included; indented = quotation
        return None
    body = line.split('VERDIKT:', 1)[1]  # step 0/b: the prefix must go
    head = re.split(r'\||--|\.', body, maxsplit=1)[0]          # step 2
    scope = body[len(head):].lstrip('|-. ').strip()
    tok = _strip_accents(head.strip().upper()).strip(' .,;:')  # steps 2-3
    if tok == NINCS:                                           # step 4: EXACT, never `in`
        return NINCS, scope
    if tok == NYITOTT:
        return NYITOTT, scope
    return UNMEASURABLE, scope                                  # step 5


def parse_verdicts(comments):
    """comments: iterable of (author, created_at, content). -> {author: (token, scope, ts)}"""
    last = {}
    for author, ts, content in comments:
        for line in content.split('\n'):
            got = classify(line)
            if got:
                last[author] = (got[0], got[1], ts)
    return last


def card_state(last):
    """The convention's THREE outcomes. Never collapses `MIND NINCS` into "the card is done"."""
    if not last:
        return 'NINCS VERDIKT', 'egyetlen ellenorzo sem szolalt meg'
    if any(v[0] == NYITOTT for v in last.values()):
        who = sorted(a for a, v in last.items() if v[0] == NYITOTT)
        return NYITOTT, 'nyitott tetel: ' + ', '.join(who)
    if any(v[0] == UNMEASURABLE for v in last.values()):
        who = sorted(a for a, v in last.items() if v[0] == UNMEASURABLE)
        return UNMEASURABLE, 'nem parszolhato verdikt-sor: ' + ', '.join(who)
    return (NINCS, 'egyetlen ELLENORZONEK sincs nyitott tetele -- ez NEM azonos azzal, hogy a '
                   'kartya kesz: olvasd el a hatokoroket')


SELFTEST = [
    # (line, expected token) -- every case transcribed from the reference file's measured traps
    ('VERDIKT: NINCS NYITOTT TETEL | a frontend felen', NINCS),
    ('**VERDIKT: NINCS NYITOTT TETEL | bold, es a lap MEGENGEDI**', NINCS),
    ('VERDIKT: NYITOTT TETEL | egy sorban', NYITOTT),
    ('VERDIKT: NINCS NYITOTT TETEL -- a REGI elvalaszto', NINCS),
    ('VERDIKT: NINCS NYITOTT TETEL. Es a magyar iro folytatja.', NINCS),
    ('VERDIKT: NINCS NYITOTT TÉTEL | ekezettel', NINCS),
    ('    VERDIKT: NINCS NYITOTT TETEL | BEHUZOTT = idezet', None),
    ('VERDIKT: NINCS NYITOTT TETEL A FRONTEND FELEN | a token mar nem token', UNMEASURABLE),
    ('KAPU: NINCS NYITOTT TETEL | mas horgony', None),
]


def selftest():
    bad = 0
    for line, want in SELFTEST:
        got = classify(line)
        got_tok = got[0] if got else None
        ok = got_tok == want
        bad += not ok
        print('  %-5s %-14s %s' % ('ok' if ok else 'BUKIK', got_tok, line[:66]))
    # the reference file's own read-time probe, as a control on THIS parser
    toks = [classify(l)[0] for l, _ in SELFTEST if classify(l)]
    print('\n  rekeszek: NINCS=%d NYITOTT=%d NEM MERHETO=%d' %
          (toks.count(NINCS), toks.count(NYITOTT), toks.count(UNMEASURABLE)))
    print('  (a lap olvasaskori probaja: ha BARMELYIK rekesz PONTOSAN nulla, a parser a gyanusitott)')
    if min(toks.count(NINCS), toks.count(NYITOTT), toks.count(UNMEASURABLE)) == 0:
        print('  FIGYELEM: egy rekesz ures'); bad += 1
    return 1 if bad else 0


def main():
    if len(sys.argv) != 2:
        print(__doc__.split('USAGE')[1]); return 2
    if sys.argv[1] == '--selftest':
        return selftest()
    pref = sys.argv[1]
    c = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
    rows = list(c.execute('select author, created_at, content from kanban_comments '
                          'where card_id like ? order by created_at', (pref + '%',)))
    if not rows:
        print('nincs komment erre a kartyara: %s' % pref); return 2
    last = parse_verdicts((r[0], r[1], r[2]) for r in rows)
    state, why = card_state(last)
    print('kartya %s | komment: %d | szerzonkenti verdikt: %d' % (pref, len(rows), len(last)))
    for a, (tok, scope, _) in sorted(last.items()):
        print('  %-12s %-16s %s' % (a, tok, scope[:78]))
    print('\nALLAPOT: %s -- %s' % (state, why))
    return 0


if __name__ == '__main__':
    sys.exit(main())
