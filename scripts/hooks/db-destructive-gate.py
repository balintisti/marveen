#!/usr/bin/env python3
"""PreToolUse gate on Bash: refuse destructive database commands.

WHY THIS EXISTS, AND WHY THE PERMISSION LIST IS NOT ENOUGH (measured 2026-08-19,
re-confirmed 2026-08-28; cards aae333c1 / caaf32a4 / 0b32c5da).

Every agent in this fleet runs with `--dangerously-skip-permissions`
(scripts/channels.sh, channel-watchdog.sh; the pane shows "bypass permissions on").
In that mode Claude Code asks nothing, so the contents of any allow/deny list are
IRRELEVANT -- a bare `npx prisma migrate reset --force` would run without a question.
Measured alongside: the production repo's settings.local.json has allow=490 / deny=0,
while three agent configs carry deny=13..14. The one checkout that touches production
is the one with no deny list at all.

A deny list is also the only layer that still bites in bypass mode -- but only for
sessions that load it. A hook is CODE, and code runs regardless of mode. That is the
whole reason this file exists rather than another settings entry.

=== THE TWO DELIBERATE INVERSIONS, BOTH ARGUED

1. FAIL-OPEN ON HOOK ERROR, AND LOUD ABOUT IT.
   Elsewhere in this repo the gates are fail-closed (see outgoing-copy-gate.py), and
   that is right there: an unsendable email is deferrable. This hook sits on EVERY Bash
   call of EVERY agent. A crash that denies everything is not a gate, it is a fleet
   outage, and it would arrive as "nothing works" with no obvious cause.
   So: unparseable input or an internal error ALLOWS -- and writes a line to
   store/db-gate.log saying it did. That log line is the point. Without it, a gate
   broken on Monday is byte-identical to a gate that simply never had to fire, which is
   the failure this whole rulebook keeps describing.

2. COMMENTS ARE **NOT** STRIPPED, deliberately, against the house rule.
   The migration checklist in the Delta-CRM rulebook says to strip comments before
   grepping, because a checklist that fires on its own documentation becomes noise.
   That reasoning holds for a REPORTING check. It inverts for a DENY gate:
     a false positive -> loud, immediate, and recoverable in one line (the override)
     a false negative -> a dropped database
   Stripping comments means parsing shell quoting correctly, and getting that wrong
   silently hides a real command. So the raw text is matched, and the cost is that a
   command whose COMMENT mentions DROP TABLE gets refused with a message explaining it.

=== THE OVERRIDE, AND WHY IT IS A TOKEN AND NOT A CARVE-OUT

A prohibition with no exit does not survive contact with someone who genuinely needs
the operation; they delete the gate instead, and then nobody knows a gate ever existed.
So there is one exit, and it is deliberate, visible and logged:

    MARVEEN_DB_GATE=allow <command>

Prefixing that env assignment is not something anyone types by accident, it names
itself in the shell history, and every use is logged with the full command. A carve-out
based on "the connection looks like a test database" was considered and rejected: it
would have to parse DATABASE_URL out of the environment the command has not run in yet,
and a wrong guess there fails in the direction that costs a production database.
"""
import json
import os
import re
import sys
import time

LOG = "/Users/isti/marveen/store/db-gate.log"

# === WHAT IS MATCHED, AND WHY IT IS SPLIT IN TWO ===============================
#
# v1 matched every pattern against the raw command text. It went live, and the
# FIRST thing it blocked was a command that merely CONTAINED the words -- a test
# harness building a JSON payload. Writing documentation about the gate needed the
# override, on the first attempt.
#
# That is fatal, and not because it is annoying: an override used routinely stops
# being a deliberate act. The rulebook already says a checker that flags the
# correct solution is worse than no checker, because the obvious fix is to remove
# the checker. So the matching is now positional, in two classes with different
# rules, and both fail toward DENY when the shape is unclear.
#
#   TOOL patterns  -- `prisma migrate reset`, `npm run db:reset`, `make db-...`
#                     These are COMMANDS. They only count in command position, so
#                     the same words inside a quoted argument or a heredoc body are
#                     text. A tool name cannot arrive any other way.
#
#   SQL patterns   -- DROP TABLE, TRUNCATE, DELETE FROM without WHERE
#                     These legitimately live INSIDE a quoted argument
#                     (`psql -c "DROP TABLE x"`), so position cannot separate them
#                     from prose. What separates them is the COMPANY they keep: the
#                     segment has to invoke a database client. `DROP TABLE` in a
#                     heredoc written to a markdown file invokes nothing.
#
# The residual hole is stated rather than hidden: a destructive statement passed to
# a client through a variable the hook cannot see (`psql -f "$f"`, or a script that
# builds SQL at runtime) is not caught. This gate is a guard rail against a typed
# mistake, not a sandbox -- it cannot become one, because the hook sees a command
# string and not the process that will run.

