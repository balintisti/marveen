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

# Short tokens get word boundaries; multi-word SQL forms are matched with flexible
# whitespace because they legitimately span lines inside heredocs.
PATTERNS = [
    (r"prisma\s+migrate\s+reset", "prisma migrate reset -- drops and recreates the schema"),
    (r"prisma\s+migrate\s+dev", "prisma migrate dev -- writes to whatever DATABASE_URL points at; production deploys use `migrate deploy` from the pipeline, never by hand"),
    (r"prisma\s+db\s+push", "prisma db push -- applies the schema destructively, without a migration"),
    (r"supabase\s+db\s+reset", "supabase db reset"),
    (r"\bnpm\s+run\s+(db:reset|db:seed|dev:clean|dev:setup)\b", "an npm script that resets or seeds the database"),
    (r"\bmake\s+db-", "a make db-* target"),
    (r"\bDROP\s+(TABLE|DATABASE|SCHEMA)\b", "DROP TABLE/DATABASE/SCHEMA"),
    (r"\bTRUNCATE\b", "TRUNCATE"),
    # DELETE FROM <table> with no WHERE before the statement ends.
    # The quote class allows BACKSLASHES: a psql call reaches the hook as
    # `psql -c "DELETE FROM \"Task\";"`, and the first version of this pattern --
    # which accepted a single optional quote -- did not match it. Caught by the
    # control set, not by reading: the deny case silently returned exit 0 while
    # every other deny case passed, so the gate looked healthy.
    (r"\bDELETE\s+FROM\s+[\\\"'`]*[\w.]+[\\\"'`]*\s*(;|$)", "DELETE FROM without a WHERE clause"),
]

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

        hits = [why for pat, why in PATTERNS if re.search(pat, command, re.I)]
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
