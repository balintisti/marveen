#!/usr/bin/env python3
"""Replay delivered-but-unfinished inter-agent messages into a freshly
restarted agent session (extracted from watchdog.sh so it is testable).

MSGSZIVARGAS826: this is a RECORD-LESS injection path -- raw tmux send-keys
with no delivery row anywhere, which made a leaked message impossible to
attribute. Every replayed message now writes a dated marker line into the
dashboard log (argv[5]) so transcript-side detectors have an anchor. The
marker carries a FULL DATE deliberately: dashboard.log lines are time-only,
and hour-based filtering across days has already produced a false backlog
reading once.

ITS CALL SITE (corrected at the 88c366f2 upstream merge). Until that merge this
docblock said "NOTHING CALLS THIS FILE" (measured 2026-09-11, card e479b940),
and on our tree that was true: watchdog.sh ran its own embedded heredoc, a
different program (4 argv, 0 marker writes) from this file (5 argv, marker per
replay). Upstream #1086 moved the call site: watchdog.sh now runs
`python3 "$INSTALL_DIR/scripts/watchdog-replay.py" ... 2>>"$LOG"`, and that
reached our tree with the same merge. The claim was therefore retracted rather
than left standing -- re-measure with an ANCHORED search for
`scripts/watchdog-replay.py` over scripts/ src/ dist/ web/ if watchdog.sh moves.

argv: session_name agent_id cutoff_epoch data_file log_target
"""
import json
import subprocess
import sys
import time


# THE BODY IS A FUNCTION BEHIND A GUARD, AND THE HAZARD IS INHERITED argv, NOT A
# BARE IMPORT (card e479b940). Unguarded, a bare `import` of this module dies on
# the unpack below -- loud, and harmless. The case that is neither is an importer
# that HAS five or more argv entries of its own: the module then reads them as a
# session name and a data file and starts typing into a live tmux pane with
# `send-keys`. An outward side effect from an import statement is not hygiene.
#
# AND DELIBERATELY NOT A CLASS-LEVEL RULE. The measured population of tracked
# scripts/*.py that act at import AND read argv is TWO -- this and
# polarity-sweep.py. didi's wider census of 12 line-initial-side-effect files was
# 89% non-defects, so a detector on that axis would spend every round reporting
# the healthy majority, which is the shape this repo has stopped eight times.


def main():
    session_name, agent_id, cutoff_str, data_file, log_target = sys.argv[1:6]
    cutoff = int(cutoff_str)

    with open(data_file) as f:
        msgs = json.load(f)

    pending = [
        m for m in msgs
        if m.get('to_agent') == agent_id
           and m.get('status') == 'delivered'
           and m.get('completed_at') is None
           and m.get('created_at', 0) >= cutoff
    ]

    if not pending:
        sys.exit(0)

    print(f"[watchdog] {agent_id}: replaying {len(pending)} unfinished message(s)", flush=True)
    time.sleep(15)  # let claude boot up and reach the prompt


    def mark(msg_id: object, note: str) -> None:
        # Marker for transcript-side delivery detectors (MSGSZIVARGAS826): the
        # ONLY durable record this injection path produces, so it must never be
        # skipped on the injected branch. Best-effort: a marker failure must not
        # stop the replay itself.
        line = json.dumps({
            'time': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
            'msg': 'watchdog-replay injected',
            'id': msg_id,
            'agent': agent_id,
            'session': session_name,
            'note': note,
        }, ensure_ascii=False)
        try:
            with open(log_target, 'a') as lf:
                lf.write(line + '\n')
        except Exception as exc:  # noqa: BLE001
            print(f"[watchdog] marker write failed for msg {msg_id}: {exc}", file=sys.stderr, flush=True)


    for m in pending:
        content = m.get('content', '')
        full_msg = f"[Újraküldés - feladat elveszett restart előtt]: {content}"
        chunk_size = 990
        for i in range(0, len(full_msg), chunk_size):
            chunk = full_msg[i:i + chunk_size]
            subprocess.run(['tmux', 'send-keys', '-t', session_name, '-l', chunk],
                           timeout=5, capture_output=True)
        subprocess.run(['tmux', 'send-keys', '-t', session_name, 'Enter'],
                       timeout=5, capture_output=True)
        mark(m.get('id'), 'replayed-after-restart')
        time.sleep(2)


if __name__ == '__main__':
    main()
