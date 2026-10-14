#!/usr/bin/env python3
"""fd-table-guard.py -- the kernel's open-file table, BEFORE it is full (card 5f9ae1d5).

WHY. 2026-10-14 18:26 CEST: kern.num_files 184105 of kern.maxfiles 184320 (99.88%). Every new
process on the machine failed with ENFILE ("Too many open files in system"): a vitest worker spawn,
trillian's cp -Rc, even the harness reading a tool's output file. Two holders had grown for 16 days
without anyone seeing it: an orphaned test fake-redis.js (92148 sockets, at the per-process ceiling)
and ollama serve (83287 sockets in CLOSED state). Nothing measured the table, so the first signal was
the wall itself -- trillian's report, 2 minutes before the machine stopped spawning.

WHAT. One measurement per run (launchd StartInterval). Below WARN: one log line, nothing else. At or
above WARN (default 70%) or CRIT (default 90%): an alarm through alert-coordinator.sh (the
coordinator with --force, the owner as fallback) naming the top holders by lsof line count, so the
reader can act without measuring first. At most one alarm per level per COOLDOWN; a RISE in level
alarms at once, a fall is silent until it is back to ok.

WHY IT NEVER KILLS. The holder is often a live service (ollama serves the memory embeddings), and
which process may die is a decision. The guard's job is that the decision is made while there is
room to make it: at 70% a shell still spawns, at 100% even the alarm cannot.

A GUARD THAT CANNOT MEASURE IS LOUD. If sysctl gives no two integers, that is an alarm too (exit 2):
a silent guard looks exactly like a healthy table.

Exit: 0 = ok or alarm delivered; 1 = alarm delivered NOWHERE; 2 = measurement failed.
Seams (tests only): FD_GUARD_SYSCTL, FD_GUARD_LSOF, FD_GUARD_STATE_DIR, FD_GUARD_ALERT.
Tunables: FD_GUARD_WARN_PCT, FD_GUARD_CRIT_PCT, FD_GUARD_COOLDOWN_S (invalid values fall back to the
defaults, never to "always" or "never").
"""
import json
import os
import shlex
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_WARN, DEFAULT_CRIT, DEFAULT_COOLDOWN = 70, 90, 3600
LEVELS = {'ok': 0, 'warn': 1, 'crit': 2}


def _int_env(name, default, lo, hi):
    try:
        v = int(os.environ.get(name, ''))
    except ValueError:
        return default
    return v if lo <= v <= hi else default


def thresholds():
    warn = _int_env('FD_GUARD_WARN_PCT', DEFAULT_WARN, 1, 99)
    crit = _int_env('FD_GUARD_CRIT_PCT', DEFAULT_CRIT, 1, 99)
    if crit <= warn:
        # 0 < warn < crit < 100 or nothing: an inverted pair would make CRIT unreachable or WARN moot.
        warn, crit = DEFAULT_WARN, DEFAULT_CRIT
    return warn, crit, _int_env('FD_GUARD_COOLDOWN_S', DEFAULT_COOLDOWN, 60, 86400)


def measure():
    sysctl = os.environ.get('FD_GUARD_SYSCTL', '/usr/sbin/sysctl')
    try:
        out = subprocess.run([sysctl, '-n', 'kern.num_files', 'kern.maxfiles'],
                             capture_output=True, text=True, timeout=20).stdout.split()
        num, mx = int(out[0]), int(out[1])
    except Exception as e:  # noqa: BLE001 -- any failure here is the "cannot measure" alarm
        return None, None, '%s: %s' % (type(e).__name__, e)
    if mx <= 0 or num < 0:
        return None, None, 'implausible values num=%d max=%d' % (num, mx)
    return num, mx, None