TOOL_PATTERNS = [
    (r"prisma\s+migrate\s+reset", "prisma migrate reset -- drops and recreates the schema"),
    (r"prisma\s+migrate\s+dev", "prisma migrate dev -- writes to whatever DATABASE_URL points at; production deploys run `migrate deploy` from the pipeline, never by hand"),
    (r"prisma\s+db\s+push", "prisma db push -- applies the schema destructively, without a migration"),
    (r"supabase\s+db\s+reset", "supabase db reset"),
    (r"\bnpm\s+run\s+(db:reset|db:seed|dev:clean|dev:setup)\b", "an npm script that resets or seeds the database"),
    (r"\byarn\s+(db:reset|db:seed|dev:clean|dev:setup)\b", "a yarn script that resets or seeds the database"),
    (r"\bmake\s+db-", "a make db-* target"),
]

SQL_PATTERNS = [
    (r"\bDROP\s+(TABLE|DATABASE|SCHEMA)\b", "DROP TABLE/DATABASE/SCHEMA"),
    (r"\bTRUNCATE\b", "TRUNCATE"),
    # DELETE FROM <table> with nothing before the statement ends. The quote class
    # allows BACKSLASHES: a psql call arrives as `psql -c "DELETE FROM \"Task\";"`,
    # and the first version -- one optional quote -- did not match it. The control
    # set caught that; every other deny case passed, so the gate looked healthy.
    (r"\bDELETE\s+FROM\s+[\\\"\'`]*[\w.]+[\\\"\'`]*\s*(;|$)", "DELETE FROM without a WHERE clause"),
]

# Anything that can hand SQL to a server. `prisma`/`supabase` are here as well as in
# the tool list: `prisma db execute --stdin` is a client, not just a CLI.
DB_CLIENTS = re.compile(
    r"(^|[\s;&|(])(psql|sqlite3|mysql|mariadb|mongo|mongosh|cockroach|pg_restore|pgcli|"
    r"prisma|supabase|npx\s+prisma|dbmate|flyway|liquibase)([\s;&|)]|$)", re.I)

# Segment separators. Splitting is deliberately crude -- it can only ever produce
# MORE segments than a shell would.
#
# THE OLD CLAIM HERE WAS "an extra boundary can only cause an extra check, never a
# missed one". THAT IS TRUE FOR THE TOOL CLASS AND FALSE FOR THE SQL CLASS, and the
# difference is the co-occurrence requirement (card 63ab0d14, dexter observed it on
# 2026-09-04 during ordinary migration work -- not by probing):
#
#   TOOL patterns need ONE thing in a segment -- more boundaries, more chances to hit.
#   SQL patterns need TWO things in the SAME segment (a client AND a statement), so an
#   extra boundary can SEPARATE them and cause a MISS.
#
# That is exactly what happened to an executed heredoc. `strip_heredoc_bodies` KEEPS
# the body when the opener runs it (`psql <<'SQL'`), correctly, so it can be checked --
# and then the newline split guaranteed the body could never share a segment with the
# psql that executes it. Two individually correct mechanisms; the fault was in their
# composition. `psql ... -c 'DROP TABLE x'` was refused while the same statement in a
# heredoc to the same database ran.
#
# The fix is not to stop splitting (joining does not help: the body's own `;` re-splits
# it). Each executed body line CARRIES its opener's client instead -- see
# strip_heredoc_bodies.
_SEG = re.compile(r"(?:\|\||&&|[;\n|&])")
_ENV_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def _command_position_text(segment: str) -> str:
    """The part of a segment that a shell would treat as command + arguments,
    with quoted strings blanked out so their CONTENTS cannot look like a command.

    Quotes are replaced by spaces of the same length rather than removed, so the
    word positions of everything after them stay put."""
    out, quote = [], None
    for ch in segment:
        if quote:
            out.append(" " if ch != quote else ch)
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
            out.append(ch)
        else:
            out.append(ch)
    text = "".join(out)
    # Drop leading VAR=value assignments so `FOO=1 prisma migrate reset` still reads
    # as a prisma invocation.
    parts = text.split()
    while parts and _ENV_ASSIGN.match(parts[0]):
        parts.pop(0)
    return " ".join(parts)


_HEREDOC = re.compile(r"<<-?\s*([\"\']?)([A-Za-z_][A-Za-z0-9_]*)\1")


