# Upstream adoption: what to take from `Szotasz/marveen`, and what stays ours

**Card `0024b92b`. Measured 2026-09-03 against `origin/develop` @ `9d3b77f` and `origin/main` @
`266cf59` (tag `v1.36.0`), from our `HEAD` @ `9fed675`.**

Isti's ask: keep taking from Szotasz -- the CLI first, and use it regularly -- compare where both
sides solve the same thing and keep the better one, keep what we need regardless, and read GitHub
rather than trusting the newsletter. This document exists so the NEXT round is a diff, not a
re-measurement.

## THE RE-RUN PROCEDURE (start here next time)

**They already built the tool for this, and it is better than the tag-anchored `git log` we were
going to write.** `scripts/upstream-new.sh` + `docs/upstream-ledger.md` (upstream, not ours yet):

```bash
git -C /Users/isti/marveen fetch origin
UPSTREAM_REF=origin/develop scripts/upstream-new.sh          # unhandled upstream commits
UPSTREAM_REF=origin/develop scripts/upstream-new.sh --count
scripts/upstream-new.sh mark ported  <sha> "reason"
scripts/upstream-new.sh mark skipped <sha> "reason"
```

Why theirs beats a plain `git log v1.36.0..v<next>`: **git compares commit IDENTITY, not content**,
so a hand-ported commit keeps a different SHA and the log lists it forever. Their ledger
(`store/upstream-ported.json`, per-install, gitignored) subtracts what we already decided on, so the
list shrinks instead of growing. That is exactly the failure mode that makes a fork stop reviewing
upstream at all.

**Adopting that script is itself an adoption decision and needs marveen's go-ahead** (see the rule
at the bottom). Until then, the fallback anchor is the tag: `git log --oneline v1.36.0..origin/develop`.

**And the newsletter is not the source.** Isti said it explicitly and the tree agrees: read the log.

## THE NUMBERS, AND WHAT THEY DO NOT MEAN

    ours, not theirs .... 494 commits          theirs, not ours .... 113 commits
    files: ours 999 | theirs 951 | common 805
    only theirs ... 146 (21 non-test)   only ours ... 194 (75 non-test)
    common but DIFFERENT (non-test) ... 136 files, 12 231 changed lines
    CONTROL: origin/develop ^origin/develop = 0

**These are no longer the same tree. A merge is not on the table** -- this is file- and
feature-level adoption, one piece at a time. Anyone reading "take everything over" as a merge
instruction is reading it wrong.

**A commit count is not a feature count.** The 113 is a size signal, nothing else; do not lead with
it, and do not divide it by anything.

## 1. WHAT THEY HAVE AND WE DO NOT (21 non-test files)

**The CLI Isti named first** -- `npm run skill -- <enroll|upload|update>`:
`scripts/skill.ts`, `src/skill-cli-core.ts`, `src/skill-cli-fs.ts`, `src/skill-scan.ts` (+3 specs).
We have none of it: `git ls-files | grep -c skill-cli` -> 0 (CONTROL: 999 tracked files).

What it does, from its own header: `enroll` fetches and stores an attest key (0600) and pulls the
usage rules; `upload` reads a skill, **runs a local scan, refuses on a hit**, and on a clean result
signs an HMAC attestation and uploads; `update` re-pulls skills/rules. The pure core (canonical
JSON + HMAC) is separated from the filesystem and from the command shell, and the canonicalisation
is pinned by **shared test vectors** used by their Python client and Deno server too -- so a drift
between the three implementations fails a test rather than a review.

**One consequence to decide before adopting, not after:** `upload` sends skill content to
`app.marveen.io` under an account key. Our skills carry fleet-internal measurements. "Use it
regularly" therefore means publishing some of our material outside; which skills, if any, is Isti's
call, not a technical detail.

