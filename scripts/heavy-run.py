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

Start a long run with the Bash tool's run_in_background, not detached with nohup and &: the harness
notifies you when a background task ends, and knows nothing about a detached one (item 6 is the net).

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
   HEAVY_RUN_FIFO=0 switches the ticket order off (the old first-poll-wins behaviour). The light pool
   (item 4) has the SAME queue, but its OWN: tickets-light/, queue-light.lock, ticket-seq-light. A light
   waiter never takes a heavy ticket and vice versa, so an older heavy waiter cannot hold up a free
   light slot, and a light run cannot jump a heavy queue.
4. SIZE CLASSES (marveen 31661, from trillian's measurement of runs.jsonl: 252 wait-hours against 105
   run-hours, 41% of the runs were under 10 s and queued behind 25-minute e2e runs). --light is for ONE
   test file, ONE mutant, tsc on ONE project. It has its OWN pool (HEAVY_RUN_LIGHT_MAX, default 2; ONE
   per agent), so a long run no longer blocks it, and the heavy pool stays HEAVY_RUN_MAX. The price is a
   HARD CAP: a light run over HEAVY_RUN_LIGHT_CAP seconds (default 120) is killed, the wrapper says so
   on stderr ("light run exceeded 120s, rerun without --light") and exits 124, so a mislabelled heavy
   run cannot smuggle a third heavy run past the heavy pool.
5. A NESTED CALL DOES NOT WAIT FOR ITS OWN PARENT. The run exports HEAVY_RUN_HELD=<agent>:<pid> to the
   command. A heavy-run inside it, by the same agent, whose holder still holds a slot, runs the command
   without taking a second slot and without a ticket, in either pool (logged nested=true). Without this the one-per-agent rule made the inner
   call wait forever for the slot its own parent held (card 378576bc).
6. A DETACHED RUN WAKES ITS AGENT (card 6790bcdb, marveen 37807). Measured 2026-10-22/23: ford launched
   `nohup python3 heavy-run.py ... &` in a plain Bash call twice; the harness never knew about that
   process, so its end could not wake him, and the idle guard was the only net, 27-57 min late. So when
   the run ends DETACHED (parent pid 1: the shell that started it is gone) and took more than
   HEAVY_RUN_WAKE_MIN_S seconds (default 300, waiting included), the wrapper sends EXACTLY ONE message
   to the agent that started it, through scripts/agent-msg.sh: run id, label, exit code, duration, log
   path, nothing else. Once per run id (a marker file under HEAVY_RUN_DIR/wake). A run started with
   run_in_background is NOT detached (the harness's shell is its parent) and sends nothing: the harness
   already notifies it, and that is the launch to use. When the send is refused (the queue gate, exit 2)
   or fails, the result goes to the card named in the label (the first 8-hex token) as a comment, never
   a retry; no card in the label -> only stderr and the runs.jsonl line. An unknown agent gets nothing.
   Limit, stated: this wakes the agent's MAIN pane; a sub-agent that waits on a detached run is woken by
   its main session, not by this.
The exit code is the command's (128+N if a signal ended it). Each run appends one JSON line to
HEAVY_RUN_DIR/runs.jsonl: who, what, class (heavy|light), waited_s, ran_s, rc, and wake (what item 6
did: sent / card / no-card / failed / not-detached / short / unknown-agent / dup).
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
LIGHT_MAX = int(os.environ.get("HEAVY_RUN_LIGHT_MAX") or 2)
LIGHT_CAP = float(os.environ.get("HEAVY_RUN_LIGHT_CAP") or 120)
CAP_RC = 124  # the exit code timeout(1) uses
WAKE_MIN_S = float(os.environ.get("HEAVY_RUN_WAKE_MIN_S") or 300)
# The sender is agent-msg.sh next to this file; overridable so the self-test can stand a stub in.
WAKE_SEND = os.environ.get("HEAVY_RUN_WAKE_SEND") or os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                                  "agent-msg.sh")
# class -> (slot file prefix, pool size). The heavy files keep their old name, so a run started before
# this change and one started after it still see each other.
POOLS = {"heavy": ("slot", MAX), "light": ("light", LIGHT_MAX)}
# class -> (ticket dir, queue lock, ticket counter): one queue per pool, nothing shared between them.
# The heavy names are the ones from before the light pool existed.
QUEUES = {"heavy": ("tickets", "queue.lock", "ticket-seq"),
          "light": ("tickets-light", "queue-light.lock", "ticket-seq-light")}


