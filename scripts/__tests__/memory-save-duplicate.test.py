#!/usr/bin/env python3
"""Pins memory-save.sh to the 409 duplicate answer of POST /api/memories (upstream #2173).

THE CLASS OF BUG PINNED: a helper that treats every non-200 as "retry, then FAIL".
A refused duplicate cannot succeed on a retry, and the agent has to be told WHY it
was refused and how to override it. The script runs in a scratch install tree against
a stub server on an ephemeral port that answers like the real route: 409 unless the
body carries allow_duplicate === true, 200 with an id when it does.

Run: python3 scripts/__tests__/memory-save-duplicate.test.py   (exit 0 = pass)
"""
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SCRIPT = os.path.join(ROOT, 'scripts', 'memory-save.sh')

failed = []
posts = []


def check(name, ok, detail=''):
    print('[%s] %s%s' % ('PASS' if ok else 'FAIL', name, ('  -- ' + detail) if not ok and detail else ''))
    if not ok:
        failed.append(name)


class Stub(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        posts.append(body)
        if body.get('allow_duplicate') is True:
            code, reply = 200, {'ok': True, 'id': 7}
        else:
            code, reply = 409, {'ok': False, 'error': 'duplicate', 'duplicate_of': [{'id': 5, 'match': 'exact'}]}
        data = json.dumps(reply).encode()
        self.send_response(code)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


server = HTTPServer(('127.0.0.1', 0), Stub)
threading.Thread(target=server.serve_forever, daemon=True).start()

tree = tempfile.mkdtemp(prefix='memsave-dup-')
os.makedirs(os.path.join(tree, 'scripts'))
os.makedirs(os.path.join(tree, 'store'))
shutil.copy(SCRIPT, os.path.join(tree, 'scripts', 'memory-save.sh'))
with open(os.path.join(tree, 'store', '.dashboard-token'), 'w') as fh:
    fh.write('scratch-not-a-token')


def run(extra_env=None):
    env = dict(os.environ, MARVEEN_WEB_PORT=str(server.server_address[1]))
    env.pop('ALLOW_DUPLICATE', None)
    env.update(extra_env or {})
    del posts[:]
    started = time.time()
    r = subprocess.run(['bash', os.path.join(tree, 'scripts', 'memory-save.sh'), 'scratch', 'cold', 'k', 'one plain fact'],
                       capture_output=True, text=True, env=env, timeout=60)
    return r, time.time() - started


r, took = run()
check('a 409 exits 3', r.returncode == 3, 'rc=%s out=%r' % (r.returncode, r.stdout))
check('a 409 names the refusal and the matching id', 'NEM MENTETTEM duplikatum' in r.stdout and '5:exact' in r.stdout, r.stdout)
check('a 409 names the override', 'ALLOW_DUPLICATE=1' in r.stdout, r.stdout)
check('a 409 is not retried', len(posts) == 1, 'posts=%d' % len(posts))
check('a 409 does not sleep through the retry loop', took < 2.0, 'took %.1fs' % took)
check('the default body carries no allow_duplicate', 'allow_duplicate' not in posts[0], str(posts))

r, _ = run({'ALLOW_DUPLICATE': '1'})
check('ALLOW_DUPLICATE=1 saves and prints OK id', r.returncode == 0 and 'OK id=7' in r.stdout, 'rc=%s out=%r' % (r.returncode, r.stdout))
check('ALLOW_DUPLICATE=1 sends a strict boolean true', len(posts) == 1 and posts[0].get('allow_duplicate') is True, str(posts))

r, _ = run({'ALLOW_DUPLICATE': 'true'})
check('ALLOW_DUPLICATE=true (not 1) is not an override', r.returncode == 3 and 'allow_duplicate' not in posts[0], str(posts))

shutil.rmtree(tree, ignore_errors=True)
server.shutdown()
if failed:
    raise SystemExit('FAILED: ' + ', '.join(failed))
print('all passed')
