#!/usr/bin/env python3
r"""Review queue per lane (HIGH / NORMAL / LOW), with the EXACT filter printed in the header. Card 04b6ce26.

WHY THIS FILE EXISTS. Night of 2026-11-04/05: review lanes were handed out by hand three times and two
measurements gave different counts for the same pool, because each count used its own unstated
filter. marveen's rough "awaiting review" filter (a FIXED reviewer set didi/jarvis/trillian/friday)
then handed trillian 7 LOW cards of which NONE was waiting: the real reviewers were mandark, marveen
and ford, and the later author comments were format rewrites. So the two rules below are the core.

READ-ONLY. Dashboard API only (GET /api/kanban, GET /api/kanban/<id>/comments). No sqlite, no writes.

THE FILTER (all of it is also printed in the header of every run)
  population   cards with project = --project (default delta-crm; `all` = every project) and
               status in --status (default: testing), not archived.
  author       the card's ASSIGNEE. Nobody else is "the author".
  reviewer     ANY commenter other than the assignee who wrote a VERDIKT line (parsed with
               scripts/verdict-parse.py, the fleet's one parser). NOT a fixed list of names.
  lane         from the TIER line (`TIER: HIGH|MEDIUM|NORMAL|LOW` at the start of a line, optional
               `[who, date, date]` stamp) in ANY comment; the MOST SEVERE one wins (a reviewer may
               raise a tier, never lower it). HIGH and MEDIUM = lane HIGH. No TIER line: the card
               title (`.../LOW:`, `.../HIGH:`) if it says so, else lane NORMAL. The source is shown.
  state        WAITING    no reviewer has written a VERDIKT yet
               RECHECK    a reviewer VERDIKT exists, and the ASSIGNEE posted a NEW FIX after the
                          last reviewer VERDIKT. "New fix" = a commit/patch hash (7-64 hex chars,
                          at least one digit and one a-f letter) that appeared in NO earlier
                          comment of the card, or a `TIER:` hand-off line. A newer author comment
                          alone is NOT a new fix (format rewrites, batch notes, "restated").
               UNREADABLE the last reviewer VERDIKT line is not parseable (NEM MERHETO): unmeasured
               RETURNED   some reviewer's last VERDIKT is NYITOTT TETEL and no new fix since:
                          the ball is with the author, NOT in the review queue
               REVIEWED   every reviewer's last VERDIKT is NINCS NYITOTT TETEL, no new fix since
  queue        WAITING + RECHECK + UNREADABLE. RETURNED and REVIEWED are counted, not listed.
  not a filter REVIEW-CLAIM lines are only SHOWN (claimant, age); the card stays listed.

BLIND SPOT (counted, not listed): the new-fix search starts after the LAST VERDIKT of ANY reviewer. If reviewer A's
open item was fixed and another reviewer B wrote a later VERDIKT, A's pending re-check is not in the queue; the
header LIMIT line counts these cards (RETURNED/REVIEWED with a reviewer whose own last VERDIKT is older than a
new author fix). It is an upper bound: B's verdict may have covered the fix.

NOT MEASURED: the card description is not read (a hash only in the description counts as new);
comments beyond the API limit are reported as `omitted` in the header and make the run UNCLEAN.

USAGE
  python3 scripts/review-queue.py [--project P|all] [--status testing,waiting] [--lane HIGH|NORMAL|LOW]
                                  [--not-assignee NAME] [--limit N] [--json] [--title-width N]
  python3 scripts/review-queue.py --selftest
"""
import argparse
import importlib.util
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get('MARVEEN_API', 'http://localhost:3420')
TOKEN_FILE = os.environ.get('MARVEEN_DASH_TOKEN', os.path.join(HERE, '..', 'store', '.dashboard-token'))


def _load_vp():
    for p in (os.path.join(HERE, 'verdict-parse.py'), '/Users/isti/marveen/scripts/verdict-parse.py'):
        if os.path.exists(p):
            spec = importlib.util.spec_from_file_location('verdict_parse', p)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise SystemExit('verdict-parse.py not found next to this script')


vp = _load_vp()

TIER_LINE = re.compile(r'^\W*(?:\[[^\]]*date\]\s*)?TIER:\s*(HIGH|MEDIUM|NORMAL|LOW)\b', re.M)
TITLE_TIER = re.compile(r'(?:^|/|\b)(HIGH|LOW)\s*:')
CLAIM = re.compile(r'^\W*REVIEW-CLAIM\s+(\w+)', re.M)
HEXTOK = re.compile(r'\b[0-9a-f]{7,64}\b')
RANK = {'LOW': 0, 'NORMAL': 1, 'MEDIUM': 2, 'HIGH': 2}
LANES = ('HIGH', 'NORMAL', 'LOW')
QUEUE_STATES = ('WAITING', 'RECHECK', 'UNREADABLE')
ALL_STATES = QUEUE_STATES + ('RETURNED', 'REVIEWED')