def qdir(cls):
    return os.path.join(DIR, QUEUES[cls][0])


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
    """Exclusive flock on the pool's queue lock: ticket handout, queue scans and slot taking never
    interleave within one pool (the two pools are independent, so they do not share a lock)."""

    def __init__(self, cls="heavy"):
        self.cls = cls

    def __enter__(self):
        os.makedirs(qdir(self.cls), exist_ok=True)
        self.f = open(os.path.join(DIR, QUEUES[self.cls][1]), "a+")
        fcntl.flock(self.f, fcntl.LOCK_EX)
        return self

    def __exit__(self, *_exc):
        self.f.close()


def take_ticket(me):
    """The next monotonic number, and an open, LOCKED ticket file carrying who waits. Keep it open."""
    cls = me["class"]
    with QueueLock(cls):
        seq_path = os.path.join(DIR, QUEUES[cls][2])
        try:
            with open(seq_path) as f:
                last = int(f.read().strip() or 0)
        except (FileNotFoundError, ValueError):
            last = 0  # missing or torn counter: the files below still hold the order
        for name in os.listdir(qdir(cls)):
            if name.isdigit():
                last = max(last, int(name))
        n = last + 1
        with open(seq_path, "w") as f:
            f.write(str(n))
        path = os.path.join(qdir(cls), f"{n:012d}")
        f = open(path, "w")
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)  # nobody else can know this name yet
        f.write(json.dumps({**me, "seq": n, "stale_s": max(3 * POLL, STALE_FLOOR)}))
        f.flush()
        return f, path, n


def live_tickets(cls="heavy"):
    """Live waiters of one pool, oldest first. Caller holds that pool's queue lock. A ticket whose lock can be taken has no
    owner any more (killed, crashed): it is removed here, so a dead waiter never blocks the queue."""
    out = []
    for name in sorted(os.listdir(qdir(cls))):
        path = os.path.join(qdir(cls), name)
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
    cls = me["class"]
    os.utime(tpath)  # "I am polling": the stamp that tells a stopped or wedged owner from a waiting one
    with QueueLock(cls):
        held = holders(cls)
        busy = {h.get("agent") for h in held}
        free = POOLS[cls][1] - len(held)
        oldest = {}
        for t in live_tickets(cls):
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


def queue_position(seq, cls="heavy"):
    with QueueLock(cls):
        tickets = live_tickets(cls)
    for i, t in enumerate(tickets):
        if t.get("seq") == seq:
            return i + 1, len(tickets)
    return 0, len(tickets)


# EPERM counts as "nothing of ours left to reap" (dexter 24845, 2026-10-07): on macOS killpg on a
# group whose members are all zombies or have left it answers PermissionError, not ProcessLookupError.
# Uncaught, it was raised inside main()'s `finally`, so the wrapper exited 1 with a traceback, the
# runs.jsonl line was never written, and the COMMAND's rc was lost -- every run read as failed.
_GONE = (ProcessLookupError, PermissionError)


def held_by_me(held, agent):
    """True if HEAVY_RUN_HELD names this agent AND that pid holds a slot right now.

    The variable alone is not trusted: a descendant that outlives its run (a daemon it started) still
    carries it, and a pass-through on a stale value would let the agent run unlimited.
    """
    who, _, pid = held.rpartition(":")
    if who != agent or not pid.isdigit():
        return False
    return any(h.get("agent") == agent and h.get("pid") == int(pid) for cls in POOLS for h in holders(cls))


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
    if slot:
        slot.close()
    os.setsid()  # out of the run's group, so reaping the group does not take the watchdog first
    while os.getppid() == runner:
        time.sleep(0.5)
    reap_group(pgid, GRACE)
    os._exit(0)


def output_path():
    """Where this wrapper's stdout (else stderr) goes: the log the agent will read. macOS F_GETPATH."""
    for fd in (1, 2):
        try:
            path = fcntl.fcntl(fd, getattr(fcntl, "F_GETPATH"), b"\0" * 1024).split(b"\0", 1)[0].decode()
        except (OSError, AttributeError, ValueError):
            continue
        if path and not path.startswith("/dev/"):
            return path
    return "unknown"


