#!/usr/bin/env python3
"""Contract tests for scripts/done-vs-live.py and its morning-brief section (card e572a1c2).

Every case is a shape the real run on 2026-10-01 met, built in a throwaway git repo:
a merged card, a never-merged one, a REVERTED one (the case ancestry alone calls live),
a cherry-picked one (live under another SHA), a shipped card with a stray unshipped
commit, ordinary later development (must NOT be headlined), and a project-less card
(16 of marveen's 173 had project = NULL; a project filter alone was blind to them).
The section tests pin the rule that a meter that did not run never reads as zero.

Run: python3 <this file>   Exit 0 = all passed.
"""
import importlib.util, json, os, shutil, subprocess, sys, tempfile, time, unittest
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, '..', 'done-vs-live.py')
spec = importlib.util.spec_from_file_location('ns', os.path.join(HERE, '..', 'napindito-sections.py'))
ns = importlib.util.module_from_spec(spec); spec.loader.exec_module(ns)

ENV = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t',
           GIT_COMMITTER_EMAIL='t@t', GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1')
BODY = [f'line number {i} of the shared file' for i in range(40)]


class Repo:
    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix='dvl-test-')
        self.git('init', '-q', '-b', 'main')
        self.write('base.txt', BODY)
        self.commit('base')

    def git(self, *a):
        r = subprocess.run(['git', '-C', self.dir, *a], capture_output=True, text=True, env=ENV)
        if r.returncode:
            raise RuntimeError(f"git {a}: {r.stderr}")
        return r.stdout.strip()

    def write(self, name, lines):
        with open(os.path.join(self.dir, name), 'w') as f:
            f.write('\n'.join(lines) + '\n')

    def commit(self, msg):
        self.git('add', '-A')
        self.git('commit', '-q', '-m', msg)
        return self.git('rev-parse', 'HEAD')

    def branch_with(self, branch, name, lines, msg):
        self.git('checkout', '-q', '-b', branch, 'main')
        self.write(name, lines)
        sha = self.commit(msg)
        self.git('checkout', '-q', 'main')
        return sha

    def merge(self, branch):
        self.git('merge', '-q', '--no-ff', '-m', f'merge {branch}', branch)


def feature(tag, n=10):
    return [f'{tag} feature line {i} with enough text' for i in range(n)]


def run(repo, cards, live=None, acks=None):
    out = tempfile.mkdtemp(prefix='dvl-out-')
    cj = os.path.join(out, 'cards.json')
    with open(cj, 'w') as f:
        json.dump(cards, f)
    aj = os.path.join(out, 'acks.json')
    with open(aj, 'w') as f:
        json.dump(acks or {}, f)
    oj = os.path.join(out, 'out.json')
    r = subprocess.run([sys.executable, SCRIPT, '--repo', repo.dir, '--live-sha', live or repo.git('rev-parse', 'main'),
                        '--cards-json', cj, '--no-fetch', '--out', oj, '--acks', aj,
                        '--cache', os.path.join(out, 'cache.json')], capture_output=True, text=True, env=ENV)
    d = json.load(open(oj)) if os.path.exists(oj) else None
    shutil.rmtree(out)
    return r.returncode, d, r


def card(cid, status='done', project='delta-crm', **kw):
    return dict(id=cid + '-0000-test', status=status, project=project, title=f'card {cid}', **kw)


def verdicts(d):
    allc = {c['id']: c for c in d['cards']}
    return allc


