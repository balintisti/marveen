#!/usr/bin/env python3
"""Daily garbage collection for two development accumulators that nothing ever cleaned.

WHY (card 251b5785, didi's measurement 2026-09-26 04:16): the disk lost ~52 GiB in one
working day and stood at 98%. There was no runaway process; there were several
accumulators with no collector at all. Two of them are pure development artefacts and are
collected here:

    jest transform cache (`jest_dx`) .... 7.2 GiB, ~305 000 files, $TMPDIR and /private/tmp
    `crm_e2e_<agent>_<suffix>` DBs ...... 233 databases / 5.0 GB, ~20 MB left by EVERY e2e
                                          run, because the DB gate refused DROP DATABASE

The others on that list (worktrees, the npm cache, transcripts) are NOT collected here:
a worktree can hold unmerged work, and the rest are either regenerable on demand or not
ours to delete. Those are per-owner decisions on the card.

WHAT MAKES EACH HALF SAFE, AND IT IS A CONJUNCTION, NOT A HEURISTIC:

  jest_dx   files only, older than --max-age-hours (default 24), and only inside a
            directory literally named `jest_dx` whose real path is under /private/tmp or
            /private/var/folders. A running jest touches its cache files, so a 24-hour
            floor cannot pull a file out from under a live run. Empty directories are
            removed with rmdir, which refuses a non-empty one by itself.

  e2e DBs   the name must pass the SAME `E2E_DB_NAME` the DB gate uses (explicit agent
            list, suffix required -- so the `crm_e2e_didi` baseline and the SHARED
            `crm_e2e_test` are structurally out of reach); no connection in
            pg_stat_activity; and the NEWEST file under $PGDATA/base/<oid> older than the
            floor. pg_database has NO creation time, so this is "last written", which is
            the right meaning: a database somebody used today is not garbage.
            THE COMMAND GOES THROUGH THE GATE: it is built, then handed to the gate's own
            verdict(), and it runs only if the verdict is the e2e carve-out. A launchd job
            never passes the PreToolUse hook, so without this step the job would be the
            one path around the rule it was built under.

Plain `dropdb` without --force: if a session connects between the check and the drop,
the drop fails loudly and the database stays. That is the intended direction.

    python3 scripts/dev-gc.py --dry-run     # what would go, deletes nothing
    python3 scripts/dev-gc.py               # the launchd job (com.marveen.dev-gc)

Exit 1 when the database half could not ask the server (the jest half still runs): a
collector that silently skipped would look exactly like one with nothing to collect.
"""
import argparse
import importlib.util
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
GATE_PATH = os.path.join(HERE, "hooks", "db-destructive-gate.py")
JEST_ROOTS_ALLOWED = ("/private/tmp/", "/private/var/folders/")


