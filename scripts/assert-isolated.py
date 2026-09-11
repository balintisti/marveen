#!/usr/bin/env python3
"""Prove a probe's isolation BEFORE you believe its result. Card b786b93b.

Stdlib only. Wraps a command:  assert-isolated.py --scratch DIR --live DIR [...] -- CMD...

WHAT WENT WRONG, AND WHY "READ THE VARIABLE" IS NOT THE FIX. On 2026-09-11 I measured
whether a hook would fire in a worker session. I redirected its state with
CHANNEL_STATE_DIR; the hook reads TELEGRAM_STATE_DIR. The redirect never took, the run
used the LIVE channel directory, and it made a real outbound API call. Zero damage --
the guessed chat did not exist -- but the difference between that and a message landing
in the owner's chat was luck, not care. "Read the variable next time" is an intention.
This is a mechanism.

THE DECISIVE POINT IS NOT THE OUTBOUND CALL, IT IS WHAT I CONCLUDED FROM THE OUTPUT.
My isolated run produced ZERO files in the scratch directory, and I read that as "the
hook stayed silent" -- the answer I was looking for. It is BYTE-IDENTICAL to "the
redirect never took, so nothing could have appeared there". An unisolated test looks
exactly like an isolated one: it runs, it returns, its output parses.

    scratch untouched + live untouched  ->  "the subject did nothing"        <- what I read
    scratch untouched + live WRITTEN    ->  "the subject wrote somewhere else"
    and from the scratch directory alone these two are the same picture

SO THE ASSERTION IS POSITIVE, NOT NEGATIVE. It is not enough that the live location was
not touched; the SCRATCH location must show that it WAS. A redirect that took leaves a
trace where it was pointed. One that silently failed leaves the scratch empty -- and that
is the state this tool refuses to call isolated.

THREE OUTCOMES, NEVER TWO -- the middle one is the whole point:

    0  ISOLATED        live unchanged AND scratch shows activity
    3  BROKEN          the live location CHANGED -> stop, the probe touched real state
    4  NOT PROVEN      live unchanged AND scratch unchanged -> the redirect may never have
                       taken. NOT a pass. Any negative from the probe is uninterpretable,
                       because "did nothing" and "did it elsewhere" are indistinguishable.

WHAT THIS CANNOT DO, stated because a guard that oversells is worse than none. The fleet
runs while you measure, so ANOTHER process may write to a live directory during the
window. This tool reports that as BROKEN and names the files, but it CANNOT prove the
probe caused it. That error direction is the safe one -- it stops a probe that might be
fine, rather than blessing one that is not -- and the report says so rather than implying
attribution it does not have.

IT ALSO DOES NOT CHECK WHICH VARIABLE YOU SET. It checks the only thing that matters at
the end: where the bytes went.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

ISOLATED, BROKEN, NOT_PROVEN = 0, 3, 4


def fingerprint(path):
    """-> {relpath: (size, mtime_ns)} for every file under `path`, or {} if absent.

    A missing directory fingerprints as empty, which is correct for BOTH arguments:
    a scratch dir the command is expected to create, and a live dir that does not exist
    on this machine. It is the CHANGE that carries meaning, not the contents.
    """
    out = {}
    if not os.path.isdir(path):
        return out
    for root, _dirs, files in os.walk(path):
        for name in files:
            full = os.path.join(root, name)
            try:
                st = os.stat(full)
            except OSError:
                # A file that vanished mid-walk is itself a change; record it as such
                # rather than skipping it silently.
                out[os.path.relpath(full, path)] = ("GONE", 0)
                continue
            out[os.path.relpath(full, path)] = (st.st_size, st.st_mtime_ns)
    return out


def diff(before, after):
    """-> sorted list of (relpath, what) describing every difference."""
    changes = []
    for k in sorted(set(before) | set(after)):
        b, a = before.get(k), after.get(k)
        if b == a:
            continue
        if b is None:
            changes.append((k, "uj"))
        elif a is None:
            changes.append((k, "torolve"))
        else:
            changes.append((k, "modosult"))
    return changes


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Run a command and prove it wrote to the scratch location, not the live one.",
    )
    ap.add_argument("--scratch", required=True,
                    help="the location the probe is supposed to write to; it MUST show activity")
    ap.add_argument("--live", action="append", required=True, metavar="DIR",
                    help="a location that must NOT change (repeatable)")
    ap.add_argument("--allow-empty-scratch", action="store_true",
                    help="accept an untouched scratch location. ONLY for a probe whose whole "
                         "point is that it writes nothing anywhere -- and then the isolation "
                         "is NOT proven by this run, which the output still says.")
    ap.add_argument("cmd", nargs=argparse.REMAINDER,
                    help="-- followed by the command to run")
    args = ap.parse_args(argv)

    cmd = args.cmd[1:] if args.cmd and args.cmd[0] == "--" else args.cmd
    if not cmd:
        print("nincs futtatando parancs (a `--` utan add meg)", file=sys.stderr)
        return 2

    scratch = os.path.expanduser(args.scratch)
    lives = [os.path.expanduser(p) for p in args.live]
    for p in lives:
        if os.path.realpath(p) == os.path.realpath(scratch):
            print(f"a scratch es az eles hely UGYANAZ: {p} -- ez nem izolacio", file=sys.stderr)
            return 2

    before_live = {p: fingerprint(p) for p in lives}
    before_scratch = fingerprint(scratch)

    proc = subprocess.run(cmd)

    after_live = {p: fingerprint(p) for p in lives}
    after_scratch = fingerprint(scratch)

    live_changes = {p: diff(before_live[p], after_live[p]) for p in lives}
    live_changes = {p: c for p, c in live_changes.items() if c}
    scratch_changes = diff(before_scratch, after_scratch)

    print(f"\nIZOLACIO-ELLENORZES (a parancs kilepesi kodja: {proc.returncode})", file=sys.stderr)
    for p in lives:
        n = len(live_changes.get(p, []))
        print(f"  eles   {p}: {n} valtozas", file=sys.stderr)
    print(f"  scratch {scratch}: {len(scratch_changes)} valtozas", file=sys.stderr)

    if live_changes:
        print("\n  IZOLACIO MEGTORT -- a parancs ELES allapotot erintett:", file=sys.stderr)
        for p, ch in live_changes.items():
            for name, what in ch[:10]:
                print(f"    {p}/{name}  [{what}]", file=sys.stderr)
            if len(ch) > 10:
                print(f"    ... es meg {len(ch) - 10}", file=sys.stderr)
        # The limit is stated instead of implied: attribution is not proven.
        print("  A FLOTTA KOZBEN FUT, tehat azt NEM allitom, hogy ezt a parancs okozta --", file=sys.stderr)
        print("  csak azt, hogy a meres ablakaban valtozott, tehat a futas eredmenye nem", file=sys.stderr)
        print("  ertelmezheto izolaltkent. A tevedes iranya szandekosan a leallitas fele van.", file=sys.stderr)
        return BROKEN

    if not scratch_changes and not args.allow_empty_scratch:
        print("\n  AZ IZOLACIO NEM BIZONYITOTT -- a scratch hely ERINTETLEN.", file=sys.stderr)
        print("  Ez NEM sikeres futas. Ha az atiranyitas nem fogott (rossz valtozo-nev,", file=sys.stderr)
        print("  elgepeles, a program mas kulcsot olvas), a scratch pontosan igy nez ki --", file=sys.stderr)
        print("  es akkor a parancs barmelyik NULLA eredmenye ertelmezhetetlen: a `nem", file=sys.stderr)
        print("  csinalt semmit` es a `mashol csinalta` innen nezve azonos.", file=sys.stderr)
        return NOT_PROVEN

    if not scratch_changes:
        print("\n  IZOLALT (eles erintetlen), DE a scratch is erintetlen: az --allow-empty-scratch", file=sys.stderr)
        print("  miatt ez atmegy. Ez a futas tehat NEM bizonyitja, hogy az atiranyitas fogott.", file=sys.stderr)
        return ISOLATED

    print("\n  IZOLALT: az eles helyek valtozatlanok, es a scratch hely AKTIVITAST mutat", file=sys.stderr)
    print("  -- vagyis az atiranyitas tenylegesen fogott.", file=sys.stderr)
    return ISOLATED


if __name__ == "__main__":
    sys.exit(main())
