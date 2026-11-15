#!/usr/bin/env python3
"""List the cards where AN AGENT'S OWN last verdict line is still open and someone
else has since written a clean one. LIST ONLY: nothing is closed, written or moved.

    bash scripts/sajat-nyitott-zarosorok.sh <agent> [--fixture FILE]

WHY THIS EXISTS (card a31c7af0, Isti Telegram 10065). On 2026-11-14 friday asked three
times, by hand, for the closing of my own stale open lines on the vonat-3 cards (msg
10019373: 8 cards, msg 10019443: 1 card), and every one of them held back a card that was
ready to ship. The close gate reads the LAST `VERDIKT:` line of every author, so a line of
mine that says `NYITOTT TETEL` keeps the card open after the reviewer has written
`NINCS NYITOTT TETEL`, until the author who wrote it says so. Only the writer can say so,
and nobody knew which cards those were. friday's census (agents/friday/bin/crm-census.py,
column open_by) already reads WHO holds a card open; this prints that reading per agent,
for any member of the fleet.

WHAT COUNTS (the same reading as the close gate, copied verbatim from the census):
  - a verdict line is a line that starts with `VERDIKT:` (an agent's own timestamp prefix
    `[agent, YYYY-MM-DD HH:MM CET, date] ` is stripped when it is the author's own);
  - an author's verdict is their LAST such line on the card;
  - open  = `NYITOTT TETEL` (optionally with a parenthesis), clean = `NINCS NYITOTT TETEL`;
    accents, case and everything after `|` or ` -- ` are ignored.
A card is listed when ALL hold: it is not archived; <agent>'s last verdict is open; ANOTHER
author's last verdict is clean and was written AFTER the open one (comment time, then id).

A FORWARDED VERDICT IS NOT A VERDICT. A comment that carries a line starting with
`TOVABBITVA:` (jarvis relays a reviewer's verdict that way) contributes no verdict lines
at all, in either direction: a relay is not the reviewer's own reading. The column
`TOVABBIT` shows `igen` when the clean line sits in a comment that mentions a relay
anywhere, so a human can look before closing.

OUTPUT, one line per card, tab separated:
  card  status  open_comment  open_date  clean_author  clean_comment  clean_date  other_open  TOVABBIT
  `other_open` names the OTHER authors whose last line is still open (the card stays held
  even after <agent> closes theirs); `-` when nobody else holds it.
The LAST line always states what was read, so an empty result cannot pass for a negative:
  OLVASTAM: <cards> kartya, <comments> komment; <agent>-nak <n> kartyan van VERDIKT sora,
  ebbol <k> nyitott; LISTAZVA: <m>

Exit: 0 ran | 1 API or fixture unreadable | 2 usage | 3 ZERO cards read (reading nothing
is a failure, not an empty answer).
Env: MARVEEN_TOKEN_FILE, MARVEEN_API_BASE (same defaults as scripts/card-comment.sh).
Dates are Europe/Belgrade.
"""
import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from zoneinfo import ZoneInfo

TOKEN_FILE = os.environ.get('MARVEEN_TOKEN_FILE', '/Users/isti/marveen/store/.dashboard-token')
API_BASE = os.environ.get('MARVEEN_API_BASE', 'http://localhost:3420').rstrip('/')
TZ = ZoneInfo('Europe/Belgrade')

# --- the close gate's reading, verbatim from agents/friday/bin/crm-census.py ------------------
OWN_STAMP = re.compile(r'^\[([^\],]+), \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? [A-Z]{3,5}, date\] ')
OPEN_TOKEN = re.compile(r'^NYITOTT TETEL(?: \([^)]*\))?$')


def verdict_token(line):
    rest = line[len('VERDIKT:'):]
    cut = [i for i in (rest.find('|'), rest.find(' -- ')) if i >= 0]
    rest = rest[:min(cut)] if cut else rest
    rest = ''.join(ch for ch in unicodedata.normalize('NFD', rest) if not unicodedata.combining(ch))
    return re.sub(r'\s+', ' ', rest.upper()).strip()
# --- end of the copied reading -----------------------------------------------------------------

CLEAN_TOKEN = re.compile(r'^NINCS NYITOTT TETEL(?: \([^)]*\))?$')


def _plain(text):
    folded = ''.join(ch for ch in unicodedata.normalize('NFD', text) if not unicodedata.combining(ch))
    return folded.upper()


def is_relay(comment):
    """A comment with a line that starts with `TOVABBITVA:` (accent and case blind)."""
    return any(_plain(ln).lstrip().startswith('TOVABBITVA:') for ln in (comment.get('content') or '').splitlines())


def mentions_relay(comment):
    return 'TOVABBIT' in _plain(comment.get('content') or '')