def top_holders(n=5):
    lsof = os.environ.get('FD_GUARD_LSOF', '/usr/sbin/lsof')
    try:
        out = subprocess.run([lsof, '-n', '-P', '-w'], capture_output=True, text=True,
                             timeout=90).stdout
    except Exception as e:  # noqa: BLE001
        return 'holders NOT measured (%s)' % type(e).__name__
    counts = {}
    for line in out.splitlines()[1:]:
        f = line.split(None, 2)
        if len(f) >= 2 and f[1].isdigit():
            counts[f[1]] = counts.get(f[1], 0) + 1
    if not counts:
        return 'holders NOT measured (lsof gave no rows)'
    rows = []
    for pid, c in sorted(counts.items(), key=lambda kv: -kv[1])[:n]:
        try:
            ps = subprocess.run(['ps', '-o', 'etime=,command=', '-p', pid], capture_output=True,
                                text=True, timeout=10).stdout.strip()
        except Exception:  # noqa: BLE001
            ps = ''
        rows.append('  %7d  pid %s  %s' % (c, pid, (ps or '(gone)')[:160]))
    return 'top holders (lsof lines per pid):\n' + '\n'.join(rows)


def load_state(path):
    try:
        with open(path) as f:
            s = json.load(f)
        return s.get('level', 'ok'), float(s.get('ts', 0))
    except Exception:  # noqa: BLE001 -- no state = first run
        return 'ok', 0.0


def save_state(path, level, ts):
    try:
        with open(path + '.tmp', 'w') as f:
            json.dump({'level': level, 'ts': ts}, f)
        os.replace(path + '.tmp', path)
    except OSError:
        pass  # best effort: under ENFILE a failed write must not crash the guard


def alarm(text):
    cmd = os.environ.get('FD_GUARD_ALERT') or 'bash %s friday' % shlex.quote(
        os.path.join(ROOT, 'scripts', 'alert-coordinator.sh'))
    try:
        r = subprocess.run(cmd, shell=True, input=text, capture_output=True, text=True, timeout=120)
        return r.returncode == 0, (r.stdout + r.stderr).strip().splitlines()[-1:] or ['']
    except Exception as e:  # noqa: BLE001
        return False, ['%s: %s' % (type(e).__name__, e)]


def main():
    stamp = time.strftime('%Y-%m-%d %H:%M:%S %Z')
    state = os.path.join(os.environ.get('FD_GUARD_STATE_DIR', os.path.join(ROOT, 'store')),
                         'fd-table-guard.state.json')
    warn, crit, cooldown = thresholds()
    num, mx, err = measure()
    if err:
        ok, where = alarm('[fd-table-guard] CANNOT MEASURE the open-file table (%s). A silent guard '
                          'looks like a healthy table, so this is an alarm. Re-measure: '
                          '/usr/sbin/sysctl kern.num_files kern.maxfiles (card 5f9ae1d5)' % err)
        print('%s  MEASURE-FAILED %s  alarm=%s %s' % (stamp, err, 'sent' if ok else 'NOWHERE', where[0]))
        return 2
    pct = num * 100.0 / mx
    level = 'crit' if pct >= crit else 'warn' if pct >= warn else 'ok'
    prev, prev_ts = load_state(state)
    now = time.time()
    if level == 'ok':
        if prev != 'ok':
            save_state(state, 'ok', now)
        print('%s  ok %d/%d (%.1f%%) warn=%d%%' % (stamp, num, mx, pct, warn))
        return 0
    rising = LEVELS[level] > LEVELS[prev]
    if not rising and now - prev_ts < cooldown:
        print('%s  %s %d/%d (%.1f%%) -- alarmed %ds ago, cooldown %ds' %
              (stamp, level, num, mx, pct, now - prev_ts, cooldown))
        return 0
    text = ('[fd-table-guard] %s: kern.num_files %d of kern.maxfiles %d (%.1f%%, warn %d%%, crit %d%%).\n'
            'At 100%% every new process on the machine fails with ENFILE (2026-10-14 18:26: 99.88%%, an '
            'orphaned test fake-redis + ollama CLOSED sockets). This guard kills nothing: which holder may '
            'be restarted is your decision.\n%s\nRe-measure: /usr/sbin/sysctl kern.num_files '
            'kern.maxfiles; lsof -n -P -w | awk \'NR>1{print $2,$1}\' | sort | uniq -c | sort -rn | head '
            '(card 5f9ae1d5)' % (level.upper(), num, mx, pct, warn, crit, top_holders()))
    ok, where = alarm(text)
    if ok:
        # Only a DELIVERED alarm starts the cooldown: a lost one is retried on the next run.
        save_state(state, level, now)
    print('%s  %s %d/%d (%.1f%%)  alarm=%s %s' %
          (stamp, level, num, mx, pct, 'sent' if ok else 'NOWHERE', where[0]))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