def card_comment(card, author, text):
    """POST a comment on a kanban card; True only on HTTP 2xx (the fallback when the message is refused)."""
    import urllib.request
    base = (os.environ.get("MARVEEN_API_BASE")
            or f"http://localhost:{os.environ.get('MARVEEN_WEB_PORT') or 3420}").rstrip("/")
    token_file = os.environ.get("MARVEEN_TOKEN_FILE") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "store", ".dashboard-token")
    try:
        with open(token_file) as f:
            token = f.read().strip()
        req = urllib.request.Request(f"{base}/api/kanban/{card}/comments", method="POST",
                                     data=json.dumps({"author": author, "content": text}).encode(),
                                     headers={"Authorization": f"Bearer {token}",
                                              "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def wake(me, rc, elapsed, detached):
    """Item 5: one message to the starting agent when a detached run ends. Returns the outcome word."""
    if not detached:
        return "not-detached"
    if elapsed <= WAKE_MIN_S:
        return "short"
    agent = me["agent"]
    if agent.startswith("unknown-"):
        return "unknown-agent"
    run_id = f"{agent}-{me['pid']}-{me['started'].replace(' ', 'T')}"
    marker_dir = os.path.join(DIR, "wake")
    os.makedirs(marker_dir, exist_ok=True)
    try:
        os.close(os.open(os.path.join(marker_dir, run_id), os.O_CREAT | os.O_EXCL | os.O_WRONLY))
    except FileExistsError:
        return "dup"
    text = (f"[heavy-run] detached run finished: run={run_id} label={me['label']} rc={rc} "
            f"duration={round(elapsed)}s log={output_path()}")
    try:
        sent = subprocess.run(["bash", WAKE_SEND, agent, agent, "-"], input=text, text=True,
                              capture_output=True, timeout=120).returncode
    except (OSError, subprocess.TimeoutExpired):
        sent = None
    if sent == 0:
        return "sent"
    print(f"heavy-run: the wake message to {agent} was not sent (agent-msg.sh rc={sent}); not retrying",
          file=sys.stderr, flush=True)
    import re
    card = re.search(r"\b[0-9a-f]{8}\b", me["label"])
    if not card:
        return "no-card"
    return "card" if card_comment(card.group(0), agent, text) else "failed"


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
    held = os.environ.get("HEAVY_RUN_HELD", "")
    nested = held_by_me(held, me["agent"])
    env = None
    if nested:
        print(f"heavy-run: nested in this agent's own run (pid {held.rpartition(':')[2]}), "
              "running without a second slot", file=sys.stderr, flush=True)
        slot = None
    else:
        env = {**os.environ, "HEAVY_RUN_HELD": f"{me['agent']}:{me['pid']}"}
        ticket = take_ticket(me) if FIFO else None
        try:
            slot = try_slot_in_order(me, ticket) if ticket else try_slot(me)
            while slot is None:
                if time.time() - last_note >= 60:
                    busy = "; ".join(f"{h['agent']} ({h['label'][:50]}, since {h['started'][11:]})"
                                     for h in holders(cls))
                    where = ""
                    if ticket:
                        pos, total = queue_position(ticket[2], cls)
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
    proc = subprocess.Popen(cmd, start_new_session=True, env=env)
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
        if slot:
            slot.close()
        ended = time.time()
        # Read once, here: the parent is 1 when the shell that started the run is gone.
        try:
            woke = wake(me, rc, ended - asked, os.getppid() == 1)
        except Exception as e:  # the wake is a courtesy; it must never cost the run its rc or its log line
            woke = f"error: {type(e).__name__}"
        # One line per run, so the limit can be judged by its waits (marveen 23086: watch 3 days).
        with open(os.path.join(DIR, "runs.jsonl"), "a") as f:
            f.write(json.dumps({**me, "waited_s": round(got - asked, 1),
                                "ran_s": round(ended - got, 1), "rc": rc, "wake": woke,
                                **({"capped": True} if capped else {}),
                                **({"nested": True} if nested else {})}) + "\n")
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
    def order_case(fifo, old_poll="1.0", light=False):
        orderfile = os.path.join(base, f"order-{'light' if light else 'heavy'}-{fifo}")
        # one slot in the pool under test: only the oldest may take it
        e = {**env, "HEAVY_RUN_FIFO": fifo, "HEAVY_RUN_MAX": "1", "HEAVY_RUN_LIGHT_MAX": "1"}

        def sp(agent, poll, *cmd):
            return subprocess.Popen([sys.executable, me, "--label", agent, *(["--light"] if light else []),
                                     "--", *cmd],
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
    # (a) a full heavy pool does not block a light run, and a full light pool does not block a heavy one.
    # The heavy holders sleep 4 s: the CONTROL below asks only after the light run, and with 2 s holders a
    # loaded machine let them finish first, so the control read "did not wait" (1 of 13 runs, 2026-10-24).
    a = spawn("a", "sleep", "4")
    b = spawn("b", "sleep", "4")
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

    # 14. FIRST COME, FIRST SERVED IN THE LIGHT POOL (a2090e75): the same ticket queue, its own state.
    # the old light waiter polls slowly (3 s): without tickets the fast pollers win the race nearly every time
    first = order_case("1", old_poll="3.0", light=True)
    results.append(("light FIFO: the older light waiter of one agent beats three later light waiters of another",
                    first[:1] == ["old"]))
    ctrl = []
    for _ in range(5):
        ctrl = order_case("0", old_poll="3.0", light=True)
        if ctrl[:1] == ["many"]:
            break
    results.append(("CONTROL: with HEAVY_RUN_FIFO=0 the three fast light pollers get in first (race, up to 5 tries)",
                    ctrl[:1] == ["many"]))

    def tickets_in(name):
        d = os.path.join(base, name)
        return len(os.listdir(d)) if os.path.isdir(d) else 0

    # (b) separation, heavy waiter -> light: the heavy pool (1 slot) is held, an OLDER heavy waiter queues;
    # the light pool is free, so another agent's light run starts at once. With one shared queue that
    # older heavy ticket would rank first and the light run would be kept out.
    one = {"HEAVY_RUN_MAX": "1", "HEAVY_RUN_LIGHT_MAX": "1"}
    hold = spawn("hold", "sleep", "4", extra=one)
    time.sleep(1.0)
    hw = spawn("hw", "true", extra=one)
    time.sleep(1.0)
    seen = (tickets_in("tickets"), tickets_in("tickets-light"))
    lr = spawn("lr", "true", extra=one, light=True)
    lr_waited = waited(lr)
    results.append(("a heavy waiter holds a HEAVY ticket only (heavy 1, light 0)", seen == (1, 0)))
    results.append(("an older heavy waiter does not hold up a free light slot", not lr_waited and lr.returncode == 0))
    finish(hold), finish(hw)

    # (c) separation, light waiter -> heavy: the light pool (1 slot) is held, an older light waiter queues,
    # the heavy pool is free: another agent's heavy run starts at once.
    hold = spawn("hold", "sleep", "4", extra=one, light=True)
    time.sleep(1.0)
    lw = spawn("lw", "true", extra=one, light=True)
    time.sleep(1.0)
    seen = (tickets_in("tickets"), tickets_in("tickets-light"))
    hr = spawn("hr", "true", extra=one)
    hr_waited = waited(hr)
    results.append(("a light waiter holds a LIGHT ticket only (heavy 0, light 1)", seen == (0, 1)))
    results.append(("an older light waiter does not hold up a free heavy slot", not hr_waited and hr.returncode == 0))
    finish(hold), finish(lw)

    # (d) a SIGKILLed light head waiter does not block the next light waiter; the light queue empties
    hold = spawn("hold", "sleep", "3", extra=one, light=True)
    time.sleep(1.0)
    head = spawn("lhead", "true", extra=one, light=True)
    time.sleep(0.6)
    nxt = spawn("lnext", "true", extra=one, light=True)
    time.sleep(0.6)
    queued = tickets_in("tickets-light")
    head.kill()
    head.wait()
    nxt_rc = finish(nxt, 20)
    finish(hold)
    results.append(("CONTROL: both light waiters held a light ticket before the kill", queued == 2))
    results.append(("a SIGKILLed head-of-queue light waiter does not block the next one", nxt_rc == 0))
    results.append(("every light ticket is gone once the light queue is empty", tickets_in("tickets-light") == 0))

    # 15. a nested call by the same agent runs inside its parent's slot, even with max 1 (card 378576bc)
    one = {**env, "HEAVY_RUN_MAX": "1"}

    def nest(outer, inner_env, timeout, light=False, depth=1):
        """outer agent holds the only slot; inside it `depth` heavy-runs, one in the other, run `true`.
        rc, or None if stuck."""
        cls = ["--light"] if light else []
        inner = ["true"]
        for lvl in range(depth, 0, -1):
            inner = [sys.executable, me, "--label", ("inner-" if lvl == 1 else f"inner{lvl}-") + outer, *cls,
                     "--", *inner]
        inner = " ".join(inner)
        p = subprocess.Popen([sys.executable, me, "--label", "outer-" + outer, *cls, "--", "bash", "-c",
                              f"{inner_env} {inner}"], env={**one, "HEAVY_AGENT": outer},
                             stderr=subprocess.PIPE, text=True)
        try:
            p.communicate(timeout=timeout)
            return p.returncode
        except subprocess.TimeoutExpired:
            p.terminate()  # the wrapper reaps its group, the stuck inner call with it
            p.communicate()
            return None
    results.append(("nested call of the same agent completes with max 1", nest("n", "", 10) == 0))
    rows = [json.loads(x) for x in open(log)]
    results.append(("the nested run is logged nested=true, the outer one is not",
                    [x.get("nested") for x in rows if x["label"] in ("outer-n", "inner-n")] == [True, None]))
    # CONTROL: a DIFFERENT agent's call inside that run still waits for the slot
    results.append(("CONTROL: another agent's nested call still waits",
                    nest("o", "HEAVY_AGENT=other", 3) is None))
    # the light pool is one per agent too, so a light run nested in the same agent's light run deadlocked
    # the same way; the holder check has to look at both pools
    results.append(("nested light call of the same agent completes inside its light parent",
                    nest("l", "", 10, light=True) == 0))
    # a stale HEAVY_RUN_HELD (its pid holds no slot) does not bypass the limit
    a = spawn("a", "sleep", "2")
    time.sleep(1.0)
    s = subprocess.Popen([sys.executable, me, "--", "true"], stderr=subprocess.PIPE, text=True,
                         env={**one, "HEAVY_AGENT": "s", "HEAVY_RUN_HELD": "s:1"})
    results.append(("a stale HEAVY_RUN_HELD still waits for a slot", waited(s)))
    a.wait()
    # the same, while that agent DOES hold a slot: HEAVY_RUN_HELD has to name the holding pid, not just
    # the agent, or a daemon left over from one run would ride on any other run of the same agent (didi L1)
    h = spawn("h", "sleep", "2", extra={"HEAVY_RUN_MAX": "1"})
    time.sleep(1.0)
    s = subprocess.Popen([sys.executable, me, "--", "true"], stderr=subprocess.PIPE, text=True,
                         env={**one, "HEAVY_AGENT": "h", "HEAVY_RUN_HELD": "h:1"})
    results.append(("a HEAVY_RUN_HELD naming a non-holding pid waits, though its agent holds a slot", waited(s)))
    h.wait()
    # two levels deep: the nested call must pass on its PARENT's HEAVY_RUN_HELD, not its own pid, which
    # holds no slot; otherwise the second level waits for the slot its grandparent holds (didi L2)
    results.append(("a two-level nested call of the same agent completes with max 1", nest("d", "", 15, depth=2) == 0))

    # 16. item 6, the wake. A stub stands in for agent-msg.sh (records its args + stdin, exits STUB_RC) and
    # a local HTTP server for the card API. "Detached" is made the real way: sh starts the run with & and
    # exits, so the run's parent becomes 1 -- the same shape as `nohup ... &` in a Bash call.
    import http.server
    import threading
    calls = os.path.join(base, "wake-calls")
    stub = os.path.join(base, "stub-send.sh")
    with open(stub, "w") as f:
        f.write('printf "%s %s|" "$1" "$2" >> "$STUB_LOG"; cat >> "$STUB_LOG"; echo >> "$STUB_LOG"; '
                'exit "${STUB_RC:-0}"\n')
    posted = []

    class Cards(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            posted.append((self.path, self.headers.get("Authorization"), json.loads(body)))
            self.send_response(201)
            self.end_headers()

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Cards)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with open(os.path.join(base, "token"), "w") as f:
        f.write("t0ken\n")
    wenv = {**env, "HEAVY_RUN_WAKE_SEND": stub, "STUB_LOG": calls, "HEAVY_RUN_WAKE_MIN_S": "1",
            "MARVEEN_API_BASE": f"http://127.0.0.1:{srv.server_port}",
            "MARVEEN_TOKEN_FILE": os.path.join(base, "token")}

    def stub_calls():
        try:
            with open(calls) as f:
                return [x for x in f.read().split("\n") if x]
        except FileNotFoundError:
            return []

    def run_row(label, timeout=30):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                with open(log) as f:
                    rows = [json.loads(x) for x in f if x.strip()]
            except FileNotFoundError:
                rows = []
            hit = [x for x in rows if x["label"] == label]
            if hit:
                return hit[-1]
            time.sleep(0.2)
        return {}

    def detached(label, secs, extra=None):
        out = os.path.join(base, label.replace(" ", "_") + ".out")
        subprocess.run(["sh", "-c", f'"$PY" "$ME" --label "$LBL" -- sleep {secs} > "$OUT" 2>&1 &'],
                       env={**wenv, "HEAVY_AGENT": "wk", "PY": sys.executable, "ME": me, "LBL": label,
                            "OUT": out, **(extra or {})})
        return run_row(label), out

    row, out = detached("wake-a", "1.5")
    got = stub_calls()
    text = got[0].split("|", 1)[1] if got else ""
    results.append(("detached + over the threshold: EXACTLY one message, to the starting agent",
                    len(got) == 1 and got[0].startswith("wk wk|") and row.get("wake") == "sent"))
    results.append(("the message carries run id, label, rc, duration, log path",
                    all(k in text for k in ("run=wk-", " label=wake-a ", " rc=0 ", " duration=")) and
                    text.endswith("log=" + os.path.realpath(out))))
    row, _ = detached("wake-short", "0.1", {"HEAVY_RUN_WAKE_MIN_S": "30"})
    results.append(("CONTROL: detached but under the threshold sends nothing",
                    len(stub_calls()) == 1 and row.get("wake") == "short"))
    # the threshold counts the WAIT too (trillian 37834: a mutant measuring the run alone stayed green):
    # the same agent holds the only slot it may have, so this detached run queues ~2.5 s, then runs 0.1 s
    hold = subprocess.Popen([sys.executable, me, "--label", "wake-hold", "--", "sleep", "2.5"],
                            env={**wenv, "HEAVY_AGENT": "wk"}, stderr=subprocess.PIPE, text=True)
    time.sleep(0.8)
    row, _ = detached("wake-queued", "0.1", {"HEAVY_RUN_WAKE_MIN_S": "1.5"})
    hold.communicate(timeout=30)
    results.append(("waited 2.5 s + ran 0.1 s against a 1.5 s threshold: the wait counts, the message goes",
                    row.get("waited_s", 0) > 1.5 and row.get("ran_s", 9) < 1.5 and row.get("wake") == "sent"
                    and len(stub_calls()) == 2))
    p = subprocess.Popen([sys.executable, me, "--label", "wake-attached", "--", "sleep", "1.5"],
                         env={**wenv, "HEAVY_AGENT": "wk"}, stderr=subprocess.PIPE, text=True)
    p.communicate(timeout=30)
    results.append(("CONTROL: a run whose parent is alive (run_in_background) sends nothing",
                    len(stub_calls()) == 2 and run_row("wake-attached").get("wake") == "not-detached"))
    row, _ = detached("gate 1234abcd", "1.5", {"STUB_RC": "2"})
    results.append(("refused (rc 2): no retry, the result goes to the label's card as a comment",
                    len(stub_calls()) == 3 and row.get("wake") == "card" and len(posted) == 1 and
                    posted[0][0] == "/api/kanban/1234abcd/comments" and posted[0][1] == "Bearer t0ken" and
                    posted[0][2]["author"] == "wk" and "label=gate 1234abcd rc=0" in posted[0][2]["content"]))
    row, _ = detached("no card here", "1.5", {"STUB_RC": "2"})
    results.append(("refused, no card in the label: nothing posted, wake=no-card",
                    len(posted) == 1 and row.get("wake") == "no-card"))
    # once per run id, and never for an unknown agent -- in-process, with this module's globals pointed
    # at the test directory and the stub
    g = globals()
    saved = {k: g[k] for k in ("DIR", "WAKE_SEND", "WAKE_MIN_S")}
    saved_env = {k: os.environ.get(k) for k in ("STUB_LOG", "STUB_RC")}
    g.update(DIR=base, WAKE_SEND=stub, WAKE_MIN_S=1.0)
    os.environ["STUB_LOG"] = calls
    os.environ.pop("STUB_RC", None)
    try:
        one = {"agent": "wk", "pid": 4242, "label": "dup", "started": "2026-10-23 20:00:00"}
        first, second = wake(one, 0, 5, True), wake(one, 0, 5, True)
        unknown = wake({**one, "agent": "unknown-77", "pid": 4343}, 0, 5, True)
    finally:
        g.update(saved)
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    results.append(("the same run id wakes once (second call: dup)", (first, second) == ("sent", "dup")))
    results.append(("an unknown agent is not messaged", unknown == "unknown-agent" and len(stub_calls()) == 5))
    srv.shutdown()

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
            with QueueLock(cls):
                waiting = live_tickets(cls)
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
