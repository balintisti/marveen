#!/usr/bin/env python3
"""Contract tests for scripts/backup-offsite.py. Card 0f37191a.

WHAT THESE PIN. The failure a backup tool exists to prevent is not "the upload errored" -- that
one is loud. It is a copy that LOOKS present and does not restore. So the load-bearing tests are:

    the round trip is BYTE-IDENTICAL, through the real gpg        (test_round_trip_is_byte_identical)
    what leaves the machine is ciphertext, not the archive       (test_uploaded_bytes_are_not_the_archive)
    a copy Drive holds differently fails, and prunes NOTHING     (test_read_back_mismatch_fails_and_keeps_history)
    a broken local archive is refused BEFORE any upload          (test_broken_archive_is_not_shipped)
    the newest copy is never pruned, however old                 (test_prune_never_removes_the_newest)
    a wrong key fails the restore test, loudly                   (test_wrong_key_fails_restore_test)
    no key in the Keychain -> nothing is uploaded                (test_no_key_uploads_nothing)

Drive is a local fake speaking the same HTTP (resumable upload, list, media download, delete);
gpg, sqlite and scripts/lib/backup-key.sh are real; only `security` is a stand-in (the library's
own BACKUP_KEY_SECURITY_BIN seam) holding a real 15-word key made by the library's generator.
TMPDIR is private to each test (and short: gpg's agent socket lives under it), so every temp
file the tool or the library leaves behind is visible.
"""
import hashlib
import http.server
import json
import os
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, '..', 'backup-offsite.py')
WORDS = os.path.join(HERE, '..', 'lib', 'backup_key_words.py')
FAKE_SECURITY = '''#!/bin/bash
# stand-in for /usr/bin/security: find-generic-password -w prints the key, 44 = no such item
[ -f "$FAKE_KEY_FILE" ] || exit 44
printf '%s' "$(cat "$FAKE_KEY_FILE")"
'''


def new_key():
    return subprocess.run([sys.executable, WORDS, 'generate'], capture_output=True, text=True, check=True).stdout.strip()


def read(path, mode='r'):
    with open(path, mode) as f:
        return f.read()


def folder_of(env):
    return json.loads(read(env['BACKUP_OFFSITE_STATE_FILE']))['folder_id']


class FakeDrive:
    def __init__(self):
        self.files = {}          # id -> dict(meta..., data=bytes)
        self.sessions = {}
        self.corrupt_next_upload = False
        self.give_refresh = True
        self.granted = 'https://www.googleapis.com/auth/drive.file'
        self.n = 0
        fake = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _body(self):
                n = int(self.headers.get('Content-Length') or 0)
                return self.rfile.read(n) if n else b''

            def _json(self, code, obj, extra=None):
                raw = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw)))
                for k, v in (extra or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(raw)

            def do_POST(self):
                u = urllib.parse.urlparse(self.path)
                body = self._body()
                if u.path == '/token':
                    form = urllib.parse.parse_qs(body.decode())
                    j = {'access_token': 'tok', 'expires_in': 3600}
                    if form.get('grant_type') == ['authorization_code'] and fake.give_refresh:
                        j['refresh_token'] = 'rt-from-' + form['code'][0]
                    return self._json(200, j)
                if u.path == '/drive/v3/files':
                    meta = json.loads(body)
                    fid = fake._new(meta, b'')
                    return self._json(200, {'id': fid})
                if u.path == '/upload/drive/v3/files':
                    sid = f's{len(fake.sessions)}'
                    fake.sessions[sid] = json.loads(body)
                    return self._json(200, {}, {'Location': f'http://127.0.0.1:{fake.port}/session/{sid}'})
                self._json(404, {'error': 'no route'})

            def do_PUT(self):
                sid = self.path.rsplit('/', 1)[-1]
                data = self._body()
                if fake.corrupt_next_upload:
                    data = data[:-1] + bytes([data[-1] ^ 1])
                    fake.corrupt_next_upload = False
                fid = fake._new(fake.sessions.pop(sid), data)
                self._json(200, {'id': fid})

            def do_GET(self):
                u = urllib.parse.urlparse(self.path)
                q = urllib.parse.parse_qs(u.query)
                if u.path == '/tokeninfo':
                    return self._json(200, {'scope': fake.granted})
                if u.path == '/drive/v3/files':
                    parent = q['q'][0].split("'")[1]
                    items = [f for f in fake.files.values()
                             if parent in f.get('parents', []) and (f.get('appProperties') or {}).get('marveenBackup') == '1']
                    items.sort(key=lambda f: f['createdTime'], reverse=True)
                    return self._json(200, {'files': [fake._pub(f) for f in items]})
                fid = u.path.rsplit('/', 1)[-1]
                f = fake.files.get(fid)
                if not f:
                    return self._json(404, {'error': 'not found'})
                if q.get('alt') == ['media']:
                    self.send_response(200)
                    self.send_header('Content-Length', str(len(f['data'])))
                    self.end_headers()
                    return self.wfile.write(f['data'])
                self._json(200, dict(fake._pub(f), trashed=False))

            def do_DELETE(self):
                fid = self.path.rsplit('/', 1)[-1]
                fake.files.pop(fid, None)
                self.send_response(204)
                self.end_headers()

        self.srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def _new(self, meta, data):
        self.n += 1
        fid = f'f{self.n}'
        self.files[fid] = dict(meta, id=fid, data=data,
                               createdTime=time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(time.time() + self.n)))
        return fid

    def _pub(self, f):
        return {'id': f['id'], 'name': f['name'], 'size': str(len(f['data'])),
                'md5Checksum': hashlib.md5(f['data']).hexdigest(), 'createdTime': f['createdTime'],
                'appProperties': f.get('appProperties'), 'parents': f.get('parents')}

    def add_old_backup(self, parent, days_old, name):
        fid = self._new({'name': name, 'parents': [parent], 'appProperties': {'marveenBackup': '1'}}, b'old')
        self.files[fid]['createdTime'] = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(time.time() - days_old * 86400))
        return fid


