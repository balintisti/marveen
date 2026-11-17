#!/usr/bin/env python3
"""Contract tests for scripts/verdict-parse.py. Card 77de91df.

The cases are NOT invented here: each one is a trap the convention file measured, and the
tool exists because every sweep re-wrote this parser from memory and got a different one.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location(
    'verdict_parse', os.path.join(HERE, '..', 'verdict-parse.py'))
vp = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(vp)

FAILED = []


RAN = []


def check(name, got, want):
    RAN.append(name)
    if got != want:
        FAILED.append('%s: got %r, want %r' % (name, got, want))


def tok(line):
    got = vp.classify(line)
    return got[0] if got else None


# --- step 0: the anchor tolerates emphasis, and REJECTS an indented quotation ----------
check('bold is a verdict', tok('**VERDIKT: NINCS NYITOTT TETEL | x**'), vp.NINCS)
check('plain is a verdict', tok('VERDIKT: NYITOTT TETEL | x'), vp.NYITOTT)
check('indented is a QUOTE', tok('    VERDIKT: NINCS NYITOTT TETEL | x'), None)
check('other anchor ignored', tok('KAPU: NINCS NYITOTT TETEL | x'), None)

# --- step 4: EXACT equality. "NINCS NYITOTT TETEL" CONTAINS "NYITOTT TETEL" ------------
# This is the first form anyone writes and it classifies every correct NINCS as NYITOTT.
check('substring trap', tok('VERDIKT: NINCS NYITOTT TETEL | x'), vp.NINCS)
check('qualifier inside the phrase is NOT a token',
      tok('VERDIKT: NINCS NYITOTT TETEL A FRONTEND FELEN | x'), vp.UNMEASURABLE)

# --- step 2: three separators, each for a measured reason ------------------------------
check('pipe', tok('VERDIKT: NINCS NYITOTT TETEL | x'), vp.NINCS)
check('double dash (the PREVIOUS prescribed form)', tok('VERDIKT: NINCS NYITOTT TETEL -- x'), vp.NINCS)
check('sentence-final period', tok('VERDIKT: NINCS NYITOTT TETEL. Folytatas.'), vp.NINCS)

# --- step 3: accents ------------------------------------------------------------------
check('accented', tok('VERDIKT: NINCS NYITOTT TÉTEL | x'), vp.NINCS)

# --- step 1 + card state: per author, the LAST line wins -------------------------------
last = vp.parse_verdicts([
    ('a', 1, 'VERDIKT: NYITOTT TETEL | elso'),
    ('a', 2, 'VERDIKT: NINCS NYITOTT TETEL | a szerzo VISSZAVONTA'),
    ('b', 3, 'VERDIKT: NINCS NYITOTT TETEL | masik szerzo'),
])
check('author-wise last wins', last['a'][0], vp.NINCS)
check('all NINCS -> NINCS', vp.card_state(last)[0], vp.NINCS)

open_last = dict(last, c=(vp.NYITOTT, 'x', 4))
check('any NYITOTT -> NYITOTT', vp.card_state(open_last)[0], vp.NYITOTT)
check('no verdict at all', vp.card_state({})[0], 'NINCS VERDIKT')

# --- the scope must survive, because the tool refuses to collapse it -------------------
check('scope kept', vp.classify('VERDIKT: NINCS NYITOTT TETEL | csak a frontend felen')[1],
      'csak a frontend felen')

# --- card 08832e26: the author's OWN time stamp in front is not an indent --------------
# The gate (src/kanban-verdict.ts) reads it; without this the census disagreed on 5 live cards.
STAMPED_NINCS = '[didi, 2026-10-14 23:13 CEST, date] VERDIKT: NINCS NYITOTT TETEL | 970be4b3'
stamped = vp.parse_verdicts([
    ('didi', 1, 'VERDIKT: NYITOTT TETEL | 26541'),
    ('didi', 2, STAMPED_NINCS),
])
check('own stamp: the later stamped NINCS wins', stamped['didi'][0], vp.NINCS)
check('own stamp, seconds + CET', vp.classify('[didi, 2026-12-01 09:05:07 CET, date] VERDIKT: NYITOTT TETEL | x', 'didi')[0], vp.NYITOTT)
check('ANOTHER author\'s stamp is a citation', vp.classify(STAMPED_NINCS, 'marveen'), None)
check('no author given: stamp not taken off', vp.classify(STAMPED_NINCS), None)
check('estimated time is not the stamp', vp.classify('[didi, 2026-10-14 23:1x CEST, date] VERDIKT: NYITOTT TETEL | x', 'didi'), None)

# --- card e9d95660 (marveen 67400): trillian's later NINCS closes a handed-over didi NYITOTT ---
D_OPEN = 'VERDIKT: NYITOTT TETEL | DashboardViewPage.tsx:90 mutans tulel, FIX ROUND: trillian'
HAND = '[computress, 2026-11-14 15:36 CET, date]\nTIER: LOW | csak teszt: a mutans most hal'
T_NINCS = 'VERDIKT: NINCS NYITOTT TETEL | @574811edde Y7 hal'


def fr(*rows):
    st = vp.card_state(vp.parse_verdicts(rows))[0]
    return st


check('fix round: marker + hand-off + later trillian NINCS closes',
      fr(('didi', 1, D_OPEN), ('computress', 2, HAND), ('trillian', 3, T_NINCS)), vp.NINCS)
closed = vp.parse_verdicts([('didi', 1, D_OPEN), ('computress', 2, HAND), ('trillian', 3, T_NINCS)])
check('fix round: the scope says who closed it', 'FIX ROUND: trillian NINCS-e zarta' in closed['didi'][1], True)
check('fix round: NO marker stays open',
      fr(('didi', 1, 'VERDIKT: NYITOTT TETEL | mutans tulel'), ('computress', 2, HAND), ('trillian', 3, T_NINCS)),
      vp.NYITOTT)
# didi's OWN entry, not the card state: the card is open anyway on trillian's NYITOTT, so the
# card state cannot tell whether didi's line was (wrongly) closed (mutant "closer token ignored").
for t_line in ('VERDIKT: NYITOTT TETEL | Y7 el', 'VERDIKT: majdnem kesz | Y7 el'):
    check('fix round: trillian %r does not close didi' % t_line[9:22],
          vp.parse_verdicts([('didi', 1, D_OPEN), ('computress', 2, HAND), ('trillian', 3, t_line)])['didi'][0],
          vp.NYITOTT)
check('fix round: no hand-off in between stays open',
      fr(('didi', 1, D_OPEN), ('trillian', 3, T_NINCS)), vp.NYITOTT)
check('fix round: hand-off only BEFORE didi\'s verdict stays open',
      fr(('computress', 0, HAND), ('didi', 1, D_OPEN), ('trillian', 3, T_NINCS)), vp.NYITOTT)
check('fix round: trillian NINCS BEFORE didi NYITOTT stays open',
      fr(('trillian', 0, T_NINCS), ('computress', 1, HAND), ('didi', 2, D_OPEN)), vp.NYITOTT)
check('fix round: marker on its own line, not the verdict line, stays open (literal rule)',
      fr(('didi', 1, 'VERDIKT: NYITOTT TETEL | mutans tulel\nFIX ROUND: trillian'), ('computress', 2, HAND),
         ('trillian', 3, T_NINCS)), vp.NYITOTT)
check('fix round: another name hands nothing over',
      fr(('didi', 1, 'VERDIKT: NYITOTT TETEL | x, FIX ROUND: ford'), ('computress', 2, HAND), ('trillian', 3, T_NINCS)),
      vp.NYITOTT)
check('fix round: trillian\'s own TIER line is not the hand-off',
      fr(('didi', 1, D_OPEN), ('trillian', 2, 'TIER: LOW | x'), ('trillian', 3, T_NINCS)), vp.NYITOTT)
check('fix round: a later didi NYITOTT without marker reopens',
      fr(('didi', 1, D_OPEN), ('computress', 2, HAND), ('trillian', 3, T_NINCS),
         ('didi', 4, 'VERDIKT: NYITOTT TETEL | uj lelet')), vp.NYITOTT)
check('fix round: only didi is closed this way (ford NYITOTT with marker stays open)',
      fr(('ford', 1, D_OPEN), ('computress', 2, HAND), ('trillian', 3, T_NINCS)), vp.NYITOTT)

# --- CONTROL, both directions: the classifier can say each of the three ---------------
kinds = {tok('VERDIKT: NINCS NYITOTT TETEL | x'),
         tok('VERDIKT: NYITOTT TETEL | x'),
         tok('VERDIKT: valami mas | x')}
check('the meter can say all three', kinds, {vp.NINCS, vp.NYITOTT, vp.UNMEASURABLE})

if FAILED:
    print('\n'.join('FAIL ' + f for f in FAILED))
    sys.exit(1)
print('All verdict-parse contract tests passed (%d).' % len(RAN))
