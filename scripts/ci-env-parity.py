#!/usr/bin/env python3
"""Report what a CI job DECLARES that the caller's environment does not provide.

Card 61f8f593. Four harness gaps in one night, all one root: we copied a job's
COMMAND and left its `env:` and `services:` behind. Two of them looked like
failing tests (missing JWT_SECRET -> config validation error; missing
NODE_OPTIONS -> OOM), and one is worse than a failure -- without the Upstash
REST shim the cache is simply OFF, so cache-dependent specs can PASS while
measuring nothing. A false red costs a turn; a false green becomes the input to
a deployment decision.

WHY A TOOL AND NOT A CHECKLIST LINE. The rule "copy the whole job, not just the
test command" was already written, and was already a checklist item, and still
did not fire: in ci.yml the `env:` block sits SIX LINES ABOVE the command, so
whoever copies the command never sees it, and whoever measures ad hoc never
reads the checklist at all. So this answers the question at the moment of the
decision instead of asking anyone to remember.

IT ALSO ENUMERATES, WHICH IS THE HALF A NAME-KEYED TOOL CANNOT DO. On 2026-09-11
a deploy was held because a CI job that was never run was missing from the
"every job ran" list. You never ask a name-keyed tool about a job you do not
know exists -- a list can only watch its known members, and what changed was the
MEMBERSHIP. So with no --job, this reports EVERY job and says which ones it has
no statement about.

EXIT CODES ARE THREE-VALUED, deliberately (the shape didi hit on the openapi
gate): a tool that cannot answer must not be readable as "clean".
    0  no gap
    1  a gap: the job declares something the caller does not provide
    2  CANNOT ANSWER (nothing parsed, no such job, unreadable file)

NO YAML LIBRARY EXISTS ON THIS HOST -- measured 2026-09-11: python pyyaml, node
`yaml` and node `js-yaml` are all absent. So this carries a deliberately NARROW
parser: it reads only the shapes it needs (job headers, `env:` mappings,
`services:` names) and REFUSES rather than guessing. An empty parse exits 2, not
0 -- a silent zero here would be indistinguishable from a clean environment,
which is the exact failure this tool exists to stop.

Usage:
  ci-env-parity.py <workflow.yml>                     # every job, plus coverage
  ci-env-parity.py <workflow.yml> --job backend-e2e   # one job, exit 1 on a gap
  ci-env-parity.py <workflow.yml> --job X --env-file backend/.env.test
  ci-env-parity.py <workflow.yml> --list              # job inventory only
"""
import argparse, os, re, sys

CANNOT_ANSWER = 2


def die(msg):
    print(f"CANNOT ANSWER: {msg}", file=sys.stderr)
    sys.exit(CANNOT_ANSWER)


def indent_of(line):
    return len(line) - len(line.lstrip(" "))


def parse_jobs(lines):
    """job name -> (start, end) line indices. Only the block under a top-level `jobs:`."""
    jobs, start = {}, None
    for i, l in enumerate(lines):
        if re.match(r"^jobs:\s*(#.*)?$", l):
            start = i + 1
            break
    if start is None:
        die("no top-level `jobs:` key -- is this a GitHub Actions workflow?")

    heads = []
    for i in range(start, len(lines)):
        l = lines[i]
        if not l.strip() or l.lstrip().startswith("#"):
            continue
        if indent_of(l) == 0:                       # left the jobs block
            break
        m = re.match(r"^  ([A-Za-z0-9_.-]+):\s*(#.*)?$", l)
        if m:
            heads.append((i, m.group(1)))
    if not heads:
        die("`jobs:` present but no job headers parsed -- the parser does not "
            "understand this file, which is NOT the same as 'no gaps'")

    for idx, (i, name) in enumerate(heads):
        end = heads[idx + 1][0] if idx + 1 < len(heads) else len(lines)
        jobs[name] = (i, end)
    return jobs


def block_ranges(lines, lo, hi, key):
    """Line ranges of every `<key>:` block inside [lo,hi)."""
    out = []
    i = lo
    while i < hi:
        l = lines[i]
        if re.match(rf"^\s+{key}:\s*(#.*)?$", l) and not l.lstrip().startswith("#"):
            base = indent_of(l)
            j = i + 1
            while j < hi:
                n = lines[j]
                if n.strip() and not n.lstrip().startswith("#") and indent_of(n) <= base:
                    break
                j += 1
            out.append((i, j))
            i = j
            continue
        i += 1
    return out


