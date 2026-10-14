"""fd-table-guard.py (card 5f9ae1d5): the open-file table alarms BEFORE it is full, names the
holders, does not repeat itself inside the cooldown, and is loud when it cannot measure."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
GUARD = os.path.join(os.path.dirname(HERE), 'fd-table-guard.py')


class Guard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='fdguard-')
        self.sent = os.path.join(self.tmp, 'sent.txt')
        self.lsof = self.fake('lsof', 'cat <<EOF\nCOMMAND PID USER FD\nnode 111 isti 1u\n'
                              'node 111 isti 2u\nnode 111 isti 3u\nollama 222 isti 4u\nEOF')
        self.alert_ok = self.fake('alert', 'cat >> %s; echo "---" >> %s; echo "OK coordinator OK id=9"'
                                  % (self.sent, self.sent))

    def tearDown(self):
        subprocess.run(['rm', '-rf', self.tmp])

    def fake(self, name, body):
        path = os.path.join(self.tmp, name)
        with open(path, 'w') as f:
            f.write('#!/bin/sh\n' + body + '\n')
        os.chmod(path, 0o755)
        return path

    def sysctl(self, num, mx=100):
        return self.fake('sysctl-%s' % num, 'printf "%s\\n%s\\n"' % (num, mx))

    def run_guard(self, sysctl=None, alert=None, **env):
        e = dict(os.environ, FD_GUARD_STATE_DIR=self.tmp, FD_GUARD_LSOF=self.lsof,
                 FD_GUARD_ALERT=alert or self.alert_ok)
        if sysctl:
            e['FD_GUARD_SYSCTL'] = sysctl
        e.update(env)
        return subprocess.run([sys.executable, GUARD], capture_output=True, text=True, env=e, timeout=60)

    def alarms(self):
        if not os.path.exists(self.sent):
            return []
        with open(self.sent) as f:
            return [a for a in f.read().split('---\n') if a.strip()]

    def test_real_measurement_fires_when_the_threshold_is_below_it(self):
        # Positive control on the REAL sysctl: only the threshold moves, the measurement is the machine's.
        r = self.run_guard(FD_GUARD_WARN_PCT='1', FD_GUARD_CRIT_PCT='99')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(len(self.alarms()), 1, r.stdout)
        self.assertRegex(self.alarms()[0], r'kern\.num_files \d+ of kern\.maxfiles \d+')
        self.assertIn('alarm=sent', r.stdout)

    def test_real_measurement_quiet_below_the_threshold(self):
        r = self.run_guard(FD_GUARD_WARN_PCT='98', FD_GUARD_CRIT_PCT='99')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertRegex(r.stdout, r' ok \d+/\d+ ')
        self.assertEqual(self.alarms(), [])

    def test_names_the_holders_biggest_first(self):
        self.run_guard(self.sysctl(75))
        a = self.alarms()[0]
        self.assertIn('WARN', a)
        self.assertLess(a.index('pid 111'), a.index('pid 222'))
        self.assertRegex(a, r'\b3  pid 111\b')
        self.assertIn('kills nothing', a)

    def test_cooldown_then_rise_alarms_at_once_and_a_fall_is_silent(self):
        self.run_guard(self.sysctl(75))
        self.run_guard(self.sysctl(76))                       # same level inside cooldown
        self.assertEqual(len(self.alarms()), 1)
        self.run_guard(self.sysctl(95))                       # rise -> at once
        self.assertEqual(len(self.alarms()), 2)
        self.assertIn('CRIT', self.alarms()[1])
        self.run_guard(self.sysctl(80))                       # fall inside cooldown -> silent
        self.assertEqual(len(self.alarms()), 2)
        self.run_guard(self.sysctl(10))                       # back to ok resets
        self.run_guard(self.sysctl(75))
        self.assertEqual(len(self.alarms()), 3)

    def test_cooldown_expires(self):
        self.run_guard(self.sysctl(75))
        state = os.path.join(self.tmp, 'fd-table-guard.state.json')
        with open(state) as f:
            s = json.load(f)
        s['ts'] -= 3601
        with open(state, 'w') as f:
            json.dump(s, f)
        self.run_guard(self.sysctl(75))
        self.assertEqual(len(self.alarms()), 2)

    def test_invalid_thresholds_fall_back_to_the_defaults_not_to_always(self):
        for bad in ('0', 'abc', '-5', '100'):
            r = self.run_guard(self.sysctl(50), FD_GUARD_WARN_PCT=bad)
            self.assertIn(' ok ', r.stdout, bad)
        r = self.run_guard(self.sysctl(50), FD_GUARD_WARN_PCT='40', FD_GUARD_CRIT_PCT='30')  # inverted
        self.assertIn(' ok ', r.stdout)
        self.assertEqual(self.alarms(), [])

    def test_cannot_measure_is_an_alarm_not_silence(self):
        r = self.run_guard(self.fake('sysctl-bad', 'echo nonsense'))
        self.assertEqual(r.returncode, 2)
        self.assertIn('CANNOT MEASURE', self.alarms()[0])

    def test_a_lost_alarm_exits_1_and_is_retried_next_run(self):
        lost = self.fake('alert-lost', 'cat >/dev/null; echo "NOWHERE: both refused"; exit 1')
        r = self.run_guard(self.sysctl(95), alert=lost)
        self.assertEqual(r.returncode, 1)
        self.assertIn('alarm=NOWHERE', r.stdout)
        self.run_guard(self.sysctl(95))                       # no cooldown was started by the lost one
        self.assertEqual(len(self.alarms()), 1)


if __name__ == '__main__':
    unittest.main(verbosity=1)
