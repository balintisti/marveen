#!/usr/bin/env python3
"""fg-exec.py -- run one command in a FRESH launchd job with ProcessType=Interactive, and wait for it.

WHY (measured 2026-10-28 19:17-19:24, marveen, mem 2773): the fleet's tmux server is CPU-throttled by
macOS even after it was restarted from an Interactive launchd job. 8 parallel node loops (6e8 each):
from the fleet tmux 16-21 s; from a fresh tmux server started by an Interactive launchd job 6-8 s, and
it stayed 6-7 s over three back-to-back heavy rounds. A plain session in the fleet tmux WITHOUT claude
was also 16 s, so it is the fleet's process context, not Claude Code. Cause unknown (tip: the
scheduler demotes the long-lived, CPU-heavy fleet coalition). A fresh launchd job per run gets the
fast context every time, whatever the cause.

  python3 scripts/fg-exec.py -- <command> [args...]
  python3 scripts/fg-exec.py --self-test

Behaves like running the command directly: same cwd, same environment, stdout+stderr streamed to
this process's stdout (one stream: the job writes both into one log file), exit code is the
command's (128+N for a signal). stdin is /dev/null.

The environment travels in a 0600 JSON file under ~/.heavy-run/fg/ that the job reads and DELETES
before it starts the command; the plist holds only paths, so no secret sits in a launchd plist.

The command's tree dies with this process:
  - INT/TERM/HUP here -> `launchctl bootout` of the job: launchd TERMs the inner wrapper only, so the
    wrapper passes the TERM to its process group and KILLs the group HEAVY_RUN_GRACE - 2 s later (at
    least 0.5 s), or as soon as the command itself exits: a TERM-ignoring grandchild dies too.
  - SIGKILL here (no handler runs) -> the job's inner wrapper polls this pid every 0.5 s and, when it is
    gone, KILLs its own process group.
  Limit, stated: a descendant that calls setsid() leaves the group (same limit as heavy-run.py).

If the job does not start within FG_EXEC_START_TIMEOUT seconds (default 20; launchctl refused, no GUI
session), it says so on stderr and runs the command DIRECTLY, slow but not lost. FG_EXEC=0 makes it a
plain exec (the escape hatch).
"""
import json
import os
import plistlib
import signal
import subprocess
import sys
import time

BASE = os.path.join(os.environ.get("HEAVY_RUN_DIR") or os.path.expanduser("~/.heavy-run"), "fg")
START_TIMEOUT = float(os.environ.get("FG_EXEC_START_TIMEOUT") or 20)
POLL = 0.2
# launchd's TERM->KILL wait on bootout: the same grace heavy-run.py gives its own process group.
GRACE = max(1, int(float(os.environ.get("HEAVY_RUN_GRACE") or 10)))


def inner(owner, work):
    """Runs INSIDE the launchd job: read+delete the env file, start the command, watch the owner."""
    with open(os.path.join(work, "started"), "w") as f:  # the outer reaps this group after bootout
        f.write(str(os.getpgrp()) if os.getpgrp() == os.getpid() else "")
    spec_path = os.path.join(work, "spec.json")
    with open(spec_path) as f:
        spec = json.load(f)
    os.unlink(spec_path)
    rc = 127
    try:
        try:
            proc = subprocess.Popen(spec["cmd"], cwd=spec["cwd"], env=spec["env"], stdin=subprocess.DEVNULL)
        except OSError as e:
            print(f"fg-exec: {spec['cmd'][0]}: {e.strerror}", file=sys.stderr, flush=True)
            return
        term = []
        signal.signal(signal.SIGTERM, lambda *_: term.append(1))  # bootout's TERM: launchd sends it to us only
        while True:
            if term:  # pass it to the group, then KILL the group (a TERM-ignoring grandchild included)
                signal.signal(signal.SIGTERM, signal.SIG_IGN)
                rc = 143
                try:
                    with open(os.path.join(work, "rc"), "w") as f:
                        f.write(str(rc))
                except OSError:  # the outer's cleanup may already have removed the work dir
                    pass
                try:
                    os.killpg(0, signal.SIGTERM)
                    proc.wait(timeout=max(0.5, GRACE - 2))
                except subprocess.TimeoutExpired:
                    pass
                os.killpg(0, signal.SIGKILL)
            try:
                r = proc.wait(timeout=0.5)
                rc = r if r >= 0 else 128 - r
                return
            except subprocess.TimeoutExpired:
                pass
            try:
                os.kill(owner, 0)
            except ProcessLookupError:  # the owner died without its handler finishing: take the tree down.
                # The owner's TERM phase (bootout) already ran or was cut short by its KILL, so: KILL.
                rc = 137
                try:
                    os.killpg(0, signal.SIGKILL)  # this wrapper is in the group too; rc stays unwritten
                except (ProcessLookupError, PermissionError):
                    pass
                return
    finally:
        tmp = os.path.join(work, "rc.tmp")
        try:
            with open(tmp, "w") as f:
                f.write(str(rc))
            os.replace(tmp, os.path.join(work, "rc"))
        except OSError:  # nobody is left to read it: the outer cleaned up and went
            pass


