#!/usr/bin/env python3
"""Second copy of the Marveen backup on Google Drive -- encrypted, pruned, and restore-tested.

Card 0f37191a, Isti's decision (Telegram 3523, 2026-09-25): "Mehet Drive-ra."
The daily archive (scripts/backup.sh -> backups/claudeclaw-*.tar.gz) sits on the same disk as the
data it protects. This sends a second copy off the machine.

    consent-url       print the owner's one-time consent link (scope drive.file only)
    consent-exchange  turn the code from that link into the stored credential, and prove it
    push          verify the newest local archive, encrypt it, upload, READ BACK, then prune
    restore-test  download the newest remote copy, decrypt, and prove it restores
    prune         remove remote copies older than --keep-days (never the newest)

WHY NOT THE SERVICE ACCOUNT (measured 2026-09-25 07:32): a service account has a Drive storage
quota of 0. A binary upload is refused with 403 storageQuotaExceeded -- also into a folder the
owner shared with it, because the account would OWN the file. Native Google Docs do not count
against quota, which is why the existing createDriveDoc path works and this one cannot. So the
upload runs as the OWNER through OAuth, with the one scope `drive.file`: it sees only files this
tool created, and it can delete only those.

ENCRYPTION: the SAME offsite key and the SAME code as the CRM backup (marveen 2026-09-25 07:35):
scripts/lib/backup-key.sh reads it from the Keychain (com.marveen.delta-crm-backup) and runs gpg
AES256. The key never enters this process -- the library moves it over a pipe into gpg -- and
the owner keeps ONE verified paper copy that restores both backups, not two. The archive holds
secrets (vault, tokens, .env), so it never leaves the machine in the clear. FAIL-CLOSED: without
a readable key nothing is uploaded, and the reason names the Keychain status.

A 200 IS NOT PROOF: after the upload the file's md5 as DRIVE reports it is compared with the md5
of the bytes sent, and the plaintext's sha256 travels in appProperties so a restore test can
prove a byte-identical round trip -- not merely that something decrypted.

FAILURES ARE LOUD: every failure exits non-zero AND alerts the coordinator (the owner as the
fallback when the coordinator is not running), the routing rule of card 45101873.

Configuration (all overridable for tests):
    scripts/lib/backup-key.sh                  key + gpg (its BACKUP_KEY_SECURITY_BIN seam in tests)
    ~/.config/marveen/drive-backup-oauth.json  {client_id, client_secret, refresh_token}
                                               (BACKUP_OFFSITE_OAUTH_FILE)
    ~/.config/marveen/drive-backup-state.json  {folder_id} once created (BACKUP_OFFSITE_STATE_FILE)
    DRIVE_API_BASE / DRIVE_UPLOAD_BASE / OAUTH_TOKEN_URL   endpoints (a fake server in tests)
    BACKUP_OFFSITE_ALERT_CMD                   a command that receives an alert on stdin (tests)
"""
import argparse
import calendar
import glob
import re
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

