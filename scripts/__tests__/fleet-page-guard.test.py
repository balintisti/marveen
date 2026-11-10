"""fleet-page-guard.sh + agent-core-check.py (card 074149c2, marveen 57647): a generated block that
has not reached a page yet is NOT a defect and sends nothing; a defect names its pages on a
machine-readable first line; an unmeasurable start never reads as reassuring."""
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)
GUARD = os.path.join(SCRIPTS, 'fleet-page-guard.sh')
CHECK = os.path.join(SCRIPTS, 'agent-core-check.py')

spec = importlib.util.spec_from_file_location('agent_core_check', CHECK)
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def write(path, body):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)


PAGE_LINES = '  atlas          33,471 kar.  kanari 23/23, szakasz 12/12, generalt 9/10\n' \
             '  didi           39,962 kar.  kanari 23/23, szakasz 12/12, generalt 10/10\n'


class Guard(unittest.TestCase):
    """The shell script against a fake root: the checker and the alarm route are stubs, the
    checker's closing lines come from the REAL summary()."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='page-guard-')
        os.makedirs(os.path.join(self.root, 'scripts'))
        os.makedirs(os.path.join(self.root, 'store'))
        self.sent = os.path.join(self.root, 'sent.txt')
        self.log = os.path.join(self.root, 'store', 'fleet-page-guard.log')
        with open(os.path.join(self.root, 'scripts', 'alert-coordinator.sh'), 'w') as f:
            f.write(f'#!/bin/bash\ncat > "{self.sent}"\necho "OK coordinator OK id=1"\n')

    def tearDown(self):
        subprocess.run(['rm', '-rf', self.root])

    def run_guard(self, out, rc):
        with open(os.path.join(self.root, 'checker-out.txt'), 'w', encoding='utf-8') as f:
            f.write(out)
        with open(os.path.join(self.root, 'scripts', 'agent-core-check.py'), 'w') as f:
            f.write('import sys\n'
                    f'sys.stdout.write(open({os.path.join(self.root, "checker-out.txt")!r}, encoding="utf-8").read())\n'
                    f'sys.exit({rc})\n')
        r = subprocess.run(['bash', GUARD], env=dict(os.environ, FLEET_PAGE_GUARD_ROOT=self.root),
                           capture_output=True, text=True, timeout=30)
        return r.returncode, read(self.sent) if os.path.exists(self.sent) else None, read(self.log)

    def test_complete_pages_send_nothing(self):
        rc, sent, log = self.run_guard(PAGE_LINES + '\n' + check.summary(2, [], []) + '\n', 0)
        self.assertEqual(rc, 0)
        self.assertIsNone(sent)
        self.assertIn('OK rc=0  2 agens-lap, mind teljes', log)

    def test_a_block_that_arrives_at_the_next_start_sends_nothing_and_is_named_in_the_log(self):
        rc, sent, log = self.run_guard(PAGE_LINES + '\n' + check.summary(2, [], ['atlas']) + '\n', 0)
        self.assertEqual(rc, 0)
        self.assertIsNone(sent)
        self.assertIn('OK rc=0  2 agens-lap, hibas nincs; 1 lapra generalt blokk a kovetkezo indulasnal erkezik (atlas)', log)
        self.assertNotIn('mind teljes', log)

    def test_a_defect_names_its_pages_on_the_first_line(self):
        rc, sent, log = self.run_guard(PAGE_LINES + '\n' + check.summary(3, ['didi', 'ford-2'], ['atlas']) + '\n', 3)
        self.assertEqual(rc, 3)
        lines = sent.splitlines()
        self.assertEqual(lines[0], '[fleet-page-guard] LAPOK: didi, ford-2')
        self.assertEqual(lines[1], 'EGY VAGY TOBB AGENS-LAP NEM HORDOZZA A TEHERHORDO MONDATOKAT.')
        self.assertIn('GENERALT blokkot kezzel NE irj', sent)
        self.assertIn('1 lapra generalt blokk a kovetkezo indulasnal erkezik (atlas)', sent)
        self.assertIn('HIANYOS rc=3', log)

    def test_a_defect_without_a_readable_name_line_carries_no_page_list(self):
        for tail in ('!!! 1 LAP HIANYOS -- regi alak, nev nelkul',
                     'HIBAS-LAPOK: didi; rm -rf x',
                     'HIBAS-LAPOK: Didi',
                     'HIBAS-LAPOK: ',
                     '  HIBAS-LAPOK: didi'):
            with self.subTest(tail=tail):
                if os.path.exists(self.sent):
                    os.remove(self.sent)
                rc, sent, _ = self.run_guard(PAGE_LINES + '\n' + tail + '\n', 3)
                self.assertEqual(rc, 3)
                self.assertEqual(sent.splitlines()[0],
                                 '[fleet-page-guard] EGY VAGY TOBB AGENS-LAP NEM HORDOZZA A TEHERHORDO MONDATOKAT.')
                self.assertNotIn('LAPOK: ', sent.splitlines()[0])

    def test_a_blind_guard_stays_an_alarm_without_a_page_list(self):
        rc, sent, _ = self.run_guard('!!! A MERO NEM FUTOTT: a szakasz-lista URES\nHIBAS-LAPOK: didi\n', 4)
        self.assertEqual(rc, 4)
        self.assertTrue(sent.startswith('[fleet-page-guard] AZ AGENS-LAP OR NEM TUDOTT MERNI (rc=4)'))
        self.assertNotIn('LAPOK: ', sent.splitlines()[0])


class Checker(unittest.TestCase):
    def test_the_self_test_passes(self):
        r = subprocess.run([sys.executable, CHECK, '--self-test'], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertRegex(r.stdout, r'SELF-TEST PASS \((\d+)/\1\)')

    def test_only_a_session_older_than_the_writer_waits(self):
        self.assertEqual(check.generated_wait(100, 200)[0], True)
        self.assertEqual(check.generated_wait(None, 200)[0], True)
        self.assertEqual(check.generated_wait(200, 200)[0], False)
        self.assertEqual(check.generated_wait(300, 200)[0], False)

    def test_an_unmeasured_start_is_a_defect_whatever_the_other_reading_says(self):
        for start, since in ((check.UNKNOWN, 200), (100, check.UNKNOWN), (None, check.UNKNOWN),
                             (check.UNKNOWN, check.UNKNOWN)):
            with self.subTest(start=start, since=since):
                arrives, why = check.generated_wait(start, since)
                self.assertFalse(arrives)
                self.assertIn('NEM MERHETO', why)

    def test_the_writer_start_is_unknown_without_a_dashboard_process(self):
        tmp = tempfile.mkdtemp(prefix='page-guard-pid-')
        old = (check.PIDFILE, check.SCAFFOLD)
        try:
            check.SCAFFOLD = CHECK  # any existing file: only the pid file is under test
            check.PIDFILE = os.path.join(tmp, 'missing.pid')
            self.assertIs(check.writer_since(), check.UNKNOWN)
            for body in ('not a pid', str(os.getpid())):  # this process is not the dashboard
                check.PIDFILE = os.path.join(tmp, 'x.pid')
                write(check.PIDFILE, body)
                self.assertIs(check.writer_since(), check.UNKNOWN, body)
            check.SCAFFOLD = os.path.join(tmp, 'no-build.js')
            self.assertIs(check.writer_since(), check.UNKNOWN)
        finally:
            check.PIDFILE, check.SCAFFOLD = old
            subprocess.run(['rm', '-rf', tmp])

    def test_the_writer_start_is_the_later_of_the_build_and_the_process_start(self):
        tmp = tempfile.mkdtemp(prefix='page-guard-ps-')
        old = (check.PIDFILE, check.SCAFFOLD, os.environ['PATH'])
        try:
            fake = os.path.join(tmp, 'ps')  # the dashboard, up for 10 minutes
            write(fake, '#!/bin/sh\ncase "$2" in command=) echo "node /x/dist/index.js";; etime=) echo "   10:00";; esac\n')
            os.chmod(fake, 0o755)
            os.environ['PATH'] = tmp
            check.PIDFILE = os.path.join(tmp, 'd.pid')
            write(check.PIDFILE, '4242\n')
            check.SCAFFOLD = os.path.join(tmp, 'build.js')
            write(check.SCAFFOLD, 'x')
            now = 1_000_000
            os.utime(check.SCAFFOLD, (now - 3600, now - 3600))  # built an hour ago: the process is the later
            self.assertEqual(check.writer_since(now), now - 600)
            os.utime(check.SCAFFOLD, (now - 60, now - 60))  # rebuilt a minute ago: the build is the later
            self.assertEqual(check.writer_since(now), now - 60)
        finally:
            check.PIDFILE, check.SCAFFOLD, os.environ['PATH'] = old
            subprocess.run(['rm', '-rf', tmp])

    def test_tmux_that_does_not_answer_is_unknown_not_an_empty_fleet(self):
        tmp = tempfile.mkdtemp(prefix='page-guard-tmux-')
        old = os.environ['PATH']
        try:
            os.environ['PATH'] = tmp  # no tmux at all
            self.assertIs(check.session_starts(), check.UNKNOWN)
            # fails / fails after printing a session / lists nothing / garbage
            for body in ('exit 1', 'echo "agent-didi 1794317909"; exit 1', 'exit 0', 'echo "no numbers here"'):
                fake = os.path.join(tmp, 'tmux')
                write(fake, '#!/bin/sh\n' + body + '\n')
                os.chmod(fake, 0o755)
                self.assertIs(check.session_starts(), check.UNKNOWN, body)
            write(fake, '#!/bin/sh\necho "agent-didi 1794317909"\necho "odd name 12"\n')
            self.assertEqual(check.session_starts(), {'agent-didi': 1794317909, 'odd name': 12})
        finally:
            os.environ['PATH'] = old
            subprocess.run(['rm', '-rf', tmp])


if __name__ == '__main__':
    unittest.main()
