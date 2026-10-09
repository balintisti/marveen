#!/usr/bin/env python3
"""heavy-run.py -- a fleet-wide limit on heavy runs (tsc / jest / vitest / playwright), card a2090e75.

WHY (measured 2026-10-03 12:03, dexter 22886, marveen re-measured): 17 node tsc/jest processes at once
on the Mac Mini -- 12 of them one agent's -- free pages 4998, 526M swapouts, and a backend tsc that did
not finish in 2.5 h. The rule that followed ("ONE heavy run per agent, serial", marveen 22890) is a
habit; a habit is a hope. This makes it a gate. And the second, larger cost the same day: 55 orphaned
backends (node dist/main) from e2e runners whose EXIT trap never ran or whose SIGTERM was ignored,
~9 GB of swap (marveen 14:0x). So the wrapper also owns the command's whole process tree.

  python3 scripts/heavy-run.py [--label TEXT] [--light] -- <command> [args...]
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
3. FIRST COME, FIRST SERVED (card 391d725b; measured 2026-10-08 18:45: didi waited 60+ min while dexter's
   later runs, three waiters polling every 5 s, kept winning the first poll after a release). Every
   waiter takes a TICKET: a monotonic number in HEAVY_RUN_DIR/ticket-seq and a file tickets/<number>
   that it holds an fcntl lock on for as long as it lives -- so a SIGKILLed waiter's ticket is dead the
   moment the kernel drops the lock, and the next scan removes it (same property as the slots). Only
   the lowest ticket among waiters whose agent holds no slot may take a free slot ("whose agent holds
   no slot": a waiter that the one-per-agent rule keeps out must not block everybody behind it).
   Deciding and taking happen under one lock (queue.lock), so two waiters cannot both think it is theirs.
   A ticket is only as good as its owner's polling: SIGSTOP keeps the lock alive, and a stopped (or
   wedged) head waiter would hold a free slot empty for everyone behind it (marveen, review of 391d725b).
   So each waiter touches its ticket on every poll, and a ticket not touched for max(3 x its poll, 3 s)
   is SKIPPED -- not deleted: it rejoins its place the moment its owner polls again.
   HEAVY_RUN_FIFO=0 switches the ticket order off (the old first-poll-wins behaviour).
4. SIZE CLASSES (marveen 31661, from trillian's measurement of runs.jsonl: 252 wait-hours against 105
   run-hours, 41% of the runs were under 10 s and queued behind 25-minute e2e runs). --light is for ONE
   test file, ONE mutant, tsc on ONE project. It has its OWN pool (HEAVY_RUN_LIGHT_MAX, default 2; ONE
   per agent), so a long run no longer blocks it, and the heavy pool stays HEAVY_RUN_MAX. The price is a
   HARD CAP: a light run over HEAVY_RUN_LIGHT_CAP seconds (default 120) is killed, the wrapper says so
   on stderr ("light run exceeded 120s, rerun without --light") and exits 124, so a mislabelled heavy
   run cannot smuggle a third heavy run past the heavy pool.
The exit code is the command's (128+N if a signal ended it). Each run appends one JSON line to
HEAVY_RUN_DIR/runs.jsonl: who, what, class (heavy|light), waited_s, ran_s, rc.
"""
import fcntl
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time

DIR = os.environ.get("HEAVY_RUN_DIR") or os.path.expanduser("~/.heavy-run")
MAX = int(os.environ.get("HEAVY_RUN_MAX") or 2)
GRACE = float(os.environ.get("HEAVY_RUN_GRACE") or 10)
POLL = float(os.environ.get("HEAVY_RUN_POLL") or 5)
FIFO = (os.environ.get("HEAVY_RUN_FIFO") or "1") != "0"
STALE_FLOOR = 3.0  # a ticket untouched for less than this is never called stalled, whatever the poll
QDIR = os.path.join(DIR, "tickets")
LIGHT_MAX = int(os.environ.get("HEAVY_RUN_LIGHT_MAX") or 2)
LIGHT_CAP = float(os.environ.get("HEAVY_RUN_LIGHT_CAP") or 120)
CAP_RC = 124  # the exit code timeout(1) uses
# class -> (slot file prefix, pool size). The heavy files keep their old name, so a run started before
# this change and one started after it still see each other.
POOLS = {"heavy": ("slot", MAX), "light": ("light", LIGHT_MAX)}