def strip_heredoc_bodies(command: str) -> str:
    """Remove heredoc BODIES, unless the heredoc is being fed to something that
    would execute it.

    A heredoc body is data. `cat > notes.md <<'EOF' ... DROP TABLE ... EOF` writes
    prose; splitting on newlines without this step puts that line in command
    position and denies it. That was v1's first real false positive, and it hit
    documentation about this very gate.

    The carve-out is the whole point: `bash <<'EOF'` or `psql <<'EOF'` DOES execute
    the body, so for those the body stays in scope. When in doubt the body is
    KEPT -- an unrecognised opener leaves the text where it is, which can only
    cause an extra check."""
    lines = command.split("\n")
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        m = _HEREDOC.search(line)
        if m:
            terminator = m.group(2)
            executes = re.search(r"(^|[\s;&|])(bash|sh|zsh|psql|sqlite3|mysql|python3?|node)([\s;&|]|$)", line)
            # Each kept body line is PREFIXED with the opener's client, so the SQL class
            # (which needs client AND statement in one segment) still sees them together
            # after the newline/semicolon split. Joining the body onto the opener line
            # would NOT do it: the body's own `;` splits it apart again.
            client = executes.group(2) if executes else ""
            i += 1
            while i < len(lines) and lines[i].strip() != terminator:
                if executes:
                    out.append(f"{client} {lines[i]}")
                i += 1
            if i < len(lines):
                out.append(lines[i])  # the terminator itself
        i += 1
    return "\n".join(out)


def find_hits(command: str):
    hits = []
    command = strip_heredoc_bodies(command)
    for segment in _SEG.split(command):
        if not segment.strip():
            continue
        cmdpos = _command_position_text(segment)
        for pat, why in TOOL_PATTERNS:
            if re.search(pat, cmdpos, re.I) and why not in hits:
                hits.append(why)
        if DB_CLIENTS.search(segment):
            for pat, why in SQL_PATTERNS:
                if re.search(pat, segment, re.I) and why not in hits:
                    hits.append(why)
    return hits


OVERRIDE = re.compile(r"(^|\s)MARVEEN_DB_GATE=allow(\s|$)")


def log(kind, detail, command=""):
    """Append one line. Never raises: a logging failure must not decide the gate."""
    try:
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(
                "%s\t%s\t%s\t%s\n"
                % (
                    time.strftime("%Y-%m-%d %H:%M:%S %Z"),
                    kind,
                    detail.replace("\t", " ").replace("\n", " "),
                    command[:400].replace("\t", " ").replace("\n", " "),
                )
            )
    except Exception:
        pass


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        # See inversion 1: allow, but leave a trace, so a gate that has quietly
        # stopped working is distinguishable from a gate that never had to fire.
        log("FAIL-OPEN", "unparseable hook payload: %s" % exc)
        sys.exit(0)

    if str(payload.get("tool_name") or "") != "Bash":
        sys.exit(0)

    try:
        command = str((payload.get("tool_input") or {}).get("command") or "")
        if not command.strip():
            sys.exit(0)

        hits = find_hits(command)
        if not hits:
            sys.exit(0)

        if OVERRIDE.search(command):
            log("OVERRIDE", "; ".join(hits), command)
            sys.stderr.write(
                "DB-KAPU: ATENGEDVE MARVEEN_DB_GATE=allow miatt.\n"
                "Naplozva ide: %s\n" % LOG
            )
            sys.exit(0)

        log("DENY", "; ".join(hits), command)
    except Exception as exc:
        log("FAIL-OPEN", "internal error: %s" % exc)
        sys.exit(0)

    sys.stderr.write(
        "DB-KAPU: TILTVA -- destruktiv adatbazis-muvelet.\n\n"
        + "\n".join("  - %s" % h for h in hits)
        + "\n\n"
        "MIERT KODBAN ES NEM JOGOSULTSAGBAN: minden agens bypass modban fut, ahol a\n"
        "jogosultsagi lista tartalma nem szamit. Ez a kapu akkor is fog.\n\n"
        "HA A PARANCS TENYLEG KELL -- es a felelosseg a tied, a naplo megorzi:\n"
        "    MARVEEN_DB_GATE=allow <a parancs>\n\n"
        "HA CSAK MERNI AKARSZ eles adaton, NE ezt az utat valaszd: a szabalykonyv\n"
        "csak-olvaso receptje (BEGIN TRANSACTION READ ONLY + kapu-bizonyitas a meres\n"
        "elott ES utan) pontosan erre valo, es nem ir semmit.\n\n"
        "HA A TALALAT EGY KOMMENTBEN VAN: igen, szandekosan. Ez a kapu NEM csupaszit\n"
        "kommentet, mert ahhoz helyesen kellene ertelmeznie a shell-idezojeleket, es egy\n"
        "elrontott csupaszitas NEMAN engedne at egy valodi parancsot. Egy hamis riasztas\n"
        "hangos es egy sorban feloldhato; egy hamis atengedes egy adatbazis.\n"
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
