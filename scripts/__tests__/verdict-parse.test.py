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


def check(name, got, want):
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

# --- CONTROL, both directions: the classifier can say each of the three ---------------
kinds = {tok('VERDIKT: NINCS NYITOTT TETEL | x'),
         tok('VERDIKT: NYITOTT TETEL | x'),
         tok('VERDIKT: valami mas | x')}
check('the meter can say all three', kinds, {vp.NINCS, vp.NYITOTT, vp.UNMEASURABLE})

if FAILED:
    print('\n'.join('FAIL ' + f for f in FAILED))
    sys.exit(1)
print('All verdict-parse contract tests passed (%d).' % 17)