class Meter(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        r = cls.repo = Repo()
        # merged
        r.branch_with('fix/aaaaaaa1-merged', 'a.txt', feature('A'), 'feat: A'); r.merge('fix/aaaaaaa1-merged')
        # never merged
        r.branch_with('fix/bbbbbbb2-unmerged', 'b.txt', feature('B'), 'feat: B')
        # merged, then reverted on main
        r.branch_with('fix/ccccccc3-reverted', 'c.txt', feature('C'), 'feat: C'); r.merge('fix/ccccccc3-reverted')
        os.remove(os.path.join(r.dir, 'c.txt')); r.commit('revert C')
        # cherry-picked onto main under another sha, branch itself never merged
        d_sha = r.branch_with('fix/ddddddd4-picked', 'd.txt', feature('D'), 'feat: D')
        r.git('cherry-pick', d_sha)
        # merged, plus a stray commit on a second ref that never shipped
        r.branch_with('fix/eeeeeee5-shipped', 'e.txt', feature('E'), 'feat: E'); r.merge('fix/eeeeeee5-shipped')
        r.git('checkout', '-q', '-b', 'fix/eeeeeee5-followup', 'fix/eeeeeee5-shipped')
        r.write('e2.txt', feature('E2')); r.commit('feat: E followup'); r.git('checkout', '-q', 'main')
        # merged, then ordinary later development touches 2 of its 10 lines
        r.branch_with('fix/fffffff6-evolved', 'f.txt', feature('F'), 'feat: F'); r.merge('fix/fffffff6-evolved')
        lines = feature('F'); lines[0] = 'F rewritten line zero'; lines[1] = 'F rewritten line one'
        r.write('f.txt', lines); r.commit('refactor F\n\nrevert to the plainer wording')  # 'revert' in the BODY only
        # a real revert that touches f.txt but deletes none of F's lines: must not count against F
        r.write('f.txt', lines + ['unrelated line added then reverted']); r.commit('feat: unrelated')
        r.write('f.txt', lines); r.commit('Revert "feat: unrelated"')
        # merged, then a REVERT removes a fifth of it: under half, yet named a revert (didi's dilution case)
        r.git('checkout', '-q', '-b', 'fix/aaaabbb8-diluted', 'main')
        r.write('h_big.txt', feature('H', 40)); r.write('h_small.txt', feature('h', 10)); r.commit('feat: H')
        r.git('checkout', '-q', 'main'); r.merge('fix/aaaabbb8-diluted')
        os.remove(os.path.join(r.dir, 'h_small.txt')); r.commit('Revert "feat: H small part"')
        # merged into a SHARED file, which later changes elsewhere: the delta still reverse-applies
        r.branch_with('fix/abcabc12-shared-top', 'base.txt', feature('S', 5) + BODY, 'feat: S on top of base')
        r.merge('fix/abcabc12-shared-top')
        r.write('base.txt', feature('S', 5) + BODY[:-1] + ['the last shared line, rewritten']); r.commit('chore: tail')
        # project-less card with a ref, never merged
        r.branch_with('fix/99999997-projectless', 'g.txt', feature('G'), 'feat: G')
        cls.cards = [card('aaaaaaa1'), card('bbbbbbb2', priority='high'), card('ccccccc3'), card('ddddddd4'),
                     card('eeeeeee5'), card('fffffff6'), card('99999997', project=None), card('aaaabbb8'), card('abcabc12'),
                     card('12345678'), card('87654321', project=None), card('abcdef01', project='marveen'),
                     card('0bbbbbb2', status='planned')]
        cls.rc, cls.d, cls.proc = run(r, cls.cards)
        cls.v = verdicts(cls.d)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.repo.dir)

    def test_runs(self):
        self.assertEqual(self.rc, 0, self.proc.stderr)
        self.assertIsNone(self.d['error'])

    def test_merged_is_live(self):
        self.assertNotIn('aaaaaaa1', self.v)

    def test_unmerged_is_not_live(self):
        self.assertEqual(self.v['bbbbbbb2']['verdict'], 'NOT-LIVE')
        self.assertFalse(self.v['bbbbbbb2']['partly_shipped'])

    def test_reverted_is_lines_missing_not_live(self):
        # THE CASE ANCESTRY CANNOT SEE: the tip is an ancestor of live, its content is gone.
        self.assertEqual(self.v['ccccccc3']['verdict'], 'LINES-MISSING')
        self.assertEqual(self.v['ccccccc3']['missing_share'], '10/10')

    def test_a_named_revert_is_flagged_even_when_diluted(self):
        self.assertEqual(self.v['aaaabbb8']['verdict'], 'LINES-MISSING')
        self.assertEqual(self.v['aaaabbb8']['missing_share'], '10/50')
        self.assertEqual(len(self.v['aaaabbb8']['reverts']), 1)

    def test_a_shared_file_changed_elsewhere_is_live(self):
        self.assertNotIn('abcabc12', self.v)

    def test_cherry_picked_is_live(self):
        self.assertNotIn('ddddddd4', self.v)

    def test_stray_unshipped_commit_is_not_live_partly_shipped(self):
        self.assertEqual(self.v['eeeeeee5']['verdict'], 'NOT-LIVE')
        self.assertTrue(self.v['eeeeeee5']['partly_shipped'])
        self.assertEqual([m['ref'] for m in self.v['eeeeeee5']['missing_commits']], ['fix/eeeeeee5-followup'])

    def test_ordinary_later_development_is_not_headlined(self):
        self.assertNotIn('fffffff6', self.v)
        self.assertEqual(self.d['summary']['done']['counts'].get('EVOLVED'), 1)

    def test_projectless_with_ref_is_measured(self):
        self.assertEqual(self.v['99999997']['verdict'], 'NOT-LIVE')

    def test_projectless_without_ref_is_counted_not_dropped(self):
        self.assertNotIn('87654321', self.v)
        self.assertEqual(self.d['projectless_without_ref'], 1)

    def test_no_branch_and_scope(self):
        self.assertEqual(self.v['12345678']['verdict'], 'NO-BRANCH')
        self.assertNotIn('abcdef01', self.v)          # other project
        self.assertNotIn('0bbbbbb2', self.v)          # not done/testing
        self.assertEqual(self.d['summary']['done']['population'], 10)

    def test_ack_holds_only_while_fingerprint_matches(self):
        fp = self.v['bbbbbbb2']['fingerprint']
        _, d, _ = run(self.repo, self.cards, acks={'bbbbbbb2': {'fingerprint': fp, 'reason': 'obsolete', 'by': 't'}})
        self.assertEqual(verdicts(d)['bbbbbbb2']['acked']['reason'], 'obsolete')
        _, d, _ = run(self.repo, self.cards, acks={'bbbbbbb2': {'fingerprint': 'stale', 'reason': 'x'}})
        self.assertNotIn('acked', verdicts(d)['bbbbbbb2'])
        self.assertIn('ack_lapsed', verdicts(d)['bbbbbbb2'])

    def test_unknown_live_sha_is_not_measurable(self):
        rc, d, _ = run(self.repo, self.cards, live='0123456789012345678901234567890123456789')
        self.assertEqual(rc, 1)
        self.assertIn('not in the repo', d['error'])

    def test_empty_population_is_not_a_clean_board(self):
        rc, d, _ = run(self.repo, [card('aaaaaaa1', status='planned')])
        self.assertEqual(rc, 1)
        self.assertIn('0 done/testing', d['error'])

    def test_a_crash_still_writes_the_error(self):
        # A card without an id makes the script raise; the result file must still say so.
        rc, d, _ = run(self.repo, self.cards + [{'status': 'done', 'project': 'delta-crm'}])
        self.assertEqual(rc, 1)
        self.assertIn('crashed: KeyError', d['error'])

    def test_target_is_the_image_not_main(self):
        # live = the image built BEFORE the C revert: there C is fully live, whatever main says now.
        before_revert = self.repo.git('rev-parse', self.repo.git('rev-parse', ':/^revert C') + '^')
        _, d, _ = run(self.repo, self.cards, live=before_revert)
        self.assertNotIn('ccccccc3', verdicts(d))


