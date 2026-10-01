#!/usr/bin/env python3
"""done-vs-live: which FINISHED Delta-CRM cards carry work that is NOT in the live image (card e572a1c2).

WHY (Isti 4553, 2026-09-30). Measured that day: 173 done/testing cards whose work never reached
main, among them the terms-of-service page and a fix Isti ran into twice. Nobody owned the gap
between "the card is done" and "the code is live", so it grew in silence. Isti's rule since then:
done = LIVE. This script measures that rule every day, so the gap shows up in the morning brief
instead of in Isti's hands.

WHAT "LIVE" MEANS HERE. The target is the SHA in the Cloud Run image tag (both services), never
main and never a branch name: the image is what runs. For every done/testing delta-crm card, the
refs that name it (8 hex of the card id in the ref name, local + origin) are judged by CONTENT:

  (b) NOT-LIVE       a non-merge commit on one of the card's refs is not in the live history,
                     is not patch-equivalent to one that is, and its diff does not reverse-apply
                     on the live tree. The work was never shipped.
  (c) LINES-MISSING  every commit is in, but the tip's FULL delta (base..tip, base = the mainline
                     just before it landed) has added lines the live file no longer contains. This
                     is content that went in and was later removed: a revert, a bad hand
                     resolution, or a legitimate rewrite. Only a reader can tell which, so it is
                     reported separately from (b). Without this step a reverted card reads as LIVE
                     (didi's finding on 575f38bd, comment 23869; the 1c52b3e8 revert). Flagged only
                     when HALF or more of the delta's added lines are gone, or when a commit
                     named "revert..." touched a gap file after the tip; otherwise it is
                     EVOLVED (ordinary later development), counted but not headlined.
  LIVE               neither.
  NO-BRANCH          no ref names the card: not measurable by this method, counted, not judged.

WHY NOT scripts/landed-check.py (card 7eb6a490). It asks whether the SHAs a card's TEXT names
reached a TRUNK. This asks whether the card's BRANCHES reached the running IMAGE, by content. The
two differ exactly where it hurt: main is not the image (a merge whose deploy failed), a quoted SHA
is not the work (later commits on the branch), and ancestry cannot see a revert. Its subject leg
is reused here as a marker (subject_in_live), not as a pass.

ACKS. A card a person has looked at and judged ("rewritten by X", "obsolete") goes into
store/done-vs-live-acks.json with the fingerprint printed by this script. An ack holds only while
the fingerprint is unchanged: if one more commit or one more missing file appears, the card is
reported again. An ack that never expires would be a mute button.

A RUN THAT DID NOT HAPPEN IS NOT A CLEAN RUN. The result file carries measured_at and an `error`
field; napindito-sections.py says "nem futott le" when the file is missing, stale or errored, so a
dead meter and a quiet day stay distinguishable.

What it WRITES: `git fetch --prune origin` updates the shared repo's origin/* refs and deletes the
ones whose branch is gone (that is a write to the shared repo, said here because a fetch reads like
a read -- didi, e572a1c2); a throwaway index file; store/done-vs-live*.json. It never checks out,
never writes a local branch, never touches a worktree. A failed fetch does not stop the run, it is
reported: the brief line says the refs are stale.

INSTALL (a launchd unit, NOT live on merge): bash scripts/install-launchd-unit.sh com.marveen.done-vs-live
It runs at 06:45, ahead of the 07:30 morning brief; a full run took 130-180 s on 2026-10-01
(1417 cards, 916 branch tips). The cache keys every judgement by blob SHAs, so a rerun is cheaper.

Exit: 0 measured (findings or not)   1 not measurable (no live SHA, git failure, no cards)
Test seams: --live-sha, --cards-json, --no-fetch, --out, --acks, --cache.
"""
import argparse, collections, hashlib, json, os, re, signal, subprocess, sys, tempfile, time, urllib.request
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_REPO = '/Users/isti/Projektek/sajat-crm'
PROJECT = 'delta-crm'
SERVICES = ('delta-crm-backend', 'delta-crm-frontend')
GCP_PROJECT, GCP_REGION = 'delta-crm-483922', 'europe-west1'
MIN_LINE = 4          # added lines shorter than this (trimmed) are noise: braces, "});"
ZERO = '0' * 40