def make_archive(path, cards=3, broken_db=False):
    with tempfile.TemporaryDirectory() as d:
        db = os.path.join(d, 'claudeclaw.db')
        c = sqlite3.connect(db)
        c.execute('CREATE TABLE kanban_cards (id TEXT)')
        c.executemany('INSERT INTO kanban_cards VALUES (?)', [(f'c{i}',) for i in range(cards)])
        c.commit()
        c.close()
        if broken_db:
            with open(db, 'r+b') as f:
                f.seek(100)
                f.write(b'\xff' * 4000)
        with tarfile.open(path, 'w:gz') as t:
            t.add(db, arcname='repo/store/claudeclaw.db')
            secret = os.path.join(d, '.env')
            with open(secret, 'w') as f:
                f.write('SECRET_MARKER_4242=do-not-leak\n')
            t.add(secret, arcname='repo/.env')


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='offsite-test-')
        self.drive = FakeDrive()
        self.tooltmp = tempfile.mkdtemp(prefix='bot')
        self.alerts = os.path.join(self.tmp, 'alerts.txt')
        self.keyfile = os.path.join(self.tmp, 'key')
        self.security = os.path.join(self.tmp, 'security')
        with open(self.security, 'w') as f:
            f.write(FAKE_SECURITY)
        os.chmod(self.security, 0o755)
        self.oauth = os.path.join(self.tmp, 'conf', 'oauth.json')
        os.makedirs(os.path.dirname(self.oauth))
        with open(self.oauth, 'w') as f:
            json.dump({'client_id': 'i', 'client_secret': 's', 'refresh_token': 'r'}, f)
        base = f'http://127.0.0.1:{self.drive.port}'
        self.env = dict(os.environ, TMPDIR=self.tooltmp, BACKUP_KEY_SECURITY_BIN=self.security,
                        FAKE_KEY_FILE=self.keyfile, BACKUP_OFFSITE_OAUTH_FILE=self.oauth,
                        BACKUP_OFFSITE_STATE_FILE=os.path.join(self.tmp, 'conf', 'state.json'),
                        DRIVE_API_BASE=f'{base}/drive/v3', DRIVE_UPLOAD_BASE=f'{base}/upload/drive/v3',
                        OAUTH_TOKEN_URL=f'{base}/token', OAUTH_TOKENINFO_URL=f'{base}/tokeninfo',
                        BACKUP_OFFSITE_CLIENT_FILE=os.path.join(self.tmp, 'conf', 'client.json'), BACKUP_OFFSITE_ALERT_CMD=f'cat >> {self.alerts}')
        self.archive = os.path.join(self.tmp, 'claudeclaw-20260925-030000.tar.gz')
        make_archive(self.archive)

    def tearDown(self):
        self.drive.srv.shutdown()
        self.drive.srv.server_close()
        subprocess.run(['rm', '-rf', self.tmp, self.tooltmp])

    def run_tool(self, *args):
        return subprocess.run([sys.executable, SCRIPT, *args], env=self.env, capture_output=True, text=True, timeout=120)

    def init(self):
        with open(self.keyfile, 'w') as f:
            f.write(new_key())

    def alert_text(self):
        return read(self.alerts) if os.path.exists(self.alerts) else ''

    def uploaded(self):
        return [f for f in self.drive.files.values() if f['name'].endswith('.gpg')]


