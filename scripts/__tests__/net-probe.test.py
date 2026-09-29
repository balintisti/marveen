"""net-probe.py (card 286de2bf): a run records every target, no answer is 000, the hourly
large-body probes run only in the first ten minutes, and the summary can say the probe itself
did not run."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'net-probe.py')

FAKE_CURL = """#!/bin/bash
# answers like curl -w, or not at all for a URL listed in FAKE_DEAD
for a in "$@"; do url="$a"; done
case " $FAKE_DEAD " in *" $url "*) exit 28;; esac
printf '200 0.010 0.020 0.030'
"""


def at(hh, mm):
    return time.mktime(time.strptime(f'2026-09-29 {hh:02d}:{mm:02d}:00', '%Y-%m-%d %H:%M:%S'))


class NetProbe(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='net-probe-')
        self.log = os.path.join(self.tmp, 'net-probe.jsonl')
        self.curl = os.path.join(self.tmp, 'curl')
        with open(self.curl, 'w') as f:
            f.write(FAKE_CURL)
        os.chmod(self.curl, 0o755)

    def tearDown(self):
        subprocess.run(['rm', '-rf', self.tmp])

    def run_probe(self, now, *args, dead=''):
        env = dict(os.environ, NET_PROBE_LOG=self.log, NET_PROBE_CURL=self.curl, NET_PROBE_NOW=str(now), FAKE_DEAD=dead)
        return subprocess.run([sys.executable, SCRIPT, *args], env=env, capture_output=True, text=True, timeout=60)

    def lines(self):
        return [json.loads(l) for l in open(self.log).read().splitlines()]

    def test_a_run_records_every_small_target(self):
        self.assertEqual(self.run_probe(at(4, 25)).returncode, 0)
        [line] = self.lines()
        self.assertEqual(set(line['results']), {'googleapis', 'oauth2', 'monitoring', 'sentry', 'cloudflare', 'github'})
        self.assertEqual(line['results']['sentry']['code'], '200')

    def test_the_large_body_probes_run_once_an_hour(self):
        self.run_probe(at(4, 25))
        self.run_probe(at(5, 3))
        off, on = self.lines()
        self.assertNotIn('cf-up-1MB', off['results'])
        self.assertIn('cf-up-1MB', on['results'])
        self.assertIn('cf-down-1MB', on['results'])

    def test_no_answer_is_recorded_as_000_not_dropped(self):
        self.run_probe(at(4, 25), dead='https://sentry.io/api/0/')
        [line] = self.lines()
        self.assertEqual(line['results']['sentry']['code'], '000')
        self.assertEqual(line['results']['github']['code'], '200')

    def test_the_summary_counts_failures_per_target_in_the_window(self):
        self.run_probe(at(1, 25), dead='https://sentry.io/api/0/')    # outside a 2 h window at 04:30
        self.run_probe(at(3, 25), dead='https://sentry.io/api/0/')
        self.run_probe(at(4, 25))
        r = self.run_probe(at(4, 30), '--summary', '2')
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn('2 run(s)', r.stdout)
        self.assertRegex(r.stdout, r'sentry\s+1/2 no answer \(50%\)')
        self.assertRegex(r.stdout, r'github\s+0/2 no answer')

    def test_CONTROL_the_summary_says_so_when_the_probe_did_not_run(self):
        self.run_probe(at(1, 25))
        r = self.run_probe(at(4, 30), '--summary', '2')
        self.assertEqual(r.returncode, 1)
        self.assertIn('NO RUNS', r.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=1)