def agent_name():
    if os.environ.get("HEAVY_AGENT"):
        return os.environ["HEAVY_AGENT"]
    # The session's config dir names the agent wherever it works; the cwd only does inside
    # agents/<name>, and the heavy runs happen in worktrees outside it (measured 2026-10-04:
    # a friday run from /Users/isti/friday-test was logged as "unknown-<pid>", one agent per run).
    conf = (os.environ.get("CLAUDE_CONFIG_DIR") or "").rstrip(os.sep).split(os.sep)
    if "agents" in conf and conf.index("agents") + 1 < len(conf):
        return conf[conf.index("agents") + 1]
    if conf[-1:] == [".channels-config"]:
        return "marveen"
    if len(conf) >= 2 and conf[-1] == ".claude-config" and conf[-2].startswith("."):
        return conf[-2][1:]  # ~/.marveen-worker/.claude-config -> marveen-worker
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


def holders(cls="heavy"):
    prefix, size = POOLS[cls]
    out = []
    for i in range(size):
        path = os.path.join(DIR, f"{prefix}-{i}")
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
    """An open, locked slot file, or None. Refuses a second slot of the same class for the same agent."""
    prefix, size = POOLS[me["class"]]
    for h in holders(me["class"]):
        if h.get("agent") == me["agent"]:
            return None
    for i in range(size):
        path = os.path.join(DIR, f"{prefix}-{i}")
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


class QueueLock:
    """Exclusive flock on DIR/queue.lock: ticket handout, queue scans and slot taking never interleave."""

    def __enter__(self):
        os.makedirs(QDIR, exist_ok=True)
        self.f = open(os.path.join(DIR, "queue.lock"), "a+")
        fcntl.flock(self.f, fcntl.LOCK_EX)
        return self

    def __exit__(self, *_exc):
        self.f.close()


def take_ticket(me):
    """The next monotonic number, and an open, LOCKED ticket file carrying who waits. Keep it open."""
    with QueueLock():
        seq_path = os.path.join(DIR, "ticket-seq")
        try:
            with open(seq_path) as f:
                last = int(f.read().strip() or 0)
        except (FileNotFoundError, ValueError):
            last = 0  # missing or torn counter: the files below still hold the order
        for name in os.listdir(QDIR):
            if name.isdigit():
                last = max(last, int(name))
        n = last + 1
        with open(seq_path, "w") as f:
            f.write(str(n))
        path = os.path.join(QDIR, f"{n:012d}")
        f = open(path, "w")
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)  # nobody else can know this name yet
        f.write(json.dumps({**me, "seq": n, "stale_s": max(3 * POLL, STALE_FLOOR)}))
        f.flush()
        return f, path, n


def live_tickets():
    """Live waiters, oldest first. Caller holds the queue lock. A ticket whose lock can be taken has no
    owner any more (killed, crashed): it is removed here, so a dead waiter never blocks the queue."""
    out = []
    for name in sorted(os.listdir(QDIR)):
        path = os.path.join(QDIR, name)
        try:
            f = open(path)
        except FileNotFoundError:
            continue
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            t = read_holder(path)  # locked: its owner lives (this includes our own ticket)
            if t:
                try:
                    t["_age"] = time.time() - os.stat(path).st_mtime
                except FileNotFoundError:
                    continue
                out.append(t)
        else:
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass
        finally:
            f.close()
    return out


def is_stalled(t):
    return t.get("_age", 0) > t.get("stale_s", 15)


def try_slot_in_order(me, ticket):
    """try_slot, but only if ours is among the oldest tickets that can use the free slots.

    A waiter is a CANDIDATE when its agent holds no slot and no older ticket of the same agent is
    queued (one run per agent). With k free slots the k oldest candidates may go: two arrivals at an
    idle machine both start, a third waits for the first release."""
    tf, tpath, seq = ticket
    os.utime(tpath)  # "I am polling": the stamp that tells a stopped or wedged owner from a waiting one
    with QueueLock():
        held = holders()
        busy = {h.get("agent") for h in held}
        free = MAX - len(held)
        oldest = {}
        for t in live_tickets():
            if is_stalled(t):
                continue  # alive but not polling: it must not hold a free slot empty
            if t.get("agent") not in busy:
                oldest.setdefault(t.get("agent"), t)
        ranked = [t.get("seq") for t in oldest.values()]  # insertion order = ticket order
        if seq not in ranked or ranked.index(seq) >= free:
            return None
        slot = try_slot(me)
        if slot is not None:
            drop_ticket(ticket)  # inside the lock: no scan ever sees us both queued and running
        return slot


