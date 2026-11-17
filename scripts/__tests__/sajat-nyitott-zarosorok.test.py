#!/usr/bin/env python3
"""scripts/sajat-nyitott-zarosorok.sh: the list of an agent's own stale open verdict lines (card a31c7af0).

Every case is a fixture, nothing reads the API, nothing is written. The control has both
directions, because a lister that printed every card, or none, would pass half of this file:

    POSITIVE  an open line of ford, then a clean line of another author   -> listed
    NEGATIVE  ford closed it himself / the clean line is OLDER / the clean author reopened /
              the clean line is a relay (TOVABBITVA:) / the card is archived  -> NOT listed

The last output line (what was read) is asserted too: an empty list must say how much it read.

Run: python3 scripts/__tests__/sajat-nyitott-zarosorok.test.py   Exit 0 = all pass.
"""
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, '..', 'sajat-nyitott-zarosorok.sh')
spec = importlib.util.spec_from_file_location('szn', os.path.join(HERE, '..', 'sajat_nyitott_zarosorok.py'))
szn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(szn)

FAILURES = []
_id = [100]


def check(name, ok, detail=''):
    print(('  OK    ' if ok else '  BUKO  ') + name + (('  -- ' + detail) if (detail and not ok) else ''))
    if not ok:
        FAILURES.append(name)


def cm(author, content, t):
    _id[0] += 1
    return {'id': _id[0], 'author': author, 'content': content, 'created_at': t}


def card(cid, status='testing', archived=None):
    return {'id': cid, 'status': status, 'archived_at': archived}


OPEN = 'VERDIKT: NYITOTT TETEL | oka'
CLEAN = 'VERDIKT: NINCS NYITOTT TETEL | rendben'
T = 1_794_000_000  # a fixed epoch second, 2026-11-09

FIX = {
    'cards': [
        card('aaaaaaaa-pos'), card('bbbbbbbb-self'), card('cccccccc-older'), card('dddddddd-relay'),
        card('eeeeeeee-arch', archived=T), card('ffffffff-reopen'), card('11111111-stamp'),
        card('22222222-held'), card('33333333-nobody'), card('55555555-fordclean'),
    ],
    'comments': {
        'aaaaaaaa-pos': [cm('ford', OPEN, T), cm('trillian', CLEAN, T + 60)],
        'bbbbbbbb-self': [cm('ford', OPEN, T), cm('trillian', CLEAN, T + 60), cm('ford', CLEAN, T + 120)],
        'cccccccc-older': [cm('trillian', CLEAN, T), cm('ford', OPEN, T + 60)],
        'dddddddd-relay': [cm('ford', OPEN, T), cm('jarvis', 'TOVABBITVA: trillian 12:00\n' + CLEAN, T + 60)],
        'eeeeeeee-arch': [cm('ford', OPEN, T), cm('trillian', CLEAN, T + 60)],
        'ffffffff-reopen': [cm('ford', OPEN, T), cm('trillian', CLEAN, T + 60), cm('trillian', OPEN, T + 120)],
        '11111111-stamp': [cm('ford', '[ford, 2026-11-09 08:00 CET, date] ' + OPEN, T), cm('didi', CLEAN, T + 60)],
        '22222222-held': [cm('ford', OPEN, T), cm('marveen', OPEN, T + 30), cm('trillian', CLEAN, T + 60)],
        '33333333-nobody': [cm('trillian', CLEAN, T), cm('didi', CLEAN, T + 5)],
        '55555555-fordclean': [cm('ford', CLEAN, T), cm('trillian', CLEAN, T + 60)],
    },
}


def listed(agent, fix=FIX):
    out = io.StringIO()
    szn.run(agent, fix['cards'], fix['comments'], out)
    lines = out.getvalue().splitlines()
    return [ln.split('\t') for ln in lines[:-1]], lines[-1]


rows, summary = listed('ford')
ids = sorted(r[0] for r in rows)
print('lista:', ids)

