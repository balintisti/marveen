#!/usr/bin/env python3
"""heavy-run.py -- a fleet-wide limit on heavy runs (tsc / jest / vitest / playwright), card a2090e75.

WHY (measured 2026-10-03 12:03, dexter 22886, marveen re-measured): 17 node tsc/jest processes at once
on the Mac Mini -- 12 of them one agent's -- free pages 4998, 526M swapouts, and a backend tsc that did
not finish in 2.5 h. The rule that followed ("ONE heavy run per agent, serial", marveen 22890) is a
habit; a habit is a hope. This makes it a gate. And the second, larger cost the same day: 55 orphaned
backends (node dist/main) from e2e runners whose EXIT trap never ran or whose SIGTERM was ignored,
~9 GB of swap (marveen 14:0x). So the wrapper also owns the command's whole process tree.

  python3 scripts/heavy-run.py [--label TEXT] -- <command> [args...]
  python3 scripts/heavy-run.py --status
  python3 scripts/heavy-run.py --self-test

1. FLEET LIMIT. At most HEAVY_RUN_MAX (default 2) heavy runs on the machine at once; ONE per agent.
   A slot is an fcntl lock on a file under HEAVY_RUN_DIR (default ~/.heavy-run). The kernel drops the
   lock when the holder dies -- SIGKILL included -- so a killed run can never strand a slot. A waiting
   run prints who holds the slots, once a minute.
2. THE TREE DIES WITH THE RUN. The command runs in its own process group. On exit, on INT/TERM/HUP,
   the group gets TERM, then KILL after HEAVY_RUN_GRACE seconds (default 10): a swapped Nest does not
   honour TERM (measured). A watchdog child does the same if the wrapper itself is SIGKILLed.
   Limit, stated: a descendant that calls setsid() leaves the group and is not reaped.
The exit code is the command's (128+N if a signal ended it).
"""
import fcntl
import json
import os
import signal
import subprocess
import sys
import tempfile
import time

DIR = os.environ.get("HEAVY_RUN_DIR") or os.path.expanduser("~/.heavy-run")
MAX = int(os.environ.get("HEAVY_RUN_MAX") or 2)
GRACE = float(os.environ.get("HEAVY_RUN_GRACE") or 10)
POLL = float(os.environ.get("HEAVY_RUN_POLL") or 5)


def agent_name():
    if os.environ.get("HEAVY_AGENT"):
        return os.environ["HEAVY_AGENT"]
    parts = (os.environ.get("PWD") or os.getcwd()).split(os.sep)
    if "agents" in parts and parts.index("agents") + 1 < len(parts):
        return parts[parts.index("agents") + 1]
    return f"unknown-{os.getppid()}"


def read_holder(path):
    try:
        with open(path) as f:
            return json.loads(f.read() or "null")
    except Exception:
        return None


def holders():
    out = []
    for i in range(MAX):
        path = os.path.join(DIR, f"slot-{i}")
        if not os.path.exists(path):
            continue
        with open(path, "a+") as f:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(f, fcntl.LOCK_UN)  # free: whatever it says is stale
            except BlockingIOError:
                h = read_holder(path)
                if h:
                    out.append(h)
    return out


def try_slot(me):
    """An open, locked slot file, or None. Refuses a second slot for the same agent."""
    for h in holders():
        if h.get("agent") == me["agent"]:
            return None
    for i in range(MAX):
        path = os.path.join(DIR, f"slot-{i}")
        f = open(path, "a+")
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            f.close()
            continue
        f.seek(0)
        f.truncate()
        f.write(json.dumps({**me, "slot": i}))
        f.flush()
        return f
    return None


def reap_group(pgid, grace):
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.time() + grace
    while time.time() < deadline:
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.2)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def watchdog(runner, pgid, slot):
    """Forked child: if the runner dies without reaping (SIGKILL), reap the group.

    Two traps, both hit by the first version's self-test (it hung): the child shares the slot's open
    file description, and a flock belongs to that description -- so the watchdog must CLOSE it, or the
    slot stays locked while the watchdog lives. And kill(runner, 0) succeeds on an unreaped zombie, so
    the runner's death is read from being reparented instead.
    """
    if os.fork() != 0:
        return
    slot.close()
    os.setsid()  # out of the run's group, so reaping the group does not take the watchdog first
    while os.getppid() == runner:
        time.sleep(0.5)
    reap_group(pgid, GRACE)
    os._exit(0)


def run(label, cmd):
    os.makedirs(DIR, exist_ok=True)
    me = {"agent": agent_name(), "pid": os.getpid(), "label": label or " ".join(cmd)[:120],
          "started": time.strftime("%Y-%m-%d %H:%M:%S")}
    last_note = 0.0
    slot = try_slot(me)
    while slot is None:
        if time.time() - last_note >= 60:
            busy = "; ".join(f"{h['agent']} ({h['label'][:50]}, since {h['started'][11:]})" for h in holders())
            print(f"heavy-run: waiting for a slot ({MAX} max, one per agent) -- busy: {busy or 'nobody?'}",
                  file=sys.stderr, flush=True)
            last_note = time.time()
        time.sleep(POLL)
        slot = try_slot(me)
    proc = subprocess.Popen(cmd, start_new_session=True)
    watchdog(os.getpid(), proc.pid, slot)
    rc = None

    def on_signal(signum, _frame):
        reap_group(proc.pid, GRACE)
        sys.exit(128 + signum)

    for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(s, on_signal)
    try:
        rc = proc.wait()
    finally:
        reap_group(proc.pid, GRACE)  # what the command left behind (a backend it started)
        slot.close()
    return rc if rc >= 0 else 128 - rc


