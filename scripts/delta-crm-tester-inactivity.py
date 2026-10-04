#!/usr/bin/env python3
"""Tell Isti when a Delta-CRM tester company has not used the CRM for 7 days.

Card 4008ea30 (Isti 4407, 2026-09-29: "7 nap belepes nelkul szolunk Istinek";
no automatic mail to the customer, Isti calls them himself).

WHERE THE DATA COMES FROM, and why not the CRM API: the admin endpoints want a
super-admin JWT, i.e. Isti's own login, which a robot must not hold. The nightly
backup (scripts/delta-crm-backup.sh, 03:30) is a verified dump of the same
tables, already on this machine. So this reads the newest local dump: no
production connection, no new credential, data at most a day old -- plenty for
a 7-day threshold.

THE SIGNAL, per company: max(User.lastLoginAt, Session.lastActivityAt). The
login alone would miss a user who stays signed in on a refresh token and works
every day; Session.lastActivityAt is touched by jwt.strategy on authenticated
requests. A company nobody ever signed into counts from its createdAt.

THE POPULATION: every company not marked E2E/SEED/DEMO (Organization.provenance,
set by an admin, never inferred -- card fedd2d7f). An UNCLASSIFIED one is in,
and the alert says so: a mislabel must not hide a real tester.

NO SILENT ALL-CLEAR: if the newest dump is older than MAX_DUMP_AGE_H, or cannot
be read, the run alerts that the signal is UNKNOWN instead of reporting that
everybody is active.

ONE ALERT PER LAPSE: a company is announced once when it crosses the threshold,
and again only after it came back and lapsed anew. The state is written only
after the alert went out, so a failed delivery is retried on the next run.

  python3 scripts/delta-crm-tester-inactivity.py            # the launchd run
  python3 scripts/delta-crm-tester-inactivity.py --dry-run  # print, send nothing
"""
import datetime
import glob
import json
import os
import subprocess
import sys
import time
import urllib.request

DUMP_DIR = os.environ.get("TI_DUMP_DIR", "/Users/isti/Backups/delta-crm")
PG_RESTORE = os.environ.get("TI_PG_RESTORE", "/opt/homebrew/opt/libpq/bin/pg_restore")
STATE_FILE = os.environ.get("TI_STATE_FILE", "/Users/isti/marveen/store/tester-inactivity-state.json")
LOG_FILE = os.environ.get("TI_LOG_FILE", os.path.join(DUMP_DIR, "tester-inactivity.log"))
NOTIFY_SCRIPT = os.environ.get("TI_NOTIFY_SCRIPT", "/Users/isti/marveen/scripts/notify.sh")
KANBAN_URL = os.environ.get("TI_KANBAN_URL", "http://localhost:3420/api/kanban")
TOKEN_FILE = os.environ.get("TI_TOKEN_FILE", "/Users/isti/marveen/store/.dashboard-token")
THRESHOLD_DAYS = int(os.environ.get("TI_THRESHOLD_DAYS", "7"))
MAX_DUMP_AGE_H = int(os.environ.get("TI_MAX_DUMP_AGE_H", "26"))
NOT_REAL = ("E2E", "SEED", "DEMO")
NULL = "\\N"


def log(msg):
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_FILE, "a", encoding="utf-8") as fh:
        fh.write(f"{stamp} {msg}\n")


def parse_ts(value):
    """A dump timestamp (UTC, 'YYYY-MM-DD HH:MM:SS[.fff]') or None."""
    if not value or value == NULL:
        return None
    return datetime.datetime.strptime(value[:19], "%Y-%m-%d %H:%M:%S")


def read_tables(dump, names):
    """The COPY data of `names` from a custom-format dump, as lists of dicts."""
    args = [PG_RESTORE, "-f", "-", "--data-only"]
    for n in names:
        args += ["-t", n]
    # utf-8 explicitly, because the dump IS utf-8 whatever the environment says.
    # Not a fix: measured with `env -i`, /usr/bin/python3 (3.9) enters UTF-8 mode
    # under the C locale and decodes the same way.
    out = subprocess.run(args + [dump], capture_output=True, check=True).stdout.decode("utf-8")
    tables, cur = {n: None for n in names}, None
    for line in out.split("\n"):
        if line.startswith("COPY public."):
            name = line.split()[1].split(".", 1)[1].strip('"')
            cols = [c.strip().strip('"') for c in line[line.index("(") + 1:line.index(")")].split(",")]
            cur = (name, cols)
            tables[name] = []
        elif cur is not None and line == "\\.":
            cur = None
        elif cur is not None:
            tables[cur[0]].append(dict(zip(cur[1], line.split("\t"))))
    missing = [n for n, rows in tables.items() if rows is None]
    if missing:
        raise RuntimeError(f"a dumpban nincs tabla: {', '.join(missing)}")
    return tables


