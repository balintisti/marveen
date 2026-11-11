#!/usr/bin/env python3
"""Contract tests for scripts/review-queue.py (card 04b6ce26). Pure: no API, synthetic comments.

Each case is a trap measured on 2026-11-04/05: a fixed reviewer list, a later author comment
read as a new fix, an assignee VERDIKT read as a review, a tier lowered by a later comment.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location('review_queue', os.path.join(HERE, '..', 'review-queue.py'))
rq = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rq)
vp = rq.vp

FAILED = []
RAN = []


def check(name, got, want):
    RAN.append(name)
    if got != want:
        FAILED.append('%s: got %r, want %r' % (name, got, want))


_n = [0]


def cm(author, content):
    _n[0] += 1
    return dict(id=_n[0], author=author, content=content, created_at=1000 + _n[0])


CARD = dict(id='c1', title='[BUG] x', assignee='dexter')
H1, H2 = 'a1b2c3d4e5', 'f6e5d4c3b2'
NINCS = 'VERDIKT: NINCS NYITOTT TETEL | ok'
NYIT = 'VERDIKT: NYITOTT TETEL | baj'


def st(comments, card=CARD):
    r = rq.classify_card(card, comments)
    return r['state'], r['lane']


# --- states -------------------------------------------------------------------------
check('no comment = WAITING', st([]), ('WAITING', 'NORMAL'))
check('author only = WAITING', st([cm('dexter', 'TIER: LOW. fix ' + H1)]), ('WAITING', 'LOW'))
check('reviewer NINCS = REVIEWED', st([cm('dexter', 'fix ' + H1), cm('didi', NINCS)])[0], 'REVIEWED')
check('reviewer NYITOTT = RETURNED', st([cm('dexter', 'fix ' + H1), cm('didi', NYIT)])[0], 'RETURNED')
check('unparsable = UNREADABLE', st([cm('dexter', 'fix ' + H1), cm('didi', 'VERDIKT: NEM MERHETO | x')])[0], 'UNREADABLE')

# --- a reviewer's LAST verdict counts (review 58925, Mh) ------------------------------------
check('same reviewer NYITOTT, fix, NINCS = REVIEWED',
      st([cm('dexter', 'fix ' + H1), cm('didi', NYIT), cm('dexter', 'fixed ' + H2), cm('didi', NINCS)])[0], 'REVIEWED')
check('same reviewer NINCS, fix, NYITOTT = RETURNED',
      st([cm('dexter', 'fix ' + H1), cm('didi', NINCS), cm('dexter', 'fixed ' + H2), cm('didi', NYIT)])[0], 'RETURNED')

# --- REVIEW-CLAIM is only shown, never excludes (review 58925, Mg) -----------------------------
claimed = rq.classify_card(CARD, [cm('dexter', 'fix ' + H1), cm('trillian', 'REVIEW-CLAIM trillian 2026-11-11')])
check('claim is reported', claimed['claim'][0], 'trillian')
check('a claimed card is still WAITING', claimed['state'], 'WAITING')

# --- blind spot: another reviewer's later verdict hides A's pending re-check (58925, LELET 2) --
def hid(comments):
    r = rq.classify_card(CARD, comments)
    return r['state'], r['hidden_recheck']


check('A NYITOTT, fix, B NINCS = RETURNED and flagged hidden',
      hid([cm('dexter', 'fix ' + H1), cm('didi', NYIT), cm('dexter', 'fixed ' + H2), cm('mandark', NINCS)]),
      ('RETURNED', True))
check('A NYITOTT, B NINCS, no fix between = not hidden',
      hid([cm('dexter', 'fix ' + H1), cm('didi', NYIT), cm('mandark', NINCS)]), ('RETURNED', False))
check('one reviewer, NYITOTT, no fix = not hidden', hid([cm('dexter', 'fix ' + H1), cm('didi', NYIT)]), ('RETURNED', False))
check('a rewrite without a new hash between two verdicts is not hidden',
      hid([cm('dexter', 'fix ' + H1), cm('didi', NYIT), cm('dexter', 'restated ' + H1), cm('mandark', NINCS)]),
      ('RETURNED', False))

check('a hash quoted in the earlier verdict itself is not a new fix when restated',
      hid([cm('dexter', 'fix'), cm('didi', NYIT + ' @' + H1), cm('dexter', 'restated ' + H1), cm('mandark', NINCS)]),
      ('RETURNED', False))
check('a hash from a non-assignee between two verdicts is not a fix',
      hid([cm('dexter', 'fix ' + H1), cm('didi', NYIT), cm('trillian', 'try ' + H2), cm('mandark', NINCS)]),
      ('RETURNED', False))
check('a TIER line from a non-assignee between two verdicts is not a fix',
      hid([cm('dexter', 'fix ' + H1), cm('didi', NYIT), cm('trillian', 'TIER: LOW. again'), cm('mandark', NINCS)]),
      ('RETURNED', False))
check('the fix between two verdicts hides the EARLIER reviewer, REVIEWED card too',
      hid([cm('dexter', 'fix ' + H1), cm('didi', NINCS), cm('dexter', 'fixed ' + H2), cm('mandark', NINCS)]),
      ('REVIEWED', True))

# --- rule 1: reviewer = ANY non-assignee commenter with a VERDIKT ------------------------
check('unlisted reviewer counts', st([cm('dexter', 'fix ' + H1), cm('mandark', NINCS)])[0], 'REVIEWED')
check('assignee VERDIKT is not a review', st([cm('dexter', NINCS)])[0], 'WAITING')
check('non-VERDIKT reviewer chatter is not a review', st([cm('didi', 'looks fine to me')])[0], 'WAITING')

# --- rule 2: RECHECK only on a NEW hash or a TIER hand-off line ---------------------------
check('NYITOTT + new hash = RECHECK',
      st([cm('dexter', 'fix ' + H1), cm('didi', NYIT), cm('dexter', 'fixed in ' + H2)])[0], 'RECHECK')
check('NINCS + new hash = RECHECK',
      st([cm('dexter', 'fix ' + H1), cm('didi', NINCS), cm('dexter', 'next ' + H2)])[0], 'RECHECK')
check('rewrite re-quoting an old hash stays RETURNED',
      st([cm('dexter', 'fix ' + H1), cm('didi', NYIT), cm('dexter', 'restated, same ' + H1)])[0], 'RETURNED')
check('rewrite without hash stays REVIEWED',
      st([cm('dexter', 'fix ' + H1), cm('didi', NINCS), cm('dexter', 'summary for Isti')])[0], 'REVIEWED')
check('TIER hand-off after verdict = RECHECK',
      st([cm('dexter', 'fix ' + H1), cm('didi', NYIT), cm('dexter', 'TIER: LOW. again')])[0], 'RECHECK')
check('a hash before the verdict is not new',
      st([cm('dexter', 'a ' + H1), cm('dexter', 'b ' + H2), cm('didi', NINCS)])[0], 'REVIEWED')
check('only the assignee can make a new fix',
      st([cm('dexter', 'fix ' + H1), cm('didi', NYIT), cm('trillian', 'try ' + H2)])[0], 'RETURNED')
check('one reviewer NYITOTT among NINCS = RETURNED',
      st([cm('dexter', 'fix ' + H1), cm('didi', NINCS), cm('mandark', NYIT)])[0], 'RETURNED')

# --- lanes ------------------------------------------------------------------------------
check('MEDIUM -> HIGH lane', st([cm('dexter', 'TIER: MEDIUM. x')])[1], 'HIGH')
check('reviewer raise is kept', st([cm('dexter', 'TIER: LOW. x'), cm('didi', 'TIER: HIGH (raised)')])[1], 'HIGH')
check('HIGH raises over an earlier NORMAL', st([cm('dexter', 'TIER: NORMAL. x'), cm('didi', 'TIER: HIGH (raised)')])[1], 'HIGH')
check('a later LOW never lowers', st([cm('dexter', 'TIER: HIGH. x'), cm('dexter', 'TIER: LOW. y')])[1], 'HIGH')
check('title fallback LOW', st([], dict(CARD, title='[x]/LOW: copy'))[1], 'LOW')
check('no tier = NORMAL', st([cm('dexter', 'hello')])[1], 'NORMAL')

# --- run(): population filter, queue content, denominator (api stubbed, nothing leaves the process) ----
import contextlib
import io
import json
import re
from types import SimpleNamespace

BOARD = [
    dict(id='w1', status='testing', project='delta-crm', assignee='dexter', title='waiting'),
    dict(id='u1', status='testing', project='delta-crm', assignee='dexter', title='unreadable'),
    dict(id='r1', status='testing', project='delta-crm', assignee='dexter', title='returned'),
    dict(id='d1', status='testing', project='delta-crm', assignee='dexter', title='reviewed'),
    dict(id='a1', status='testing', project='delta-crm', assignee='dexter', title='archived', archived_at=5),
    dict(id='p1', status='testing', project='marveen', assignee='dexter', title='other project'),
    dict(id='s1', status='planned', project='delta-crm', assignee='dexter', title='other status'),
    dict(id='f1', status='testing', project='delta-crm', assignee='ford', title='ford card'),
]
THREADS = {
    'w1': [cm('dexter', 'fix ' + H1)],
    'u1': [cm('dexter', 'fix ' + H1), cm('didi', 'VERDIKT: NEM MERHETO | x')],
    'r1': [cm('dexter', 'fix ' + H1), cm('didi', NYIT)],
    'd1': [cm('dexter', 'fix ' + H1), cm('didi', NINCS)],
    'a1': [cm('dexter', 'fix ' + H1)],
    'p1': [cm('dexter', 'fix ' + H1)],
    's1': [cm('dexter', 'fix ' + H1)],
    'f1': [cm('ford', 'fix ' + H1)],
}


def fake_api(path):
    m = re.match(r'/api/kanban/(\w+)/comments', path)
    if m:
        return dict(comments=THREADS[m.group(1)], omitted=0)
    return BOARD


def run_json(**over):
    args = SimpleNamespace(project='delta-crm', status='testing', lane=None, not_assignee=None,
                           limit=0, title_width=70, json=True)
    for k, v in over.items():
        setattr(args, k, v)
    real, buf = rq.api, io.StringIO()
    rq.api = fake_api
    try:
        with contextlib.redirect_stdout(buf):
            rc = rq.run(args)
    finally:
        rq.api = real
    return rc, json.loads(buf.getvalue())


rc, out = run_json()
check('run: exit 0 when nothing is omitted', rc, 0)
check('run: population = project + status, archived excluded', out['population'], 5)
check('run: denominator sums to the population', sum(out['states'].values()), out['population'])
check('run: states', out['states'], dict(WAITING=2, RECHECK=0, UNREADABLE=1, RETURNED=1, REVIEWED=1))
check('run: queue = WAITING + RECHECK + UNREADABLE, not RETURNED/REVIEWED',
      sorted(r['id'] for r in out['queue']), ['f1', 'u1', 'w1'])
check('run: hidden re-check count is 0 when nothing is hidden', out['hidden_recheck'], 0)
THREADS['x1'] = [cm('dexter', 'fix ' + H1), cm('didi', NYIT), cm('dexter', 'fixed ' + H2), cm('mandark', NINCS)]
THREADS['k1'] = [cm('dexter', 'fix ' + H1), cm('trillian', 'REVIEW-CLAIM trillian')]
BOARD.extend([dict(id='x1', status='testing', project='delta-crm', assignee='dexter', title='hidden'),
              dict(id='k1', status='testing', project='delta-crm', assignee='dexter', title='claimed')])
rc, out2 = run_json()
check('run: hidden re-check is counted, the card stays out of the queue',
      (out2['hidden_recheck'], 'x1' in [r['id'] for r in out2['queue']]), (1, False))
check('run: a REVIEW-CLAIM card stays in the queue', 'k1' in [r['id'] for r in out2['queue']], True)
rc, out = run_json(not_assignee='ford')
check('run: --not-assignee drops that author', sorted(r['id'] for r in out['queue']), ['k1', 'u1', 'w1'])
check('run: a status filter reaches the other status', run_json(status='planned')[1]['population'], 1)

# --- helpers ----------------------------------------------------------------------------
check('hash needs a digit and a letter', rq.hashes('deadbeef 1234567 a1b2c3d'), {'a1b2c3d'})

if FAILED:
    print('FAILED %d/%d' % (len(FAILED), len(RAN)))
    print('\n'.join(FAILED))
    sys.exit(1)
print('OK %d checks' % len(RAN))
