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
# answers like curl -w (tab-separated, remote_ip last). A URL in FAKE_DEAD fails like real
# curl does: the -w line is STILL printed (code 000), the error goes to stderr, rc is non-zero.
# FAKE_DEAD_IP is the address it "connected" to before failing; empty = no TCP connection.
for a in "$@"; do url="$a"; done
case " $FAKE_DEAD " in *" $url "*)
  printf '000\\t0.050\\t0.000\\t0.120\\t%s' "$FAKE_DEAD_IP"
  echo "curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to $url" >&2
  exit 35;;
esac
printf '200\\t0.010\\t0.020\\t0.030\\t192.0.2.7'
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

    def run_probe(self, now, *args, dead='', dead_ip='172.217.113.4'):
        env = dict(os.environ, NET_PROBE_LOG=self.log, NET_PROBE_CURL=self.curl, NET_PROBE_NOW=str(now), FAKE_DEAD=dead,
                   FAKE_DEAD_IP=dead_ip)
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

    def test_a_failure_keeps_the_ip_and_curls_error_text(self):
        # card 286de2bf: WHERE it failed is the question; a bare 000 cannot answer it
        self.run_probe(at(4, 25), dead='https://www.googleapis.com/generate_204')
        [line] = self.lines()
        g = line['results']['googleapis']
        self.assertEqual((g['code'], g['rc'], g['ip']), ('000', 35, '172.217.113.4'))
        self.assertIn('SSL_ERROR_SYSCALL', g['error'])
        ok = line['results']['github']
        self.assertEqual((ok['code'], ok['ip']), ('200', '192.0.2.7'))
        self.assertNotIn('error', ok)

    def test_no_tcp_connection_is_an_empty_ip_not_a_shifted_field(self):
        self.run_probe(at(4, 25), dead='https://www.googleapis.com/generate_204', dead_ip='')
        g = self.lines()[0]['results']['googleapis']
        self.assertEqual((g['code'], g['ip'], g['total']), ('000', '', 0.12))

    def test_the_summary_names_the_failing_ips_and_skips_lines_without_one(self):
        with open(self.log, 'w') as f:   # an OLD-format line (no ip): must not be counted or guessed
            f.write(json.dumps({'ts': int(at(4, 5)), 'at': 'x', 'results': {'googleapis': {'code': '000', 'total': None}}}) + '\n')
        self.run_probe(at(4, 15), dead='https://www.googleapis.com/generate_204')
        self.run_probe(at(4, 25), dead='https://www.googleapis.com/generate_204')
        self.run_probe(at(4, 35), dead='https://www.googleapis.com/generate_204', dead_ip='')
        r = self.run_probe(at(4, 40), '--summary', '2')
        self.assertRegex(r.stdout, r'googleapis\s+4/4 no answer')
        self.assertIn('failed at: 172.217.113.4 x2, no-connect x1', r.stdout)

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
