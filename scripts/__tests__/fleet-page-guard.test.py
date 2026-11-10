"""fleet-page-guard.sh + agent-core-check.py (card 074149c2, marveen 57647): a generated block that
has not reached a page yet is NOT a defect and sends nothing; a defect names its pages on a
machine-readable first line; an unmeasurable start never reads as reassuring."""
import contextlib
import importlib.util
import io
import os
import re
import subprocess
import sys
import tempfile
import time
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


BLOCK = '<!-- BEGIN GENERATED: blk (x) -->\n<!-- END GENERATED: blk -->\n'


class Main(unittest.TestCase):
    """main() against a fake root, a fake tmux and a fake ps (didi 57938, finding 2): the wiring
    between the session list, the writer start and each page's verdict. Nothing of the checker is
    stubbed; the canary source (claude-md-edit.py) is a one-line stand-in. The fake dashboard has
    been up for 10 minutes on a build an hour old, so the writer start is ten minutes ago."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='page-guard-main-')
        for d in ('scripts', 'store', 'dist/web', 'bin', 'agents'):
            os.makedirs(os.path.join(self.root, d))
        write(os.path.join(self.root, 'scripts', 'claude-md-edit.py'),
              'def canary_lines():\n    return ["CANARY-LINE"]\n')
        sections = os.path.join(self.root, 'sections.txt')
        write(sections, 'a | ALPHA\n')
        scaffold = os.path.join(self.root, 'dist', 'web', 'agent-scaffold.js')
        write(scaffold, BLOCK)
        self.now = int(time.time())
        os.utime(scaffold, (self.now - 3600, self.now - 3600))
        pidfile = os.path.join(self.root, 'store', 'claudeclaw.pid')
        write(pidfile, '4242\n')
        ps = os.path.join(self.root, 'bin', 'ps')
        write(ps, '#!/bin/sh\ncase "$2" in command=) echo "node /x/dist/index.js";; etime=) echo "   10:00";; esac\n')
        os.chmod(ps, 0o755)
        self.old = (check.ROOT, check.SECTIONS, check.SCAFFOLD, check.PIDFILE, os.environ['PATH'])
        check.ROOT, check.SECTIONS, check.SCAFFOLD, check.PIDFILE = self.root, sections, scaffold, pidfile
        os.environ['PATH'] = os.path.join(self.root, 'bin')

    def tearDown(self):
        check.ROOT, check.SECTIONS, check.SCAFFOLD, check.PIDFILE, os.environ['PATH'] = self.old
        subprocess.run(['rm', '-rf', self.root])

    def page(self, agent, body='CANARY-LINE\nALPHA\n', block=True):
        os.makedirs(os.path.join(self.root, 'agents', agent))
        if body is not None:
            write(os.path.join(self.root, 'agents', agent, 'CLAUDE.md'), body + (BLOCK if block else ''))

    def run_main(self, tmux_body):
        """tmux_body: the fake tmux as shell lines; `{ago:N}` becomes the epoch N seconds ago."""
        tmux = os.path.join(self.root, 'bin', 'tmux')
        write(tmux, '#!/bin/sh\n' + re.sub(r'\{ago:(\d+)\}', lambda m: str(self.now - int(m.group(1))), tmux_body) + '\n')
        os.chmod(tmux, 0o755)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = check.main()
        return rc, out.getvalue()

    def test_pages_that_only_wait_for_the_next_start_exit_clean_and_name_no_defect(self):
        self.page('early', block=False)    # its session is older than the writer
        self.page('stopped', block=False)  # no agent session; a bare-named one is not the agent's
        self.page('full')
        rc, out = self.run_main('echo "agent-early {ago:3600}"\necho "stopped {ago:60}"\necho "agent-full {ago:60}"')
        self.assertEqual(rc, 0, out)
        self.assertEqual(out.splitlines()[-1], 'NINCS HIBAS LAP (3 lap): 2 lapra generalt blokk a kovetkezo '
                                               'indulasnal erkezik (early, stopped)')
        self.assertNotIn('HIBAS-LAPOK', out)
        self.assertNotIn('HIANYZIK', out)
        self.assertIn('nincs futo munkamenete', out)

    def test_a_session_started_after_the_writer_is_a_defect_under_its_agent_prefixed_name(self):
        self.page('late', block=False)
        self.page('full')
        # the decoy: an old session under the BARE name must not lend its age to the agent
        rc, out = self.run_main('echo "late {ago:3600}"\necho "agent-late {ago:60}"\necho "agent-full {ago:60}"')
        self.assertEqual(rc, 3, out)
        self.assertEqual(out.splitlines()[-1], 'HIBAS-LAPOK: late')
        self.assertIn('HIANYZIK generalt: blk', out)
        self.assertIn('megsem irta meg', out)
        self.assertNotIn('KESOBB ERKEZIK', out)

    def test_tmux_that_does_not_answer_makes_a_missing_block_a_defect_not_a_stopped_agent(self):
        self.page('gap', block=False)
        self.page('full')
        rc, out = self.run_main('exit 1')
        self.assertEqual(rc, 3, out)
        self.assertEqual(out.splitlines()[-1], 'HIBAS-LAPOK: gap')
        self.assertIn('NEM MERHETO', out)
        self.assertNotIn('KESOBB ERKEZIK', out)

    def test_a_writer_that_cannot_be_measured_makes_a_missing_block_a_defect(self):
        self.page('early', block=False)
        os.remove(check.PIDFILE)
        rc, out = self.run_main('echo "agent-early {ago:3600}"')
        self.assertEqual(rc, 3, out)
        self.assertEqual(out.splitlines()[-1], 'HIBAS-LAPOK: early')
        self.assertIn('NEM MERHETO', out)

    def test_a_waiting_page_neither_hides_nor_joins_the_defective_ones(self):
        self.page('early', block=False)
        self.page('both', body='CANARY-LINE\n', block=False)  # waits for its block AND lacks a section
        self.page('broken', body='CANARY-LINE\n')  # the section is missing, the block is there
        self.page('nopage', body=None)
        rc, out = self.run_main('echo "agent-early {ago:3600}"\necho "agent-both {ago:3600}"\n'
                                'echo "agent-broken {ago:60}"')
        self.assertEqual(rc, 3, out)
        self.assertEqual(out.splitlines()[-1], 'HIBAS-LAPOK: both, broken, nopage')
        self.assertIn('(2 lapra generalt blokk a kovetkezo indulasnal erkezik (both, early))', out)
        self.assertIn('HIANYZIK szakasz: a', out)
        self.assertRegex(out, r'(?m)^  nopage +NINCS LAP$')

    def test_complete_pages_exit_clean_whatever_tmux_says(self):
        self.page('full')
        for body in ('exit 1', 'echo "agent-full {ago:60}"'):
            with self.subTest(tmux=body):
                rc, out = self.run_main(body)
                self.assertEqual(rc, 0, out)
                self.assertEqual(out.splitlines()[-1], 'MIND A 1 LAP TELJES')

    def test_a_fleet_without_agent_directories_refuses_to_measure(self):
        with self.assertRaises(check.Unavailable):
            self.run_main('exit 1')

    def test_the_session_key_is_the_name_the_dashboard_gives_an_agent_session(self):
        """main() looks a page's session up as `agent-<name>`. The name is made in
        src/web/session-names.ts; if that template moves, this key must move with it."""
        ts = read(os.path.join(os.path.dirname(SCRIPTS), 'src', 'web', 'session-names.ts'))
        self.assertRegex(ts, r'export function agentSessionName\(name: string\): string \{\s*return `agent-\$\{name\}`')


if __name__ == '__main__':
    unittest.main()
