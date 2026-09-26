#!/usr/bin/env python3
"""Daily garbage collection for two development accumulators that nothing ever cleaned.

WHY (card 251b5785, didi's measurement 2026-09-26 04:16): the disk lost ~52 GiB in one
working day and stood at 98%. There was no runaway process; there were several
accumulators with no collector at all. Two of them are pure development artefacts and are
collected here:

    jest transform cache (`jest_dx`) .... 7.2 GiB, ~305 000 files, $TMPDIR and /private/tmp
    `crm_e2e_<agent>_<suffix>` DBs ...... 233 databases / 5.0 GB, ~20 MB left by EVERY e2e
                                          run, because the DB gate refused DROP DATABASE

The npm cache and the transcripts are NOT collected here: they are either regenerable on
demand or not ours to delete.

CARD 9f499b14 (2026-09-26) adds two more halves, because the disk alert came back the same
day (96%, 19 GB free) and the cause was WORKTREE CHURN, not a cache:

  compile caches  `node-compile-cache` and `v8-compile-cache-<uid>` under $TMPDIR and
            /private/tmp, capped by SIZE (--compile-cache-cap-mb, default 1024 per
            directory), oldest files first. Regenerable by node on the next start.

  worktrees REPORT-ONLY until an explicit decision (--apply-worktrees is NOT in the
            launchd plist). A linked worktree is a candidate only if ALL hold:
              - not the main checkout, exists, not locked, not prunable
              - no tmux pane has its cwd inside it
              - `git status --porcelain --untracked-files=all` is empty
              - no merge/rebase/cherry-pick/revert/bisect in progress
              - `git rev-list --count HEAD --not --remotes=<r>...` is 0, with the remotes
                NAMED per repo (marveen: fork+origin; Delta-CRM: origin only -- its
                `old-origin` is a dead repo and must not count as "backed up"; and a bare
                `--remotes` would count the ORPHAN `dexterwt/` refs too)
              - its newest top-level entry is older than --wt-min-age-hours (default 48);
                `.git/worktrees/*/logs/HEAD` is NOT an age signal (all touched 09-25)
              - no other worktree's `node_modules` symlink resolves into it
            Removal is plain `git worktree remove` WITHOUT --force, so git itself refuses a
            tree that turned dirty between the check and the removal. The branch stays.
            Never by card status: several waiting cards live only on a local branch.
            The same criteria removed 404 trees by hand on 2026-09-26 13:49 (19.0 -> 47.1 GB
            free, 0 refused).

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


COMPILE_CACHE_NAMES = ("node-compile-cache", "v8-compile-cache-%d" % os.getuid())
GIT_OPS_IN_PROGRESS = ("MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD",
                       "REVERT_HEAD", "BISECT_LOG")
DEFAULT_WT_REPOS = (("/Users/isti/marveen", ("fork", "origin")),
                    ("/Users/isti/Projektek/sajat-crm", ("origin",)))


def default_compile_cache_dirs():
    roots = [os.environ.get("TMPDIR") or "", "/private/tmp"]
    return [os.path.join(r, n) for r in roots if r for n in COMPILE_CACHE_NAMES]


def compile_dir_is_allowed(path):
    real = os.path.realpath(path)
    return os.path.basename(real) in COMPILE_CACHE_NAMES and real.startswith(JEST_ROOTS_ALLOWED)


def collect_compile_cache(dirs, cap_bytes, dry_run):
    """Evict the oldest files until each directory is under cap. Returns (files, bytes, refused)."""
    files = size = 0
    refused = []
    seen = set()
    for d in dirs:
        if not os.path.isdir(d):
            continue
        real = os.path.realpath(d)
        if real in seen:
            continue
        seen.add(real)
        if not compile_dir_is_allowed(d):
            refused.append(d)
            continue
        entries = []
        for root, _subdirs, names in os.walk(d, followlinks=False):
            for n in names:
                p = os.path.join(root, n)
                try:
                    st = os.lstat(p)
                except OSError:
                    continue
                entries.append((st.st_mtime, st.st_blocks * 512, p))
        total = sum(e[1] for e in entries)
        for _mtime, blocks, p in sorted(entries):
            if total <= cap_bytes:
                break
            if not dry_run:
                try:
                    os.unlink(p)
                except OSError:
                    continue
            total -= blocks
            files += 1
            size += blocks
    return files, size, refused


def git(args, cwd):
    r = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout, r.stderr


def tmux_pane_paths():
    """cwd of every tmux pane. None = could not ask (then NO tree is a candidate)."""
    try:
        r = subprocess.run(["tmux", "list-panes", "-a", "-F", "#{pane_current_path}"],
                           capture_output=True, text=True, timeout=30)
    except FileNotFoundError:
        return []  # no tmux binary: no pane can sit in a tree
    except Exception:
        return None
    if r.returncode != 0:
        err = r.stderr.lower()
        return [] if ("no server running" in err or "error connecting" in err) else None
    return [ln for ln in r.stdout.splitlines() if ln.strip()]


def list_worktrees(repo):
    rc, out, err = git(["worktree", "list", "--porcelain"], repo)
    if rc != 0:
        raise RuntimeError(err.strip() or "git worktree list rc=%d" % rc)
    wts, cur = [], {}
    for line in out.splitlines() + [""]:
        if not line:
            if cur:
                wts.append(cur)
                cur = {}
            continue
        k, _, v = line.partition(" ")
        cur[k] = v or True
    return wts


def newest_top_level_mtime(path):
    try:
        newest = os.lstat(path).st_mtime
        with os.scandir(path) as it:
            for e in it:
                try:
                    newest = max(newest, e.stat(follow_symlinks=False).st_mtime)
                except OSError:
                    continue
        return newest
    except OSError:
        return None


def plan_worktrees(repo, remotes, now, min_age_s, panes):
    """Returns (candidates, skipped{reason: [paths]}). Reads git, never writes."""
    candidates, skipped = [], {}

    def skip(reason, path):
        skipped.setdefault(reason, []).append(path)

    main_real = os.path.realpath(repo)
    wts = list_worktrees(repo)
    known = set(ln.strip() for ln in git(["remote"], repo)[1].splitlines())
    missing_remotes = [r for r in remotes if r not in known]
    # node_modules symlinks of EVERY tree: a target inside a candidate would break its owner
    nm_targets = []
    for w in wts:
        nm = os.path.join(w["worktree"], "node_modules")
        if os.path.islink(nm):
            nm_targets.append(os.path.realpath(nm))
    for w in wts:
        p = w["worktree"]
        real = os.path.realpath(p)
        if real == main_real:
            continue
        if missing_remotes:
            skip("remote-not-configured", p)
            continue
        if w.get("locked"):
            skip("locked", p)
            continue
        if w.get("prunable") or not os.path.isdir(p):
            skip("missing", p)
            continue
        if panes is None:
            skip("panes-unknown", p)
            continue
        if any(x == real or x.startswith(real + "/") or x == p or x.startswith(p + "/") for x in panes):
            skip("in-use", p)
            continue
        if any(t == real or t.startswith(real + "/") for t in nm_targets):
            skip("node_modules-target", p)
            continue
        rc, st, _ = git(["status", "--porcelain", "--untracked-files=all"], p)
        if rc != 0:
            skip("status-error", p)
            continue
        if st.strip():
            skip("dirty", p)
            continue
        rc, gd, _ = git(["rev-parse", "--git-dir"], p)
        gd = gd.strip()
        gd = gd if os.path.isabs(gd) else os.path.join(p, gd)
        if rc != 0 or any(os.path.exists(os.path.join(gd, f)) for f in GIT_OPS_IN_PROGRESS):
            skip("git-op", p)
            continue
        rc, cnt, _ = git(["rev-list", "--count", "HEAD", "--not"] + ["--remotes=" + r for r in remotes], p)
        if rc != 0 or not cnt.strip().isdigit():
            skip("revlist-error", p)
            continue
        if int(cnt.strip()) > 0:
            skip("local-only-commits", p)
            continue
        m = newest_top_level_mtime(p)
        if m is None:
            skip("age-unknown", p)
            continue
        if now - m < min_age_s:
            skip("young", p)
            continue
        candidates.append(p)
    return candidates, skipped


def run_worktrees(repos, now, min_age_s, apply, stamp):
    """Returns the number of failures (a repo that could not be listed counts)."""
    tag = "" if apply else "REPORT-ONLY "
    panes = tmux_pane_paths()
    failures = 0
    for repo, remotes in repos:
        if not os.path.isdir(repo):
            print("%s %sworktrees %s: repo missing, skipped" % (stamp, tag, repo))
            continue
        try:
            cands, skipped = plan_worktrees(repo, remotes, now, min_age_s, panes)
        except Exception as exc:
            print("%s ERROR: worktrees %s: %s" % (stamp, repo, exc))
            failures += 1
            continue
        removed, refused = 0, []
        if apply:
            for p in cands:
                rc, _, err = git(["worktree", "remove", p], repo)  # NO --force: git re-checks
                if rc == 0:
                    removed += 1
                else:
                    refused.append("%s: %s" % (p, err.strip()[:120]))
        print("%s %sworktrees %s (remotes %s): %s %d, kept %s%s" % (
            stamp, tag, repo, "+".join(remotes),
            "removed" if apply else "would remove", removed if apply else len(cands),
            {k: len(v) for k, v in sorted(skipped.items())},
            (" | REFUSED: %s" % refused) if refused else ""))
        if not apply:
            for p in cands:
                print("    would remove: %s" % p)
        failures += 1 if refused else 0
    return failures


def parse_repo_arg(v):
    path, _, rems = v.partition(":")
    return path, tuple(r for r in rems.split(",") if r)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-age-hours", type=float, default=24.0)
    ap.add_argument("--jest-dir", action="append", help="override the jest_dx dirs (tests)")
    ap.add_argument("--skip-db", action="store_true", help="skip the e2e database half")
    ap.add_argument("--skip-worktrees", action="store_true")
    ap.add_argument("--skip-compile-cache", action="store_true")
    ap.add_argument("--compile-cache-dir", action="append", help="override the dirs (tests)")
    ap.add_argument("--compile-cache-cap-mb", type=float, default=1024.0)
    ap.add_argument("--wt-repo", action="append", type=parse_repo_arg,
                    help="PATH:remote1,remote2 -- override the repos (tests)")
    ap.add_argument("--wt-min-age-hours", type=float, default=48.0)
    ap.add_argument("--apply-worktrees", action="store_true",
                    help="actually remove; without it the worktree half only reports")
    a = ap.parse_args(argv)
    if a.max_age_hours < 1:
        print("ERROR: --max-age-hours below 1 would reach a live run; refusing")
        return 2
    if a.wt_min_age_hours < 24:
        print("ERROR: --wt-min-age-hours below 24 would reach a tree in use today; refusing")
        return 2
    if a.wt_repo and any(not r for _, r in a.wt_repo):
        print("ERROR: --wt-repo needs PATH:remote[,remote] -- no remote means nothing is backed up")
        return 2
    now, max_age_s = time.time(), a.max_age_hours * 3600
    tag = "DRY-RUN " if a.dry_run else ""
    stamp = time.strftime("%Y-%m-%d %H:%M:%S %Z")

    files, size, refused = collect_jest(a.jest_dir or default_jest_dirs(), max_age_s, now, a.dry_run)
    print("%s %sjest_dx: %d files, %.2f GiB%s" % (
        stamp, tag, files, size / 2**30, (" | REFUSED dirs: %s" % refused) if refused else ""))

    failures = 0
    if not a.skip_compile_cache:
        cf, cs, cref = collect_compile_cache(a.compile_cache_dir or default_compile_cache_dirs(),
                                             a.compile_cache_cap_mb * 2**20, a.dry_run)
        print("%s %scompile caches (cap %.0f MB each): %d files, %.2f GiB%s" % (
            stamp, tag, a.compile_cache_cap_mb, cf, cs / 2**30,
            (" | REFUSED dirs: %s" % cref) if cref else ""))

    if not a.skip_worktrees:
        failures += run_worktrees(a.wt_repo or list(DEFAULT_WT_REPOS), now,
                                  a.wt_min_age_hours * 3600,
                                  a.apply_worktrees and not a.dry_run, stamp)

    if a.skip_db:
        return 1 if failures else 0
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
    return 1 if (failed or failures) else 0


if __name__ == "__main__":
    sys.exit(main())