ap = argparse.ArgumentParser()
ap.add_argument('--repo', default=DEFAULT_REPO)
ap.add_argument('--live-sha', help='skip gcloud and measure against this commit (tests, manual runs)')
ap.add_argument('--cards-json', help='card list instead of the dashboard API (tests)')
ap.add_argument('--no-fetch', action='store_true')
ap.add_argument('--out', default=os.path.join(ROOT, 'store', 'done-vs-live.json'))
ap.add_argument('--acks', default=os.path.join(ROOT, 'store', 'done-vs-live-acks.json'))
ap.add_argument('--cache', default=os.path.join(ROOT, 'store', 'done-vs-live-cache.json'))
ap.add_argument('--gcloud', default='/opt/homebrew/bin/gcloud')
A = ap.parse_args()

T0 = time.time()
RUN_BUDGET_S = 1800   # a wedged run must say so, not hold the next 06:45 hostage in silence
result = {'measured_at': datetime.now().astimezone().isoformat(timespec='seconds'),
          'repo': A.repo, 'error': None}


def write_out():
    result['duration_s'] = round(time.time() - T0, 1)
    os.makedirs(os.path.dirname(os.path.abspath(A.out)), exist_ok=True)
    tmp = A.out + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    os.replace(tmp, A.out)


def fail(msg):
    result['error'] = msg
    write_out()
    print('NEM MERHETO:', msg, file=sys.stderr)
    sys.exit(1)


def git(*a, inp=None, env=None, check=False, timeout=300):
    r = subprocess.run(['git', '-C', A.repo, *a], capture_output=True, text=True, errors='replace',
                       input=inp, env=env or os.environ, timeout=timeout)
    if check and r.returncode:
        fail(f"git {' '.join(a[:3])}: {r.stderr.strip()[:300]}")
    return r


# ---------- the live SHA ----------
def live_sha():
    if A.live_sha:
        return {'manual': A.live_sha}
    tags = {}
    for s in SERVICES:
        try:
            r = subprocess.run([A.gcloud, 'run', 'services', 'describe', s, '--project', GCP_PROJECT,
                                '--region', GCP_REGION,
                                '--format=value(spec.template.spec.containers[0].image)'],
                               capture_output=True, text=True, timeout=120)
        except Exception as e:
            fail(f'gcloud {s}: {e}')
        tag = r.stdout.strip().rsplit(':', 1)[-1]
        if r.returncode or not re.fullmatch(r'[0-9a-f]{40}', tag):
            fail(f'gcloud {s}: rc={r.returncode}, tag={tag!r}, {r.stderr.strip()[:200]}')
        tags[s] = tag
    return tags


def _crashed(kind, exc, tb):
    # ANY uncaught error still writes the result file with `error` set (measured 2026-10-01: a
    # crash left no file at all, so the brief would have shown YESTERDAY's numbers until the 26 h
    # staleness check fired). The traceback still goes to stderr, i.e. the launchd log.
    import traceback
    traceback.print_exception(kind, exc, tb)
    result['error'] = f'crashed: {kind.__name__}: {str(exc)[:200]}'
    try:
        write_out()
    except Exception:
        pass
    os._exit(1)


sys.excepthook = _crashed
signal.signal(signal.SIGALRM, lambda *_: fail(f'run exceeded {RUN_BUDGET_S} s (git or gcloud wedged)'))
signal.alarm(RUN_BUDGET_S)
tags = live_sha()
result['live'] = tags
if not A.no_fetch:
    # Two retries: this machine's outbound network flickers (card 286de2bf), and the first live
    # run lost its fetch to one "Could not resolve host: github.com" (2026-10-01 10:44).
    for attempt in range(3):
        r = git('fetch', '--quiet', '--prune', 'origin', timeout=180)
        if r.returncode == 0:
            break
        time.sleep(float(os.environ.get('DONE_VS_LIVE_RETRY_SLEEP', '15')))
    result['fetch'] = ('ok' if attempt == 0 else f'ok after {attempt + 1} attempts') if r.returncode == 0 \
        else f'FAILED rc={r.returncode} after 3 attempts: {r.stderr.strip()[:200]}'
else:
    result['fetch'] = 'skipped'
resolved = {}
for s, t in tags.items():
    rr = git('rev-parse', '-q', '--verify', t + '^{commit}')
    if rr.returncode:
        fail(f'live SHA {t[:12]} ({s}) is not in the repo even after fetch')
    resolved[s] = rr.stdout.strip()
# The two services normally run the same merge. If not, judge against the OLDER one: a card is
# live only if it runs everywhere it has to, and the older image is the one that may lack it.
shas = sorted(set(resolved.values()))
if len(shas) == 1:
    LIVE = shas[0]
else:
    a, b = shas[0], shas[1]
    if git('merge-base', '--is-ancestor', a, b).returncode == 0:
        LIVE = a
    elif git('merge-base', '--is-ancestor', b, a).returncode == 0:
        LIVE = b
    else:
        fail(f'the services run unrelated commits: {resolved}')
    result['services_differ'] = True
