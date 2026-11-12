# The lean worker sub-agent type

Card dc5d2e53 (stage B of ecbb62e6). Decision: marveen, on ecbb62e6.

## What it is

`lean-worker` is a sub-agent type for ONE bounded task: read, search, measure, or
write files into the single directory the task names, then answer in writing. Its
definition (`templates/sub-agents/lean-worker.md`) carries `omitClaudeMd: true`, so
a launch does not get the parent's rule sheet, and it does not get the skill list
or the memory index either.

Measured 2026-11-12 on Claude Code 2.1.314, in one agent (dexter), from the first
request in the launch's transcript: two lean-worker launches took 5 421 and 5 402
first-prompt tokens, and neither request carried the rule-sheet block, the skill
list or the memory index. A general-purpose launch from the same agent carries
all three and measured 39 145. Both lean launches ran on `claude-haiku-5-5`,
because that agent's environment sets `CLAUDE_CODE_SUBAGENT_MODEL` (the definition
names no model). The count is one agent's, on one version: another agent's sheet
changes the general-purpose number, not the lean one.

## What it is not for

Kanban or memory writes, messages to agents or to the owner, git commit / push /
merge / release, anything that touches production or live customer data, web
research, and any procedure that lives in a skill. Those keep the general-purpose
type with the full sheet. The frontmatter `description` says this to the parent
(the description is all a parent sees when it picks a type), and the body says it
to the worker in its first lines (the description does not reach the worker).

## The body is the whole rule set

Without the sheet, the body is every rule the worker holds. The text is not
free to edit: didi drafted it from the boundary sections of the rule sheets and
marveen approved it (ecbb62e6 comment 58694). `lean-worker-definition.test.ts`
pins it by hash; a change needs a new approval, then a new hash.

The body names the install root as `{{PROJECT_ROOT}}`. `ensureLeanWorker` refuses
to deploy a render in which a placeholder survived, and logs it: a missing type
fails loudly at the first launch, a type with a hole in a boundary rule does not
fail at all.

## What the text does and what the gates do

The PreToolUse hooks are in the agent's settings, not in the rule sheet, so
leaving the sheet out should not take them away. What was measured, 2026-11-12,
is ONE gate on ONE call: a lean worker's `npm test --prefix <dir>` was refused
with "HEAVY-RUN GATE: REFUSED" (the DENY line is in `store/heavy-run-gate.log`),
the same text the parent got for the same command, and an `echo` in the same
launch ran. The other hooks were not measured one by one.

What the TEXT did in the same measurement: asked to post a kanban comment, the
worker refused, said so, and made no API call (the card had no new comment). That
is one prompt without pressure, on `claude-haiku-5-5`.

The text is still part of the protection, because the gates do not cover
everything the text forbids. Making the lean type the default, or leaning on the
gates instead of the text, is NOT decided.

## How to use it

Put in the prompt everything the worker needs: the absolute directory it may
write to, the exact question, the facts. It has not read your CLAUDE.md, your
skills or your conversation. Its final reply is the report.

## Where it is deployed, and when a change arrives

`ensureLeanWorker` writes the rendered definition next to the quarantine-reader
(`<agent>/.claude/agents/`, the main agent's under the install root) when an
agent is scaffolded and at every dashboard start. On Claude Code 2.1.314
(2026-11-12, card 4341fd40) a running session did NOT pick up an EDIT of a
definition it had started with, while a NEW definition file was announced to a
session that had started 22 minutes before the file existed (seen once). So the
first deploy can reach running agents; a changed body reaches an agent at its
next session start.

## What no test can pin

- That Claude Code honours `omitClaudeMd`. A mistyped or unsupported key is
  ignored without a word. The proof is a launch's first-prompt token count and the
  absence of the block that starts "Codebase and user instructions are shown
  below" in `<CLAUDE_CONFIG_DIR>/projects/<cwd>/<session>/subagents/agent-*.jsonl`.
- That a worker obeys the body under pressure. Nobody has tested it; the one
  refusal above was a plain request.

Measure both again after a Claude Code upgrade.

## Reopen

A lean-worker run found doing one of the excluded things: the type is withdrawn
until the cause is known. Fewer than a third of sub-agent launches using it four
weeks after it lands: ask why before building more.
