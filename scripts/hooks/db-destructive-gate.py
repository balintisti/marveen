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
_LINE_CONT = re.compile(r"\\\n")
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