result['target'] = LIVE

# ---------- cards ----------
if A.cards_json:
    cards = json.load(open(A.cards_json, encoding='utf-8'))
else:
    try:
        tok = open(os.path.join(ROOT, 'store', '.dashboard-token')).read().strip()
        req = urllib.request.Request('http://localhost:3420/api/kanban?includeArchived=1',
                                     headers={'Authorization': 'Bearer ' + tok})
        cards = json.load(urllib.request.urlopen(req, timeout=60))
    except Exception as e:
        fail(f'kanban API: {e}')
if not isinstance(cards, list):
    fail(f'kanban API returned {type(cards).__name__}, not a list')

# ---------- refs ----------
refs = git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes/origin',
           check=True).stdout.splitlines()
by_hex = collections.defaultdict(dict)
for line in refs:
    name, sha = line.split()
    if name.endswith('/HEAD'):
        continue
    short = name.replace('refs/remotes/', '').replace('refs/heads/', '')
    for h in set(re.findall(r'(?<![0-9a-f])([0-9a-f]{8})(?![0-9a-f])', short)):
        by_hex[h][short] = sha

# THE PROJECT FIELD IS NOT CLEAN, and a filter on it alone is blind (measured 2026-10-01): of
# marveen's 173 not-shipped cards (64aad5a5), 16 have project = NULL -- among them 122d8498, the
# terms-of-service page, the very case this script exists for. So a project-less card counts as
# Delta-CRM work when a ref in THIS repo names it; without such a ref it is counted as unmeasurable.
done_like = [c for c in cards if c.get('status') in ('done', 'testing')]
pop = [c for c in done_like if (c.get('project') or '').lower() == PROJECT
       or (not c.get('project') and c['id'][:8] in by_hex)]
result['projectless_without_ref'] = sum(1 for c in done_like if not c.get('project') and c['id'][:8] not in by_hex)
if not pop:
    fail('0 done/testing delta-crm cards: a filter or the API is wrong, not a clean board')

# ---------- live tree, index, cache ----------
live_blobs = {}
for line in git('ls-tree', '-r', '--full-tree', LIVE, check=True).stdout.splitlines():
    meta, path = line.split('\t', 1)
    live_blobs[path] = meta.split()[2]
idx_fd, IDX = tempfile.mkstemp(prefix='done-vs-live-', suffix='.index')
os.close(idx_fd)
ENV_IDX = dict(os.environ, GIT_INDEX_FILE=IDX)
git('read-tree', LIVE, env=ENV_IDX, check=True)
try:
    cache = json.load(open(A.cache))
except Exception:
    cache = {}
used = {}
fp_chain = git('rev-list', '--first-parent', LIVE, check=True).stdout.split()
# Subjects already in the live history: a missing commit whose subject is among them is most often
# a pre-rebase copy whose content was re-resolved on the way in (measured 2026-10-01: 15 of 227
# NOT-LIVE cards had ONLY such commits). Still reported -- the content does differ -- but marked,
# so the reader starts there.
live_subjects = set(git('log', '--no-merges', '--format=%s', LIVE, check=True).stdout.splitlines())
# Every commit named "revert..." in the live history, with the files it touched: ONE log call.
# Asking per gap file walked the whole history once per file and took a run past 20 minutes
# (measured 2026-10-01, the first live run, killed by its own alarm).
# The SUBJECT decides: --grep matches any line of the message, and two ordinary fixes whose body
# had a line starting "revert" were counted as reverts on the first run (610940f04, cfc0300ce).
revert_files = collections.defaultdict(set)
_cur = None
for line in git('log', '--no-merges', '-i', '-E', '--grep=^revert', '--name-only', '--format=@%H %s',
                LIVE, check=True).stdout.splitlines():
    if line.startswith('@'):
        h, _, subj = line[1:].partition(' ')
        _cur = h if re.match(r'(?i)revert', subj) else None
    elif line.strip() and _cur:
        revert_files[line.strip()].add(_cur)


def revert_removed(rev, path):
    """Hashes of the lines a revert DELETED from one file."""
    def calc():
        d = git('show', '--format=', '-U0', '--no-renames', rev, '--', ':(top)' + path).stdout
        return sorted({hashlib.sha1(x[1:].strip().encode()).hexdigest()[:12] for x in d.splitlines()
                       if x.startswith('-') and not x.startswith('---') and len(x[1:].strip()) >= MIN_LINE})
    return set(cached(f'r:{rev}:{path}', calc))


def cached(key, fn):
    if key not in cache:
        cache[key] = fn()
    used[key] = cache[key]
    return cache[key]