# POSITIVE controls
check('open line + later clean line of another author is listed', 'aaaaaaaa' in ids, str(ids))
check("the author's own timestamp prefix is read as the same line", '11111111' in ids, str(ids))
check('a card where someone else also holds it open is listed AND names the other holder',
      any(r[0] == '22222222' and r[7] == 'marveen' for r in rows), str(rows))
pos = [r for r in rows if r[0] == 'aaaaaaaa'][0]
check('the row names open comment, clean author and clean comment',
      pos[4] == 'trillian' and pos[2].isdigit() and pos[5].isdigit() and int(pos[5]) > int(pos[2]), str(pos))

# NEGATIVE controls
check('the agent closed it himself: not listed', 'bbbbbbbb' not in ids)
check('the clean line is OLDER than the open one: not listed', 'cccccccc' not in ids)
check('a relayed (TOVABBITVA:) clean line is not a verdict: not listed', 'dddddddd' not in ids)
check('an archived card is not listed', 'eeeeeeee' not in ids)
check('the clean author reopened afterwards: not listed', 'ffffffff' not in ids)
check('a card where the agent wrote nothing: not listed', '33333333' not in ids)
check("the agent's own last line is CLEAN (another clean line after it): not listed", '55555555' not in ids)
check('exactly the three expected cards', ids == ['11111111', '22222222', 'aaaaaaaa'], str(ids))

# A relay that merely MENTIONS the word is flagged, not dropped
mention = {
    'cards': [card('44444444-note')],
    'comments': {'44444444-note': [cm('ford', OPEN, T), cm('jarvis', 'a tovabbitas utan:\n' + CLEAN, T + 60)]},
}
mrows, _ = listed('ford', mention)
check('a clean line whose comment mentions a relay is listed with TOVABBIT=igen',
      len(mrows) == 1 and mrows[0][8] == 'igen', str(mrows))
check('...and a plain one has TOVABBIT=nem', pos[8] == 'nem', str(pos))

# The counter: an empty answer must say how much it read
erows, esummary = listed('deeper')
check('another agent with no verdict line: empty list', erows == [], str(erows))
check('...but the last line states cards, comments, own verdict cards and what was listed',
      esummary.startswith('OLVASTAM: 9 kartya, ') and 'deeper-nak 0 kartyan' in esummary and esummary.endswith('LISTAZVA: 0'),
      esummary)
check('the read count excludes the archived card (10 fixtures, 9 read)', ' 9 kartya, ' in summary, summary)
check('own-verdict cards and open ones are counted', 'ford-nak 8 kartyan van VERDIKT sora, ebbol 6 nyitott' in summary, summary)


# The shell entry: exit codes
def sh(*args):
    return subprocess.run(['bash', SCRIPT, *args], capture_output=True, text=True, timeout=60)


with tempfile.TemporaryDirectory() as d:
    good = os.path.join(d, 'fix.json')
    json.dump(FIX, open(good, 'w'))
    empty = os.path.join(d, 'empty.json')
    json.dump({'cards': [], 'comments': {}}, open(empty, 'w'))
    bad = os.path.join(d, 'bad.json')
    open(bad, 'w').write('{nope')
    r = sh('ford', '--fixture', good)
    check('shell entry: rc 0, three rows plus the counter line',
          r.returncode == 0 and len(r.stdout.splitlines()) == 4 and r.stdout.splitlines()[-1].startswith('OLVASTAM:'),
          '%s %r' % (r.returncode, r.stdout))
    r = sh('ford', '--fixture', empty)
    check('zero cards read is rc 3, not an empty answer', r.returncode == 3, '%s %r' % (r.returncode, r.stderr))
    r = sh('ford', '--fixture', bad)
    check('an unreadable fixture is rc 1', r.returncode == 1, '%s %r' % (r.returncode, r.stderr))
    r = sh('ford', '--fixture', os.path.join(d, 'missing.json'))
    check('a missing fixture is rc 1', r.returncode == 1, str(r.returncode))
    r = sh()
    check('no agent given is rc 2 (usage)', r.returncode == 2, '%s %r' % (r.returncode, r.stderr))

print('PASS' if not FAILURES else 'FAIL: %d' % len(FAILURES))
sys.exit(1 if FAILURES else 0)