def last_seen(tables):
    """Per company: id -> (name, provenance, last seen, ever active?)."""
    seen = {}
    for u in tables["User"]:
        t = parse_ts(u.get("lastLoginAt"))
        if t and u.get("deletedAt", NULL) == NULL:
            org = u["organizationId"]
            seen[org] = max(seen.get(org, t), t)
    for s in tables["Session"]:
        t = parse_ts(s.get("lastActivityAt"))
        if t:
            org = s["organizationId"]
            seen[org] = max(seen.get(org, t), t)
    result = {}
    for o in tables["Organization"]:
        if o.get("deletedAt", NULL) != NULL or o.get("provenance") in NOT_REAL:
            continue
        provenance = None if o.get("provenance", NULL) == NULL else o["provenance"]
        active = o["id"] in seen
        result[o["id"]] = (o.get("name", "?"), provenance,
                           seen[o["id"]] if active else parse_ts(o.get("createdAt")), active)
    return result


def decide(companies, state, now, threshold_days=THRESHOLD_DAYS):
    """Pure: which companies to announce now, and the state to keep.

    `state` maps company id -> the last-seen ISO string it was announced for.
    A company is announced when it is past the threshold and was not already
    announced for the same last-seen moment; a company back under the threshold
    is dropped from the state, so its next lapse is announced again.
    """
    alerts, new_state = [], {}
    limit = datetime.timedelta(days=threshold_days)
    for cid, (name, provenance, seen, active) in sorted(companies.items(), key=lambda kv: kv[1][0]):
        if seen is None or now - seen < limit:
            continue
        key = seen.isoformat()
        new_state[cid] = key
        if state.get(cid) != key:
            alerts.append((cid, name, provenance, seen, active, (now - seen).days))
    return alerts, new_state


def save_state(state):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh)
    os.replace(tmp, STATE_FILE)


def notify(text):
    r = subprocess.run(["bash", NOTIFY_SCRIPT, text], capture_output=True)
    if r.returncode != 0:
        err = (r.stdout + r.stderr).decode("utf-8", "replace").strip()[:200]
        raise RuntimeError(f"notify.sh rc={r.returncode}: {err}")


def open_card(title, description):
    token = open(TOKEN_FILE).read().strip()
    body = json.dumps({"title": title, "description": description, "status": "planned",
                       "assignee": "marveen", "priority": "normal", "project": "delta-crm"}).encode()
    req = urllib.request.Request(KANBAN_URL, data=body, method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode() or "{}")
        if resp.status not in (200, 201) or not data.get("id"):
            raise RuntimeError(f"kanban HTTP {resp.status}, id={data.get('id')}")
        return data["id"]


def message(name, provenance, seen, active, days):
    label = "jelöletlen" if provenance is None else provenance
    if not active:
        return (f"Tesztelő cég inaktív: {name} ({label}) a létrehozása óta ({seen.strftime('%Y-%m-%d')}, "
                f"{days} napja) senki nem lépett be. Forrás: az éjszakai mentés.")
    return (f"Tesztelő cég inaktív: {name} ({label}) {days} napja nem használta a CRM-et "
            f"(utolsó aktivitás: {seen.strftime('%Y-%m-%d')}). Forrás: az éjszakai mentés.")


def main(argv):
    dry = "--dry-run" in argv
    now = datetime.datetime.utcnow()
    if os.environ.get("TI_NOW"):
        now = datetime.datetime.strptime(os.environ["TI_NOW"], "%Y-%m-%d %H:%M:%S")
    dumps = sorted(glob.glob(os.path.join(DUMP_DIR, "delta-crm-*-public.dump")))
    try:
        if not dumps:
            raise RuntimeError(f"nincs dump itt: {DUMP_DIR}")
        dump = dumps[-1]
        age_h = (time.time() - os.path.getmtime(dump)) / 3600   # the wall clock, never TI_NOW
        if age_h > MAX_DUMP_AGE_H:
            raise RuntimeError(f"a legfrissebb dump {age_h:.0f} oras ({os.path.basename(dump)})")
        companies = last_seen(read_tables(dump, ["Organization", "User", "Session"]))
    except Exception as exc:  # the signal is unknown -- say so, never "all active"
        text = f"Tesztelő-aktivitás jel ISMERETLEN: {exc}"
        log(f"UNKNOWN {exc}")
        if dry:
            print(text)
            return 1
        notify(text)
        return 1

    try:
        state = json.load(open(STATE_FILE, encoding="utf-8"))
    except FileNotFoundError:
        state = {}
    alerts, new_state = decide(companies, state, now)
    log(f"RUN {os.path.basename(dump)} companies={len(companies)} inactive={len(new_state)} new_alerts={len(alerts)}")
    for cid, name, provenance, seen, active, days in alerts:
        text = message(name, provenance, seen, active, days)
        if dry:
            print(text)
            continue
        notify(text)
        card = open_card(f"Tesztelő cég {days} napja inaktív: {name}",
                         text + " Isti hívja fel (nincs automatikus levél). Kártya: 4008ea30.")
        log(f"ALERT {cid} days={days} card={card}")
        # written after EACH delivered alert, so a later failure does not re-send this one
        state[cid] = new_state[cid]
        save_state(state)
    if not dry:
        save_state(new_state)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