HOME = os.path.expanduser('~')
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
CONF = os.path.join(HOME, '.config', 'marveen')
KEY_LIB = os.path.join(REPO_ROOT, 'scripts', 'lib', 'backup-key.sh')
OAUTH_FILE = os.environ.get('BACKUP_OFFSITE_OAUTH_FILE', os.path.join(CONF, 'drive-backup-oauth.json'))
STATE_FILE = os.environ.get('BACKUP_OFFSITE_STATE_FILE', os.path.join(CONF, 'drive-backup-state.json'))
API = os.environ.get('DRIVE_API_BASE', 'https://www.googleapis.com/drive/v3')
UPLOAD = os.environ.get('DRIVE_UPLOAD_BASE', 'https://www.googleapis.com/upload/drive/v3')
TOKEN_URL = os.environ.get('OAUTH_TOKEN_URL', 'https://oauth2.googleapis.com/token')
TOKENINFO_URL = os.environ.get('OAUTH_TOKENINFO_URL', 'https://oauth2.googleapis.com/tokeninfo')
AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
CLIENT_FILE = os.environ.get('BACKUP_OFFSITE_CLIENT_FILE', os.path.join(CONF, 'drive-backup-client.json'))
SCOPE = 'https://www.googleapis.com/auth/drive.file'
REDIRECT = 'http://localhost'
FOLDER_NAME = 'Marveen mentes'
APP_TAG = 'marveenBackup'
DEFAULT_KEEP_DAYS = 14
HTTP_TIMEOUT = 120
# RESILIENCE (measured 2026-09-28 23:3x, the first real push): the network to Google dropped
# connections intermittently -- two 172 MB pushes died with BrokenPipe, a 1 MB probe did too, and
# minutes later the same calls went through. One PUT of the whole archive restarts from byte 0 on
# every break, and nothing retried at all. So: the upload goes in CHUNK pieces through the
# resumable session, a break costs one "how much do you have?" and the rest of the file, and the
# small calls retry a TRANSIENT failure (no connection, 5xx, 429) a bounded number of times. A real
# 4xx is never retried: it is an answer, and it stays loud.
CHUNK = int(os.environ.get('BACKUP_OFFSITE_CHUNK', 8 * 1024 * 1024))    # Drive: a multiple of 256 KiB
RETRIES = int(os.environ.get('BACKUP_OFFSITE_RETRIES', 5))
BACKOFF_S = float(os.environ.get('BACKUP_OFFSITE_BACKOFF', 2))
MAIN_AGENT_ID = os.environ.get('MAIN_AGENT_ID', 'marveen')
DB_IN_ARCHIVE = 'repo/store/claudeclaw.db'
# A daily archive older than this means the DAILY BACKUP has stopped (didi 08:08, marveen 08:09).
# Without it, a stopped local backup was re-uploaded every day "successfully" -- measured: a
# 10-day-old archive gave push rc=0 and restore-test "0 h old", and a 10-day local gap really
# happened (09-14 .. 09-24). 36 h = one missed day plus slack for a late run.
MAX_ARCHIVE_AGE_H = 36
STAMP_RE = re.compile(r'claudeclaw-(\d{8}-\d{6})\.tar\.gz$')


class Fail(Exception):
    """A failure with a sentence that names its cause; main() turns it into exit 1 + an alert."""


class Transient(Fail):
    """Worth another try: the connection broke, or Drive answered 5xx / 429."""


# ---------------------------------------------------------------- local checks and crypto