def drop_ticket(ticket):
    tf, tpath, _seq = ticket
    try:
        os.unlink(tpath)
    except FileNotFoundError:
        pass
    tf.close()


def queue_position(seq):
    with QueueLock():
        tickets = live_tickets()
    for i, t in enumerate(tickets):
        if t.get("seq") == seq:
            return i + 1, len(tickets)
    return 0, len(tickets)


# EPERM counts as "nothing of ours left to reap" (dexter 24845, 2026-10-07): on macOS killpg on a
# group whose members are all zombies or have left it answers PermissionError, not ProcessLookupError.
# Uncaught, it was raised inside main()'s `finally`, so the wrapper exited 1 with a traceback, the
# runs.jsonl line was never written, and the COMMAND's rc was lost -- every run read as failed.
_GONE = (ProcessLookupError, PermissionError)


def reap_group(pgid, grace):
    try:
        os.killpg(pgid, signal.SIGTERM)
    except _GONE:
        return
    deadline = time.time() + grace
    while time.time() < deadline:
        try:
            os.killpg(pgid, 0)
        except _GONE:
            return
        time.sleep(0.2)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except _GONE:
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


def run(label, cmd, cls="heavy"):
    # A mistyped command fails before it queues for a slot, the way a shell says it, not as a traceback.
    if shutil.which(cmd[0]) is None:
        print(f"heavy-run: {cmd[0]}: command not found", file=sys.stderr)
        return 127
    os.makedirs(DIR, exist_ok=True)
    me = {"agent": agent_name(), "pid": os.getpid(), "label": label or " ".join(cmd)[:120],
          "class": cls, "started": time.strftime("%Y-%m-%d %H:%M:%S")}
    last_note = 0.0
    asked = time.time()
    ticket = take_ticket(me) if FIFO and cls == "heavy" else None
    try:
        slot = try_slot_in_order(me, ticket) if ticket else try_slot(me)
        while slot is None:
            if time.time() - last_note >= 60:
                busy = "; ".join(f"{h['agent']} ({h['label'][:50]}, since {h['started'][11:]})"
                                 for h in holders(cls))
                where = ""
                if ticket:
                    pos, total = queue_position(ticket[2])
                    where = f", queue position {pos}/{total}"
                print(f"heavy-run: waiting for a {cls} slot ({POOLS[cls][1]} max, one per agent{where}) -- "
                      f"busy: {busy or 'nobody?'}",
                      file=sys.stderr, flush=True)
                last_note = time.time()
            time.sleep(POLL)
            slot = try_slot_in_order(me, ticket) if ticket else try_slot(me)
    finally:
        if ticket:
            drop_ticket(ticket)  # a no-op after a successful take; the cleanup for an interrupted wait
    got = time.time()
    proc = subprocess.Popen(cmd, start_new_session=True)
    watchdog(os.getpid(), proc.pid, slot)
    rc = None

    def on_signal(signum, _frame):
        reap_group(proc.pid, GRACE)
        sys.exit(128 + signum)

    for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(s, on_signal)
    capped = False
    try:
        try:
            rc = proc.wait(timeout=LIGHT_CAP if cls == "light" else None)
        except subprocess.TimeoutExpired:
            capped = True
            print(f"heavy-run: light run exceeded {LIGHT_CAP:g}s, rerun without --light "
                  f"(killed: {me['label'][:80]})", file=sys.stderr, flush=True)
            reap_group(proc.pid, GRACE)
            rc = CAP_RC
    finally:
        reap_group(proc.pid, GRACE)  # what the command left behind (a backend it started)
        slot.close()
        # One line per run, so the limit can be judged by its waits (marveen 23086: watch 3 days).
        with open(os.path.join(DIR, "runs.jsonl"), "a") as f:
            f.write(json.dumps({**me, "waited_s": round(got - asked, 1),
                                "ran_s": round(time.time() - got, 1), "rc": rc,
                                **({"capped": True} if capped else {})}) + "\n")
    return rc if rc >= 0 else 128 - rc