def mapping_keys(lines, lo, hi, key, direct_only, skip=()):
    """Keys under every `<key>:` mapping inside [lo,hi).

    The two callers want DIFFERENT things and a single rule serves neither:

      env:      a job-level `env:` (indent 4) and a step-level `env:` (indent 10)
                are BOTH real, and the caller is asking what the job provides
                anywhere -- so every block is visited and unioned.
                HONEST NOTE, because the obvious justification is wrong: setting
                direct_only=True here would NOT drop the step-level keys. The
                shallowest depth is computed PER BLOCK, so a flat `env:` mapping
                yields the same set either way -- measured on the real ci.yml,
                10/10 under both settings, i.e. flipping it is a NO-OP. It is
                False because env blocks are flat by nature and a nested value
                under env would still be a key the job sets; it is NOT load-
                bearing today. (Found by mutating it and watching every test
                stay green -- a surviving mutation that turned out to be a
                no-op, not a weak test.)
      services: only the DIRECT children are service names. Union-across-levels
                returns `image`, `ports`, `options` and the services' own env
                keys as if they were services -- measured, it did exactly that.
    """
    out = set()
    i = lo
    while i < hi:
        l = lines[i]
        if (re.match(rf"^\s+{key}:\s*(#.*)?$", l) and not l.lstrip().startswith("#")
                and not any(a <= i < b for a, b in skip)):
            base = indent_of(l)
            block = []
            j = i + 1
            while j < hi:
                n = lines[j]
                if not n.strip() or n.lstrip().startswith("#"):
                    j += 1
                    continue
                if indent_of(n) <= base:
                    break
                m = re.match(r"^\s+([A-Za-z0-9_.-]+):", n)
                if m:
                    block.append((m.group(1), indent_of(n)))
                j += 1
            if block:
                if direct_only:
                    d = min(depth for _, depth in block)
                    out |= {k for k, depth in block if depth == d}
                else:
                    out |= {k for k, _ in block}
            i = j
            continue
        i += 1
    return out


def load_env_files(paths):
    env = {}
    for p in paths:
        if not os.path.exists(p):
            die(f"--env-file not found: {p} (refusing to report a gap against a file I could not read)")
        with open(p, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                env[line.split("=", 1)[0].strip()] = 1
    return env


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("workflow")
    ap.add_argument("--job")
    ap.add_argument("--env-file", action="append", default=[])
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--no-process-env", action="store_true",
                    help="ignore os.environ; compare only against --env-file")
    a = ap.parse_args()

    if not os.path.exists(a.workflow):
        die(f"workflow not found: {a.workflow}")
    with open(a.workflow, encoding="utf-8", errors="replace") as fh:
        lines = fh.read().splitlines()

    jobs = parse_jobs(lines)

    if a.list:
        print(f"jobs in {a.workflow}: {len(jobs)}")
        for n in jobs:
            print(f"  {n}")
        return 0

    have = load_env_files(a.env_file)
    if not a.no_process_env:
        have.update({k: 1 for k in os.environ})

    names = [a.job] if a.job else list(jobs)
    if a.job and a.job not in jobs:
        die(f"no job named {a.job!r}. Known jobs: {', '.join(jobs)}")

    gap = False
    for n in names:
        lo, hi = jobs[n]
        # A `services.<name>.env:` block configures the SERVICE CONTAINER, not the
        # job's steps -- the caller does not need POSTGRES_DB in their shell, they
        # need postgres running with it. Counting those as job env produced a
        # false gap on a genuinely complete environment (measured: the "silent on
        # a complete environment" case failed on POSTGRES_DB). A tool that flags
        # correct setups is worse than no tool, so services blocks are excluded.
        svc_ranges = block_ranges(lines, lo, hi, "services")
        declared = mapping_keys(lines, lo, hi, "env", direct_only=False, skip=svc_ranges)
        services = mapping_keys(lines, lo, hi, "services", direct_only=True)
        missing = sorted(k for k in declared if k not in have)
        # The label must agree with the exit code. It used to read GAP whenever a
        # job had services, while `gap` was set only by missing env -- so a
        # complete environment printed "GAP backend-e2e" and exited 0. A status
        # word that contradicts the exit code reintroduces exactly the ambiguity
        # this tool exists to remove. Services are INFORMATIONAL: they cannot be
        # checked from the environment, so they never decide the verdict.
        status = "GAP " if missing else "ok  "
        if missing:
            gap = True
        print(f"{status}{n}")
        if missing:
            print(f"      env NOT provided by the caller ({len(missing)}/{len(declared)}): "
                  + ", ".join(missing))
        if services:
            print(f"      services this job runs ({len(services)}): " + ", ".join(sorted(services))
                  + "  -- a service cannot be checked from the environment; start it or say you did not")

    # THE INVENTORY HALF -- and it must run ESPECIALLY when --job was given.
    # Guarding this with `if not a.job` made it dead code: without --job every
    # job is covered, so the unaddressed list is always empty, and WITH --job the
    # block was skipped entirely. The whole point is the opposite -- you asked
    # about one job, so here are the ones you did not ask about. That is the gap
    # a name-keyed tool cannot see, and it is what held a deploy on 2026-09-11.
    print(f"\ncoverage: {len(names)}/{len(jobs)} jobs in this workflow reported on")
    unaddressed = [n for n in jobs if n not in names]
    if unaddressed:
        print("  NO STATEMENT about: " + ", ".join(unaddressed))

    return 1 if gap else 0


if __name__ == "__main__":
    sys.exit(main())