def sha256_of(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def md5_of(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def verify_archive(path, workdir):
    """The archive must be a readable tar.gz whose database passes integrity_check.

    Checked BEFORE encryption, so a broken backup is not shipped and later mistaken for a good one.
    Returns the kanban card count as a sanity figure for the log line."""
    try:
        with tarfile.open(path, 'r:gz') as t:
            names = t.getnames()
            if DB_IN_ARCHIVE not in names:
                raise Fail(f'{os.path.basename(path)}: no {DB_IN_ARCHIVE} in the archive')
            # `filter` exists from Python 3.12 (and late 3.8-3.11 patches); the stock macOS
            # /usr/bin/python3 is 3.9.6 WITHOUT it, where the keyword is a TypeError -- measured.
            kw = {'filter': 'data'} if hasattr(tarfile, 'data_filter') else {}
            t.extract(DB_IN_ARCHIVE, workdir, **kw)
    except (tarfile.TarError, OSError, EOFError) as e:
        raise Fail(f'{os.path.basename(path)}: not a readable tar.gz ({type(e).__name__}: {e})')
    db = os.path.join(workdir, DB_IN_ARCHIVE)
    try:
        c = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
        ok = c.execute('PRAGMA integrity_check').fetchone()[0]
        cards = c.execute('SELECT count(*) FROM kanban_cards').fetchone()[0]
        c.close()
    except sqlite3.Error as e:
        raise Fail(f'{os.path.basename(path)}: database unreadable ({e})')
    if ok != 'ok':
        raise Fail(f'{os.path.basename(path)}: integrity_check says {ok!r}')
    if cards == 0:
        raise Fail(f'{os.path.basename(path)}: kanban_cards is EMPTY -- refusing to call that a backup')
    return cards


# The key is read and used INSIDE the library's shell: this process never holds it.
_KEY_SH = (
    'set -u; . "$0"; '
    'backup_key_read K || { printf "%s" "$BACKUP_KEY_STATUS" >&2; exit 3; }; '
    'backup_"$1" K "$2" "$3"'
)


def key_crypto(op, src, dst):
    r = subprocess.run(['/bin/bash', '-c', _KEY_SH, KEY_LIB, op, src, dst], capture_output=True, text=True)
    if r.returncode == 3:
        raise Fail(f'the offsite key is not readable ({r.stderr.strip()[:40]}; Keychain com.marveen.delta-crm-backup)'
                   ' -- nothing was encrypted, nothing is uploaded')
    if r.returncode != 0:
        raise Fail(f'gpg {op} failed (rc={r.returncode}): {r.stderr.strip()[:200]}')


def encrypt(src, dst):
    key_crypto('encrypt', src, dst)


def decrypt(src, dst):
    key_crypto('decrypt', src, dst)


# ---------------------------------------------------------------- Drive over plain HTTP

def _once(method, url, token=None, body=None, headers=None):
    """One request, no retry. A 308 is an answer (resumable upload: "resume incomplete")."""
    h = dict(headers or {})
    if token:
        h['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(url, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        raw = e.read()
        if e.code == 308:
            return 308, raw, e.headers
        msg = f'{method} {url.split("?")[0]} -> HTTP {e.code}: {raw[:300].decode(errors="replace")}'
        if e.code >= 500 or e.code == 429:
            raise Transient(msg)
        raise Fail(msg)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        cause = getattr(e, 'reason', e)
        raise Transient(f'{method} {url.split("?")[0]} did not connect: {type(cause).__name__}: {cause}')


def _pause(attempt):
    time.sleep(BACKOFF_S * 2 ** attempt)


def http(method, url, token=None, body=None, headers=None, want_json=True):
    for attempt in range(RETRIES + 1):
        try:
            status, raw, hdrs = _once(method, url, token, body, headers)
            return status, (json.loads(raw) if want_json and raw else raw), hdrs
        except Transient as e:
            if attempt == RETRIES:
                raise Fail(f'{e} (gave up after {RETRIES + 1} attempts)')
            _pause(attempt)


def access_token():
    try:
        with open(OAUTH_FILE) as f:
            o = json.load(f)
        form = urllib.parse.urlencode({
            'client_id': o['client_id'], 'client_secret': o['client_secret'],
            'refresh_token': o['refresh_token'], 'grant_type': 'refresh_token',
        }).encode()
    except FileNotFoundError:
        raise Fail(f'no OAuth credential at {OAUTH_FILE} -- the owner has not consented yet')
    except (KeyError, json.JSONDecodeError) as e:
        raise Fail(f'OAuth credential file is malformed ({type(e).__name__})')
    _, j, _ = http('POST', TOKEN_URL, body=form, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    if not isinstance(j, dict) or 'access_token' not in j:
        raise Fail('token endpoint answered without an access_token')
    return j['access_token']


def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(state, f)
    os.replace(tmp, STATE_FILE)


def folder_id(token):
    """The backup folder, created by this tool on first use (drive.file can only see its own)."""
    state = load_state()
    fid = state.get('folder_id')
    if fid:
        _, meta, _ = http('GET', f'{API}/files/{fid}?fields=id,trashed', token)
        if not meta.get('trashed'):
            return fid
    _, made, _ = http('POST', f'{API}/files?fields=id', token,
                      body=json.dumps({'name': FOLDER_NAME, 'mimeType': 'application/vnd.google-apps.folder'}).encode(),
                      headers={'Content-Type': 'application/json'})
    state['folder_id'] = made['id']
    save_state(state)
    return made['id']


def _received(headers):
    """How many bytes the session holds, from a 308's Range header ("bytes=0-N"); none = 0."""
    m = re.match(r'bytes=0-(\d+)$', (headers.get('Range') or '').strip())
    return int(m.group(1)) + 1 if m else 0


def upload(token, parent, path, name, props):
    """Resumable upload in CHUNK pieces. After a break it ASKS the session how much arrived (the
    bytes may or may not have landed before the connection died) and continues from there."""
    meta = {'name': name, 'parents': [parent], 'mimeType': 'application/octet-stream',
            'appProperties': dict(props, **{APP_TAG: '1'})}
    size = os.path.getsize(path)
    _, _, hdr = http('POST', f'{UPLOAD}/files?uploadType=resumable&fields=id', token,
                     body=json.dumps(meta).encode(),
                     headers={'Content-Type': 'application/json; charset=UTF-8',
                              'X-Upload-Content-Type': 'application/octet-stream',
                              'X-Upload-Content-Length': str(size)}, want_json=False)
    session = hdr.get('Location')
    if not session:
        raise Fail('the upload session was not opened (no Location header)')
    offset, breaks, stalls, ask = 0, 0, 0, False
    with open(path, 'rb') as f:
        while True:
            try:
                if ask or offset >= size:
                    status, raw, h = _once('PUT', session, token, b'', {'Content-Range': f'bytes */{size}'})
                else:
                    f.seek(offset)
                    chunk = f.read(CHUNK)
                    status, raw, h = _once('PUT', session, token, chunk,
                                           {'Content-Type': 'application/octet-stream',
                                            'Content-Range': f'bytes {offset}-{offset + len(chunk) - 1}/{size}'})
            except Transient as e:
                breaks += 1
                if breaks > RETRIES:
                    raise Fail(f'{e} (upload gave up after {breaks} breaks, at byte {offset} of {size})')
                _pause(breaks - 1)
                ask = True
                continue
            ask = False
            if status in (200, 201):
                done = json.loads(raw) if raw else {}
                if 'id' not in done:
                    raise Fail('the upload finished without a file id')
                return done['id']
            if status != 308:
                raise Fail(f'the upload session answered HTTP {status}')
            got = _received(h)
            stalls = stalls + 1 if got <= offset else 0
            if stalls > RETRIES:
                raise Fail(f'the upload session stopped taking bytes at {got} of {size}')
            offset = got


def list_backups(token, parent):
    q = f"'{parent}' in parents and trashed=false and appProperties has {{ key='{APP_TAG}' and value='1' }}"
    params = urllib.parse.urlencode({'q': q, 'orderBy': 'createdTime desc', 'pageSize': '100',
                                     'fields': 'files(id,name,size,md5Checksum,createdTime,appProperties)'})
    _, j, _ = http('GET', f'{API}/files?{params}', token)
    return j.get('files', [])


def rfc3339_to_epoch(s):
    return calendar.timegm(time.strptime(s[:19], '%Y-%m-%dT%H:%M:%S'))


# ---------------------------------------------------------------- the commands

def archive_time(path):
    """When the archive was MADE: the stamp backup.sh puts in its name (local time).

    Not the mtime -- a copy or a restore moves that, and a moved mtime made a 10-day-old
    archive look fresh. The mtime is only the fallback for a name without a stamp, and says so."""
    m = STAMP_RE.search(os.path.basename(path))
    if m:
        return time.mktime(time.strptime(m.group(1), '%Y%m%d-%H%M%S')), 'name'
    return os.path.getmtime(path), 'mtime'


def newest_archive():
    found = sorted(glob.glob(os.path.join(REPO_ROOT, 'backups', 'claudeclaw-*.tar.gz')), key=os.path.getmtime)
    if not found:
        raise Fail('no local archive in backups/ -- the daily backup has not produced one')
    return found[-1]


def read_client():
    """The OAuth client of the SEPARATE backup project (desktop type), placed here by the owner."""
    try:
        with open(CLIENT_FILE) as f:
            c = json.load(f)
    except FileNotFoundError:
        raise Fail(f'no OAuth client at {CLIENT_FILE} -- the owner downloads it from the backup project')
    except json.JSONDecodeError:
        raise Fail(f'{CLIENT_FILE} is not JSON')
    if 'installed' not in c:
        raise Fail(f'{CLIENT_FILE} is a {"/".join(c)} client, not a desktop ("installed") one')
    return c['installed']


def cmd_consent_url(_a):
    c = read_client()
    # offline + consent, or Google may return NO refresh token for an account that consented
    # before -- and the exchange then "works" and dies silently an hour later.
    print(AUTH_URL + '?' + urllib.parse.urlencode({
        'client_id': c['client_id'], 'redirect_uri': REDIRECT, 'response_type': 'code',
        'scope': SCOPE, 'access_type': 'offline', 'prompt': 'consent'}))
    return 0


def cmd_consent_exchange(a):
    c = read_client()
    code = a.code
    if code.startswith('http'):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(code).query)
        if 'code' not in q:
            raise Fail('the pasted address has no code= in it -- the whole address bar is needed')
        code = q['code'][0]
    _, j, _ = http('POST', TOKEN_URL, body=urllib.parse.urlencode({
        'code': code, 'client_id': c['client_id'], 'client_secret': c['client_secret'],
        'redirect_uri': REDIRECT, 'grant_type': 'authorization_code'}).encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded'})
    if not j.get('refresh_token'):
        raise Fail('Google returned NO refresh_token -- nothing stored; redo the consent from a fresh link')
    # A 200 is not the proof: what scope came back is. The owner may untick it on the consent page.
    _, info, _ = http('GET', f'{TOKENINFO_URL}?access_token={urllib.parse.quote(j["access_token"])}')
    granted = set(str(info.get('scope', '')).split())
    if SCOPE not in granted:
        raise Fail(f'the consent did not grant {SCOPE} (granted: {sorted(granted) or "nothing"}) -- nothing stored')
    os.makedirs(os.path.dirname(OAUTH_FILE), mode=0o700, exist_ok=True)
    tmp = OAUTH_FILE + '.tmp'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump({'client_id': c['client_id'], 'client_secret': c['client_secret'],
                   'refresh_token': j['refresh_token']}, f)
    os.replace(tmp, OAUTH_FILE)
    # and the stored credential works on its own, through the path push will use
    fid = folder_id(access_token())
    print(f'consent: stored {OAUTH_FILE} (0600), scope drive.file, backup folder {fid}')
    return 0


def cmd_push(a):
    archive = a.archive or newest_archive()
    made, source = archive_time(archive)
    age_h = (time.time() - made) / 3600
    if age_h > MAX_ARCHIVE_AGE_H:
        raise Fail(f'the newest local archive {os.path.basename(archive)} is {age_h:.0f} h old (from its {source}; '
                   f'limit {MAX_ARCHIVE_AGE_H} h) -- the DAILY backup has stopped. Nothing uploaded, nothing pruned')
    work = tempfile.mkdtemp(prefix='offsite-push-')
    try:
        os.chmod(work, 0o700)
        cards = verify_archive(archive, work)
        plain_sha = sha256_of(archive)
        enc = os.path.join(work, os.path.basename(archive) + '.gpg')
        encrypt(archive, enc)
        sent_md5 = md5_of(enc)
        token = access_token()
        parent = folder_id(token)
        fid = upload(token, parent, enc, os.path.basename(enc),
                     {'sha256': plain_sha, 'plainSize': str(os.path.getsize(archive)),
                      'archiveTime': str(int(made))})
        _, meta, _ = http('GET', f'{API}/files/{fid}?fields=id,size,md5Checksum', token)
        if meta.get('md5Checksum') != sent_md5 or int(meta.get('size', -1)) != os.path.getsize(enc):
            raise Fail(f'READ-BACK MISMATCH for {fid}: Drive has md5 {meta.get("md5Checksum")} '
                       f'size {meta.get("size")}, sent md5 {sent_md5} size {os.path.getsize(enc)}')
        print(f'push: {os.path.basename(archive)} ({cards} cards, archive {age_h:.0f} h old) -> {fid}, '
              f'read back md5 {sent_md5}')
        # Prune ONLY after this run's copy was read back: a failed upload must not also shrink
        # the history it would have replaced.
        prune(token, parent, a.keep_days)
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


def prune(token, parent, keep_days):
    files = list_backups(token, parent)
    cutoff = time.time() - keep_days * 86400
    # never the newest: a stopped daily backup must not age the last good copy out of existence
    doomed = [f for f in files[1:] if rfc3339_to_epoch(f['createdTime']) < cutoff]
    for f in doomed:
        http('DELETE', f'{API}/files/{f["id"]}', token, want_json=False)
    print(f'prune: {len(files)} remote copies, {len(doomed)} older than {keep_days} days removed')
    return len(doomed)


def cmd_prune(a):
    token = access_token()
    prune(token, folder_id(token), a.keep_days)
    return 0


def cmd_restore_test(_a):
    token = access_token()
    files = list_backups(token, folder_id(token))
    if not files:
        raise Fail('restore test: there is NO remote copy to restore')
    f = files[0]
    work = tempfile.mkdtemp(prefix='offsite-restore-')
    try:
        os.chmod(work, 0o700)
        enc = os.path.join(work, f['name'])
        _, raw, _ = http('GET', f'{API}/files/{f["id"]}?alt=media', token, want_json=False)
        with open(enc, 'wb') as out:
            out.write(raw)
        if md5_of(enc) != f.get('md5Checksum'):
            raise Fail(f'restore test: downloaded bytes do not match Drive md5 for {f["name"]}')
        plain = os.path.join(work, 'restored.tar.gz')
        decrypt(enc, plain)
        want = (f.get('appProperties') or {}).get('sha256')
        got = sha256_of(plain)
        if not want or got != want:
            raise Fail(f'restore test: decrypted archive sha256 {got[:12]} != recorded {str(want)[:12]}')
        cards = verify_archive(plain, os.path.join(work, 'x'))
        # the ARCHIVE's age, not the upload's: a stale archive uploaded today is still stale
        made = (f.get('appProperties') or {}).get('archiveTime')
        age = f'archive {(time.time() - int(made)) / 3600:.0f} h old' if made else 'archive age UNKNOWN (no archiveTime)'
        up_h = max(0.0, (time.time() - rfc3339_to_epoch(f['createdTime'])) / 3600)  # clock skew is not an age
        print(f'restore-test: OK {f["name"]} ({age}, uploaded {up_h:.0f} h ago) byte-identical, '
              f'integrity ok, {cards} cards')
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ---------------------------------------------------------------- alerts

def alert(text):
    """Coordinator first, owner as the fallback (card 45101873). Returns where it went."""
    hook = os.environ.get('BACKUP_OFFSITE_ALERT_CMD')
    if hook:
        subprocess.run(hook, shell=True, input=text, text=True)
        return 'hook'
    # ABSOLUTE tmux: launchd's PATH has no /opt/homebrew/bin, and a bare `tmux` would make the
    # alert itself raise -- silence exactly when it has to speak.
    tmux = shutil.which('tmux') or '/opt/homebrew/bin/tmux'
    try:
        up = subprocess.run([tmux, 'has-session', '-t', f'{MAIN_AGENT_ID}-channels'], capture_output=True).returncode == 0
    except OSError:
        up = False
    if up:
        r = subprocess.run(['bash', os.path.join(REPO_ROOT, 'scripts', 'agent-msg.sh'), MAIN_AGENT_ID,
                            MAIN_AGENT_ID, '-', '--force'], input=text, capture_output=True, text=True)
        if r.returncode == 0 and 'OK id=' in r.stdout:
            return 'coordinator'
    r = subprocess.run(['bash', os.path.join(REPO_ROOT, 'scripts', 'notify.sh'), text], capture_output=True, text=True)
    return 'owner' if r.returncode == 0 else 'NOWHERE'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('push')
    p.add_argument('--archive')
    p.add_argument('--keep-days', type=int, default=DEFAULT_KEEP_DAYS)
    sub.add_parser('restore-test')
    sub.add_parser('consent-url')
    e = sub.add_parser('consent-exchange')
    e.add_argument('code', help='the code, or the whole address from the browser')
    q = sub.add_parser('prune')
    q.add_argument('--keep-days', type=int, default=DEFAULT_KEEP_DAYS)
    a = ap.parse_args(argv)
    fn = {'consent-url': cmd_consent_url, 'consent-exchange': cmd_consent_exchange, 'push': cmd_push, 'restore-test': cmd_restore_test, 'prune': cmd_prune}[a.cmd]
    try:
        return fn(a)
    except Exception as e:  # noqa: BLE001 -- a crash must be as loud as a named failure
        why = str(e) if isinstance(e, Fail) else f'UNEXPECTED {type(e).__name__}: {e}'
        msg = f'[backup-offsite] {a.cmd} FAILED: {why}'
        print(msg, file=sys.stderr)
        if not a.cmd.startswith('consent'):   # a person runs those, and reads the error
            where = alert(msg + ' -- the Drive copy of the Marveen backup is NOT current.')
            print(f'alert sent to: {where}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