def self_test():
    """Each case with the control that proves the check can fail."""
    base = tempfile.mkdtemp(prefix="heavy-run-test-")
    env = {**os.environ, "HEAVY_RUN_DIR": base, "HEAVY_RUN_MAX": "2", "HEAVY_RUN_POLL": "0.2",
           "HEAVY_RUN_GRACE": "1"}
    me = os.path.abspath(__file__)
    results = []

    def spawn(agent, *cmd, extra=None, light=False):
        return subprocess.Popen([sys.executable, me, "--label", agent, *(["--light"] if light else []),
                                 "--", *cmd],
                                env={**env, "HEAVY_AGENT": agent, **(extra or {})},
                                stderr=subprocess.PIPE, text=True)

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
        try:
            _, err = p.communicate(timeout=40)
        except subprocess.TimeoutExpired:  # a queue that never lets it in is the loudest kind of waiting
            p.kill()
            _, err = p.communicate()
            return True
        return "heavy-run: waiting for a" in (err or "")

    def finish(p, timeout=40):
        """wait() that cannot hang the self-test: a run the queue never admits counts as failed (None)."""
        try:
            return p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
            return None

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

    # 6. every finished run leaves one line with its wait, its run time and its exit code
    log = os.path.join(base, "runs.jsonl")
    lines = [json.loads(x) for x in open(log)] if os.path.exists(log) else []
    results.append(("each run is logged with waited_s / ran_s / rc",
                    any(x["label"] == "rc" and x["rc"] == 7 and "waited_s" in x for x in lines)))

    # 7. the agent is read from the session's config dir, not only from the cwd
    def named(conf):
        e = {k: v for k, v in env.items() if k != "HEAVY_AGENT"}
        e.update(CLAUDE_CONFIG_DIR=conf, PWD=base)
        subprocess.run([sys.executable, me, "--label", "who:" + conf, "--", "true"], env=e, cwd=base)
        rows = [json.loads(x) for x in open(log)]
        return [x["agent"] for x in rows if x["label"] == "who:" + conf][-1]
    results.append(("config dir agents/dexter -> dexter, from any cwd",
                    named("/Users/isti/marveen/agents/dexter/.claude-config") == "dexter"))
    results.append(("coordinator's .channels-config -> marveen",
                    named("/Users/isti/marveen/.channels-config") == "marveen"))
    results.append(("CONTROL: no config dir, cwd outside agents/ -> unknown",
                    named("").startswith("unknown-")))

    # 9. FIRST COME, FIRST SERVED (card 391d725b). Both slots held; "old" queues first (a slow poll, 1 s),
    # then three waiters of ONE other agent (fast poll, 0.2 s) that would win every race for the slot.
    # Each command appends its agent when it STARTS, so the first line says who got in first.
    def order_case(fifo, old_poll="1.0"):
        orderfile = os.path.join(base, f"order-{fifo}")
        e = {**env, "HEAVY_RUN_FIFO": fifo, "HEAVY_RUN_MAX": "1"}  # one slot: only the oldest may take it

        def sp(agent, poll, *cmd):
            return subprocess.Popen([sys.executable, me, "--label", agent, "--", *cmd],
                                    env={**e, "HEAVY_AGENT": agent, "HEAVY_RUN_POLL": poll},
                                    stderr=subprocess.DEVNULL)

        h1 = sp("h1", "0.2", "sleep", "3")
        time.sleep(1.0)
        note = f"echo $0 >> {orderfile}; sleep 1.2"
        procs = [sp("old", old_poll, "bash", "-c", note, "old")]
        time.sleep(0.6)
        procs += [sp("many", "0.2", "bash", "-c", note, "many") for _ in range(3)]
        for p in [h1, *procs]:
            finish(p)
        return [x.strip() for x in open(orderfile)] if os.path.exists(orderfile) else []

    first = order_case("1")
    results.append(("FIFO: the older waiter of one agent beats three later waiters of another",
                    first[:1] == ["old"]))
    # Without tickets the winner is whoever polls first after the release: a race. The control only has
    # to show that the setup CAN lose, so the old waiter polls slower still and it gets five tries
    # (measured: with a 1 s poll it won 1 run in 6 by luck of timing).
    ctrl = []
    for _ in range(5):
        ctrl = order_case("0", old_poll="3.0")
        if ctrl[:1] == ["many"]:
            break
    results.append(("CONTROL: with HEAVY_RUN_FIFO=0 the three fast pollers get in first (race, up to 5 tries)",
                    ctrl[:1] == ["many"]))

    # 10. a SIGKILLed waiter at the head of the queue does not block it (its ticket dies with its lock)
    # ONE slot, so the dead head would be the only one allowed to take it if its ticket still counted.
    one = {"HEAVY_RUN_MAX": "1"}
    h1 = spawn("h1", "sleep", "3", extra=one)
    time.sleep(1.0)
    head = spawn("head", "true", extra=one)
    time.sleep(0.6)
    nxt = spawn("next", "true", extra=one)
    time.sleep(0.6)
    tdir = os.path.join(base, "tickets")
    queued = len(os.listdir(tdir))
    head.kill()
    head.wait()
    t0 = time.time()
    try:
        nxt_rc = nxt.wait(timeout=20)  # a dead ticket that still counted would hold it here for ever
    except subprocess.TimeoutExpired:
        nxt.kill()
        nxt_rc = None
    finish(h1)
    results.append(("CONTROL: both waiters held a ticket before the kill", queued == 2))
    results.append(("a SIGKILLed head-of-queue waiter does not block the next one",
                    nxt_rc == 0 and time.time() - t0 < 10))
    results.append(("every ticket is gone once the queue is empty", os.listdir(tdir) == []))

    # 11. a waiter that the one-per-agent rule keeps out does not block the ones behind it
    d = spawn("d", "sleep", "4")
    time.sleep(1.0)
    d2 = spawn("d", "true")   # older ticket than e's, but its agent already holds a slot
    time.sleep(0.6)
    e2 = spawn("e", "true")
    results.append(("an agent-blocked older waiter does not hold up another agent (free slot used at once)",
                    not waited(e2) and e2.returncode == 0))
    results.append(("CONTROL: that agent's own second run does wait", waited(d2)))
    finish(d)

    # 12. a STOPPED head waiter (SIGSTOP keeps its ticket lock alive) must not keep a free slot empty
    # (marveen's review of 391d725b). One slot, held for 7 s; the head is stopped at 1.5 s, so by the time
    # the slot frees its ticket has gone untouched for longer than max(3 x poll, 3 s).
    fast = {"HEAVY_RUN_MAX": "1", "HEAVY_RUN_POLL": "0.5"}
    h1 = spawn("h1", "sleep", "7", extra=fast)
    time.sleep(1.0)
    head = spawn("shead", "true", extra=fast)
    time.sleep(0.6)
    nxt = spawn("snext", "true", extra=fast)
    time.sleep(0.2)
    head.send_signal(signal.SIGSTOP)
    nxt_rc = finish(nxt, 40)
    still_stopped = head.poll() is None
    results.append(("a SIGSTOPped head waiter does not keep the free slot empty for the next one",
                    nxt_rc == 0 and still_stopped))
    head.send_signal(signal.SIGCONT)
    results.append(("CONTROL: after SIGCONT the stopped waiter rejoins and gets its turn", finish(head, 40) == 0))
    finish(h1)

    # 8. --help and a mistyped command answer in words, not with a traceback
    h = subprocess.run([sys.executable, me, "--help"], env=env, capture_output=True, text=True)
    results.append(("--help prints the usage, rc 0", h.returncode == 0 and "--status" in h.stdout))
    m = spawn("typo", "no-such-command-a2090e75")
    err = m.communicate()[1]
    results.append(("a missing command: rc 127, no traceback", m.returncode == 127 and "Traceback" not in err))

    # 13. SIZE CLASSES (a2090e75, marveen 31661). The light pool is separate from the heavy one, ONE per
    # agent, with a hard cap that kills the run and names the overrun; the class lands in runs.jsonl.
    # (a) a full heavy pool does not block a light run, and a full light pool does not block a heavy one
    a = spawn("a", "sleep", "2")
    b = spawn("b", "sleep", "2")
    time.sleep(1.0)
    c = spawn("c", "true", light=True)
    results.append(("light run does not wait behind a full heavy pool", not waited(c)))
    c = spawn("c", "true")
    results.append(("CONTROL: a heavy run does wait behind the full heavy pool", waited(c)))
    a.wait(), b.wait()
    a = spawn("a", "sleep", "2", light=True)
    b = spawn("b", "sleep", "2", light=True)
    time.sleep(1.0)
    c = spawn("c", "true")
    results.append(("heavy run does not wait behind a full light pool", not waited(c)))
    # (b) the light pool has its own size: the third light run waits, with a larger pool it does not
    c = spawn("c", "true", light=True)
    results.append(("third light run waits (light pool 2)", waited(c)))
    a.wait(), b.wait()
    a = spawn("a", "sleep", "2", light=True)
    b = spawn("b", "sleep", "2", light=True)
    time.sleep(1.0)
    c = spawn("c", "true", light=True, extra={"HEAVY_RUN_LIGHT_MAX": "3"})
    results.append(("CONTROL: with light pool 3 the third light run does not wait", not waited(c)))
    a.wait(), b.wait()
    # (c) ONE light run per agent, even with a free light slot
    a = spawn("same", "sleep", "2", light=True)
    time.sleep(1.0)
    a2 = spawn("same", "true", light=True)
    results.append(("same agent's second light run waits though a light slot is free", waited(a2)))
    a3 = spawn("other", "true", light=True)
    results.append(("CONTROL: another agent's light run takes the free light slot", not waited(a3)))
    a.wait()
    # (d) the hard cap kills the run (also a TERM-ignoring grandchild), names the overrun, exits non-zero
    pidfile = os.path.join(base, "light.pid")
    capped = spawn("capped", "bash", "-c", f"trap '' TERM; sleep 30 & echo $! > {pidfile}; wait",
                   light=True, extra={"HEAVY_RUN_LIGHT_CAP": "1.5"})
    t0 = time.time()
    err = capped.communicate()[1]
    took = time.time() - t0
    results.append(("light run over the cap is killed: rc 124, message names the overrun",
                    capped.returncode == 124 and "light run exceeded 1.5s, rerun without --light" in err
                    and took < 15))
    time.sleep(0.5)
    results.append(("the cap reaps the TERM-ignoring grandchild too", not alive(int(open(pidfile).read()))))
    ok_run = spawn("under", "sleep", "1", light=True, extra={"HEAVY_RUN_LIGHT_CAP": "30"})
    ok_run.communicate()
    results.append(("CONTROL: a light run under the cap finishes with its own rc 0", ok_run.returncode == 0))
    heavy_long = spawn("hv", "sleep", "3", extra={"HEAVY_RUN_LIGHT_CAP": "1.5"})
    heavy_long.communicate()
    results.append(("CONTROL: the cap does not touch a heavy run", heavy_long.returncode == 0))
    st = subprocess.run([sys.executable, me, "--status"], env={k: v for k, v in env.items()
                        if k != "HEAVY_RUN_LIGHT_CAP"}, capture_output=True, text=True).stdout
    results.append(("the default hard cap is 120s", "light runs: 0/2 (hard cap 120s)" in st))
    # (e) runs.jsonl carries the class
    rows = [json.loads(x) for x in open(log)]
    by = {x["label"]: x for x in rows if x["label"] in ("capped", "under", "hv")}
    results.append(("runs.jsonl records class light / heavy, and the capped run's rc 124",
                    by.get("capped", {}).get("class") == "light" and by["capped"].get("rc") == 124
                    and by.get("under", {}).get("class") == "light" and by.get("hv", {}).get("class") == "heavy"))

    shutil.rmtree(base, ignore_errors=True)
    for name, ok in results:
        print(("PASS " if ok else "FAIL ") + name)
    passed = sum(ok for _, ok in results)
    print(f"SELF-TEST {'PASS' if passed == len(results) else 'FAIL'} ({passed}/{len(results)})")
    return 0 if passed == len(results) else 1


def main(argv):
    if argv[:1] in (["-h"], ["--help"]):
        print(__doc__)
        return 0
    if argv[:1] == ["--self-test"]:
        return self_test()
    if argv[:1] == ["--status"]:
        os.makedirs(DIR, exist_ok=True)
        for cls, (_, size) in POOLS.items():
            hs = holders(cls)
            extra = f" (hard cap {LIGHT_CAP:g}s)" if cls == "light" else ""
            print(f"{cls} runs: {len(hs)}/{size}{extra}")
            for h in hs:
                print(f"  slot {h.get('slot')}: {h['agent']} pid {h['pid']} since {h['started']} -- {h['label']}")
        with QueueLock():
            waiting = live_tickets()
        for i, t in enumerate(waiting):
            note = " [stalled: not polling]" if is_stalled(t) else ""
            print(f"  waiting #{i + 1}: {t['agent']} pid {t['pid']} since {t['started']} -- {t['label']}{note}")
        return 0
    label, cls = None, "heavy"
    while argv[:1] in (["--label"], ["--light"]):
        if argv[0] == "--light":
            cls, argv = "light", argv[1:]
        else:
            label, argv = argv[1], argv[2:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    return run(label, argv, cls)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
