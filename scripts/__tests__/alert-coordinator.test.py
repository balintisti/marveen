"""alert-coordinator.sh (card 906e9159): the coordinator with --force first, the owner when that is
refused, and a loud NOWHERE when both fail -- plus a static guard over every agent-msg.sh caller."""
import os
import re
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)
HELPER = os.path.join(SCRIPTS, 'alert-coordinator.sh')


class Helper(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='alert-')
        self.notified = os.path.join(self.tmp, 'notified.txt')

    def tearDown(self):
        subprocess.run(['rm', '-rf', self.tmp])

    def run_helper(self, coordinator, notify_ok=True, text='the alarm text'):
        def fake(name, body):
            path = os.path.join(self.tmp, name)
            open(path, 'w').write('#!/bin/sh\n' + body + '\n')
            os.chmod(path, 0o755)
            return path
        send = fake('send', {'ok': 'cat >/dev/null; echo "OK id=77 queue=4"',
                             'refused': 'cat >/dev/null; echo "NEM KULDTEM" >&2; exit 2'}[coordinator])
        notify = fake('notify', f'printf %s "$1" > {self.notified}' if notify_ok else 'exit 1')
        env = dict(os.environ, ALERT_AGENT_MSG=send, ALERT_NOTIFY=notify)
        return subprocess.run(['bash', HELPER], input=text, env=env, capture_output=True, text=True, timeout=30)

    def test_the_coordinator_first_and_only_it_when_it_accepts(self):
        r = self.run_helper('ok')
        self.assertEqual(r.returncode, 0)
        self.assertIn('OK coordinator OK id=77', r.stdout)
        self.assertFalse(os.path.exists(self.notified))

    def test_a_refused_alarm_goes_to_the_owner_with_the_same_text(self):
        r = self.run_helper('refused')
        self.assertEqual(r.returncode, 0)
        self.assertIn('OK owner', r.stdout)
        self.assertEqual(open(self.notified).read(), 'the alarm text')

    def test_nowhere_is_loud(self):
        r = self.run_helper('refused', notify_ok=False)
        self.assertEqual(r.returncode, 1)
        self.assertIn('NOWHERE', r.stdout)

    def test_an_empty_alarm_is_not_a_delivery(self):
        r = self.run_helper('ok', text='')
        self.assertEqual(r.returncode, 1)

    def test_the_real_coordinator_route_uses_force(self):
        self.assertRegex(open(HELPER).read(), r"agent-msg\.sh'? \$FROM \$MAIN_AGENT_ID - --force")


# Every scripts/ file that CALLS agent-msg.sh either forces it, goes through the helper, or is listed
# here with the reason its silence is covered elsewhere. A new silent alarm fails this test.
NOT_AN_ALARM_OR_COVERED = {
    'agent-msg.sh': 'the sender itself (its help text names the command)',
    'backup.sh': 'scheduler command task, failThreshold 1: a failed run alerts the owner by Telegram',
    'tenant-second-user-watch.sh': 'scheduler command task, failThreshold 2, exits 6 on a send failure',
    'quota-ceiling-guard.sh': 'messages OTHER agents, not the coordinator; its own owner fallback is notify.sh',
    'kartya-es-ertesites.py': 'help text only, no call',
    'kanban-project-classify.py': 'a docstring mention, no call',
    'merge-overlap.py': 'a docstring mention, no call',
    'homoglyph.py': 'a docstring mention, no call (the checker agent-msg.sh runs; upstream dd312aa1)',
    'mixed_script.py': 'a docstring mention, no call (the shared rule; upstream dd312aa1)',
}
CALL = re.compile(r'agent-msg\.sh')


def offenders(root):
    out = []
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in ('__tests__', 'node_modules', '__pycache__')]
        for f in files:
            if not f.endswith(('.sh', '.py', '.mjs', '.ts')) or f in NOT_AN_ALARM_OR_COVERED or f == 'alert-coordinator.sh':
                continue
            lines = open(os.path.join(dirpath, f), errors='replace').read().split('\n')
            for n, line in enumerate(lines, 1):
                t = line.strip()
                if not CALL.search(t) or t.startswith('#') or t.startswith('//'):
                    continue
                # a call may continue on the next lines (a Python argv list, a `\` continuation)
                if '--force' not in ' '.join(lines[n - 1:n + 2]):
                    out.append(f'{os.path.relpath(os.path.join(dirpath, f), root)}:{n}')
    return out


class Guard(unittest.TestCase):
    def test_every_alarm_sender_forces_or_uses_the_helper(self):
        self.assertEqual(offenders(SCRIPTS), [])

    def test_CONTROL_the_guard_sees_a_plain_call(self):
        d = tempfile.mkdtemp(prefix='alert-guard-')
        try:
            open(os.path.join(d, 'x-guard.sh'), 'w').write('printf %s "$M" | bash "$ROOT/scripts/agent-msg.sh" marveen marveen -\n')
            open(os.path.join(d, 'y-guard.sh'), 'w').write('bash scripts/agent-msg.sh a b - --force\n# bash scripts/agent-msg.sh in a comment\n')
            self.assertEqual(offenders(d), ['x-guard.sh:1'])
        finally:
            subprocess.run(['rm', '-rf', d])


if __name__ == '__main__':
    unittest.main(verbosity=1)
