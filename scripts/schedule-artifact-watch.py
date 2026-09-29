#!/usr/bin/env python3
"""schedule-artifact-watch.py -- an agent-round schedule that FIRED is not one that FINISHED (card 8289611e).

WHY (card 5b69464f, didi 2026-09-18): sentry-or's state file did not move for 5 days 12 hours
while the scheduler fired it 44 times. The runner records the FIRE (schedule-last-outcome.json)
and, since then, whether the pane picked the prompt up (sawTurn / lost). Nothing records whether
the round got to its end and wrote its result -- and a monitor that stops running looks exactly
like a calm system.

WHAT: for every task listed in WATCH, if it fired more than `grace_min` ago and its artifact's
mtime is still older than that fire, the round did not finish. The coordinator hears it once per
fire (the fire time is remembered in store/schedule-artifact-watch.state.json). A task that has
not fired since the watch started says nothing: not firing is the scheduler's own alarm.

Exit codes: 0 all finished, 3 at least one unfinished round (reported), 1 BLIND (the outcome file
is missing or unreadable -- then nothing here can be judged, and that is reported too), 2 the
report itself failed to send.

A new agent-round task names its artifact HERE; the task's author knows what it writes.

Test seams: SAW_ROOT (repo root), SAW_NOW (epoch s), SAW_MSG (the sender command).
"""
import json
import os
import subprocess
import sys
import time

ROOT = os.environ.get('SAW_ROOT', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUTCOME = os.path.join(ROOT, 'store', 'schedule-last-outcome.json')
STATE = os.path.join(ROOT, 'store', 'schedule-artifact-watch.state.json')
LOG = os.path.join(ROOT, 'store', 'schedule-artifact-watch.log')
# alert-coordinator.sh: --force past the queue gate, the owner as the fallback (card 906e9159)
MSG = os.environ.get('SAW_MSG', f'bash {ROOT}/scripts/alert-coordinator.sh')

# task -> the file its round writes when it gets to the end, and how long a round may take
WATCH = {
    'sentry-or': {'artifact': 'store/sentry-watch-state.json', 'grace_min': 45},
}


def log(text, now):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, 'a') as f:
        f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now))}] {text}\n")


def send(text):
    r = subprocess.run(MSG, shell=True, input=text, capture_output=True, text=True)
    return r.returncode == 0 and r.stdout.startswith('OK'), (r.stdout + r.stderr).strip()[:200]


def main():
    now = float(os.environ.get('SAW_NOW', time.time()))
    try:
        outcome = json.load(open(OUTCOME))
    except (OSError, ValueError) as e:
        text = (f'schedule-artifact-watch VAK: a {OUTCOME} nem olvashato ({type(e).__name__}). '
                'Amig ez all, egy ugyan elsult, de le nem futott utemezett kor senkinek nem jelez.')
        ok, detail = send(text)
        log(f'BLIND ({type(e).__name__}); jelzes: {"OK" if ok else "ELBUKOTT " + detail}', now)
        return 1 if ok else 2
    try:
        state = json.load(open(STATE))
    except (OSError, ValueError):
        state = {}
    unfinished = []
    for task, cfg in WATCH.items():
        fired_ms = (outcome.get(task) or {}).get('lastFiredAt')
        if not fired_ms:
            continue
        fired = fired_ms / 1000
        if now - fired < cfg['grace_min'] * 60:
            continue                                   # still inside its own time to finish
        path = os.path.join(ROOT, cfg['artifact'])
        mtime = os.path.getmtime(path) if os.path.exists(path) else None
        if mtime is not None and mtime >= fired:
            continue                                   # written after this fire: it finished
        unfinished.append((task, fired, cfg, mtime))
    if not unfinished:
        log('ok', now)
        return 0
    rc = 3
    for task, fired, cfg, mtime in unfinished:
        if state.get(task) == fired:
            log(f'{task}: unfinished round of {time.strftime("%m-%d %H:%M", time.localtime(fired))} already reported', now)
            continue
        written = time.strftime('%m-%d %H:%M', time.localtime(mtime)) if mtime else 'SOHA (a fajl nincs meg)'
        text = (f'[schedule-artifact-watch] {task}: a {time.strftime("%m-%d %H:%M", time.localtime(fired))}-kor '
                f'ELSULT kor {cfg["grace_min"]} perc utan sem irta meg az eredmenyet ({cfg["artifact"]}, utolso iras: '
                f'{written}). Az elsules megtortent, a LEFUTAS nem latszik: nezd meg a panelt, vagy a kor '
                f'kozben elakadt. (kartya 8289611e)')
        ok, detail = send(text)
        log(f'{task}: unfinished; jelzes {"OK" if ok else "ELBUKOTT " + detail}', now)
        if ok:
            state[task] = fired
        else:
            rc = 2
    with open(STATE + '.tmp', 'w') as f:
        json.dump(state, f)
    os.replace(STATE + '.tmp', STATE)
    return rc


if __name__ == '__main__':
    sys.exit(main())