def load_gate():
    spec = importlib.util.spec_from_file_location("db_gate", GATE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def default_jest_dirs():
    tmp = os.environ.get("TMPDIR") or ""
    if not tmp:
        try:
            tmp = subprocess.run(["getconf", "DARWIN_USER_TEMP_DIR"], capture_output=True,
                                 text=True, timeout=10).stdout.strip()
        except Exception:
            tmp = ""
    dirs = ["/private/tmp/jest_dx"]
    if tmp:
        dirs.insert(0, os.path.join(tmp, "jest_dx"))
    return dirs


def jest_dir_is_allowed(path):
    real = os.path.realpath(path)
    return os.path.basename(real) == "jest_dx" and real.startswith(JEST_ROOTS_ALLOWED)


def collect_jest(dirs, max_age_s, now, dry_run):
    """Returns (files_removed, bytes_removed, refused_dirs)."""
    files = size = 0
    refused = []
    for d in dirs:
        if not os.path.isdir(d):
            continue
        if not jest_dir_is_allowed(d):
            refused.append(d)
            continue
        for root, subdirs, names in os.walk(d, topdown=False, followlinks=False):
            for n in names:
                p = os.path.join(root, n)
                try:
                    st = os.lstat(p)
                except OSError:
                    continue
                if now - st.st_mtime < max_age_s:
                    continue
                if not dry_run:
                    try:
                        os.unlink(p)
                    except OSError:
                        continue
                files += 1
                size += st.st_blocks * 512
            if root != d and not dry_run:
                try:
                    if now - os.lstat(root).st_mtime >= max_age_s:
                        os.rmdir(root)  # refuses a non-empty directory by itself
                except OSError:
                    pass
    return files, size, refused


def newest_mtime(path):
    """Newest mtime of the directory and the files directly in it; None if unreadable."""
    try:
        newest = os.stat(path).st_mtime
        with os.scandir(path) as it:
            for e in it:
                try:
                    newest = max(newest, e.stat(follow_symlinks=False).st_mtime)
                except OSError:
                    continue
        return newest
    except OSError:
        return None


def plan_db(rows, data_dir, now, max_age_s, gate, env, mtime_of=newest_mtime):
    """rows: [(oid, name, active_connections)]. Returns (to_drop, skipped{reason: [names]}).
    Pure apart from mtime_of, so the whole selection is testable without a server."""
    to_drop, skipped = [], {}

    def skip(reason, name):
        skipped.setdefault(reason, []).append(name)

    for oid, name, conns in rows:
        if not gate.E2E_DB_NAME.fullmatch(name):
            skip("name", name)
            continue
        if conns:
            skip("active", name)
            continue
        m = mtime_of(os.path.join(data_dir, "base", str(oid)))
        if m is None:
            skip("age-unknown", name)
            continue
        if now - m < max_age_s:
            skip("young", name)
            continue
        cmd = ["dropdb", "-h", "localhost", "--if-exists", name]
        kind, _ = gate.verdict(" ".join(cmd), env)
        if kind != "e2e":
            skip("gate", name)
            continue
        to_drop.append((name, cmd))
    return to_drop, skipped


def query_rows(psql, env):
    sql = ("select current_setting('data_directory'); "
           "select d.oid, d.datname, (select count(*) from pg_stat_activity a where a.datid = d.oid) "
           "from pg_database d where d.datname like 'crm\\_e2e\\_%' order by d.datname")
    r = subprocess.run([psql, "-h", "localhost", "-X", "-q", "-At", "-F", "\t", "-d", "postgres",
                        "-c", sql], capture_output=True, text=True, env=env, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or "psql rc=%d" % r.returncode)
    lines = [ln for ln in r.stdout.splitlines() if ln.strip()]
    data_dir = lines[0].strip()
    rows = []
    for ln in lines[1:]:
        oid, name, conns = ln.split("\t")
        rows.append((int(oid), name, int(conns)))
    return data_dir, rows


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-age-hours", type=float, default=24.0)
    ap.add_argument("--jest-dir", action="append", help="override the jest_dx dirs (tests)")
    ap.add_argument("--skip-db", action="store_true", help="jest half only (tests)")
    a = ap.parse_args(argv)
    if a.max_age_hours < 1:
        print("ERROR: --max-age-hours below 1 would reach a live run; refusing")
        return 2
    now, max_age_s = time.time(), a.max_age_hours * 3600
    tag = "DRY-RUN " if a.dry_run else ""
    stamp = time.strftime("%Y-%m-%d %H:%M:%S %Z")

    files, size, refused = collect_jest(a.jest_dir or default_jest_dirs(), max_age_s, now, a.dry_run)
    print("%s %sjest_dx: %d files, %.2f GiB%s" % (
        stamp, tag, files, size / 2**30, (" | REFUSED dirs: %s" % refused) if refused else ""))

    if a.skip_db:
        return 0
    # The psql variables that could point the job elsewhere are dropped; the job talks
    # to localhost only, and the gate re-checks that against this same env.
    env = {k: v for k, v in os.environ.items()
           if k not in ("PGHOST", "PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGDATABASE")}
    env["PATH"] = "/opt/homebrew/bin:" + env.get("PATH", "/usr/bin:/bin")
    psql = shutil.which("psql", path=env["PATH"])
    dropdb = shutil.which("dropdb", path=env["PATH"])
    if not psql or not dropdb:
        print("%s ERROR: psql/dropdb not found on %s" % (stamp, env["PATH"]))
        return 1
    try:
        data_dir, rows = query_rows(psql, env)
    except Exception as exc:
        print("%s ERROR: could not list databases: %s" % (stamp, exc))
        return 1
    gate = load_gate()
    to_drop, skipped = plan_db(rows, data_dir, now, max_age_s, gate, env)
    dropped, failed = 0, []
    for name, cmd in to_drop:
        if a.dry_run:
            continue
        r = subprocess.run([dropdb] + cmd[1:], capture_output=True, text=True, env=env, timeout=120)
        if r.returncode == 0:
            dropped += 1
        else:
            failed.append("%s: %s" % (name, r.stderr.strip()[:120]))
    print("%s %se2e DBs: listed %d, %s %d, skipped %s%s" % (
        stamp, tag, len(rows), "would drop" if a.dry_run else "dropped",
        len(to_drop) if a.dry_run else dropped,
        {k: len(v) for k, v in sorted(skipped.items())},
        (" | FAILED: %s" % failed) if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
