#!/usr/bin/env python3
"""PreToolUse gate on Bash: refuse destructive database commands.

WHY THIS EXISTS, AND WHY THE PERMISSION LIST IS NOT ENOUGH (measured 2026-08-19,
re-confirmed 2026-08-28; cards aae333c1 / caaf32a4 / 0b32c5da).

Every agent in this fleet runs with `--dangerously-skip-permissions`
(scripts/channels.sh, channel-watchdog.sh; the pane shows "bypass permissions on").
In that mode Claude Code asks nothing, so an ALLOW list decides nothing -- a bare
`npx prisma migrate reset --force` would run without a question. The DENY list is the
exception, and that is measured, not assumed: in bypass-mode sessions on 2026-09-06
both `echo marveen-flag-probe --force x` and `git push nonexistent-remote-xyz-12345`
came back REFUSED (card 9e3f2f5c). Until that day this paragraph said "allow/deny ...
IRRELEVANT", which reads as "do not bother writing deny rules" -- and an afternoon was
spent on that reading before the second per-agent settings file turned up.

AND WHAT THAT SENTENCE DOES **NOT** SAY, spelled out because it reads as though a bare
`--force` token were refused anywhere, which would make the FORCE-PUSH class below look
redundant: both probes ran against PURPOSE-ADDED deny rules. jarvis's config carried
`Bash(echo marveen-flag-probe --force:*)` that afternoon (deny=4), and the paired control
is on the card -- the SAME command RAN for dexter, whose config did not carry the rule.
Re-measured 2026-09-10 in a dexter session: `echo marveen-flag-probe --force x` RUNS, with
the positive control (`marveen-permission-probe-do-not-run --x`) DENIED, so the deny list
was loaded and the negative is real. What those probes established is that a MULTI-WORD
PREFIX binds in bypass mode. Not that a force flag is refused wherever it stands.
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

=== HOW TO PROBE THIS GATE AFTER A CHANGE, AND THE ONE MISTAKE THAT LOOKS EXACTLY LIKE A
=== DEAD GATE (marveen, on the merge of the force-push class, 2026-09-10)

**A NEGATIVE PROBE MUST BE UNQUOTED.** Matching is positional, and quoted strings are
blanked before anything is compared (`_command_position_text`) on purpose, so that prose
ABOUT a destructive command is not itself treated as one. So this happens:

    echo "git push fork feat/x --force"    -> RUNS. The documented exemption.
    git push fork feat/x --force           -> REFUSED.

The first probe anyone reaches for is the quoted one, because printing a string is how you
show a string -- and for about ten seconds after the merge it looked like a gate that had
stopped firing. The gate was right and the probe was the exemption.

A quoted probe and an unquoted one are **two different tests, not a weak and a strong
version of one**: the quoted form asserts the exemption, the unquoted form asserts the
rule. Run both and expect OPPOSITE verdicts; a pair that agrees means one of them is not
measuring what you think. Both are pinned as controls in
`src/__tests__/db-gate-force-push.test.ts`.
"""
import json
import os
import re
import shlex
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
# FILE-DELIVERED SQL (card fc7d05f9, porting friday's 2e08a7e1 which never merged):
# the LITERAL-PATH case is covered, the VARIABLE case is not, and the difference is
# not effort -- it is the tool's boundary.
#
#   COVERED -- the file is READ and its statements are checked as if typed:
#       psql -f x.sql | psql --file=x.sql | psql < x.sql | cat x.sql | psql
#       psql -c '\i x.sql' (also \ir, \include, \include_relative, and inside a
#       psql heredoc) | prisma db execute --file x.sql
#   NOT COVERED, and it cannot be: `psql -f "$f"` (15 of the 50 file-fed commands in
#       14 days of real fleet traffic, didi's census on fc7d05f9), and any script that
#       builds or runs SQL itself (`bash x.sh`, `python3 x.py`, scripts/readonly-
#       measure.sh). The hook sees a command string, not the process that will run.
#       This gate is a guard rail against a typed mistake, not a sandbox.
#   NOT COVERED either, by the same boundary: a FIFO or device (allow + log -- opening
#       one would hang or consume it), so a background writer into a FIFO read by psql
#       passes. Same class as `$var` and scripts (didi, fc7d05f9 review).
#
# DO NOT DESCRIBE THIS AS "THE -f HOLE IS CLOSED". Our own prescribed recipe
# (readonly-measure.sh) uses the variable form, so the one sanctioned user of file
# delivery stays outside this check -- it does not need it (BEGIN TRANSACTION READ
# ONLY, gate proved before AND after).