class Section(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='dvl-root-')
        os.makedirs(os.path.join(self.root, 'store'))
        self.path = os.path.join(self.root, 'store', 'done-vs-live.json')

    def tearDown(self):
        shutil.rmtree(self.root)

    def put(self, **kw):
        d = dict(measured_at=datetime.now().astimezone().isoformat(timespec='seconds'),
                 error=None, target='03b396fb61b8edab', cards=[])
        d.update(kw)
        with open(self.path, 'w') as f:
            json.dump(d, f)

    def test_missing_file_is_not_zero(self):
        out = ns.section_done_vs_live(self.root)
        self.assertIn('NEM MERHETO', out[0])

    def test_stale_by_content_not_mtime(self):
        self.put(measured_at=(datetime.now().astimezone() - timedelta(hours=30)).isoformat())
        out = ns.section_done_vs_live(self.root)
        self.assertIn('NEM MERHETO', out[0]); self.assertIn('30 oras', out[0])

    def test_meter_error_is_said(self):
        self.put(error='gcloud delta-crm-backend: rc=1')
        self.assertIn('gcloud', ns.section_done_vs_live(self.root)[0])

    def test_counts_and_oldest(self):
        now = time.time()
        self.put(cards=[
            dict(id='aaaaaaa1', status='done', verdict='NOT-LIVE', priority='high', status_at=now - 9 * 86400, title='old one'),
            dict(id='bbbbbbb2', status='done', verdict='NOT-LIVE', priority='low', status_at=now - 86400, partly_shipped=True, title='new'),
            dict(id='ccccccc3', status='done', verdict='LINES-MISSING', status_at=now),
            dict(id='ddddddd4', status='testing', verdict='NOT-LIVE', status_at=now),
            dict(id='eeeeeee5', status='done', verdict='NOT-LIVE', acked={'reason': 'x'}, status_at=now - 99 * 86400),
            dict(id='12345678', status='done', verdict='NO-BRANCH')], projectless_without_ref=147)
        text = '\n'.join(ns.section_done_vs_live(self.root))
        self.assertIn('nincs elesben: 2 kartya (ebbol urgent/high 1, reszben szallitva 1)', text)
        self.assertIn('legregebbi: aaaaaaa1', text)          # the acked older one is NOT the oldest
        self.assertIn('kesobb kikerult', text); self.assertIn('ccccccc3', text)
        self.assertIn('testing, nincs elesben: 1', text)
        self.assertIn('NEM MERHETO: 1 done kartya ag nelkul, es 147 projekt nelkuli', text)
        self.assertIn('nyugtazva: 1', text)

    def test_failed_fetch_is_said(self):
        self.put(fetch='FAILED rc=128: could not read Username')
        self.assertIn('fetch NEM SIKERULT', ns.section_done_vs_live(self.root)[0])
        self.put(fetch='ok')
        self.assertNotIn('fetch', ns.section_done_vs_live(self.root)[0])

    def test_zero_is_said_when_measured(self):
        self.put()
        self.assertIn('0 kartya', '\n'.join(ns.section_done_vs_live(self.root)))


if __name__ == '__main__':
    unittest.main(verbosity=1)