def hashes(text):
    return {t for t in HEXTOK.findall(text.lower())
            if re.search(r'\d', t) and re.search(r'[a-f]', t)}


def tier_of(title, comments):
    """-> (lane, source). Most severe TIER line wins; title is the fallback; else NORMAL."""
    best = None
    for i, c in enumerate(comments):
        for m in TIER_LINE.finditer(c['content']):
            t = m.group(1)
            if best is None or RANK[t] > RANK[best[0]]:
                best = (t, 'comment %s' % c.get('id', i))
    if best:
        return ('HIGH' if best[0] == 'MEDIUM' else best[0]), best[1]
    m = TITLE_TIER.search(title or '')
    if m:
        return m.group(1), 'title'
    return 'NORMAL', 'none'


def _fix_after(comments, assignee, idx):
    """True when the assignee posted a new hash (seen in no comment up to idx) or a TIER line after idx."""
    seen = set()
    for c in comments[:idx + 1]:
        seen |= hashes(c['content'])
    for c in comments[idx + 1:]:
        if c.get('author') != assignee:
            continue
        if hashes(c['content']) - seen or TIER_LINE.search(c['content']):
            return True
    return False


def classify_card(card, comments):
    """-> dict(state, why, lane, tier_src, reviewers{name:token}, claim)."""
    assignee = card.get('assignee') or ''
    lane, src = tier_of(card.get('title'), comments)
    last_rev = {}          # reviewer -> (index, token)
    last_idx = -1
    for i, c in enumerate(comments):
        a = c.get('author')
        for line in c['content'].split('\n'):
            got = vp.classify(line, a)
            if got and a != assignee:
                last_rev[a] = (i, got[0])
                last_idx = max(last_idx, i)
    claim = None
    for i, c in enumerate(comments):
        for m in CLAIM.finditer(c['content']):
            claim = (m.group(1), c['created_at'])
    base = dict(lane=lane, tier_src=src, claim=claim,
                reviewers={a: v[1] for a, v in sorted(last_rev.items())})
    if not last_rev:
        return dict(base, state='WAITING', why='no reviewer VERDIKT yet')
    seen = set()
    for c in comments[:last_idx + 1]:
        seen |= hashes(c['content'])
    new_fix = None
    for c in comments[last_idx + 1:]:
        if c.get('author') != assignee:
            continue
        fresh = hashes(c['content']) - seen
        if fresh:
            new_fix = 'new hash %s' % sorted(fresh)[0][:12]
        elif TIER_LINE.search(c['content']):
            new_fix = 'new TIER hand-off line'
        if new_fix:
            break
    toks = {v[1] for v in last_rev.values()}
    if new_fix:
        return dict(base, state='RECHECK', why='author %s after last reviewer verdict' % new_fix)
    # Blind spot, counted not listed: a reviewer whose OWN last verdict is older than the assignee's new
    # fix, while another reviewer wrote a later verdict. The later verdict may or may not have covered
    # that fix, so the card is NOT put back in the queue (it would swamp the lanes), but it is counted.
    # The reviewer who wrote the very last verdict needs no guard: a fix after it returned RECHECK above.
    base['hidden_recheck'] = any(_fix_after(comments, assignee, i_r) for i_r, _ in last_rev.values())
    if vp.NYITOTT in toks:
        return dict(base, state='RETURNED', why='open item from ' + ','.join(
            a for a, v in sorted(last_rev.items()) if v[1] == vp.NYITOTT))
    if vp.UNMEASURABLE in toks:
        return dict(base, state='UNREADABLE', why='verdict line not parseable: ' + ','.join(
            a for a, v in sorted(last_rev.items()) if v[1] == vp.UNMEASURABLE))
    return dict(base, state='REVIEWED', why='all reviewers NINCS NYITOTT TETEL')


def api(path):
    tok = open(TOKEN_FILE).read().strip()
    req = urllib.request.Request(BASE + path, headers={'Authorization': 'Bearer ' + tok})
    return json.load(urllib.request.urlopen(req, timeout=30))