def self_test():
    """Each case with the control that proves the check can fail."""
    import shutil
    base = tempfile.mkdtemp(prefix="heavy-run-test-")
    env = {**os.environ, "HEAVY_RUN_DIR": base, "HEAVY_RUN_MAX": "2", "HEAVY_RUN_POLL": "0.2",
           "HEAVY_RUN_GRACE": "1"}
    me = os.path.abspath(__file__)
    results = []

    def spawn(agent, *cmd):
        return subprocess.Popen([sys.executable, me, "--label", agent, "--", *cmd],
                                env={**env, "HEAVY_AGENT": agent}, stderr=subprocess.PIPE, text=True)

    def alive(pid):
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False

    # Whether a run WAITED is read from its own report ("waiting for a slot", printed the moment it
    # has to wait), not from wall time: under load, interpreter start-up alone takes ~0.6 s, and a
    # timing threshold cannot tell "waited" from "started slowly" (the first version's control failed
    # on exactly that).
    def waited(p):
        _, err = p.communicate()
        return "waiting for a slot" in (err or "")

    # 1. two agents run at once; a third waits until one finishes (fleet limit 2)
    a = spawn("a", "sleep", "2")
    b = spawn("b", "sleep", "2")
    time.sleep(1.0)
    c = spawn("c", "true")
    results.append(("third run waits for a free slot (fleet max 2)", waited(c)))
    a.wait(), b.wait()
    # CONTROL: with max 3 the third does not wait
    a = spawn("a", "sleep", "2")
    b = spawn("b", "sleep", "2")
    time.sleep(1.0)
    c = subprocess.Popen([sys.executable, me, "--", "true"], stderr=subprocess.PIPE, text=True,
                         env={**env, "HEAVY_RUN_MAX": "3", "HEAVY_AGENT": "c"})
    results.append(("CONTROL: with max 3 the third does not wait", not waited(c)))
    a.wait(), b.wait()

    # 2. one per agent: the same agent's second run waits even with a free slot
    a = spawn("same", "sleep", "2")
    time.sleep(1.0)
    a2 = spawn("same", "true")
    results.append(("same agent's second run waits though a slot is free", waited(a2)))
    a.wait()

    # 3. a SIGKILLed holder frees its slot (kernel drops the lock)
    k = spawn("killed", "sleep", "30")
    time.sleep(1.0)
    k.kill()
    k.wait()
    time.sleep(0.5)
    x = spawn("x", "true")
    y = spawn("y", "true")
    results.append(("a SIGKILLed holder frees its slot", not waited(x) and not waited(y)))

    # 4. the command's tree dies with the run -- also a TERM-ignoring child, and also on SIGKILL of the wrapper
    pidfile = os.path.join(base, "child.pid")
    script = f"trap '' TERM; sleep 30 & echo $! > {pidfile}; wait"
    r = spawn("tree", "bash", "-c", script)
    time.sleep(0.6)
    child = int(open(pidfile).read())
    r.send_signal(signal.SIGTERM)
    r.wait()
    time.sleep(1.5)
    results.append(("TERM to the run: the TERM-ignoring grandchild dies too", not alive(child)))
    r = spawn("tree2", "bash", "-c", script)
    time.sleep(0.6)
    child = int(open(pidfile).read())
    r.kill()  # SIGKILL: no handler runs; the watchdog must reap
    r.wait()
    time.sleep(3.5)
    results.append(("SIGKILL to the wrapper: the watchdog reaps the grandchild", not alive(child)))
    # CONTROL: the same grandchild WITHOUT the wrapper survives a SIGKILL of its parent
    p = subprocess.Popen(["bash", "-c", script], start_new_session=True)
    time.sleep(0.6)
    child = int(open(pidfile).read())
    p.kill()
    p.wait()
    time.sleep(1)
    survived = alive(child)
    if survived:
        os.kill(child, signal.SIGKILL)
    results.append(("CONTROL: without the wrapper that grandchild survives", survived))

    # 5. the exit code is the command's
    results.append(("exit code passes through", spawn("rc", "bash", "-c", "exit 7").wait() == 7))

    shutil.rmtree(base, ignore_errors=True)
    for name, ok in results:
        print(("PASS " if ok else "FAIL ") + name)
    passed = sum(ok for _, ok in results)
    print(f"SELF-TEST {'PASS' if passed == len(results) else 'FAIL'} ({passed}/{len(results)})")
    return 0 if passed == len(results) else 1


def main(argv):
    if argv[:1] == ["--self-test"]:
        return self_test()
    if argv[:1] == ["--status"]:
        os.makedirs(DIR, exist_ok=True)
        hs = holders()
        print(f"heavy runs: {len(hs)}/{MAX}")
        for h in hs:
            print(f"  slot {h.get('slot')}: {h['agent']} pid {h['pid']} since {h['started']} -- {h['label']}")
        return 0
    label = None
    if argv[:1] == ["--label"]:
        label, argv = argv[1], argv[2:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    return run(label, argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