def launchctl(*args):
    return subprocess.run(["launchctl", *args], capture_output=True, text=True)


def direct(cmd):
    try:
        r = subprocess.call(cmd)
    except OSError as e:
        print(f"fg-exec: {cmd[0]}: {e.strerror}", file=sys.stderr)
        return 127
    return r if r >= 0 else 128 - r


def outer(cmd):
    if os.environ.get("FG_EXEC") == "0":
        return direct(cmd)
    os.makedirs(BASE, mode=0o700, exist_ok=True)
    os.chmod(BASE, 0o700)
    label = f"com.marveen.fg.{os.getpid()}.{time.time_ns()}"
    work = os.path.join(BASE, label)
    os.mkdir(work, 0o700)
    spec = os.path.join(work, "spec.json")
    fd = os.open(spec, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"cmd": cmd, "cwd": os.getcwd(), "env": dict(os.environ)}, f)
    log = os.path.join(work, "out.log")
    plist = os.path.join(work, "job.plist")
    with open(plist, "wb") as f:
        plistlib.dump({"Label": label, "ProcessType": "Interactive", "RunAtLoad": True,
                       "ProgramArguments": [sys.executable, os.path.abspath(__file__), "--inner",
                                            str(os.getpid()), work],
                       "StandardOutPath": log, "StandardErrorPath": log, "ExitTimeOut": GRACE,
                       "WorkingDirectory": os.getcwd()}, f)
    domain = f"gui/{os.getuid()}"
    sweep(domain)
    loaded = False

    def cleanup():
        if loaded:
            try:
                pgid = int(open(os.path.join(work, "started")).read() or 0)
            except (OSError, ValueError):
                pgid = 0
            launchctl("bootout", f"{domain}/{label}")
            # bootout TERMs (then KILLs) the inner wrapper only; under load it may die before it passes the
            # signal on (measured 2026-10-28: a TERM-ignoring grandchild survived). Its group is the tree.
            if pgid > 1:
                try:
                    os.killpg(pgid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
        for name in ("spec.json", "job.plist", "started", "rc", "rc.tmp", "out.log"):
            try:
                os.unlink(os.path.join(work, name))
            except FileNotFoundError:
                pass
        try:
            os.rmdir(work)
        except OSError:
            pass

    def on_signal(signum, _frame):
        cleanup()
        sys.exit(128 + signum)

    for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(s, on_signal)
    try:
        r = launchctl("bootstrap", domain, plist)
        loaded = r.returncode == 0
        deadline = time.time() + START_TIMEOUT
        while loaded and not os.path.exists(os.path.join(work, "started")) and time.time() < deadline:
            time.sleep(POLL)
        if not loaded or not os.path.exists(os.path.join(work, "started")):
            why = (r.stderr or r.stdout).strip() if not loaded else f"job did not start in {START_TIMEOUT:g}s"
            print(f"fg-exec: no foreground job ({why}); running directly, at background speed",
                  file=sys.stderr, flush=True)
            cleanup()
            loaded = False
            return direct(cmd)
        rc_path = os.path.join(work, "rc")
        pos = 0
        out = sys.stdout.buffer
        ticks = 0
        while True:
            done = os.path.exists(rc_path)
            try:
                with open(log, "rb") as f:
                    f.seek(pos)
                    chunk = f.read()
                    pos += len(chunk)
                if chunk:
                    out.write(chunk)
                    out.flush()
            except FileNotFoundError:
                pass
            if done:
                return int(open(rc_path).read().strip() or 1)
            ticks += 1
            if ticks % 10 == 0 and _job_exited(domain, label):
                time.sleep(0.5)
                if not os.path.exists(rc_path):
                    print("fg-exec: the job ended without an exit code", file=sys.stderr, flush=True)
                    return 1
            time.sleep(POLL)
    finally:
        cleanup()


def sweep(domain):
    """Remove what a SIGKILLed outer left behind: its job stays loaded and its work dir stays."""
    for name in os.listdir(BASE):
        parts = name.split(".")
        if not name.startswith("com.marveen.fg.") or len(parts) != 5 or not parts[3].isdigit():
            continue
        try:
            os.kill(int(parts[3]), 0)
            continue  # the owner lives: not stale
        except ProcessLookupError:
            pass
        except PermissionError:
            continue
        launchctl("bootout", f"{domain}/{name}")
        work = os.path.join(BASE, name)
        for f in os.listdir(work):
            try:
                os.unlink(os.path.join(work, f))
            except OSError:
                pass
        try:
            os.rmdir(work)
        except OSError:
            pass


def _job_exited(domain, label):
    """True once the job's process is gone (launchd keeps the job loaded after a non-KeepAlive exit)."""
    r = launchctl("print", f"{domain}/{label}")
    return r.returncode != 0 or ("state = running" not in r.stdout and "last exit code" in r.stdout)


def self_test():
    me = [sys.executable, os.path.abspath(__file__), "--"]
    fails = 0

    def check(name, ok, detail=""):
        nonlocal fails
        print(("PASS " if ok else "FAIL ") + name + (f" -- {detail}" if detail and not ok else ""))
        fails += 0 if ok else 1

    r = subprocess.run(me + ["sh", "-c", "echo out; echo err >&2; pwd; echo $FG_PROBE; exit 7"],
                       capture_output=True, text=True, env={**os.environ, "FG_PROBE": "probe-42"}, cwd="/tmp")
    check("rc passes through", r.returncode == 7, f"rc={r.returncode} err={r.stderr!r}")
    check("stdout and stderr streamed", "out" in r.stdout and "err" in r.stdout, repr(r.stdout))
    check("cwd kept", "/tmp" in r.stdout or "/private/tmp" in r.stdout, repr(r.stdout))
    check("env kept", "probe-42" in r.stdout, repr(r.stdout))
    check("no fallback taken", "running directly" not in r.stderr, r.stderr)
    r = subprocess.run(me + ["sh", "-c", "kill -TERM $$"], capture_output=True, text=True)
    check("signal rc is 128+N", r.returncode == 143, f"rc={r.returncode}")
    r = subprocess.run(me + ["no-such-command-fg"], capture_output=True, text=True)
    check("missing command -> 127", r.returncode == 127, f"rc={r.returncode} {r.stderr!r}")
    r = subprocess.run(me + ["true"], capture_output=True, text=True, env={**os.environ, "FG_EXEC": "0"})
    check("FG_EXEC=0 runs directly", r.returncode == 0)
    # TERM to the outer kills the tree; a marker file proves the inner command was really running.
    mark = os.path.join(BASE, f"selftest-{os.getpid()}")
    p = subprocess.Popen(me + ["sh", "-c", f"touch {mark}; sleep 300"])
    t0 = time.time()
    while not os.path.exists(mark) and time.time() - t0 < 20:
        time.sleep(0.2)
    p.send_signal(signal.SIGTERM)
    p.wait(timeout=30)
    time.sleep(1)
    left = subprocess.run(["pgrep", "-f", f"touch {mark}"], capture_output=True, text=True).stdout.split()
    check("TERM to outer reaps the job", os.path.exists(mark) and not left, f"left={left}")
    # TERM to the outer, the command IGNORES TERM: its grandchild must still die (heavy-run's case 4).
    os.unlink(mark)
    p = subprocess.Popen(me + ["bash", "-c", f"trap '' TERM; sleep 302 & touch {mark}; wait"],
                         env={**os.environ, "HEAVY_RUN_GRACE": "3"})
    t0 = time.time()
    while not os.path.exists(mark) and time.time() - t0 < 20:
        time.sleep(0.2)
    p.send_signal(signal.SIGTERM)
    p.wait(timeout=30)
    gone = False
    for _ in range(20):
        time.sleep(0.5)
        if not subprocess.run(["pgrep", "-f", "sleep 302"], capture_output=True).stdout:
            gone = True
            break
    check("TERM to outer: a TERM-ignoring grandchild dies too", os.path.exists(mark) and gone)
    # SIGKILL to the outer: the inner watcher must take the tree down within a few seconds.
    os.unlink(mark)
    p = subprocess.Popen(me + ["sh", "-c", f"touch {mark}; sleep 301"])
    t0 = time.time()
    while not os.path.exists(mark) and time.time() - t0 < 20:
        time.sleep(0.2)
    p.kill()
    p.wait()
    gone = False
    for _ in range(30):
        time.sleep(0.5)
        if not subprocess.run(["pgrep", "-f", f"touch {mark}; sleep 301"], capture_output=True).stdout:
            gone = True
            break
    check("SIGKILL to outer: inner reaps the tree", os.path.exists(mark) and gone)
    try:
        os.unlink(mark)
    except FileNotFoundError:
        pass
    subprocess.run(me + ["true"])  # its sweep removes the SIGKILLed run's leftovers
    def dead(n):  # a dir whose owner lives is someone's run in progress, not a leftover
        try:
            os.kill(int(n.split(".")[3]), 0)
            return False
        except (ProcessLookupError, ValueError, IndexError):
            return True
        except PermissionError:
            return False
    stale = [n for n in os.listdir(BASE) if n.startswith("com.marveen.fg.") and dead(n)]
    print(f"{'FAIL' if fails else 'OK'}: {fails} failed; leftover job dirs: {len(stale)}")
    return 1 if fails else 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["--inner"]:
        inner(int(a[1]), a[2])
        sys.exit(0)
    if a[:1] == ["--self-test"]:
        sys.exit(self_test())
    if a[:1] == ["--"]:
        a = a[1:]
    if not a:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    sys.exit(outer(a))