def order_key(comment):
    return (comment.get('created_at') or 0, comment.get('id') or 0)


def last_verdicts(comments):
    """author -> (line, comment) of the author's last verdict line; relays contribute nothing."""
    last = {}
    for x in sorted(comments, key=order_key):
        if is_relay(x):
            continue
        for raw in (x.get('content') or '').splitlines():
            m = OWN_STAMP.match(raw)
            line = raw[m.end():] if m and m.group(1) == x.get('author') else raw
            if line.startswith('VERDIKT:'):
                last.pop(x.get('author'), None)
                last[x.get('author')] = (line.rstrip(), x)
    return last


def stamp(comment):
    t = comment.get('created_at') or 0
    if t > 1e11:  # milliseconds
        t = t / 1000
    return datetime.fromtimestamp(t, TZ).strftime('%Y-%m-%d %H:%M')


def stale_own_open(agent, comments):
    """None, or the fields of a card whose open line of `agent` was followed by a clean one."""
    last = last_verdicts(comments)
    mine = last.get(agent)
    if not mine or not OPEN_TOKEN.match(verdict_token(mine[0])):
        return None
    open_comment = mine[1]
    # The agent's own last line is open (checked above), so a clean line here is always
    # another author's: no author test is needed.
    later_clean = [
        (a, x) for a, (l, x) in last.items()
        if CLEAN_TOKEN.match(verdict_token(l)) and order_key(x) > order_key(open_comment)
    ]
    if not later_clean:
        return None
    clean_author, clean_comment = max(later_clean, key=lambda p: order_key(p[1]))
    others_open = sorted(a for a, (l, _) in last.items() if a != agent and OPEN_TOKEN.match(verdict_token(l)))
    return {
        'open_comment': open_comment.get('id'), 'open_date': stamp(open_comment),
        'clean_author': clean_author, 'clean_comment': clean_comment.get('id'),
        'clean_date': stamp(clean_comment),
        'other_open': ','.join(others_open) or '-',
        'relay': 'igen' if mentions_relay(clean_comment) else 'nem',
    }


def has_verdict(agent, comments):
    mine = last_verdicts(comments).get(agent)
    return (mine is not None), bool(mine and OPEN_TOKEN.match(verdict_token(mine[0])))


def api(path):
    with open(TOKEN_FILE) as f:
        token = f.read().strip()
    req = urllib.request.Request(API_BASE + path, headers={'Authorization': 'Bearer ' + token})
    return json.load(urllib.request.urlopen(req, timeout=60))


def load_api():
    cards = api('/api/kanban')
    cards = cards if isinstance(cards, list) else cards.get('cards', [])

    def one(c):
        got = api('/api/kanban/%s/comments' % c['id'])
        return c['id'], (got if isinstance(got, list) else got.get('comments', []))
    with ThreadPoolExecutor(8) as ex:
        comments = dict(ex.map(one, cards))
    return cards, comments


def load_fixture(path):
    with open(path) as f:
        data = json.load(f)
    return data['cards'], data['comments']


def run(agent, cards, comments, out):
    live = [c for c in cards if not c.get('archived_at')]
    listed = n_comments = with_verdict = open_now = 0
    for c in live:
        cs = comments.get(c['id'], [])
        n_comments += len(cs)
        has, is_open = has_verdict(agent, cs)
        with_verdict += has
        open_now += is_open
        hit = stale_own_open(agent, cs)
        if hit:
            listed += 1
            out.write('\t'.join([
                c['id'][:8], c.get('status') or '-', str(hit['open_comment']), hit['open_date'],
                hit['clean_author'], str(hit['clean_comment']), hit['clean_date'],
                hit['other_open'], hit['relay'],
            ]) + '\n')
    out.write('OLVASTAM: %d kartya, %d komment; %s-nak %d kartyan van VERDIKT sora, ebbol %d nyitott; LISTAZVA: %d\n'
              % (len(live), n_comments, agent, with_verdict, open_now, listed))
    return len(live)


def main(argv=None):
    ap = argparse.ArgumentParser(prog='sajat-nyitott-zarosorok.sh', add_help=True)
    ap.add_argument('agent')
    ap.add_argument('--fixture', help='JSON {"cards": [...], "comments": {id: [...]}} instead of the API')
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    try:
        cards, comments = load_fixture(args.fixture) if args.fixture else load_api()
    except Exception as e:  # noqa: BLE001 -- loud, with the cause
        sys.stderr.write('NEM OLVASHATO: %s: %s\n' % (type(e).__name__, e))
        return 1
    read = run(args.agent, cards, comments, sys.stdout)
    if read == 0:
        sys.stderr.write('NULLA kartya olvasva: ez hiba, nem ures valasz.\n')
        return 3
    return 0


if __name__ == '__main__':
    sys.exit(main())