def age(secs):
    if secs is None:
        return '?'
    h = max(0, int(time.time() - secs)) // 3600
    return '%dd%02dh' % (h // 24, h % 24) if h >= 24 else '%dh' % h


def run(args):
    now = time.strftime('%Y-%m-%d %H:%M:%S %Z')
    statuses = [s.strip() for s in args.status.split(',') if s.strip()]
    board = api('/api/kanban?fields=summary')
    if isinstance(board, dict):
        board = board.get('cards', board)
    total = len(board)
    pop = [c for c in board
           if c.get('status') in statuses and not c.get('archived_at')
           and (args.project == 'all' or c.get('project') == args.project)]
    dropped = 0
    if args.not_assignee:
        keep = [c for c in pop if c.get('assignee') != args.not_assignee]
        dropped = len(pop) - len(keep)
        pop = keep
    rows, omitted = [], 0
    for c in pop:
        cm = api('/api/kanban/%s/comments?limit=1000' % c['id'])
        omitted += cm.get('omitted', 0) or 0
        r = classify_card(c, cm['comments'])
        r.update(id=c['id'], title=c.get('title') or '', assignee=c.get('assignee') or '-',
                 priority=c.get('priority'), since=c.get('last_status_at'))
        rows.append(r)
    counts = {s: sum(1 for r in rows if r['state'] == s) for s in ALL_STATES}
    queue = [r for r in rows if r['state'] in QUEUE_STATES]
    hidden = sum(1 for r in rows if r['state'] in ('RETURNED', 'REVIEWED') and r.get('hidden_recheck'))
    per_lane = {ln: [r for r in queue if r['lane'] == ln] for ln in LANES}
    if args.json:
        print(json.dumps(dict(measured=now, board_cards=total, population=len(rows), states=counts,
                              omitted_comments=omitted, hidden_recheck=hidden, queue=queue), ensure_ascii=False, indent=1))
        return 0 if not omitted else 1
    out = ['REVIEW QUEUE | measured %s | board snapshot: %d cards' % (now, total),
           'FILTER  population: project=%s, status in {%s}, not archived%s' % (
               args.project, ','.join(statuses),
               (', assignee != %s (dropped %d)' % (args.not_assignee, dropped)) if args.not_assignee else ''),
           'FILTER  author = the card ASSIGNEE; reviewer = ANY other commenter who wrote a VERDIKT line (no fixed list)',
           'FILTER  lane = most severe TIER line in any comment (HIGH+MEDIUM -> HIGH), else title /LOW: /HIGH:, else NORMAL',
           'FILTER  RECHECK only on a NEW FIX after the last reviewer VERDIKT: a hash seen in no earlier comment, or a TIER hand-off line; a newer author comment alone is NOT',
           'FILTER  queue = WAITING + RECHECK + UNREADABLE; REVIEW-CLAIM is shown, never excludes; description not read',
           'DENOMINATOR  population %d = %s' % (len(rows), ' + '.join('%s %d' % (s, counts[s]) for s in ALL_STATES)),
           'DENOMINATOR  queue %d = %s' % (len(queue), ' + '.join('%s %d' % (ln, len(per_lane[ln])) for ln in LANES)),
           'LIMIT  %d of the RETURNED+REVIEWED cards have a reviewer whose own last VERDIKT is older than a new author fix, '
           'hidden by another reviewer\'s later VERDIKT (upper bound: it may have covered the fix); counted here, NOT in the queue' % hidden]
    if omitted:
        out.append('UNCLEAN  %d comments omitted by the API limit: counts may be off' % omitted)
    out.append('')
    for ln in LANES:
        if args.lane and args.lane != ln:
            continue
        cards = sorted(per_lane[ln], key=lambda r: (r['since'] or 0))
        out.append('== %s lane: %d card(s) (oldest first) ==' % (ln, len(cards)))
        for r in cards[:args.limit] if args.limit else cards:
            cl = ' claim:%s/%s' % (r['claim'][0], age(r['claim'][1])) if r['claim'] else ''
            out.append('%s  %-10s %-6s %-10s %s%s' % (
                r['id'][:8], r['assignee'], age(r['since']), r['state'],
                r['title'][:args.title_width], cl))
            out.append('          tier src: %s | %s' % (r['tier_src'], r['why']))
        out.append('')
    print('\n'.join(out))
    return 0 if not omitted else 1


def main():
    ap = argparse.ArgumentParser(description='Review queue per lane')
    ap.add_argument('--project', default='delta-crm')
    ap.add_argument('--status', default='testing')
    ap.add_argument('--lane', choices=LANES)
    ap.add_argument('--not-assignee', dest='not_assignee')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--title-width', type=int, default=70)
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--selftest', action='store_true')
    args = ap.parse_args()
    if args.selftest:
        sys.path.insert(0, os.path.join(HERE, '__tests__'))
        return os.system('python3 %s' % os.path.join(HERE, '__tests__', 'review-queue.test.py')) != 0
    return run(args)


if __name__ == '__main__':
    sys.exit(main())