def is_anc(x, y):
    return git('merge-base', '--is-ancestor', x, y).returncode == 0


def raw_files(a, b):
    """(path, old_blob, new_blob) for a..b, renames off so paths are stable."""
    out = []
    for line in git('diff', '--raw', '--no-renames', '--no-abbrev', '-z', a, b).stdout.split('\0:'):
        line = line.lstrip(':')
        if not line:
            continue
        parts = line.split('\0')
        meta = parts[0].split()
        if len(meta) >= 4 and len(parts) >= 2:
            out.append((parts[1], meta[2], meta[3]))
    return out


def commit_in_live(c):
    """(b) for one commit: its content is in the live tree."""
    files = raw_files(c + '^', c) if git('rev-parse', '-q', '--verify', c + '^').returncode == 0 else []
    key = 'c:' + c + ':' + hashlib.sha1(''.join(f'{p}{live_blobs.get(p, ZERO)}' for p, _, _ in files).encode()).hexdigest()

    def calc():
        if files and all(live_blobs.get(p, ZERO) == new for p, _, new in files):
            return True   # every touched file is byte-identical to the commit's result
        patch = git('format-patch', '-1', '--stdout', '--no-renames', c).stdout
        if not patch.strip():
            return True
        return git('apply', '--cached', '--check', '-R', '-', inp=patch, env=ENV_IDX).returncode == 0
    return cached(key, calc)


def landing_base(tip):
    """merge-base of tip with the mainline just before tip landed in LIVE."""
    lo, hi = 0, len(fp_chain) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if is_anc(tip, fp_chain[mid]):
            lo = mid
        else:
            hi = mid - 1
    if lo + 1 >= len(fp_chain):
        return None
    return git('merge-base', tip, fp_chain[lo + 1]).stdout.strip() or None


def delta_added(base, tip):
    """Added lines (>= MIN_LINE, trimmed) in the whole base..tip delta: the denominator of (c)."""
    def calc():
        d = git('diff', '-U0', '--no-renames', base, tip).stdout
        return sum(1 for x in d.splitlines()
                   if x.startswith('+') and not x.startswith('+++') and len(x[1:].strip()) >= MIN_LINE)
    return cached(f'a:{base}:{tip}', calc)


def delta_gaps(base, tip):
    """(c): files of base..tip whose added lines are missing from the live file."""
    gaps = []
    for path, old, new in raw_files(base, tip):
        live = live_blobs.get(path, ZERO)
        if live == new:
            continue
        key = f'd2:{old}:{new}:{live}:{path}'

        def calc():
            p = git('diff', '--binary', '--full-index', '--no-renames', base, tip, '--', ':(top)' + path).stdout
            if not p.strip() or git('apply', '--cached', '--check', '-R', '-', inp=p, env=ENV_IDX).returncode == 0:
                return [0, 0, []]
            d = git('diff', '-U0', '--no-renames', base, tip, '--', ':(top)' + path).stdout
            added = [x[1:].strip() for x in d.splitlines() if x.startswith('+') and not x.startswith('+++')]
            added = [x for x in added if len(x) >= MIN_LINE]
            have = collections.Counter(x.strip() for x in
                                       (git('cat-file', '-p', live).stdout if live != ZERO else '').splitlines())
            gone = [x for x in added if have[x] == 0]
            return [len(gone), len(added), sorted({hashlib.sha1(x.encode()).hexdigest()[:12] for x in gone})]
        miss, added, gone = cached(key, calc)
        if miss:
            gaps.append({'file': path, 'missing': miss, 'added': added, 'gone': gone})
    return gaps


try:
    acks = json.load(open(A.acks))
except FileNotFoundError:
    acks = {}
except Exception as e:
    acks = {}
    result['acks_error'] = f'{A.acks} unreadable: {e}'