Everything else they alone have, by area:

    hooks ....... clear-capture.py, clear-replay.py, clearstate_lib.py, email-approval-gate.py,
                  email_extract.py, provenance-gate.py
    scripts ..... agent-msg-get.sh, context-restart-gate-doctor.mjs, lib/quota-check.py,
                  statusline-ratelimit.sh, support-mail/entitlement.py, upstream-new.sh
    src ......... skill-scan.ts, web/desktop-lock.ts, web/system-directive.ts,
                  web/routes/desktop-lock.ts, web/routes/heartbeat.ts
    docs ........ upstream-ledger.md

## 2. WHAT WE HAVE AND THEY DO NOT (75 non-test files)

    scripts 49 | src/web 11 | src 9 | scripts/hooks 2 | seed-skills, docs, templates, .lang 1 each

Measured today on the `src` half (card `3b1fc14f`), by capability rather than by file: **14
capabilities, of which 4 are portable (own CLI + wrapper: agenda, capacity, card-flow,
google-health) and 10 live inside the running system** (idle-work guard, session-progress,
build-freshness, command-health-age, kanban project warning, query-param rejection,
recipient-advice, reopen-condition warning+log, restart-inflight, data-source-alarm). One file
(`web/session-names.ts`) is a refactor with no capability behind it.

## 3. WHERE BOTH SOLVE THE SAME PROBLEM -- AND THIS IS THE HALF THAT NEEDS JUDGEMENT

The honest shape first: **136 shared files differ, 12 231 lines, and BOTH sides grew on the same
files.** Where each side added the most:

    they added more ... web/agent-process.ts (+396), web/schedule-runner.ts (+395),
                        web/context-restart-gate-runner.ts (+346), web/agent-scaffold.ts (+335)
    we added more ..... src/db.ts (-558), src/google-api.ts (-548), scripts/skill-index.sh (-450),
                        src/web/routes/kanban.ts (-289), src/web/message-router.ts (-313),
                        src/pane-state.ts (-276)

**JUDGED IN THIS ROUND -- one, and it is the one that pays for itself:**

`scripts/upstream-new.sh` + `docs/upstream-ledger.md` (theirs) **beats** the tag-anchored log we
were about to write. Reason, in their words and confirmed by our own repeated lesson: git matches
identity, not content, so a hand-ported commit never leaves the list. Their design keeps a decision
memory; ours would have had none. **Take theirs.**

**NOT JUDGED IN THIS ROUND, and named so nobody reads silence as agreement:** the other 135 files.
The four where they added most are the agent lifecycle (process, scaffold, restart gate, scheduler)
-- that is where their 113 commits went, and it is also where our fleet behaviour lives, so it is
the area where a wrong adoption is most expensive. It needs a file-by-file round with someone who
knows both sides' intent, not a diff reader.

## 4. WHAT STAYS OURS REGARDLESS -- MEASURED, NOT ASSUMED

- **The fleet's own state**: `agents/` is **gitignored here**, so every agent's config, persona,
  workcheck and memory index is invisible to any tree diff. Nothing upstream can overwrite it, and
  nothing in this document measures it.
- **The kanban as we use it**: they have `routes/kanban.ts` and `kanban-dispatch.ts` too, so this is
  not "they lack a board" -- our divergence is 289 lines on that one route, and the card conventions
  (project field, actor, reopen-condition warning) are ours.
- **The rulebook-driven guards**: idle-work guard, build-freshness, restart-inflight,
  recipient-advice -- section 2's ten in-core capabilities. These are the fleet's behaviour, and
  adopting upstream code on those same files is where we would lose them silently.

## BLIND SPOTS OF THIS DOCUMENT

1. `agents/` is gitignored: a **measured blind spot**, not a gap. Do not read its absence as
   "we have nothing there".
2. File-level comparison says nothing about **semantics**: two files with the same name can solve
   different problems, and two differently-named files can solve the same one. Section 3 is the only
   part that looks past names, and it covers one pair out of 136.
3. Nothing here was run. No upstream code was executed, adopted, or pushed.

## THE RULE THIS DOCUMENT WAS WRITTEN UNDER

Reading and measuring: free. **Pushing anything, or adopting any upstream code, needs marveen's
go-ahead first** (his 21:28 instruction, and the repo's own rule that `origin` here is a foreign
public project).
