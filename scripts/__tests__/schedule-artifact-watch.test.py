"""schedule-artifact-watch.py (card 8289611e): a fired round whose artifact did not move after the
grace period is reported ONCE; a finished one, a fresh one and a never-fired one are not; an
unreadable outcome file is reported as blindness."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'schedule-artifact-watch.py')
FIRED = 1_790_000_000          # epoch s of the fire in every case


class Watch(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='saw-')
        os.makedirs(os.path.join(self.root, 'store'))
        self.sent = os.path.join(self.root, 'sent.txt')
        self.artifact = os.path.join(self.root, 'store', 'sentry-watch-state.json')

    def tearDown(self):
        subprocess.run(['rm', '-rf', self.root])

    def outcome(self, fired=FIRED):
        with open(os.path.join(self.root, 'store', 'schedule-last-outcome.json'), 'w') as f:
            json.dump({'sentry-or': {'lastFiredAt': fired * 1000}} if fired else {}, f)

    def artifact_at(self, t):
        open(self.artifact, 'w').write('{}')
        os.utime(self.artifact, (t, t))

    def run_watch(self, minutes_after, send_ok=True):
        sender = f"cat >> {self.sent}; echo 'OK id=1'" if send_ok else 'cat >/dev/null; echo refused; exit 1'
        env = dict(os.environ, SAW_ROOT=self.root, SAW_NOW=str(FIRED + minutes_after * 60), SAW_MSG=sender)
        return subprocess.run([sys.executable, SCRIPT], env=env, capture_output=True, text=True, timeout=30)

    def reports(self):
        return open(self.sent).read().count('[schedule-artifact-watch]') if os.path.exists(self.sent) else 0

    def test_a_fired_round_that_never_wrote_is_reported(self):
        self.outcome(); self.artifact_at(FIRED - 3 * 3600)
        self.assertEqual(self.run_watch(60).returncode, 3)
        self.assertEqual(self.reports(), 1)
        self.assertIn('sentry-or', open(self.sent).read())

    def test_it_is_reported_once_per_fire_not_every_run(self):
        self.outcome(); self.artifact_at(FIRED - 3 * 3600)
        self.run_watch(60); self.run_watch(90)
        self.assertEqual(self.reports(), 1)

    def test_a_new_fire_that_also_did_not_finish_is_reported_again(self):
        self.outcome(); self.artifact_at(FIRED - 3 * 3600)
        self.run_watch(60)
        self.outcome(FIRED + 3 * 3600)
        env_minutes = 3 * 60 + 60
        self.run_watch(env_minutes)
        self.assertEqual(self.reports(), 2)

    def test_CONTROL_a_round_that_wrote_after_its_fire_is_quiet(self):
        self.outcome(); self.artifact_at(FIRED + 49)
        self.assertEqual(self.run_watch(60).returncode, 0)
        self.assertEqual(self.reports(), 0)

    def test_a_round_still_inside_its_grace_is_quiet(self):
        self.outcome(); self.artifact_at(FIRED - 3 * 3600)
        self.assertEqual(self.run_watch(20).returncode, 0)
        self.assertEqual(self.reports(), 0)

    def test_a_missing_artifact_counts_as_never_written(self):
        self.outcome()
        self.assertEqual(self.run_watch(60).returncode, 3)
        self.assertIn('SOHA', open(self.sent).read())

    def test_a_task_that_never_fired_says_nothing(self):
        self.outcome(fired=None)
        self.assertEqual(self.run_watch(60).returncode, 0)

    def test_an_unreadable_outcome_file_is_blindness_and_is_reported(self):
        r = self.run_watch(60)
        self.assertEqual(r.returncode, 1)
        self.assertIn('VAK', open(self.sent).read())

    def test_a_failed_report_is_not_remembered_as_sent(self):
        self.outcome(); self.artifact_at(FIRED - 3 * 3600)
        self.assertEqual(self.run_watch(60, send_ok=False).returncode, 2)
        self.run_watch(70)
        self.assertEqual(self.reports(), 1)          # the retry run sends it


if __name__ == '__main__':
    unittest.main(verbosity=1)