cards_out = []
for c in pop:
    h = c['id'][:8]
    rec = {'id': h, 'status': c.get('status'), 'priority': c.get('priority'), 'assignee': c.get('assignee'),
           'title': (c.get('title') or '')[:120], 'archived': bool(c.get('archived_at')),
           'status_at': c.get('last_status_at') or c.get('updated_at')}
    crefs = by_hex.get(h, {})
    if not crefs:
        rec['verdict'] = 'NO-BRANCH'
        cards_out.append(rec)
        continue
    rec['refs'] = sorted(crefs)
    missing_commits = {}
    for ref in sorted(crefs):
        for cm in git('log', '--no-merges', '--right-only', '--cherry-pick', '--format=%H',
                      f'{LIVE}...{crefs[ref]}').stdout.split():
            if cm not in missing_commits and not commit_in_live(cm):
                missing_commits[cm] = ref
    gaps, added_total, tip_of = [], 0, {}
    shipped_tips = [t for t in sorted(set(crefs.values())) if is_anc(t, LIVE)]
    if not missing_commits:
        for tip in shipped_tips:
            base = landing_base(tip)
            if base and base != tip:
                tip_of[tip[:9]] = tip
                gaps += [dict(g, tip=tip[:9]) for g in delta_gaps(base, tip)]
                added_total += delta_added(base, tip)
    missing_total = sum(g['missing'] for g in gaps)
    # A REVERT is judged by name, not by share (didi, e572a1c2): a revert riding on a big seam
    # branch is diluted below half (1c52b3e8's revert sat under 1% on 0bea63c0 and 15dd14db).
    # ...and a revert counts only if its diff DELETED one of this card's missing lines: file level
    # alone flagged every card with any gap in a shared file a revert once touched (62 on the
    # first run, mostly through one unrelated revert, 9bd764f1f).
    reverts = sorted({h[:9] for g in gaps for h in revert_files.get(g['file'], ())
                      if not is_anc(h, tip_of[g['tip']]) and revert_removed(h, g['file']) & set(g['gone'])})
    if missing_commits:
        rec['verdict'] = 'NOT-LIVE'
        subj = {k: git('log', '-1', '--format=%s', k).stdout.strip() for k in missing_commits}
        rec['missing_commits'] = [{'commit': k[:9], 'ref': v, 'subject': subj[k][:100],
                                   'subject_in_live': subj[k] in live_subjects}
                                  for k, v in list(missing_commits.items())[:20]]
        rec['only_rewritten_copies'] = all(x in live_subjects for x in subj.values())
        rec['missing_commit_count'] = len(missing_commits)
        rec['partly_shipped'] = bool(shipped_tips)
        fp_src = sorted(missing_commits)
    elif gaps and (missing_total * 2 >= max(added_total, 1) or reverts):
        # Half or more of the card's added lines are gone from the live tree: the shape of a revert
        # or a lost resolution. Below half it is the shape of ordinary later development: measured
        # 2026-10-01, 186 of 234 cards with any missing line were under 20%. That band is counted
        # (EVOLVED), not headlined; a small lost hunk in it is caught only at batch close, by
        # close-measure with a reader -- this daily line cannot tell it from evolution.
        rec['verdict'] = 'LINES-MISSING'
        rec['gaps'] = [{k: v for k, v in g.items() if k != 'gone'} for g in gaps[:20]]
        rec['gap_count'] = len(gaps)
        rec['missing_share'] = f'{missing_total}/{added_total}'
        rec['reverts'] = reverts
        fp_src = sorted(f"{g['tip']}:{g['file']}:{g['missing']}" for g in gaps)
    elif gaps:
        rec['verdict'] = 'EVOLVED'
        rec['missing_share'] = f'{missing_total}/{added_total}'
        fp_src = None
    else:
        rec['verdict'] = 'LIVE'
        fp_src = None
    if fp_src is not None:
        rec['fingerprint'] = hashlib.sha1('\n'.join(fp_src).encode()).hexdigest()[:12]
        ack = acks.get(h)
        if ack and ack.get('fingerprint') == rec['fingerprint']:
            rec['acked'] = {k: ack.get(k) for k in ('reason', 'by', 'at')}
        elif ack:
            rec['ack_lapsed'] = f"ack fingerprint {ack.get('fingerprint')} != now {rec['fingerprint']}"
    cards_out.append(rec)

os.unlink(IDX)
try:
    tmp = A.cache + '.tmp'
    json.dump(used, open(tmp, 'w'))
    os.replace(tmp, A.cache)
except Exception as e:
    result['cache_error'] = str(e)


def summary(status):
    rows = [r for r in cards_out if r['status'] == status]
    cnt = collections.Counter(r['verdict'] + ('+ACK' if r.get('acked') else '') for r in rows)
    return {'population': len(rows), 'counts': dict(cnt)}


result['summary'] = {'done': summary('done'), 'testing': summary('testing')}
result['cards'] = sorted((r for r in cards_out if r['verdict'] not in ('LIVE', 'EVOLVED')),
                         key=lambda r: (r['verdict'], r['status'], r.get('status_at') or 0))
result['live_count'] = sum(1 for r in cards_out if r['verdict'] in ('LIVE', 'EVOLVED'))
write_out()
s = result['summary']
print(f"target {LIVE[:12]} | done {s['done']} | testing {s['testing']} | {result['duration_s']}s")
sys.exit(0)
