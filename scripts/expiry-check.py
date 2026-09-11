#!/usr/bin/env python3
"""Ask every credential in scripts/expiry-inventory.json when it expires.

Card b91eb75f. Stdlib only -- no jq, no third-party imports.

WHY THIS EXISTS AT ALL. friday's SOUL.md has carried this as a STANDING duty since
the day he was created: "A hozzaferes lejar, es en tudom, mikor. [...] Ha valami ket
heten belul lejar, szolok, mielott lejar, nem utana." Measured 2026-09-10 by marveen:
zero expiry-watching files in the repo, zero of the (then) 17 scheduled tasks. The
duty was DECLARED and nothing executed it. Re-measured 2026-09-11 at 18 tasks: still
zero -- the single grep hit is crm-smoke-teszt asserting a 403 SUBSCRIPTION_EXPIRED
CRM response, which is not an expiry watcher. The measured price: the TACIT session
died 2026-08-07 and Isti noticed on 09-08, thirty days later.

WHY FIVE OUTCOMES AND NOT TWO. The failure this card documents is not "a date passed
and nobody looked". It is that a thing which was never measurable looked exactly like
a thing that was fine. So the two are kept apart by construction:

    DUE        a queried date inside the threshold, or already past   -> act
    OK         a queried date beyond the threshold                    -> nothing to do
    NO_EXPIRY  measured, and the source says there is no expiry        -> nothing to do
    UNKNOWN    declared not queryable, with the reason                 -> THE FINDING
    FAILED     the probe ran and could not answer                      -> THE FINDING

WHY A FAILED PROBE IS NOT 'NO EXPIRY'. A command that errors, returns non-JSON, or
returns JSON without the named path tells us nothing about the credential. Folding
that into "no expiry" would manufacture a green from an absence -- the exact shape
this repo keeps measuring: an empty result reading as a negative answer. FAILED is
therefore louder than OK and is counted with UNKNOWN.

WHY THE SUMMARY CANNOT SAY 'ALL CLEAR' WHILE ANYTHING IS UNMEASURED. A checker whose
headline collapses "I looked and it is fine" into the same sentence as "I could not
look" is worse than no checker, because it converts a gap into a reassurance. The
summary prints the unmeasured count unconditionally, and the exit code is non-zero
whenever it is not zero.

WHY --quiet-unless-changed EXISTS, AND WHY THE SILENCE HAS A CEILING. Run daily,
this checker would report the same expired TACIT session and the same two
unmeasurable items every morning forever. This repo has measured what happens to a
guard that always fires: it becomes wallpaper, and a permanently-firing guard is
indistinguishable in practice from a disabled one. So the scheduled path reports on
CHANGE. The obvious danger is the mirror image -- a state file that silently
suppresses a real expiry -- so the silence cannot last: past max_silence_days the
report is forced regardless, a missing or unreadable state file reports, and every
suppressed run still PRINTS the full table and says out loud that it is suppressing
and until when. Silence here is always visible and always bounded.

An item that stays DUE for weeks is not a notification problem, it is an unactioned
one, and this repo's own rule sends that to a card -- which does not queue and is not
re-read every turn -- not to a daily ping.

AND THE SIXTH STATE, WHICH THE FIVE ABOVE CANNOT SEPARATE (didi, 2026-09-11). Those five
partition WHAT WE ASKED ABOUT. A credential that EXISTS and is not on the list yields no
DUE, no UNKNOWN, no FAILED -- it yields NOTHING, and therefore looks exactly like a healthy
one. That is this file's opening sentence, one level in, and it landed on the file itself.

    NOT_IN_INVENTORY   a file sits in a declared credential location and no item claims it

The inventory's `scan` section names locations where a file's EXISTENCE is by itself enough
to make it a fleet credential; every item may declare `covers` for the paths it accounts
for. Anything seen and unclaimed is reported. Measured when this was written: the inventory's
own directory held two files and the inventory named one.

A SWEEP THAT SWEEPS NOTHING LOOKS EXACTLY LIKE A CLEAN SWEEP, so a scan entry whose
directory is missing is reported as FAILED rather than contributing a silent zero. Rename
the directory and this gate would otherwise go quiet in the reassuring direction -- the same
shape it exists to catch.

AND THE SCOPE IS DELIBERATELY NARROW, which is a limit, not an oversight: this is NOT a
machine-wide credential census. Other tools' own credentials are out of scope, and whether
they belong here is a SCOPE DECISION rather than a measurement. The report therefore always
prints what it swept -- a completeness claim without its denominator would repeat the error
it fixes.

EXIT CODES (the worst state wins; everything is still printed):
    0  every item answered, nothing inside the threshold, nothing unclaimed
    3  at least one DUE (expired, or expiring within threshold_days)
    5  nothing due, but something EXISTS that the inventory does not name
    4  nothing due and nothing unclaimed, but at least one UNKNOWN or FAILED
    2  the inventory itself could not be read (usage/parse error)

WHY 5 OUTRANKS 4 AND BOTH SIT UNDER 3. A DUE item is a concrete fact about the system, so it
leads. Between the other two: an UNKNOWN is a declared gap we chose to carry, while a
NOT_IN_INVENTORY means the POPULATION is wrong -- every other number in the report is
conditional on a list that has just been shown to be incomplete.

THIS SCRIPT NEVER HANDLES SECRET VALUES. Probes read one named field out of a
command's output. Nothing it prints is derived from a credential's value.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_INVENTORY = os.path.join(HERE, "expiry-inventory.json")
PROBE_TIMEOUT = 30  # seconds; `timeout(1)` does not exist on this machine
MAX_SILENCE_DAYS = 7  # --quiet-unless-changed can never hold its tongue longer

DUE, OK, NO_EXPIRY, UNKNOWN, FAILED = "DUE", "OK", "NO_EXPIRY", "UNKNOWN", "FAILED"
UNLISTED = "NOT_IN_INVENTORY"
NEEDS_ATTENTION = (UNKNOWN, FAILED)


def _expand(x):
    return os.path.expanduser(os.path.expandvars(x))


def _run(cmd, timeout=PROBE_TIMEOUT):
    """Run a probe. Returns (rc, stdout, stderr) or raises nothing."""
    try:
        p = subprocess.run(
            [_expand(c) for c in cmd],
            capture_output=True, text=True, timeout=timeout,
        )
        return p.returncode, p.stdout, p.stderr
    except FileNotFoundError as e:
        return 127, "", f"command not found: {e}"
    except subprocess.TimeoutExpired:
        return 124, "", f"probe timed out after {timeout}s"
    except OSError as e:
        return 126, "", f"{type(e).__name__}: {e}"


def _dig(obj, dotted):
    for part in dotted.split("."):
        if not isinstance(obj, dict) or part not in obj:
            return None
        obj = obj[part]
    return obj


def _parse_iso(s):
    """Parse an ISO-8601 instant into an aware UTC datetime, or None."""
    if not isinstance(s, str) or not s.strip():
        return None
    t = s.strip().replace("Z", "+00:00")
    try:
        d = dt.datetime.fromisoformat(t)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(dt.timezone.utc)


# --- probe kinds -----------------------------------------------------------

def probe_json_cmd(spec):
    rc, out, err = _run(spec["cmd"])
    # NOTE: rc is deliberately not a gate here. `tacit-assistant doctor` exits 0
    # with ok:false, and other CLIs exit non-zero while still printing usable
    # JSON. The parse is the gate; a bad rc only colours the error message.
    try:
        data = json.loads(out)
    except (ValueError, TypeError):
        return FAILED, None, f"probe returned non-JSON (rc={rc}) {(err or out).strip()[:120]}"
    raw = _dig(data, spec["path"])
    if raw is None:
        return FAILED, None, f"path {spec['path']!r} missing from probe output (rc={rc})"
    when = _parse_iso(raw)
    if when is None:
        return FAILED, None, f"path {spec['path']!r} is not an ISO-8601 instant: {str(raw)[:40]!r}"
    return None, when, ""


def probe_http_header(spec):
    rc, out, err = _run(spec["cmd"])
    if rc != 0 and not out:
        return FAILED, None, f"probe failed (rc={rc}) {err.strip()[:120]}"
    want = spec["header"].lower()
    for line in out.splitlines():
        if line.lower().startswith(want + ":"):
            value = line.split(":", 1)[1].strip()
            if not value:
                # Header present but empty: that is an answer we cannot use.
                return FAILED, None, f"header {spec['header']!r} present but empty"
            when = _parse_iso(value.replace(" UTC", "+00:00").replace(" ", "T", 1))
            if when is None:
                return FAILED, None, f"header {spec['header']!r} unparseable: {value[:40]!r}"
            return None, when, ""
    # Header absent. Deliberately reported as NO_EXPIRY with the weaker wording
    # "no expiry reported" rather than "never expires" -- see the inventory trap.
    return NO_EXPIRY, None, f"no {spec['header']} header in the response"


def probe_gcloud_sa_key(spec):
    """Expiry of the service account key THAT IS ACTUALLY IN USE.

    The account may carry several keys. Matching on private_key_id from the key
    file is the whole point: measured 2026-09-11, the key in use never expires
    while two sibling keys expire in 2028, so a probe that took the first listed
    key would report a real date belonging to a key nothing reads.
    """
    path = _expand(spec["key_file"])
    try:
        with open(path, encoding="utf-8") as fh:
            key = json.load(fh)
    except OSError as e:
        return FAILED, None, f"key file unreadable: {type(e).__name__}"
    except ValueError:
        return FAILED, None, "key file is not valid JSON"
    kid, email = key.get("private_key_id"), key.get("client_email")
    if not kid or not email:
        return FAILED, None, "key file has no private_key_id/client_email"
    rc, out, err = _run(
        ["gcloud", "iam", "service-accounts", "keys", "list",
         f"--iam-account={email}", "--format=json"], timeout=60,
    )
    if rc != 0:
        return FAILED, None, f"gcloud failed (rc={rc}) {err.strip()[:120]}"
    try:
        keys = json.loads(out)
    except (ValueError, TypeError):
        return FAILED, None, "gcloud returned non-JSON"
    for k in keys:
        if str(k.get("name", "")).endswith("/" + kid):
            when = _parse_iso(k.get("validBeforeTime"))
            if when is None:
                return FAILED, None, "validBeforeTime missing or unparseable"
            # Google encodes "does not expire" as the year 9999.
            if when.year >= 9999:
                return NO_EXPIRY, None, "validBeforeTime 9999 (key does not expire)"
            return None, when, ""
    return FAILED, None, f"key {kid[:8]}... not listed on {email} -- rotated or revoked?"


PROBES = {
    "json_cmd": probe_json_cmd,
    "http_header": probe_http_header,
    "gcloud_sa_key": probe_gcloud_sa_key,
}


def evaluate(item, now, threshold_days):
    """-> (state, when|None, note)"""
    spec = item.get("probe") or {}
    kind = spec.get("kind")
    if kind == "not_queryable":
        return UNKNOWN, None, spec.get("why", "declared not queryable")
    if kind == "none_by_construction":
        return NO_EXPIRY, None, spec.get("why", "no expiry by construction")
    fn = PROBES.get(kind)
    if fn is None:
        return FAILED, None, f"unknown probe kind {kind!r}"
    state, when, note = fn(spec)
    if state is not None:
        return state, when, note
    days = (when - now).days
    if days < threshold_days:
        return DUE, when, ("EXPIRED" if days < 0 else "due")
    return OK, when, ""


def _suppression(args, rows, now):
    """-> (suppress: bool, why: str). Writes the new snapshot as a side effect.

    Reports (suppress=False) on every uncertainty: no state file, unreadable state
    file, unparseable timestamp, or an age past the ceiling. The only path to
    silence is a successfully read, recent snapshot whose per-item states match.
    """
    path = getattr(args, "quiet_unless_changed", None)
    if not path:
        return False, ""
    current = {r["id"]: r["state"] for r in rows}
    # The sweep result is part of the state: a credential appearing on disk is a CHANGE,
    # and without this the daily run would report it once and then fall silent about it.
    for d in getattr(args, "_sweep_ids", []) or []:
        current[f"sweep:{d}"] = UNLISTED
    snapshot = {"checked_at": now.isoformat(), "states": current}

    previous, prev_when, reason = None, None, ""
    try:
        with open(path, encoding="utf-8") as fh:
            old = json.load(fh)
        previous = old.get("states")
        prev_when = _parse_iso(old.get("checked_at"))
    except OSError:
        reason = "nincs korabbi allapot"
    except ValueError:
        reason = "a korabbi allapot olvashatatlan"

    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(snapshot, fh, indent=2, ensure_ascii=False)
    except OSError as e:
        # Cannot remember -> must not stay silent, or the next run forgets too.
        return False, f"az allapot nem mentheto ({type(e).__name__})"

    if not isinstance(previous, dict):
        return False, reason or "nincs korabbi allapot"
    if prev_when is None:
        return False, "a korabbi idobelyeg ertelmezhetetlen"
    age_days = (now - prev_when).days
    if age_days >= args.max_silence_days:
        return False, f"a korabbi jelentes {age_days} napos"
    if previous != current:
        return False, "valtozott az allapot"
    return True, f"valtozatlan a(z) {prev_when.isoformat(timespec='seconds')} ota"


def sweep_declared_locations(inv):
    """-> (findings, swept) over the inventory's declared credential locations.

    findings: list of (kind, detail) where kind is UNLISTED or FAILED.
    swept:    list of human-readable "<dir>/<glob>: N file(s)" lines, printed ALWAYS.

    The swept list is not decoration. A completeness statement without its denominator is
    the same defect this whole file is about, so the reader is always told what was looked
    at -- and, by omission made explicit in the summary, what was not.
    """
    findings, swept = [], []
    scans = inv.get("scan") or []
    if not scans:
        return findings, swept

    claimed = set()
    for it in inv.get("items", []):
        for c in it.get("covers", []) or []:
            claimed.add(os.path.realpath(_expand(c)))

    for sc in scans:
        raw = sc.get("dir", "")
        d = _expand(raw)
        pattern = sc.get("glob", "*")
        if not os.path.isdir(d):
            # LOUD, never a silent zero: a scan over a missing directory finds nothing,
            # which is byte-identical to a scan that found everything claimed.
            findings.append((FAILED, f"a deklaralt hely NEM LETEZIK: {raw} -- a sopres nem futott le"))
            swept.append(f"{raw}/{pattern}: A KONYVTAR HIANYZIK")
            continue
        seen = sorted(glob.glob(os.path.join(d, pattern)))
        swept.append(f"{raw}/{pattern}: {len(seen)} fajl")
        for f in seen:
            if os.path.realpath(f) not in claimed:
                findings.append((UNLISTED, f"{raw}/{os.path.basename(f)}"))
    return findings, swept


def main(argv=None):
    ap = argparse.ArgumentParser(description="Report credential expiry from the inventory.")
    ap.add_argument("--inventory", default=DEFAULT_INVENTORY)
    ap.add_argument("--threshold-days", type=int, default=None,
                    help="override threshold_days from the inventory")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--now", default=None,
                    help="ISO-8601 instant to evaluate against (testing only)")
    ap.add_argument("--quiet-unless-changed", metavar="STATEFILE", default=None,
                    help="for scheduled runs: exit 0 when the per-item states are "
                         "identical to the previous run recorded in STATEFILE. The "
                         "table is still printed and the suppression is announced. "
                         f"Forced to report after {MAX_SILENCE_DAYS} days regardless.")
    ap.add_argument("--max-silence-days", type=int, default=MAX_SILENCE_DAYS,
                    help="ceiling on how long --quiet-unless-changed may stay silent")
    args = ap.parse_args(argv)

    try:
        with open(args.inventory, encoding="utf-8") as fh:
            inv = json.load(fh)
    except OSError as e:
        print(f"inventory unreadable: {args.inventory}: {e}", file=sys.stderr)
        return 2
    except ValueError as e:
        print(f"inventory is not valid JSON: {e}", file=sys.stderr)
        return 2

    items = inv.get("items")
    if not isinstance(items, list) or not items:
        print("inventory has no items -- refusing to report an empty all-clear", file=sys.stderr)
        return 2

    threshold = args.threshold_days if args.threshold_days is not None else inv.get("threshold_days", 14)
    now = _parse_iso(args.now) if args.now else dt.datetime.now(dt.timezone.utc)
    if now is None:
        print(f"--now is not an ISO-8601 instant: {args.now!r}", file=sys.stderr)
        return 2

    rows = []
    for it in items:
        state, when, note = evaluate(it, now, threshold)
        rows.append({
            "id": it.get("id", "?"),
            "what": it.get("what", ""),
            "state": state,
            "expires_at": when.isoformat() if when else None,
            "days_left": (when - now).days if when else None,
            "renewed_by": it.get("renewed_by", "?"),
            "renew": it.get("renew", ""),
            "note": note,
        })

    sweep_findings, swept = sweep_declared_locations(inv)
    unlisted = [d for k, d in sweep_findings if k == UNLISTED]
    sweep_failed = [d for k, d in sweep_findings if k == FAILED]

    due = [r for r in rows if r["state"] == DUE]
    unmeasured = [r for r in rows if r["state"] in NEEDS_ATTENTION]
    # A missing scan directory is a FAILED sweep, and it must not be quieter than an
    # unclaimed file: both mean the population cannot be trusted.
    population_broken = unlisted or sweep_failed
    rc = 3 if due else (5 if population_broken else (4 if unmeasured else 0))

    if args.json:
        print(json.dumps({
            "checked_at": now.isoformat(),
            "threshold_days": threshold,
            "total": len(rows),
            "due": len(due),
            "unmeasured": len(unmeasured),
            "unlisted": len(unlisted),
            "sweep_failed": len(sweep_failed),
            "swept": swept,
            "exit_code": rc,
            "items": rows,
        }, indent=2, ensure_ascii=False))
        return rc

    print(f"LEJARAT-ELLENORZES  {now.isoformat(timespec='seconds')}  kuszob: {threshold} nap")
    print()
    for r in rows:
        if r["state"] == DUE:
            tag = "LEJART" if (r["days_left"] or 0) < 0 else "ESEDEKES"
            when = f"{r['expires_at'][:10]}  {r['days_left']:+d} nap"
        elif r["state"] == OK:
            tag, when = "ok", f"{r['expires_at'][:10]}  {r['days_left']:+d} nap"
        elif r["state"] == NO_EXPIRY:
            tag, when = "ok", "nem jar le"
        elif r["state"] == UNKNOWN:
            tag, when = "NEM MERHETO", "-"
        else:
            tag, when = "PROBA BUKOTT", "-"
        print(f"  {tag:<13} {r['id']:<28} {when}")
        if r["state"] in NEEDS_ATTENTION or r["state"] == DUE:
            print(f"                {r['note']}")
            if r["state"] == DUE:
                print(f"                ujitja: {r['renewed_by']} -- {r['renew']}")
        print()

    args._sweep_ids = unlisted + [f"MISSING:{d}" for d in sweep_failed]
    suppress, why = _suppression(args, rows, now)

    if swept:
        print("DEKLARALT HELYEK SOPRESE (NEM gep-szintu cenzus -- csak az alabbiak):")
        for line in swept:
            print(f"  {line}")
        for kind, detail in sweep_findings:
            tag = "NINCS A LELTARBAN" if kind == UNLISTED else "A SOPRES ELBUKOTT"
            print(f"  {tag}  {detail}")
        if not sweep_findings:
            print("  minden itt talalt fajlt vallal egy leltar-tetel")
        print()

    fine = len(rows) - len(due) - len(unmeasured)
    # The unmeasured count is printed unconditionally and on its own clause: a
    # summary that can read as "all clear" while anything is unmeasured is the
    # exact failure this card is about.
    print(f"OSSZEGZES: {len(rows)} tetel | {len(due)} esedekes vagy lejart "
          f"| {len(unmeasured)} NEM MERHETO | {fine} rendben "
          f"| {len(unlisted) + len(sweep_failed)} NINCS A LELTARBAN")
    if population_broken:
        # The quotable line must carry this: every number above is conditional on a list
        # that has just been shown to be incomplete.
        print(f"           A leltar NEM TELJES -- a fenti szamok egy olyan listarol szolnak, "
              f"amirol az iment derult ki, hogy hianyzik belole valami.")
    if unmeasured:
        print(f"           A {len(unmeasured)} nem merheto tetel NEM 'rendben' -- "
              f"rola semmit nem tudunk. Ez a b91eb75f kartya harmadik resze.")
    if args.quiet_unless_changed:
        # BOTH directions are announced. Suppression must never be invisible -- but
        # neither must a REFUSAL to suppress: a checker that reports every single day
        # because it cannot write its state file looks exactly like one whose state
        # legitimately changes every day. Printing the reason is what separates them.
        if suppress:
            print(f"ELNEMITVA (--quiet-unless-changed): {why}. "
                  f"A kilepesi kod {rc} helyett 0. Kenyszeritett jelentes "
                  f"legkesobb {args.max_silence_days} nap utan.")
            return 0
        print(f"JELENTEK (--quiet-unless-changed): {why}.")
    return rc


if __name__ == "__main__":
    sys.exit(main())