TOOL_PATTERNS = [
    (r"prisma\s+migrate\s+reset", "prisma migrate reset -- drops and recreates the schema"),
    (r"prisma\s+migrate\s+dev", "prisma migrate dev -- writes to whatever DATABASE_URL points at; production deploys run `migrate deploy` from the pipeline, never by hand"),
    (r"prisma\s+db\s+push", "prisma db push -- applies the schema destructively, without a migration"),
    (r"supabase\s+db\s+reset", "supabase db reset"),
    (r"\bnpm\s+run\s+(db:reset|db:seed|dev:clean|dev:setup)\b", "an npm script that resets or seeds the database"),
    (r"\byarn\s+(db:reset|db:seed|dev:clean|dev:setup)\b", "a yarn script that resets or seeds the database"),
    (r"\bmake\s+db-", "a make db-* target"),
    # `dropdb` IS the statement, so it carries no SQL text for the SQL class to see.
    # Until 2026-09-26 `dropdb -h localhost <any database>` passed this gate untouched
    # (measured: find_hits -> [], card 251b5785). The one shape that stays allowed is
    # the narrow e2e carve-out further down (`e2e_drop_allowed`).
    (r"(?<![\w./-])dropdb(?![\w-])", "dropdb -- deletes a whole database"),
    # The same tool by PATH: `/opt/homebrew/bin/dropdb x` passed, because the lookbehind
    # above keeps `/` out (card 0f220f3f, didi measured it). Any word whose LAST path part
    # is exactly `dropdb` (`/opt/x/`, `./`, `~/`, and `bin/dropdb`, which the shell runs
    # as a path too); the bare name is refused as any word already, so `cat docs/dropdb`
    # is refused the same way `cat dropdb` is. `docs/dropdb.md`, `notes/dropdb-x` are not it.
    (r"(?<![\w.~/-])(?:[\w.~-]*/)+dropdb(?![\w./-])", "dropdb -- deletes a whole database"),
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
# the tool list: `prisma db execute --stdin` is a client, not just a CLI. A redirect may
# touch the name (`psql<<<"..."`, didi 50372 H1): that is still the client.
_DB_CLIENT_NAMES = (r"(psql|sqlite3|mysql|mariadb|mongo|mongosh|cockroach|pg_restore|pgcli|"
                    r"prisma|supabase|npx\s+prisma|dbmate|flyway|liquibase)([\s;&|)<>]|$)")
DB_CLIENTS = re.compile(r"(^|[\s;&|(])" + _DB_CLIENT_NAMES, re.I)
# The name may come with a directory (`/opt/homebrew/bin/psql`, `$PG/psql`, didi 50405
# J1): the fleet calls psql that way, and the shell runs the same client. That form counts
# ONLY in COMMAND POSITION -- the segment start or a `$(` / `<(` / `>(` anywhere (the bare
# name counts after those too: `echo $(psql ..)`), then env assignments, a launcher or a
# subshell mark. Anywhere, it would make every path argument ending in a client name one
# (`git grep "<mark" -- backend/api/prisma`, the fleet replay's one false refusal: the
# Delta-CRM repo has a `prisma` directory). Group 2 is the name, as in DB_CLIENTS.
# A directory may hold `@` and `+` (`/opt/homebrew/opt/postgresql@16/bin/psql`, the
# fleet's most common real path form, didi 50541 F-A2). A launcher option may take a
# value (`timeout -s KILL 5`, `sudo -u postgres`, F-A1); the value has no `/`, so it
# never swallows the client's path. Other prefixes (`ssh`, `find -exec`, `then`, `!`)
# are not read: the gate is a guard against slips, not a sandbox (population 0 of
# 217918 real commands, didi 50541).
_PATH_DIR = r"[\w.~${}@+-]*/"
_DB_CLIENT_PATH = re.compile(
    r"(?:^|[$<>]\()(\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:\"[^\"]*\"|'[^']*'|[^\s\"'])*\s+"
    r"|(?:timeout|gtimeout|nice|nohup|env|command|exec|time|caffeinate|sudo|doas|xargs)"
    r"(?:\s+(?:-\S+(?:\s+[^\s/-][^\s/]*)?|\d+(?:\.\d+)?[smhd]?))*\s+"
    r"|(?:\$\(|[(`{])\s*)*)"
    r"(?:" + _PATH_DIR + r")+" + _DB_CLIENT_NAMES, re.I)


def _db_client(text: str):
    """The DB client of a segment, bare anywhere or by path in command position; match
    with the name in group 2, or None."""
    return DB_CLIENTS.search(text) or _DB_CLIENT_PATH.search(text)


# A client held in a variable (`P=/opt/homebrew/opt/postgresql@15/bin/psql; $P -c "DROP
# DATABASE x"`, didi 50541): the shell runs the client, the text shows only `$P`. 3 of
# 306204 real commands had this shape, all on the shared e2e database, and all passed
# (card 485228fd). The use is replaced by the value, as the shell expands it, but only
# for a value that IS a client (bare or by path) and is assigned in the same command: a
# value from the environment or a file is not in the text the gate sees. `dropdb` is in
# the value list too: `P=/opt/homebrew/bin/dropdb; $P crm_x` passed (didi 50616, F-C1);
# the e2e carve-out reads the unexpanded command, and a `;` already keeps it out.
_VAR_CLIENT = re.compile(
    r"(?:^|[\s;&|(`])([A-Za-z_][A-Za-z0-9_]*)=([\"']?)((?:%s)*(?:psql|sqlite3|mysql|mariadb|mongo|"
    r"mongosh|cockroach|pg_restore|pgcli|prisma|supabase|dbmate|flyway|liquibase|dropdb))\2(?=[\s;&|)]|$)"
    % _PATH_DIR, re.I)


def expand_client_vars(command: str) -> str:
    """`command` with each `$NAME` / `${NAME}` of a variable assigned a DB client in it
    replaced by that client."""
    for name, _quote, value in {m.groups() for m in _VAR_CLIENT.finditer(command)}:
        command = re.sub(r"\$(?:\{%s\}|%s(?![A-Za-z0-9_]))" % (name, name), lambda _m: value, command)
    return command

# === CLOUD patterns: the third class, and it is here because a DENY LIST CANNOT
# EXPRESS IT (card 9e3f2f5c, group G3) =========================================
#
# didi's finding, 2026-08-19: the production checkout's permission list carries
# `Bash(gcloud:*)` next to an EMPTY deny list, so deleting a Cloud Run service or a
# secret needs no question from anyone. The card then spent three weeks arriving at a
# MECHANISM instead of an opinion (jarvis and computress, four probes and a positive
# control, 2026-09-06):
#
#     a `Bash(...)` rule is a LITERAL PREFIX on the raw command string. The only
#     wildcard is the closing `:*`; a `*` written INSIDE the pattern matches the
#     CHARACTER `*`. `Bash(gcloud * delete:*)` waits for a literal asterisk and
#     returns a confident, silent nothing.
#
# And the destructive verb of a gcloud invocation is its LAST word --
# `gcloud run services delete`, `gcloud secrets versions destroy`,
# `gcloud sql instances delete`. A prefix matcher can only reach it by ENUMERATING
# every command family, and an enumeration that forgets one forgets it SILENTLY.
# This card's own words for that: a pattern too narrow is worse than no pattern,
# because it buys a false sense of cover.
#
# A hook has the one property the deny list lacks -- it matches ANYWHERE in the
# string. So this class is positional but NOT a prefix: the CLI in command position,
# a destructive verb as a STANDALONE TOKEN anywhere among its arguments. There is no
# family list, so there is nothing to forget.
#
# WHAT IT COSTS, MEASURED BEFORE IT WENT IN, against the only real denominator there
# is -- the production checkout`s own `.bash_history`, i.e. what was actually typed:
#
#     gcloud invocations ......................... 81
#     of those with a standalone delete/destroy ..  0
#     what actually runs: run deploy 39, builds submit 34, config get-value 12,
#                         sql connect 7, secrets versions 1
#     the three CI workflows (deploy / rollback / maintenance): 0
#     CONTROL: the same measure over a synthetic `gcloud run services delete foo`
#              returns 1, so the zero is a real negative and not a blind matcher
#
# The blocking risk against today`s actual work is therefore zero, and the override
# stays one line away for the day someone genuinely needs the operation.
#
# THE TOKEN BOUNDARY IS A HYPHEN CLASS, NOT `\b`: `--delete-labels` and
# `--remove-env-vars` are FLAGS on otherwise ordinary commands, and `\b` matches
# inside them. `(?<![\w-])delete(?![\w-])` does not.
#
# WIDENED ON THE SAME DAY, and the reasoning is worth keeping because it reverses a
# decision made three hours earlier. The first version left `gh` and `kubectl` out on
# the grounds that this card had measured gcloud and nothing else. marveen ruled the
# other way, and the argument is the one this very class is built on: the objection to
# the deny-list route was that a FAMILY ENUMERATION has things to silently forget.
# Leaving three named families out of a rule whose SHAPE already covers them is that
# same failure with extra steps -- and `gh secret` was named explicitly in the finding
# that opened the card, so it was an open item, cheap to do and easy to never do.
#
# THE BLAST RADIUS FOR THE NEW FAMILIES, and BOTH denominators are partial -- said
# plainly, because a zero from a narrow window reads exactly like a zero from a wide one:
#
#     the production checkout`s `.bash_history` (532 lines, what Isti typed):
#         `gh` 0, `kubectl` 0 -- so nothing there to break, and the instrument is
#         known to fire, because the OLD gate already refused 15 of those 532 lines
#     the fleet tool log (`tool_call_log`), 484 Bash calls:
#         1 mentions any of the four CLIs, 0 with a destructive verb
#         BUT: that table holds ONLY the coordinator`s calls (534/534 rows are
#         marveen`s) and only 09-10 08:01-16:21. The capture hook lives in the
#         PROJECT-level settings, whose scope is the coordinator alone. So it is one
#         agent for eight hours, NOT the fleet, and it cannot say what dexter or
#         computress ran last week.
#
# So: no evidence of real destructive `gh`/`kubectl` use, from two partial windows.
# That is weaker than the gcloud number and it is not the same claim.
#
# WHAT IS STILL DELIBERATELY NOT COVERED:
#   - `gh secret list`, `gh secret --help`: reads, and the `set` pattern is written
#     narrowly enough to leave them alone.
#   - `gh pr close`, `gh run cancel`, `kubectl drain`, `kubectl scale --replicas=0`:
#     destructive in effect, no destructive VERB in the string. Adding them means
#     enumerating families again, which is the trap this class exists to avoid --
#     they need a different mechanism, not another alternation.
#   - hyphenated destructive flags (`--delete-unmatched-destination-objects`,
#     `--remove-iam-policy-binding`): excluded by the token boundary above, on
#     purpose, because catching them means catching every ordinary `--remove-*` flag.
#   - `gcloud auth revoke`, and any verb assembled at runtime (`gcloud $VERB delete`,
#     `bash deploy.sh`). Same residual as the SQL class, for the same reason: the hook
#     sees a command STRING, never the process that will run.
CLOUD_CLIS = re.compile(r"(^|[\s;&|(])(gcloud|gsutil|gh|kubectl)([\s;&|)]|$)")

CLOUD_PATTERNS = [
    (r"(?<![\w-])(delete|destroy)(?![\w-])",
     "a destructive verb (delete/destroy) on a platform CLI -- a deleted Cloud Run "
     "service, SQL instance, secret version, repository or Kubernetes object does "
     "not come back from this side"),
    (r"(?<![\w-])rm(?![\w-])",
     "gcloud storage / gsutil rm -- object deletion, which never contains the word "
     "`delete` and so no delete-shaped rule would ever see it"),
    # The one entry that is NOT a delete, and the reason it is here: didi named
    # `Bash(gh secret:*)` in the finding that opened this card, beside `sudo rm`
    # and `gcloud`. `gh secret set` OVERWRITES a CI credential in place -- there is
    # no destructive verb anywhere in the string, so every rule above is blind to
    # it, and the damage is a pipeline that starts failing with a valid-looking
    # config. `gh secret list` and `gh secret --help` are deliberately untouched.
    (r"(?<![\w-])gh\s+secret\s+set(?![\w-])",
     "gh secret set -- overwrites a CI credential in place; nothing in the command "
     "says `delete`, and the failure it causes surfaces as a broken pipeline"),
]

# === FORCE-PUSH: the fourth class, and it is here because the deny list can express
# the flag ONLY WHERE IT DOES NOT USUALLY STAND (card 9e3f2f5c, group G2) ========
#
# Unlike the CLOUD class, the deny list DOES bite here, and that was measured rather
# than assumed (computress, four probes with a positive control, 2026-09-06): a
# `Bash(...)` pattern ending in `:*` is a LITERAL PREFIX, one WITHOUT `:*` is an EXACT
# match. Both forms ship, in developer-senior and developer-junior:
#
#     Bash(git push --force)       exact  -> the bare `git push --force`
#     Bash(git push --force :*)    prefix -> `git push --force origin main`
#     Bash(git push -f:*)          prefix -> `git push -f ...`
#
# ALL THREE ANCHOR THE FLAG IMMEDIATELY AFTER `push`, AND THE ORDINARY FORM DOES NOT:
#
#     git push fork feat/x --force      <- matches none of them
#
# That limit was written down by hand on the card the day those rules shipped, and it
# cannot be closed by adding orderings. `git push <remote> <ref> --force`,
# `git push --no-verify --force`, `git push -q fork x -f` are ONE shape with the
# arguments permuted; a prefix matcher needs one rule per permutation, and a permutation
# nobody thought of is missed SILENTLY. That is the same failure the CLOUD class exists
# to avoid, so the same answer applies: two conditions in one segment, no list.
#
#     `git` in command position AND `push` as a standalone token
#     AND a force-shaped ARGUMENT anywhere among the arguments
#
# THE BOUNDARY IS **NOT** THE ONE THE CLOUD CLASS USES, and reusing it would produce a
# rule that compiles, reads correctly, passes review and NEVER FIRES. `(?<![\w-])X`
# has that lookbehind precisely to keep `--delete-labels` out -- and a FLAG is exactly
# that shape: the character before `force` in `--force` IS a hyphen. So the flag rules
# below match the WHOLE flag token, hyphens included. The look-AHEAD stays, and it is
# what keeps `--force-with-lease` out: the safe variant has to remain usable, or the
# gate would be pushing people toward the dangerous one.
#
# BLAST RADIUS, measured before it went in, on the denominator the CLOUD class used --
# the production checkout's `.bash_history`, 567 lines, i.e. what Isti actually typed:
#
#     `git` in command position .................. 33
#     of those with a standalone `push` ..........  4  -- all four `git push -u origin main`
#     of those, force-shaped .....................  0
#     CONTROL, one per axis: the same three matchers say TRUE on synthetic
#         `git push fork feat/x --force`, `git push -fu origin main` and
#         `git push origin +main:main`, so no axis is blind
#     AND THE REASON THE CLASS IS SCOPED TO A PUSH SEGMENT, from the same history:
#         2 lines carry a bare `--force` (`npm run dev -- --force`) and 9 carry a short
#         option containing an f (`rm -rf node_modules`). Un-scoped, this rule would
#         refuse eleven lines of ordinary work on day one.
#     the fleet tool log (`tool_call_log`), 753 Bash calls: 154 mention `git`, ONE has a
#         standalone `push` (`git push fork "$BR"`), 0 force-shaped. PARTIAL in the same
#         two ways as before, said plainly: 826/826 rows are the coordinator's, the
#         window is one 12-hour day (2026-09-10 08:01-20:04), and the column is a summary
#         that may be truncated.
#
# AND HERE THE FALSE-REFUSAL COST IS NEAR ZERO BY **POLICY**, NOT BY LUCK -- a stronger
# footing than a usage count, which only says what happened to be typed: force-push is a
# forbidden form in this fleet, stated outright in the rulebook, and the three deny rules
# above exist to enforce it. A gate that refuses one refuses something nobody should be
# doing; the override is one line away for the day it is genuinely needed.
#
# WHAT IS DELIBERATELY NOT COVERED:
#   - `git push --delete <branch>` and `git push origin :branch`. Deleting a merged
#     feature branch on the remote is ORDINARY HOUSEKEEPING. A rule against it would
#     flag the correct action, which this file argues is worse than no rule at all.
#   - `--force-with-lease` / `--force-if-includes`: the safe variants, excluded by the
#     same boundary that keeps `--delete-labels` out of the CLOUD class.
#   - `git push --mirror`, which force-updates every ref and deletes the ones missing
#     locally. Not force-push but a MODE, zero occurrences in both denominators, and
#     covering it starts a mode list -- exactly the enumeration this class avoids. It is
#     named here so the next reader inherits the argument instead of the omission.
#   - a flag that arrives through a quoted argument or a variable (`git push fork x
#     "$FLAGS"`): quoted text is blanked before matching, so the hook cannot see it.
#     Same residual as every other class here, for the same reason.
GIT_CLI = re.compile(r"(^|[\s;&|(])git([\s;&|)]|$)")
GIT_PUSH_VERB = re.compile(r"(?<![\w-])push(?![\w-])")

GIT_PUSH_PATTERNS = [
    (r"(?<![\w-])--force(?![\w-])",
     "git push --force -- rewrites the remote branch; the fleet rulebook lists it as a "
     "forbidden form, and `--force-with-lease` is the variant that stays allowed"),
    # Short options can be GROUPED (`git push -fu origin main` is `-f` plus `-u`), so the
    # `f` is looked for inside a single-dash token rather than only on its own. In a
    # `git push` segment the only tokens of this shape are its short options, and the
    # only one containing an f is the force flag.
    (r"(?<![\w-])-[A-Za-z]*f[A-Za-z]*(?![\w-])",
     "git push -f (also grouped, e.g. -fu) -- the short form of --force, and the one a "
     "prefix rule anchors hardest, so it is the likeliest to arrive after the arguments"),
    # git's own equivalent of --force for a single ref, and it shares NOT ONE WORD with
    # the other two: a rule shaped around the word `force` is structurally blind to it.
    # `(?<!\S)` requires the `+` to open a whitespace-delimited argument, so `A+B:C`
    # inside some other value is not a refspec.
    (r"(?<!\S)\+[\w./*^~-]+:",
     "a `+<src>:<dst>` refspec -- git's own force-update form for one ref, which never "
     "contains the word `force` and so no force-shaped rule would ever see it"),
]

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
# AND THE TOOL HALF OF THAT SENTENCE HIDES A THIRD CASE (card ffa3b565, dexter,
# 2026-09-06 -- again during ordinary work, not by probing). "More chances to hit"
# reads as harmless: an extra check on text that would not have matched anyway. It
# is not harmless. On the TOOL class an extra boundary does not merely give the
# matcher another look -- it MANUFACTURES the hit that the position rule exists to
# prevent, and it does so on exactly the input the rule was written for.
#
# THE MECHANISM IS THE ORDER OF TWO STEPS IN `find_hits`, and each step is correct
# on its own:
#
#   1. `_SEG.split(command)`        -- splits, and is QUOTE-BLIND by construction
#   2. `_command_position_text(seg)` -- blanks quoted spans, WITHIN a segment
#
# Step 2 can only blank a quoted span it can SEE. When step 1 runs first, a quoted
# argument that happens to contain a separator is already torn into fragments, and
# no fragment holds a matching pair of quotes any more. Each fragment then starts
# in command position with nothing left to blank -- so the very words the docblock
# above promises are "text inside a quoted argument" are read as a command.
#
# The measured instance: a mutation driver passing its edits as quoted arguments,
# denied 2026-09-06 02:50:51. Nothing in it was a command; the separator inside a
# quoted string was.
#
# THE PRICE OF A QUOTE-AWARE SPLIT, MEASURED ON THIS GATE'S OWN LOG rather than on
# invented cases -- every command it ever produced a DENY or an OVERRIDE for:
#
#   32 distinct commands, of which 15 are faithfully replayable
#   denials LOST with a quote-aware split ............ 0 / 15
#   commands newly DENIED by it ...................... 0 / 15
#   positive control (the meter CAN say "newly denied"): a synthetic command whose
#     client and statement sit in separate segments but inside one quoted string
#     -- PASS today, DENY under a quote-aware split. Without it the two zeroes
#     above would be describing the meter, not the corpus.
#
#   MY FIRST CONTROL FAILED, AND THE FAILURE IS THE USEFUL PART: it put the client
#   directly after a quote (`'psql ...`), and `DB_CLIENTS` anchors on
#   `(^|[\s;&|(])`, so the client was never recognised and the split was not what
#   decided the verdict. A control that fails is worth more than one that passes:
#   this one was measuring the wrong variable. (That anchor is a separate property
#   of this file, unchanged and not a regression -- stated here only so the next
#   person does not lose an hour to it as I did.)
#
# WHAT THAT PRICE CANNOT ANSWER, AND IT IS THE HALF THAT MATTERS FOR THE OPEN
# QUESTION. The unparseable branch -- what to do when quotes do not balance --
# never runs on this corpus: 0 of the 15 carry an unbalanced quote. So the zeroes
# above are NOT "the direction is free"; they are "this corpus cannot decide the
# direction". The two sibling gates already answer it in OPPOSITE directions, each
# correct for its own population (see `email-send-gate.mjs` and
# `outgoing-copy-gate.py`, and the comment-only ruling in fe418df) -- so it is not
# inheritable either, and it stays open on the card.
#
# AND THE 17 TRUNCATED LOG ENTRIES CANNOT BE PRESSED INTO SERVICE FOR IT. The log
# stores `command[:400]`, 8 of those 17 carry an unbalanced quote, and that 8 is an
# artifact: cutting a balanced command at an arbitrary point produces an unbalanced
# prefix at 193 of the 716 cut positions across the 15 replayable commands (27%),
# on 8 of the 15. Measuring the branch there would report it as common precisely
# because the log truncates -- a number that rises with the cut, not with reality.
#
# NOTHING ABOVE CHANGES BEHAVIOUR. The ordering fix is a decision, not a cleanup,
# and it is not made here.
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
#
# The `&` of a redirect is not a separator (didi 50405 J2): `2>&1`, `1>&2`, `<&0` and
# `&>file` are one word to the shell, but a split on every `&` cut `psql 2>&1 -c ".."`
# into `psql 2>` and `1 -c ".."`, the client and its statement in two segments, and the
# statement was never checked (the trailing `-c ".." 2>&1` was). Not splitting there can
# only join segments, never separate them -- more checks, never fewer.
_SEG = re.compile(r"(?:\|\||&&|[;\n|]|(?<![<>])&(?!>))")


def _redirect_amp(command: str, i: int) -> bool:
    """Is the `&` at `command[i]` part of a redirect (`>&`, `<&`, `&>`)? See _SEG."""
    return (i > 0 and command[i - 1] in "<>") or command.startswith("&>", i)


def _split_outside_quotes(command: str):
    """Segments for the SQL class: the same separators as `_SEG`, but NOT inside a
    quoted string.

    WHY THE SQL CLASS NEEDS ITS OWN SPLIT (card 251b5785, measured 2026-09-26): the SQL
    class needs a client AND a statement in ONE segment, and `_SEG` splits on the `;`
    INSIDE `psql -c "select 1; <destructive statement>"`. The second statement landed in
    a segment with no client and was never checked -- find_hits returned [] for it,
    while the same statement alone was refused. A shell does not split inside quotes,
    so this split follows the shell.

    It can only MERGE segments that `_SEG` would have separated, never separate ones it
    would have joined, so for a class that needs co-occurrence it can only add checks.
    An unbalanced quote swallows the rest of the command into one segment -- same
    direction, more checks, never fewer."""
    out, cur, quote, i = [], [], None, 0
    while i < len(command):
        ch = command[i]
        if quote:
            cur.append(ch)
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
            cur.append(ch)
        elif command.startswith("||", i) or command.startswith("&&", i):
            out.append("".join(cur))
            cur = []
            i += 2
            continue
        elif ch == "&" and _redirect_amp(command, i):
            cur.append(ch)
        elif ch in ";\n|&":
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    out.append("".join(cur))
    return out
_LINE_CONT = re.compile(r"\\\n")
_ENV_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


# What may touch a quoted span that is unquoted as part of a shell word: a word character,
# another quote, whitespace, a command separator or a redirect (`"psql"<<<".."`, didi 50542
# F-B1). Not a bracket, comma or paren.
_QUOTED_WORD_EDGE = re.compile(r"[\w./~+:=@%\-\s;&|`\"'<>]")


def _command_position_text(segment: str) -> str:
    """The part of a segment that a shell would treat as command + arguments,
    with quoted strings blanked out so their CONTENTS cannot look like a command.

    A quoted span WITHOUT whitespace is one word to the shell, the same word as
    unquoted, so its quotes are removed instead (card e81a72b7): `"<tool>" x`,
    `d"ropdb"` and `'prisma' migrate reset` ran the tool while the blanking hid it.
    What it costs: a one-word quoted argument counts like the bare word already does
    (`-m "<tool>"` is refused as `-m <tool>` is; replayed 2026-10-31: 1 new refusal in
    306204 commands, a grep pattern spelled as two adjacent quoted halves). A span with
    whitespace is prose or several words and stays blanked; an unclosed quote blanks
    the rest. So does a span glued to anything but a shell-word character
    (_QUOTED_WORD_EDGE): `run(['<tool>','x'])` is interpreter code read through this
    class, not a shell word (7 interpreter-code controls refused it)."""
    out, i, n = [], 0, len(segment)
    while i < n:
        ch = segment[i]
        if ch in "\"'":
            j = segment.find(ch, i + 1)
            if j < 0:
                out.append(ch + " " * (n - i - 1))
                break
            body = segment[i + 1:j]
            edges = (segment[i - 1] if i else " ", segment[j + 1] if j + 1 < n else " ")
            # An EMPTY span too: `""psql`, `p""sql` are psql to the shell (didi 50590 F-B3).
            if not any(c.isspace() for c in body) and all(_QUOTED_WORD_EDGE.match(e) for e in edges):
                out.append(body)
            else:
                out.append(ch + " " * len(body) + ch)
            i = j + 1
            continue
        out.append(ch)
        i += 1
    text = "".join(out)
    # Drop leading VAR=value assignments so `FOO=1 prisma migrate reset` still reads
    # as a prisma invocation.
    parts = text.split()
    while parts and _ENV_ASSIGN.match(parts[0]):
        parts.pop(0)
    return " ".join(parts)


# `<<\\PY` (a backslash-quoted delimiter) is the same quoted heredoc as `<<'PY'` to a
# shell; without it the body ran unrecognised (didi 50294, K2).
_HEREDOC = re.compile(r"<<-?\s*(?:\\(?=[A-Za-z_]))?([\"\']?)([A-Za-z_][A-Za-z0-9_]*)\1")
# The interpreters whose heredoc body or `-c`/`-e` argument is CODE, not shell. The
# list is the executor side of strip_heredoc_bodies AND the trigger of the INTERPRETER
# CODE class below, so one name cannot be in one and missing from the other.
_INTERPRETER = r"python(?:3(?:\.\d+)?)?|node|tsx|deno|bun|perl|ruby"


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
            # The opener the way _command_words reads a command (0f220f3f): by path too
            # (`/bin/bash <<EOF`), after a subshell mark (`(bash <<EOF`), and glued to the
            # redirect (`bash<<EOF`, didi 50344, G2); each of those dropped an executed body.
            # The directory as _DB_CLIENT_PATH reads it (`$HOME/bin/psql`, `postgresql@16`,
            # didi 50541 F-A3).
            # A quoted name runs the same client (`"psql" <<'EOF'`, didi 50542 F-B1), and so
            # does a partly quoted one (`p"sql" <<'EOF'`, 50590 F-B3): the line is read
            # also the way _command_position_text joins a shell word.
            opener = (r"(^|[\s;&|(`])[\"']?(?:%s)*(bash|sh|zsh|dash|ksh|psql|sqlite3|mysql|%s)[\"']?([\s;&|<]|$)"
                      % (_PATH_DIR, _INTERPRETER))
            executes = re.search(opener, line) or re.search(opener, _command_position_text(line))
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


# --- LITERAL-PATH FILE ARGUMENTS (card fc7d05f9, from friday's 2e08a7e1) --------
# When a DB client is handed a FILE, the statements live in the file, so the command
# text alone can never see them. The file is read and each STATEMENT (split on `;`,
# newlines joined) is appended PREFIXED with the client -- the same trick as an
# executed heredoc body -- so the SQL class finds client and statement in one segment.
#
# WHY STATEMENTS AND NOT LINES: a line-by-line prefix turns a legal two-line
# `DELETE FROM t` / `WHERE id = 1;` into `psql DELETE FROM t`, a FALSE refusal of the
# commonest safe shape. Joining lines first keeps the WHERE with its DELETE.
#
# THE WHOLE FILE IS READ. friday's version stopped at line 400 with no log, so a
# statement on line 401 passed silently (didi measured it) -- the worst kind of gap,
# because the gate looked like it had checked.
#
# WHAT COULD NOT BE CHECKED IS A REFUSAL, NOT A PASS (fail-closed), with one exception:
#   exists but unreadable / over the size cap / relative path with no cwd -> DENY,
#       and the reason names the way out (absolute path, or MARVEEN_DB_GATE=allow).
#   does NOT exist -> ALLOW + log. The client itself fails on a missing file, so a
#       refusal protects nothing and only adds friction (didi's reading, accepted).
# The size cap is generous (16 MiB): a pg_dump restore is a legitimate big file, and a
# `--clean` dump really does contain drops -- refusing it is this gate doing its job.
#
# OVER-BLOCKING is prevented structurally: expansion happens only in a segment that
# already invokes a DB client, so `grep -f pats`, `docker compose -f x.yml`,
# `make -f Makefile` never reach it. `\i` inside an expanded file is followed too, up
# to _MAX_FILE_DEPTH levels.
_FILE_ARG = re.compile(
    r"(?:^|\s)(?:-f|--file)(?:=|\s+)(\S+)"      # psql -f x.sql / --file=x.sql
    r"|(?<![<0-9])<(?![<(])\s*(\S+)"           # psql < x.sql  (never a heredoc)
    r"|\\(include_relative|include|ir|i)\s+(\S+)"   # psql \i x.sql
)
# `cat a.sql b.sql | psql` -- the files sit in the segment BEFORE the pipe, so they are
# found on the whole command, not per segment. Every non-option argument counts.
_CAT_PIPE = re.compile(r"(?:^|[\s;&(])cat((?:\s+[^\s|;&]+)+)\s*\|\s*((?:[A-Za-z_]\w*=\S*\s+)*\S+)")
# A path we can resolve without running anything. Anything with shell expansion in it
# is deliberately skipped: guessing what `$f` held is how a gate starts lying.
_LITERAL_PATH = re.compile(r"^[\w./~+-]+$")
_MAX_FILE_BYTES = 16 * 1024 * 1024
_MAX_FILE_DEPTH = 3
# Streams the hook cannot read without consuming them, and which are the caller's own
# input anyway: nothing to check, and opening them would steal or hang.
_STREAM_PATH = re.compile(r"^/dev/(stdin|fd/\d+)$")


def _read_sql_file(path, base):
    """(text, resolved_path, None) on success, or (None, resolved_path, reason).
    reason "skip:<why>" means log-and-allow; any other reason means refuse. Never
    raises, and never blocks: only REGULAR files are opened (a FIFO hung verdict()
    for >5 s in didi's probe, and /dev/zero reports size 0 so a size check alone
    never trips), and the read itself is capped at MAX+1 bytes."""
    try:
        if path.startswith("~"):
            path = os.path.expanduser(path)
        if not os.path.isabs(path):
            if not base:
                return None, path, "relative path and no cwd to resolve it"
            path = os.path.join(base, path)
        if _STREAM_PATH.match(path):
            return None, path, "skip:the caller's own input stream"
        if not os.path.exists(path):
            return None, path, "skip:does not exist"
        if not os.path.isfile(path):
            return None, path, "skip:not a regular file (directory, FIFO or device)"
        with open(path, "rb") as fh:
            data = fh.read(_MAX_FILE_BYTES + 1)
        if len(data) > _MAX_FILE_BYTES:
            return None, path, "larger than %d MiB" % (_MAX_FILE_BYTES // (1024 * 1024))
        return data.decode("utf-8", errors="replace"), path, None
    except Exception as exc:
        return None, path, "unreadable (%s)" % type(exc).__name__


def _file_refs(command: str, cwd, script_dir):
    """(client, raw_path, base_dir) for every file handed to a DB client.

    ONLY when the client is in COMMAND POSITION (quoted text blanked), like the TOOL,
    CLOUD and GIT classes: a card title or commit message that merely MENTIONS
    `psql -f /` must not make the gate open `/` (didi, fc7d05f9: the one new denial in
    61 replayed real commands was exactly that). `\\ir` resolves against the including
    FILE's directory, everything else against the cwd -- as psql does."""
    refs = []
    for segment in _split_outside_quotes(command):
        client = _db_client(_command_position_text(segment))
        if not client:
            continue
        name = client.group(2)
        for m in _FILE_ARG.finditer(segment):
            if m.group(4):
                base = script_dir if m.group(3) in ("ir", "include_relative") else cwd
                refs.append((name, m.group(4), base))
            else:
                refs.append((name, m.group(1) or m.group(2) or "", cwd))
    for m in _CAT_PIPE.finditer(command):
        client = _db_client(" " + m.group(2))
        if client:
            for arg in m.group(1).split():
                if not arg.startswith("-"):
                    refs.append((client.group(2), arg, cwd))
    return refs


def expand_file_args(command: str, cwd=None):
    """(extra_lines, problems, skipped). `extra_lines` are client-prefixed statements
    from every readable literal file; `problems` are files that could not be checked
    -- each becomes a refusal; `skipped` are paths deliberately not read (missing,
    directory, stream) -- logged, not refused, because the client itself fails on them
    or they are the caller's own input."""
    extra, problems, skipped, seen = [], [], [], set()
    pending = [(command, cwd)]
    for _ in range(_MAX_FILE_DEPTH):
        found = []
        for text_in, script_dir in pending:
            for name, raw, base in _file_refs(text_in, cwd, script_dir):
                raw = raw.strip().strip("\"'")
                if not raw or raw == "-" or not _LITERAL_PATH.match(raw):
                    continue
                text, resolved, why = _read_sql_file(raw, base)
                if resolved in seen:
                    continue
                seen.add(resolved)
                if why and why.startswith("skip:"):
                    skipped.append("%s (%s)" % (raw, why[5:]))
                    continue
                if text is None:
                    problems.append("a file handed to %s could not be checked: %s -- %s. "
                                    "Use an absolute path, or MARVEEN_DB_GATE=allow if it "
                                    "is meant." % (name, raw, why))
                    continue
                stmts = ["%s %s;" % (name, st.strip())
                         for st in text.replace("\r", " ").replace("\n", " ").split(";")
                         if st.strip()]
                extra.extend(stmts)
                found.append(("\n".join(stmts), os.path.dirname(resolved)))
        if not found:
            break
        pending = found
    return extra, problems, skipped


# === INTERPRETER CODE: the fifth class, because an executed body is CODE, not shell
# (card 94d86b92) ===============================================================
#
# marveen's measurement, 2026-10-31, on the live tree a8cac9e26 (store/gate-probes/):
#
#     python3 - <<'PY' ... subprocess.run(['dropdb', '--if-exists', n]) ... PY  -> ALLOW
#     dropdb --if-exists <same name>                                         -> DENY
#
# and it was not a probe only: 54 idle test databases were dropped that way the same
# night, and the gate never spoke. The mechanism is two correct rules composed again.
# strip_heredoc_bodies KEEPS a python body and prefixes every line with `python3`, so
# the body is checked -- but it is checked AS SHELL, and shell rules blank quoted text.
# In code the command name IS a quoted string (`'dropdb'`), and `['psql', '-c', sql]`
# puts a quote, not a space, before the client the SQL class looks for. Every name the
# gate knows arrives in exactly the form the shell rules are built to ignore.
#
# So an executed interpreter body (heredoc, or the argument of `python3 -c` / `node -e`)
# gets a second reading as code:
#   1. adjacent string literals are FOLDED first: `'drop' + 'db'` and `'drop' 'db'`
#      become `'dropdb'`. That is the second shape marveen used (comment on the card) --
#      a gate that one `+` switches off is not a gate.
#   2. quotes and list/call punctuation become spaces, so `['npx', 'prisma', 'migrate',
#      'reset']` reads `npx prisma migrate reset`, and the TOOL, CLOUD and GIT classes
#      run over each line exactly as they run over a shell segment.
#   3. the SQL class needs client AND statement in one place, as everywhere else -- but
#      in code that place is the whole BODY, not a line: the statement is usually a
#      variable a few lines above the call. The client is either a CLI reached through a
#      process sink, or a driver the code imports in its own language (psycopg,
#      asyncpg, sqlalchemy, `pg`, `@prisma/client`, ...).
#      `DELETE FROM t` also ends at a closing quote or bracket here, because in code the
#      statement sits inside `execute("...")`, not before a `;`.
#
# WHAT IS STILL NOT COVERED, and it is the same boundary as `psql -f "$f"`: a name or
# statement built at runtime -- a variable, `''.join(...)`, a slice, `chr()`, base64,
# a file the code reads. The hook sees a command string, never the process that will
# run. This class closes the TYPED shape, including a typed literal concatenation; it
# does not make the gate a sandbox. The way to run a genuinely intended drop stays one
# token: MARVEEN_DB_GATE=allow, which leaves a log line (marveen's own correction on
# the card: the concatenated name left none).
#
# THE FALSE-REFUSAL SIDE, MEASURED, and it decided the shape. The first version read
# every executed body as code with no further condition. Replayed against the fleet's
# real traffic -- 306 204 unique Bash commands from 30 days of every agent's transcripts,
# old gate vs new, nothing executed -- it refused 32 commands the old gate allowed, and
# about 24 of them were python heredocs that only EDIT a file (`s.replace(...)` with a
# drop command as the text being inserted) or write notes. Roughly one false refusal a
# day across the fleet, on exactly the editing work the gate exists to leave alone. So
# a name only counts when the code has a PROCESS SINK (subprocess, os.system,
# child_process, system(), ...) and SQL only with a client it can reach (a CLI through a
# sink, or an imported driver). What that still refuses: an editing script that also
# runs a subprocess, which is loud and one token away from passing. What it gives up:
# a sink reached without its name (`__import__('sub' + 'process')`) -- runtime-built,
# the boundary above. The numbers after the change are in the card 94d86b92 hand-off.
# Prose written by `cat > x.md` is untouched -- cat executes nothing -- and the Write
# tool never reaches this hook.
_CODE_FOLD = re.compile(r"[\"'`]\s*\+?\s*[\"'`]")
_CODE_PUNCT = re.compile(r"[\"'`,\[\](){}]")
# A CLI client only runs from code through a process sink; a driver runs by itself, but
# only when the code IMPORTS it in its own language -- a python body that writes a
# TypeScript test file full of `@prisma/client` imports runs no database.
_CODE_CLI_CLIENTS = re.compile(
    r"(?<![\w-])(psql|sqlite3|mysql|mariadb|mongo|mongosh|cockroach|pg_restore|pgcli|"
    r"prisma|supabase|dbmate|flyway|liquibase)(?![\w-])", re.I)
_CODE_SINKS = {
    "python": re.compile(r"\bsubprocess\b|\bcreate_subprocess_(?:exec|shell)\b|"
                         r"\bos\.(?:system|popen|exec\w*|spawn\w*)\b|\bpty\.spawn\b"),
    "node": re.compile(r"\bchild_process\b|\b(?:execSync|execFileSync|spawnSync)\b|\bBun\.spawn|\bDeno\.(?:Command|run)\b"),
    "perl": re.compile(r"\bsystem\s*\(|\bexec\s*\(|\bqx\s*[(\[{/]|`|\bIPC::|\bopen\s*\(?[^\n]*\|"),
    "ruby": re.compile(r"\bsystem\s*\(|\bexec\s*\(|%x\s*[(\[{]|`|\bOpen3\b|\bIO\.popen\b|\bspawn\s*\("),
}
_CODE_DRIVERS = {
    # Any module of an `import a, b as c, ...` list counts, not only the first (didi 50294, K4).
    "python": re.compile(r"^\s*(?:import\s+(?:[\w.]+(?:\s+as\s+\w+)?\s*,\s*)*|from\s+)"
                         r"(?:psycopg2?|psycopg|sqlite3|asyncpg|sqlalchemy|pg8000|"
                         r"pymysql|MySQLdb|mysql\.connector|duckdb)\b", re.M),
    "node": re.compile(r"require\(\s*[\"'`](?:pg|mysql2?|better-sqlite3|sqlite3|knex|@prisma/client|postgres|mssql)"
                       r"[\"'`]\s*\)|^\s*import\b[^\n]*\bfrom\s*[\"'](?:pg|mysql2?|better-sqlite3|sqlite3|knex|"
                       r"@prisma/client|postgres|mssql)[\"']", re.M),
    "perl": re.compile(r"\bDBI\b"),
    "ruby": re.compile(r"require\s*\(?\s*[\"'](?:pg|sqlite3|mysql2|sequel|active_record)[\"']"),
}
# The terminator is `; ) ] ,` or the end -- NOT a quote. A quote there made the regex back off
# one closing quote and read the `"` of `delete from "DuplicatePair" where id=...` as the end of
# the statement: a false refusal the fleet replay found in mandark's real traffic. A statement in
# code still ends at its call's `)` or list's `]`/`,` once the closing quotes are consumed.
_CODE_DELETE = re.compile(
    r"\bDELETE\s+FROM\s+[\\\"\'`]*[\w.]+[\\\"\'`]*\s*(?:;|$|[)\],])", re.I)
_CODE_FLAG = re.compile(r"^(?:-[A-Za-z]*[cCeEp]|--eval|--print)$")
_INTERPRETER_WORD = re.compile(r"^(?:.*/)?(?:%s)$" % _INTERPRETER)


def _code_lang(word: str) -> str:
    name = word.rsplit("/", 1)[-1]
    if name.startswith("python"):
        return "python"
    return name if name in ("perl", "ruby") else "node"


def _split_with_seps(command: str):
    """(segment, separator after it) with the split of _split_outside_quotes, so a
    pipeline stage can see that it is fed by the one before it."""
    out, cur, quote, i = [], [], None, 0
    while i < len(command):
        ch = command[i]
        if quote:
            cur.append(ch)
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
            cur.append(ch)
        elif command.startswith("||", i) or command.startswith("&&", i):
            out.append(("".join(cur), command[i:i + 2]))
            cur = []
            i += 2
            continue
        elif ch == "&" and _redirect_amp(command, i):
            cur.append(ch)
        elif ch in ";\n|&":
            out.append(("".join(cur), ch))
            cur = []
        else:
            cur.append(ch)
        i += 1
    out.append(("".join(cur), ""))
    return out


# Subshell and substitution marks GLUED to a word (didi 50316, F1): `(bash -c "..")`,
# `x=$(bash -c "..")`, a backtick, `(eval "..")`, `(python3 -c "..")`. shlex reads
# `(bash` as ONE word, which is no shell or interpreter word, so the code it runs was
# never read; with a space (`( bash -c`) it was. Outside quotes each of ( ) ` is split
# off into a word of its own and then dropped, with the lone `$` a `$(` leaves (else
# `$(echo .. | bash)` has `$` where `echo` is looked for). Inside quotes nothing is
# padded: the text there is code that is read again, and `require ( "pg" )` would no
# longer be the driver import. A `$(...)` or a backtick INSIDE double quotes is not
# split: that boundary is card e81a72b7's.
_SUBSHELL_MARKS = ("(", ")", "`", "$")
# `&>` glued the same way (`bash&>/dev/null -c ..`, didi 50541 F-A4).
_GLUED_REDIRECT = re.compile(r"^([^<>&]+?)(&?[<>].*)$", re.S)
_REDIRECT_PIECE = re.compile(r"\d*[<>]+&?[^<>]*", re.S)


def _command_words(segment: str):
    """shlex words of one segment, glued subshell marks split off and dropped. Raises
    ValueError like shlex.split."""
    out, quote, i = [], None, 0
    while i < len(segment):
        ch = segment[i]
        if ch == "\\" and quote != "'" and i + 1 < len(segment):
            out.append(segment[i:i + 2])
            i += 2
            continue
        if quote:
            if ch == quote:
                quote = None
            out.append(ch)
        elif ch in "\"'":
            quote = ch
            out.append(ch)
        elif ch in "()`":
            out.append(" %s " % ch)
        else:
            out.append(ch)
        i += 1
    words = [w for w in shlex.split("".join(out), comments=False, posix=True) if w not in _SUBSHELL_MARKS]
    # A redirect GLUED to a shell or interpreter name is the same root (didi 50344, G2):
    # `bash<<<"..."`, `bash</dev/null -c ..`, `python3<<<"..."` are one shlex word, so the
    # name is split off. Only after such a name: `2>/dev/null` stays one word. Behind
    # one, a redirect glued to the previous redirect is split off too (`bash
    # 2>/dev/null<<<".."`, didi H1): the spaced form was already refused.
    split, after = [], False
    for w in words:
        m = _GLUED_REDIRECT.match(w)
        if m and (_SHELL_WORD.match(m.group(1)) or _INTERPRETER_WORD.match(m.group(1))):
            split.extend(m.groups())
            after = True
        elif after and _SHELL_REDIRECT.match(w):
            split.extend(_REDIRECT_PIECE.findall(w))
        else:
            split.append(w)
            after = after or bool(_SHELL_WORD.match(w) or _INTERPRETER_WORD.match(w))
    return split


def _interpreter_at(words):
    """Index of the first interpreter word, or -1. ANY position, not only the first:
    `timeout 60 python3 -c`, `nice`, `env`, `sudo -u x`, `uv run python`, `npx tsx -e`
    all put a launcher in front, and listing launchers is a list that is never complete
    (didi 50294, K1: those five passed while the same prefixes denied in plain shell).
    What it costs: an interpreter NAME as an argument (`which python3 -c x`) also reads
    its flag's argument as code -- which then still needs a process sink to count."""
    return next((k for k, w in enumerate(words) if _INTERPRETER_WORD.match(w)), -1)


# Per interpreter: the short options whose code is their argument, the ones that run a
# module instead of stdin, and the ones that take a VALUE (`-W ignore`, `-r x`, `-I lib`).
# A value is not the script: reading `ignore` as one let `python3 -W ignore - <<PY` code
# pass (didi, 94d86b92 r2, K5). Taking an unsure option as value-taking errs to the code side.
_STDIN_CODE_LETTERS = {"python": "c", "node": "ep", "ruby": "e", "perl": "eE"}
_STDIN_MODULE_LETTERS = {"python": "m"}
_STDIN_VALUE_LETTERS = {"python": "WXQ", "node": "rC", "ruby": "rICEFT", "perl": "IMm"}
_STDIN_CODE_LONG = ("--eval", "--print")
_STDIN_VALUE_LONG = ("--require", "--import", "--loader", "--experimental-loader", "--conditions",
                     "--input-type", "--env-file", "--title", "--inspect-port", "--disable-warning",
                     "--check-hash-based-pycs", "--encoding", "--external-encoding", "--internal-encoding")


def _reads_code_from_stdin(words, lang="python") -> bool:
    """The interpreter runs its STDIN as code: no script argument, or `-`. With a script
    (`python3 x.py <<EOF`) the heredoc is that script's DATA (didi 50294, N7), and with
    -c/-e the code is the argument. An unknown long option followed by a word cannot be
    told apart from a script (`--foo x.py` or `--foo value`): that counts as code."""
    if "-" in words:
        return True
    k = 0
    while k < len(words):
        w = words[k]
        if w == "--":
            return k + 1 >= len(words)
        if w.startswith("--"):
            if w in _STDIN_CODE_LONG:
                return False
            if "=" not in w and k + 1 < len(words) and not words[k + 1].startswith("-"):
                if w in _STDIN_VALUE_LONG:
                    k += 2
                    continue
                return True
            k += 1
            continue
        if w.startswith("-") and len(w) > 1:
            letters = w[1:]
            for j, ch in enumerate(letters):
                if ch in _STDIN_CODE_LETTERS.get(lang, "") or ch in _STDIN_MODULE_LETTERS.get(lang, ""):
                    return False
                if ch in _STDIN_VALUE_LETTERS.get(lang, ""):
                    if j == len(letters) - 1:
                        k += 1  # the value is the next word
                    break  # attached value (`-Wignore`, `-rjson`) ends the cluster
            k += 1
            continue
        return False  # the first operand is the script
    return True


def interpreter_code_blocks(command: str):
    """(language, code) for every piece of interpreter CODE the command will execute:
    heredoc bodies whose opener runs an interpreter reading stdin, the argument of `-c` /
    `-e` / `--eval`, a here-string (`<<<`), and an `echo`/`printf` piped into an
    interpreter. An argument that cannot be tokenised is returned whole -- an extra
    check, never a missed one."""
    blocks = []
    lines = command.split("\n")
    i = 0
    opener = re.compile(r"(^|[\s;&|(`])(%s)([\s;&|<]|$)" % _INTERPRETER)
    while i < len(lines):
        m = _HEREDOC.search(lines[i])
        o = opener.search(lines[i]) if m else None
        if o:
            body, i0, i = [], i, i + 1
            while i < len(lines) and lines[i].strip() != m.group(2):
                body.append(lines[i])
                i += 1
            # The interpreter's own arguments, from its name to the `<<` or the next
            # separator (`python3 - <<PY`, and `cat <<PY | python3 -` after the pipe).
            # An untokenisable opener counts as code -- the safe side.
            head = re.split(r"<<|[;&|]", lines[i0][o.end(2):], maxsplit=1)[0]
            try:
                as_code = _reads_code_from_stdin(shlex.split(head, posix=True), _code_lang(o.group(2)))
            except ValueError:
                as_code = True
            if as_code:
                blocks.append((_code_lang(o.group(2)), "\n".join(body)))
        i += 1
    stages = _split_with_seps(_LINE_CONT.sub(" ", command))
    for n, (segment, _sep) in enumerate(stages):
        try:
            words = _command_words(segment)
        except ValueError:
            u = re.search(r"(^|[\s(`])(%s)[\s<]" % _INTERPRETER, segment)
            if u:
                blocks.append((_code_lang(u.group(2)), segment))
            continue
        k0 = _interpreter_at(words)
        if k0 < 0:
            continue
        lang, args = _code_lang(words[k0]), words[k0 + 1:]
        for k, word in enumerate(args):
            if _CODE_FLAG.match(word) and k + 1 < len(args):
                blocks.append((lang, args[k + 1]))
                break
            if word == "<<<" and k + 1 < len(args):
                blocks.append((lang, args[k + 1]))
                break
            if word.startswith("<<<") and len(word) > 3:
                blocks.append((lang, word[3:]))
                break
        # `echo "code" | python3`: the stage before the pipe prints the program.
        if n and stages[n - 1][1] == "|" and _reads_code_from_stdin(args, lang):
            try:
                prev = _command_words(stages[n - 1][0])
            except ValueError:
                prev = [stages[n - 1][0]]
            if prev and prev[0] in ("echo", "printf"):
                blocks.append((lang, " ".join(prev[1:])))
    return blocks


# NESTED SHELL CODE (card 0f220f3f). `bash -c "<tool> x"` passed: the whole nested
# command is ONE quoted string, and the position classes blank quoted text. The string
# a shell is told to run is a command, so it goes through find_hits again, as text,
# to _MAX_SHELL_DEPTH levels: `-c` (also combined, `-lc`, `-ec`), `eval`, a here-string,
# and `echo ... | bash`. The launcher rule is the interpreter one: the first shell word
# anywhere in the segment (`timeout 60 bash -c`, `sudo -u x sh -c`). Only the shell's OWN
# options are read (`-o pipefail`, redirects skipped): after its first operand, the
# script, the words are that script's data. A shell heredoc body is already in scope
# through strip_heredoc_bodies. Nesting deeper than _MAX_SHELL_DEPTH is not read.
_SHELL_WORD = re.compile(r"^(?:.*/)?(?:ba|z|da|k)?sh$")
_SHELL_FLAG = re.compile(r"^-[A-Za-z]*c[A-Za-z]*$")
# bash's value-taking long options too: `--rcfile /tmp/r -c ..` read `/tmp/r` as the
# script and its -c as data (didi 50316, F2).
_SHELL_OPT_WITH_ARG = ("-o", "+o", "-O", "+O", "--rcfile", "--init-file")
# `&>file` / `&>>file` (stdout and stderr) is a redirect word as well (didi 50405 J2):
# behind a shell word _command_words already cuts it to `>` / `>>` (_REDIRECT_PIECE), so
# only _SHELL_REDIRECT, which that cut uses, names `&>`.
_SHELL_REDIRECT_OP = re.compile(r"^\d*(?:[<>]+|>&|<&)$")
_SHELL_REDIRECT = re.compile(r"^(?:\d*[<>]|&>)")
_MAX_SHELL_DEPTH = 3


def shell_code_strings(command: str):
    """Every string a nested shell in `command` is told to run."""
    out = []
    stages = _split_with_seps(_LINE_CONT.sub(" ", command))
    for n, (segment, _sep) in enumerate(stages):
        try:
            words = _command_words(segment)
        except ValueError:
            continue  # the blind position split still sees this segment
        k0 = next((k for k, w in enumerate(words) if _SHELL_WORD.match(w) or w == "eval"), -1)
        if k0 < 0:
            continue
        args = words[k0 + 1:]
        if words[k0] == "eval":
            if args:
                out.append(" ".join(args))
            continue
        k = 0
        while k < len(args):
            word = args[k]
            if _SHELL_FLAG.match(word) and k + 1 < len(args):
                out.append(args[k + 1])
                break
            if word == "<<<" and k + 1 < len(args):
                out.append(args[k + 1])
                break
            if word.startswith("<<<") and len(word) > 3:
                out.append(word[3:])
                break
            if word in _SHELL_OPT_WITH_ARG or _SHELL_REDIRECT_OP.match(word):
                k += 2
                continue
            if word.startswith(("-", "+")) or _SHELL_REDIRECT.match(word):
                k += 1
                continue
            # The first operand is the script: what follows are ITS arguments, data
            # (`bash x.sh -c foo`), the same rule as a script heredoc (N7, 94d86b92).
            break
        if n and stages[n - 1][1] == "|" and all(w.startswith("-") for w in args):
            try:
                prev = _command_words(stages[n - 1][0])
            except ValueError:
                prev = []
            if prev and prev[0] in ("echo", "printf"):
                out.append(" ".join(prev[1:]))
    return out


# COMMAND SUBSTITUTION (card e81a72b7). `x=$(<tool> x)` passed: the leading-assignment
# rule of _command_position_text drops the whole first word, the substitution with it.
# `echo "$(<tool> x)"` passed too: inside double quotes the shell still runs `$(...)`
# and backticks, but the blanking hid them. The body of every substitution outside
# single quotes is a command, read again through find_hits like a nested shell string,
# to the same depth. Escaped `\$(` and `$((` arithmetic are not substitutions. Heredoc
# bodies are read the way the shell reads them (substitution_scope): an UNQUOTED
# delimiter expands the body whatever the consumer is, a QUOTED one hands it over
# verbatim, so only a shell running it as its script reads it again (the backticks of
# a `python3 - <<'PY'` string or a markdown `<<'VEGE'` body ran nothing).
def substitution_bodies(command: str, heredoc=False):
    """The text of every `$(...)` and backtick substitution outside single quotes. In
    an unquoted heredoc body (`heredoc=True`) quotes are plain characters."""
    out, i, n, dq = [], 0, len(command), False
    while i < n:
        ch = command[i]
        if ch == "\\":
            i += 2
            continue
        if heredoc and ch in "\"'":
            i += 1
            continue
        if ch == "'" and not dq:
            j = command.find("'", i + 1)
            i = n if j < 0 else j + 1
            continue
        if ch == '"':
            dq = not dq
            i += 1
            continue
        if command.startswith("$(", i) and not command.startswith("$((", i):
            depth, j, q = 1, i + 2, None
            while j < n and depth:
                c = command[j]
                if q:
                    if c == q:
                        q = None
                elif c == "\\":
                    j += 1
                elif c in "\"'":
                    q = c
                elif c == "(":
                    depth += 1
                elif c == ")":
                    depth -= 1
                j += 1
            out.append(command[i + 2:j - 1] if depth == 0 else command[i + 2:])
            i = j
            continue
        if ch == "`":
            j = command.find("`", i + 1)
            out.append(command[i + 1:] if j < 0 else command[i + 1:j])
            i = n if j < 0 else j + 1
            continue
        i += 1
    return out


def _shell_runs_stdin(line: str) -> bool:
    """A shell on the heredoc's opener line runs its stdin as the script: no script
    operand before the `<<` or the end of its segment, or `-` / `-s` before one (`cat
    <<'EOF' | bash` too). `bash x.sh - <<'EOF'` hands the body to x.sh as data, `-c` to
    its code. An untokenisable segment counts as running it -- the safe side."""
    for segment, _sep in _split_with_seps(line):
        try:
            words = _command_words(segment)
        except ValueError:
            return True
        k0 = next((k for k, w in enumerate(words) if _SHELL_WORD.match(w)), -1)
        if k0 < 0:
            continue
        args, k = words[k0 + 1:], 0
        while k < len(args):
            w = args[k]
            if w.startswith("<<") or w == "-" or re.match(r"^-[A-Za-z]*s[A-Za-z]*$", w):
                return True
            if _SHELL_FLAG.match(w):
                break
            if _SHELL_REDIRECT_OP.match(w) or w in _SHELL_OPT_WITH_ARG:
                k += 2
                continue
            if _SHELL_REDIRECT.match(w) or w[:1] in "-+":
                k += 1
                continue
            break  # the first operand is the script
        else:
            return True
    return False


def substitution_scope(command: str):
    """(text, heredoc) pairs for substitution_bodies: the command without its heredoc
    bodies, every body with an unquoted delimiter in heredoc mode, and every quoted
    body a shell runs as its script as shell text."""
    lines = command.split("\n")
    shell, out, i = [], [], 0
    while i < len(lines):
        line = lines[i]
        shell.append(line)
        m = _HEREDOC.search(line)
        i += 1
        if not m:
            continue
        body = []
        while i < len(lines) and lines[i].strip() != m.group(2):
            body.append(lines[i])
            i += 1
        quoted = bool(m.group(1)) or "\\" in m.group(0)
        if not quoted:
            out.append(("\n".join(body), True))
        elif _shell_runs_stdin(line):  # `cat <<'EOF' | bash` runs it after the pipe
            out.append(("\n".join(body), False))
        if i < len(lines):
            shell.append(lines[i])
            i += 1
    return [("\n".join(shell), False)] + out


def _code_hits(lang: str, code: str):
    """The TOOL / CLOUD / GIT / SQL classes over one piece of interpreter code. A
    command name only counts when the code can start a process at all, and SQL only
    with a client it can reach -- see THE FALSE-REFUSAL SIDE above."""
    folded = _CODE_FOLD.sub("", code)
    flat = _CODE_PUNCT.sub(" ", folded)
    found = []
    sink = bool(_CODE_SINKS[lang].search(code))
    for line in flat.split("\n") if sink else []:
        for segment in _SEG.split(line):
            words = " ".join(segment.split())
            if not words:
                continue
            for pat, why in TOOL_PATTERNS:
                if re.search(pat, words, re.I):
                    found.append(why)
            if CLOUD_CLIS.search(words):
                found.extend(why for pat, why in CLOUD_PATTERNS if re.search(pat, words, re.I))
            if GIT_CLI.search(words) and GIT_PUSH_VERB.search(words):
                found.extend(why for pat, why in GIT_PUSH_PATTERNS if re.search(pat, words, re.I))
    if (sink and _CODE_CLI_CLIENTS.search(flat)) or _CODE_DRIVERS[lang].search(code):
        joined = folded.replace("\n", " ")
        for pat, why in SQL_PATTERNS[:-1]:
            if re.search(pat, joined, re.I):
                found.append(why)
        if _CODE_DELETE.search(joined):
            found.append(SQL_PATTERNS[-1][1])
    return ["%s [in executed interpreter code: a quoted name counts there]" % w for w in found]


def find_hits(command: str, cwd=None, missing=None, _depth=0):
    """`missing`, if a list, collects literal files that do not exist (logged by the
    caller, never refused). Everything else stays pure."""
    hits = []
    command = expand_client_vars(command)
    if _depth < _MAX_SHELL_DEPTH:
        for code in shell_code_strings(command) + [b for t, h in substitution_scope(command) for b in substitution_bodies(t, h)]:
            for why in find_hits(code, cwd, missing, _depth + 1):
                if why not in hits:
                    hits.append(why)
    for lang, code in interpreter_code_blocks(command):
        for why in _code_hits(lang, code):
            if why not in hits:
                hits.append(why)
    command = strip_heredoc_bodies(command)
    extra, problems, absent = expand_file_args(command, cwd)
    if missing is not None:
        missing.extend(absent)
    hits.extend(problems)
    if extra:
        command = command + "\n" + "\n".join(extra)
    # Join shell line continuations BEFORE splitting. A backslash-newline is ONE
    # command to any shell, but `_SEG` splits on `\n` -- so `prisma migrate \<nl>
    # reset` and `gcloud run services \<nl>delete x` each arrived in two segments,
    # and every class here needs its words in ONE. Joining can only merge, never
    # separate, so it cannot cost a check that the old form made. It runs AFTER
    # strip_heredoc_bodies on purpose: inside a heredoc a trailing backslash is body
    # text, not a continuation.
    command = _LINE_CONT.sub(" ", command)
    for segment in _SEG.split(command):
        if not segment.strip():
            continue
        cmdpos = _command_position_text(segment)
        for pat, why in TOOL_PATTERNS:
            if re.search(pat, cmdpos, re.I) and why not in hits:
                hits.append(why)
        # Command position, like the TOOL class: `echo "gcloud run services delete x"`
        # is a string being printed, and its quotes are already blanked out here.
        if CLOUD_CLIS.search(cmdpos):
            for pat, why in CLOUD_PATTERNS:
                if re.search(pat, cmdpos, re.I) and why not in hits:
                    hits.append(why)
        # Same positional discipline again: `git commit -m "never force-push to main"`
        # has its quoted text blanked here, so the `push` token is already gone.
        if GIT_CLI.search(cmdpos) and GIT_PUSH_VERB.search(cmdpos):
            for pat, why in GIT_PUSH_PATTERNS:
                if re.search(pat, cmdpos, re.I) and why not in hits:
                    hits.append(why)
    # The client also by its quote-stripped word: `"psql" -c "DROP TABLE x"` and
    # `p"sql"` run psql, as `"<tool>" x` runs the tool (card e81a72b7).
    for segment in _split_outside_quotes(command):
        if _db_client(segment) or _db_client(_command_position_text(segment)):
            for pat, why in SQL_PATTERNS:
                if re.search(pat, segment, re.I) and why not in hits:
                    hits.append(why)
    return hits


# === THE E2E CARVE-OUT: ONE WHOLE COMMAND SHAPE, NOT A LOOSER PATTERN (card 251b5785)
#
# WHY IT EXISTS. Every e2e run creates a `crm_e2e_<agent>_<suffix>` database and none was
# ever dropped, because this gate refuses DROP DATABASE: 233 of them, 5.0 GB, on
# 2026-09-26 (didi's measurement), growing ~3-4 GiB per working day. A prohibition with
# no exit ends with someone deleting the gate (see THE OVERRIDE above), and the override
# token is for one-off human decisions, not for a daily job.
#
# WHY THIS IS NOT THE CARVE-OUT THE DOCBLOCK REJECTS. That one was "the connection LOOKS
# like a test database", which would have to GUESS where DATABASE_URL points. This one
# guesses nothing: the WHOLE command must be one of two fixed shapes, every token is
# accounted for, the host is read from the command AND from the psql environment
# variables that could redirect it, and anything unrecognised falls back to the normal
# verdict (DENY). The allow condition is a conjunction; any doubt fails it.
#
#   psql [-h H] [-p N] [-U U] [-d D] [-X] [-q] [-w] -c "<drop-db> [IF EXISTS] <name>[;]"
#   dropdb [-h H] [-p N] [-U U] [-w] [-e] [--if-exists] <name>
#
# THE NAME, and the two live traps didi named in her probe spec on the card:
#   - `crm_e2e_didi` with NO suffix is an 88-row baseline another reset gate protects,
#     and `crm_e2e_test` is the SHARED database other agents run on. Hence an EXPLICIT
#     agent list and a REQUIRED suffix: `[a-z]+_` would admit `crm_e2e_test_x`.
#   - lowercase and UNQUOTED only. Postgres folds unquoted names to lowercase, and a
#     quoted upper-case name is a DIFFERENT database; neither is needed, both refused.
# NOT ALLOWED, even on a matching name: `WITH (FORCE)` and `dropdb -f/--force` (they
# terminate someone's live session), any other statement, a second statement, any shell
# operator, an env-assignment prefix, a positional psql argument, a conninfo `-d`.
# The daily reaper (scripts/dev-gc.py) builds its command and asks THIS function before
# running it, so the job is held to the same shape as a typed command.
E2E_AGENTS = ("dexter", "didi", "deeper", "mandark", "computress", "marveen", "friday", "jarvis", "trillian", "ford")
E2E_DB_NAME = re.compile(r"crm_e2e_(?:%s)_[a-z0-9][a-z0-9_]*" % "|".join(E2E_AGENTS))
_E2E_DROP_SQL = re.compile(
    r"\s*(?i:DROP)\s+(?i:DATABASE)\s+(?:(?i:IF)\s+(?i:EXISTS)\s+)?([^\s;]+)\s*;?\s*")
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
_SHELL_META = re.compile(r"[\n&|<>`$\\(){}!*?\[\]#~]")
_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _is_local_host(value: str) -> bool:
    # A Unix-socket DIRECTORY is local by definition; a comma list (multi-host) is not
    # something an e2e cleanup needs, so it is refused rather than parsed.
    return value in _LOCAL_HOSTS or (value.startswith("/") and "," not in value)


def _env_is_local(env) -> bool:
    """The psql environment variables that can send a command with no -h elsewhere."""
    host = env.get("PGHOST")
    if host is not None and not _is_local_host(host):
        return False
    addr = env.get("PGHOSTADDR")
    if addr is not None and addr not in {"127.0.0.1", "::1"}:
        return False
    if env.get("PGSERVICE") or env.get("PGSERVICEFILE"):
        return False
    db = env.get("PGDATABASE")
    if db is not None and not _IDENT.fullmatch(db):
        return False
    return True


def e2e_drop_allowed(command: str, env=None) -> bool:
    """True only when the WHOLE command is one of the two e2e-drop shapes, aimed at this
    machine, on a `crm_e2e_<agent>_<suffix>` database. Never raises."""
    try:
        import shlex
        env = os.environ if env is None else env
        raw = command.strip()
        if not raw or _SHELL_META.search(raw):
            return False
        # A `;` may only be the statement terminator at the end of the quoted -c string.
        if raw.count(";") > 1 or (";" in raw and not re.search(r";\s*[\"']$", raw)):
            return False
        toks = shlex.split(raw)
        # The bare name only: a path form (`/opt/homebrew/bin/<tool> crm_e2e_..`) is
        # refused, not carved out. didi's census (50316, F3): 19 path-form drops, every one
        # also done in the bare form, so the cost is 0; and a path names a program, which
        # the one exact shape this carve-out admits does not.
        if not toks or toks[0] not in ("psql", "dropdb"):
            return False
        if not _env_is_local(env):
            return False
        tool, rest = toks[0], toks[1:]
        with_val = {"-h": "host", "--host": "host", "-p": "port", "--port": "port",
                    "-U": "user", "--username": "user"}
        flags = {"-w", "--no-password"}
        if tool == "psql":
            with_val.update({"-d": "db", "--dbname": "db", "-c": "sql", "--command": "sql"})
            flags |= {"-X", "--no-psqlrc", "-q", "--quiet"}
        else:
            flags |= {"-e", "--echo", "--if-exists"}
        seen, positional, i = {}, [], 0
        while i < len(rest):
            t = rest[i]
            if t.startswith("--") and "=" in t:
                t, val = t.split("=", 1)
                if t not in with_val:
                    return False
                key = with_val[t]
                i += 1
            elif t in with_val:
                if i + 1 >= len(rest):
                    return False
                key, val = with_val[t], rest[i + 1]
                i += 2
            elif t in flags:
                i += 1
                continue
            elif t.startswith("-"):
                return False
            else:
                positional.append(t)
                i += 1
                continue
            if key in seen:
                return False
            seen[key] = val
        if "host" in seen and not _is_local_host(seen["host"]):
            return False
        if "port" in seen and not seen["port"].isdigit():
            return False
        if "user" in seen and not _IDENT.fullmatch(seen["user"]):
            return False
        if tool == "psql":
            if positional or "sql" not in seen:
                return False
            if "db" in seen and not _IDENT.fullmatch(seen["db"]):
                return False
            m = _E2E_DROP_SQL.fullmatch(seen["sql"])
            return bool(m) and bool(E2E_DB_NAME.fullmatch(m.group(1)))
        return len(positional) == 1 and bool(E2E_DB_NAME.fullmatch(positional[0]))
    except Exception:
        return False


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


def verdict(command: str, env=None, cwd=None, missing=None):
    """The whole decision, without I/O: ("none" | "e2e" | "override" | "deny", hits).

    It exists so the ORDER of the checks is testable. A spec that calls find_hits and
    e2e_drop_allowed separately and combines them itself stays green when the decision
    stops consulting the carve-out -- measured: that mutation SURVIVED the first version
    of db-gate-e2e-drop.test.ts (card 251b5785)."""
    hits = find_hits(command, cwd, missing)
    if not hits:
        return "none", hits
    if e2e_drop_allowed(command, env):
        return "e2e", hits
    if OVERRIDE.search(command):
        return "override", hits
    return "deny", hits


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

        # The hook's own cwd is the session's; the payload names it explicitly.
        cwd = str(payload.get("cwd") or "") or os.getcwd()
        missing = []
        kind, hits = verdict(command, cwd=cwd, missing=missing)
        for path in missing:
            log("UNCHECKED-FILE", "not examined: %s" % path, command)
        if kind == "none":
            sys.exit(0)

        if kind == "e2e":
            log("E2E-DROP", "; ".join(hits), command)
            sys.exit(0)

        if kind == "override":
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
        "DB-KAPU: TILTVA -- destruktiv muvelet (adatbazis, felho-eroforras vagy force-push).\n\n"
        + "\n".join("  - %s" % h for h in hits)
        + "\n\n"
        "MIERT KODBAN ES NEM JOGOSULTSAGBAN: a `Bash(...)` szabaly LITERALIS ELOTAG a\n"
        "nyers parancs-sztringen (merve 2026-09-06, kartya 9e3f2f5c), a destruktiv ige\n"
        "viszont gyakran a parancs VEGEN all (`gcloud run services delete`) vagy egy\n"
        "idezojeles argumentumban (`psql -c ...`). Egy elotag-minta csak felsorolassal\n"
        "erne oda, es amit a felsorolas kihagy, azt CSENDBEN hagyja ki.\n"
        "Ez a kapu barhol illeszt, es bypass modban is fut, mert KOD.\n\n"
        "A FORCE-PUSHNAL UGYANEZ MASIK ALAKBAN: a deny-szabalyok a kapcsolot KOZVETLENUL\n"
        "a `push` utan horgonyozzak (`git push --force ...`), a szokasos alak viszont\n"
        "`git push fork <ag> --force`, ahol a kapcsolo az ARGUMENTUMOK UTAN all. Nem\n"
        "kifelejtettek: egy elotag-minta permutacionkent egy szabalyt kivan.\n"
        "A `--force-with-lease` SZANDEKOSAN atmegy -- az a biztonsagos valtozat.\n\n"
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
