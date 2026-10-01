#!/usr/bin/env python3
"""net-probe.py -- is outbound HTTPS from this machine flaky, or was it a bad day? (card 286de2bf)

WHY: on 2026-09-24 four pollers failed on four different hosts in one morning (googleapis oauth2,
monitoring, sentry.io, a gcloud token), and one probe in five to sentry.io timed out after 20 s
while the others took 0.3 s. On 2026-09-28/29 a Drive upload failed 40-80% of its large bodies
while small requests passed. Every one of those was a sample of five or fewer. Until there is a
RATE, "no alert" from any poller that uses this line is not a statement.

WHAT EACH RUN DOES (launchd, every 10 minutes): one small HTTPS GET to each host that failed on
09-24, and to two controls that are not Google (Cloudflare, GitHub); once an hour also a 1 MB
upload and a 1 MB download (Cloudflare's speed-test endpoints), because the large-body shape is
the one that failed on the Drive. One JSON line per run goes to store/net-probe.jsonl:
code, connect, TLS and total seconds per target, 000 for no answer.

It does not alert. `--summary [HOURS]` prints the failure rate and the latency spread per target
over the window; the card's question is answered from that, and a probe that pages on its own
noise gets muted.

Measured by hand 2026-09-29 03:4x-03:5x, before this existed: the path MTU is 1492 and the
upstream router does answer "frag needed" (so this is not a PMTU black hole); ping loss is 0/100
to both local routers and to 1.1.1.1, 13/100 to 8.8.8.8 (Google may deprioritise ICMP, which is
why this measures HTTPS); 120 interleaved HTTPS requests: 1 failure, sentry.io. The machine is on
Wi-Fi (en1), the Ethernet port is inactive.

Test seams: NET_PROBE_CURL (the curl binary), NET_PROBE_LOG (the log), NET_PROBE_NOW (epoch s).
"""
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.environ.get('NET_PROBE_LOG', os.path.join(ROOT, 'store', 'net-probe.jsonl'))
CURL = os.environ.get('NET_PROBE_CURL', '/usr/bin/curl')
CAP_S = 20

SMALL = [
    ('googleapis', 'https://www.googleapis.com/generate_204'),
    ('oauth2', 'https://oauth2.googleapis.com/'),
    ('monitoring', 'https://monitoring.googleapis.com/'),
    ('sentry', 'https://sentry.io/api/0/'),
    ('cloudflare', 'https://1.1.1.1/cdn-cgi/trace'),
    ('github', 'https://api.github.com/zen'),
]
LARGE_BYTES = 1024 * 1024
LARGE = [
    ('cf-up-1MB', ['-X', 'POST', '--data-binary', '@-', 'https://speed.cloudflare.com/__up']),
    ('cf-down-1MB', [f'https://speed.cloudflare.com/__down?bytes={LARGE_BYTES}']),
]
# Tab-separated: remote_ip is EMPTY when no TCP connection was made, and an empty field must not
# shift the others. The ip and curl's own error text say WHERE a failure happened (card 286de2bf,
# 2026-10-01: www.googleapis.com failed 12% with TLS errors right after connect, every other host
# ~2% -- one Google edge, or our path? Only the failing ip, kept per failure, can tell).
FMT = '%{http_code}\t%{time_connect}\t%{time_appconnect}\t%{time_total}\t%{remote_ip}'


def probe(args, stdin=None):
    """One request. Any failure to get an answer -- timeout, reset, DNS -- is code 000."""
    try:
        r = subprocess.run([CURL, '-sS', '-o', '/dev/null', '-m', str(CAP_S), '-w', FMT, *args],
                           input=stdin, capture_output=True, timeout=CAP_S + 10)
        code, conn, tls, total, ip = r.stdout.decode().split('\t')
        out = {'code': code, 'connect': float(conn), 'tls': float(tls), 'total': float(total), 'rc': r.returncode,
               'ip': ip.strip()}
        if r.returncode:
            out['error'] = r.stderr.decode(errors='replace').strip()[:200]
        return out
    except (subprocess.TimeoutExpired, ValueError, OSError) as e:
        return {'code': '000', 'connect': None, 'tls': None, 'total': None, 'rc': None, 'err': type(e).__name__}


def run(now):
    results = {name: probe([url]) for name, url in SMALL}
    if time.localtime(now).tm_min < 10:            # once an hour, the large-body shape
        body = os.urandom(LARGE_BYTES)
        for name, args in LARGE:
            results[name] = probe(args, stdin=body if '@-' in args else None)
    line = {'ts': int(now), 'at': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now)), 'results': results}
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, 'a') as f:
        f.write(json.dumps(line) + '\n')
    return line


def summary(hours, now):
    since = now - hours * 3600
    per = {}
    runs = 0
    try:
        lines = open(LOG).read().splitlines()
    except FileNotFoundError:
        lines = []
    for raw in lines:
        try:
            line = json.loads(raw)
        except ValueError:
            continue
        if line.get('ts', 0) < since:
            continue
        runs += 1
        for name, r in line['results'].items():
            per.setdefault(name, []).append(r)
    out = [f'net-probe summary: last {hours} h, {runs} run(s), log {LOG}']
    for name in sorted(per):
        rs = per[name]
        fails = sum(1 for r in rs if r['code'] == '000')
        totals = sorted(r['total'] for r in rs if r['code'] != '000' and r['total'] is not None)
        spread = (f'median {totals[len(totals) // 2]:.2f} s, max {totals[-1]:.2f} s' if totals else 'no answer at all')
        out.append(f'  {name:12} {fails}/{len(rs)} no answer ({100 * fails / len(rs):.0f}%) | {spread}')
        fail_ips = {}
        for r in rs:
            if r['code'] == '000' and 'ip' in r:     # older lines have no ip: not counted, not guessed
                fail_ips[r['ip'] or 'no-connect'] = fail_ips.get(r['ip'] or 'no-connect', 0) + 1
        if fail_ips:
            out.append('               failed at: ' + ', '.join(f'{ip} x{n}' for ip, n in
                                                         sorted(fail_ips.items(), key=lambda kv: -kv[1])))
    if runs == 0:
        out.append('  NO RUNS in the window: the probe itself did not run -- that is the finding.')
    print('\n'.join(out))
    return 0 if runs else 1


def main(argv):
    now = float(os.environ.get('NET_PROBE_NOW', time.time()))
    if argv[:1] == ['--summary']:
        return summary(float(argv[1]) if len(argv) > 1 else 24, now)
    run(now)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