class TestOffsite(Base):
    def test_round_trip_is_byte_identical(self):
        self.init()
        r = self.run_tool('push', '--archive', self.archive)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('read back md5', r.stdout)
        r = self.run_tool('restore-test')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('byte-identical', r.stdout)
        self.assertIn('3 cards', r.stdout)
        self.assertEqual(self.alert_text(), '')

    def test_uploaded_bytes_are_not_the_archive(self):
        self.init()
        self.assertEqual(self.run_tool('push', '--archive', self.archive).returncode, 0)
        [f] = self.uploaded()
        raw = read(self.archive, 'rb')
        self.assertNotEqual(f['data'], raw)
        self.assertNotEqual(f['data'][:2], b'\x1f\x8b', 'the upload starts like a gzip: not encrypted')
        self.assertNotIn(b'SECRET_MARKER_4242', f['data'])
        self.assertNotIn(raw[20:60], f['data'])

    def test_read_back_mismatch_fails_and_keeps_history(self):
        self.init()
        self.assertEqual(self.run_tool('push', '--archive', self.archive).returncode, 0)
        parent = folder_of(self.env)
        old = self.drive.add_old_backup(parent, 30, 'claudeclaw-old.tar.gz.gpg')
        self.drive.corrupt_next_upload = True
        r = self.run_tool('push', '--archive', self.archive)
        self.assertEqual(r.returncode, 1)
        self.assertIn('READ-BACK MISMATCH', r.stderr)
        self.assertIn('READ-BACK MISMATCH', self.alert_text())
        self.assertIn(old, self.drive.files, 'a failed push must not prune the history')

    def test_broken_archive_is_not_shipped(self):
        self.init()
        bad = os.path.join(self.tmp, 'claudeclaw-bad.tar.gz')
        make_archive(bad, broken_db=True)
        r = self.run_tool('push', '--archive', bad)
        self.assertEqual(r.returncode, 1)
        self.assertEqual(self.uploaded(), [])
        self.assertIn('FAILED', self.alert_text())
        empty = os.path.join(self.tmp, 'claudeclaw-empty.tar.gz')
        make_archive(empty, cards=0)
        r = self.run_tool('push', '--archive', empty)
        self.assertEqual(r.returncode, 1)
        self.assertIn('EMPTY', r.stderr)
        self.assertEqual(self.uploaded(), [])

    def test_prune_removes_old_copies_and_keeps_young_ones(self):
        self.init()
        self.assertEqual(self.run_tool('push', '--archive', self.archive).returncode, 0)
        parent = folder_of(self.env)
        old = self.drive.add_old_backup(parent, 20, 'claudeclaw-20.gpg')
        young = self.drive.add_old_backup(parent, 3, 'claudeclaw-3.gpg')
        r = self.run_tool('prune', '--keep-days', '14')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn(old, self.drive.files)
        self.assertIn(young, self.drive.files)

    def test_prune_never_removes_the_newest(self):
        self.init()
        self.assertEqual(self.run_tool('push', '--archive', self.archive).returncode, 0)
        parent = folder_of(self.env)
        for f in list(self.drive.files.values()):
            if f['name'].endswith('.gpg'):
                del self.drive.files[f['id']]
        only = self.drive.add_old_backup(parent, 40, 'claudeclaw-last-good.gpg')
        self.assertEqual(self.run_tool('prune', '--keep-days', '14').returncode, 0)
        self.assertIn(only, self.drive.files, 'the last copy aged out: a stopped backup erased its own history')

    def test_wrong_key_fails_restore_test(self):
        self.init()
        self.assertEqual(self.run_tool('push', '--archive', self.archive).returncode, 0)
        self.init()   # a different, equally valid key
        r = self.run_tool('restore-test')
        self.assertEqual(r.returncode, 1)
        self.assertIn('restore-test FAILED', self.alert_text())

    def test_recorded_hash_mismatch_fails_restore_test(self):
        # decrypts fine, but is not the archive that was sent: the one check that tells them apart
        self.init()
        self.assertEqual(self.run_tool('push', '--archive', self.archive).returncode, 0)
        [f] = self.uploaded()
        f['appProperties']['sha256'] = '0' * 64
        r = self.run_tool('restore-test')
        self.assertEqual(r.returncode, 1)
        self.assertIn('sha256', r.stderr)

    def test_no_consent_yet_is_named_and_alerted(self):
        self.init()
        os.remove(self.oauth)
        r = self.run_tool('push', '--archive', self.archive)
        self.assertEqual(r.returncode, 1)
        self.assertIn('the owner has not consented yet', r.stderr)
        self.assertIn('NOT current', self.alert_text())

    def test_no_key_uploads_nothing(self):
        # fail-closed, as the CRM backup: no readable key -> nothing leaves the machine
        r = self.run_tool('push', '--archive', self.archive)
        self.assertEqual(r.returncode, 1)
        self.assertIn('offsite key is not readable (empty', r.stderr)
        self.assertEqual(self.uploaded(), [])
        self.assertIn('NOT current', self.alert_text())

    def test_an_unexpected_crash_is_as_loud_as_a_named_failure(self):
        # a malformed credential raises TypeError, not Fail: it must still alert
        self.init()
        with open(self.oauth, 'w') as f:
            f.write('[]')
        r = self.run_tool('push', '--archive', self.archive)
        self.assertEqual(r.returncode, 1)
        self.assertIn('UNEXPECTED', self.alert_text())

    def test_no_temp_files_are_left_behind(self):
        self.init()
        self.assertEqual(self.run_tool('push', '--archive', self.archive).returncode, 0)
        self.assertEqual(self.run_tool('restore-test').returncode, 0)
        self.drive.corrupt_next_upload = True
        self.assertEqual(self.run_tool('push', '--archive', self.archive).returncode, 1)
        self.assertEqual(os.listdir(self.tooltmp), [])


class TestConsent(Base):
    def setUp(self):
        super().setUp()
        os.remove(self.oauth)
        self.client(kind='installed')

    def client(self, kind):
        with open(self.env['BACKUP_OFFSITE_CLIENT_FILE'], 'w') as f:
            json.dump({kind: {'client_id': 'cid.apps.googleusercontent.com', 'client_secret': 'csec'}}, f)

    def test_consent_url_asks_for_drive_file_only_offline_with_consent(self):
        r = self.run_tool('consent-url')
        self.assertEqual(r.returncode, 0, r.stderr)
        q = urllib.parse.parse_qs(urllib.parse.urlparse(r.stdout.strip()).query)
        self.assertEqual(q['scope'], ['https://www.googleapis.com/auth/drive.file'])
        self.assertEqual(q['access_type'], ['offline'])
        self.assertEqual(q['prompt'], ['consent'])
        self.assertNotIn('csec', r.stdout)

    def test_exchange_stores_a_private_credential_that_works(self):
        r = self.run_tool('consent-exchange', 'http://localhost/?code=abc123&scope=x')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(oct(os.stat(self.oauth).st_mode & 0o777), '0o600')
        self.assertEqual(json.loads(read(self.oauth))['refresh_token'], 'rt-from-abc123')
        self.assertTrue(folder_of(self.env), 'the stored credential was not proven by a real call')

    def test_no_refresh_token_stores_nothing(self):
        self.drive.give_refresh = False
        r = self.run_tool('consent-exchange', 'abc123')
        self.assertEqual(r.returncode, 1)
        self.assertIn('NO refresh_token', r.stderr)
        self.assertFalse(os.path.exists(self.oauth))

    def test_unticked_scope_stores_nothing(self):
        self.drive.granted = 'openid'
        r = self.run_tool('consent-exchange', 'abc123')
        self.assertEqual(r.returncode, 1)
        self.assertIn('did not grant', r.stderr)
        self.assertFalse(os.path.exists(self.oauth))

    def test_web_client_is_refused(self):
        self.client(kind='web')
        r = self.run_tool('consent-url')
        self.assertEqual(r.returncode, 1)
        self.assertIn('not a desktop', r.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=1)
