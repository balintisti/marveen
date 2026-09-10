#!/usr/bin/env npx tsx
/**
 * SIGNAL ONLY: where has a seeded scheduled task drifted from its template?
 * (card a22c9fe8)
 *
 * `ensureDefaultScheduledTasks` exits early on an existing directory
 * (`if (existsSync(dest)) continue`), so a template fix NEVER reaches a task
 * that is already installed. That `continue` is NOT a bug: it protects the live
 * copy from being overwritten, and the protection has been earned -- a measured
 * 14-line lesson once lived ONLY in the live napindito file, and an overwriting
 * "fix" would have deleted it.
 *
 * The defect is that the two cases -- hand-edited, and untouched seed -- are
 * indistinguishable, so every template fix is lost SILENTLY. This tool does not
 * resolve that. It makes it visible and leaves the decision to whoever knows
 * the context. It writes nothing.
 *
 * WHY TYPESCRIPT AND NOT A PYTHON SCRIPT: the placeholder substitution has ONE
 * canonical implementation, `resolveTemplatePlaceholders`, which the seeder
 * itself uses. A second copy in another language would drift from it -- which
 * is the exact defect class this card belongs to. So the checker imports it.
 *
 * THE FOUR ACCEPTANCE CONDITIONS, from the card (jarvis + marveen):
 *  1. resolve EVERY placeholder before comparing, or you report the normal
 *     operation of the installer as drift;
 *  2. say the DIRECTION -- only-in-template, only-in-live, or both -- because
 *     the three want different decisions;
 *  3. NEGATIVE CONTROL: an untouched seed task must NOT be flagged, or the
 *     signal becomes noise within days;
 *  4. and the one jarvis paid for THREE TIMES: the placeholder set comes from
 *     the TEMPLATE, never from a hand-written map, and if any `{{...}}` is
 *     still there after substitution the tool STOPS rather than reporting. His
 *     three misses (INSTALL_DIR only, then MAIN_AGENT_ID, then BOT_NAME) each
 *     produced a confident, wrong drift report.
 *
 * AND WHY (4) IS DANGEROUS RATHER THAN MERELY WRONG -- didi's sentence, and the
 * part neither this docblock nor its author had. An unresolved placeholder makes
 * the diff report IDENTITY-BEARING lines as live-only: the owner's name, the
 * install paths, the agent id. Those are precisely the lines that most RESEMBLE
 * a decision or a risk, so the false positives do NOT scatter -- they pile up
 * exactly where the reviewer is already looking, wearing the shape of the thing
 * the tool exists to find. A wrong report that lands in the noise gets ignored;
 * this one gets ACTED ON.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveTemplatePlaceholders } from './web/agent-scaffold.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SEED_DIR = join(ROOT, 'seed-scheduled-tasks');
const LIVE_DIR = join(homedir(), '.claude', 'scheduled-tasks');
export const UNRESOLVED = /\{\{[A-Z_][A-Z0-9_]*\}\}/g;

type Drift = { task: string; file: string; onlyTemplate: string[]; onlyLive: string[] };

/** A runtime-added key is not drift: the template only asserts the keys it
 *  declares. Measured on this repo -- all three live task-config.json files
 *  carry `stuckAfterMinutes`, which no template has, and treating that as
 *  drift would flag every task forever (condition 3). */
/**
 * Fields the SEEDER assigns, which a template cannot meaningfully assert.
 *
 * `createdAt` ships as 0 in most templates and gets a real timestamp when the
 * task is seeded, so a template that declares it drifts FOREVER, on every
 * seeded task, from the first minute. Measured after shipping the checker: two
 * of its four "drifts" were this and nothing else -- my own condition 3 (an
 * untouched seed must not be flagged) broken by the tool that carries it.
 *
 * Same class as the live-only `stuckAfterMinutes` the comparison already
 * ignores; the difference is only that this one is DECLARED by the template,
 * so a key-based comparison walks straight into it.
 *
 * `agent` joins it for a STRONGER reason than "it is per-install", and the
 * reason is code, not preference: `copyTaskConfigWithAgentRewrite` in
 * agent-scaffold.ts OVERWRITES the template's agent with MAIN_AGENT_ID at seed
 * time whenever the key is a string. The template's value is therefore never
 * what lands, so comparing it against the live value asks a question the
 * seeder has already answered. Measured: `scheduled-tasks-io.ts` also defaults
 * a MISSING agent to MAIN_AGENT_ID, so the key is not required either.
 *
 * NOT the same as "treat the difference as expected", which would leave a
 * true-forever drift in the report and teach its readers to skip that line.
 * The comparison is dropped because it is meaningless, not tolerated because
 * it is inconvenient.
 */
export const RUNTIME_ASSIGNED_FIELDS = new Set(['createdAt', 'agent']);

export function jsonDrift(tpl: string, live: string): { onlyTemplate: string[]; onlyLive: string[] } {
  const t = JSON.parse(tpl) as Record<string, unknown>;
  const l = JSON.parse(live) as Record<string, unknown>;
  const onlyTemplate: string[] = [];
  for (const [k, v] of Object.entries(t)) {
    if (RUNTIME_ASSIGNED_FIELDS.has(k)) continue;
    const seen = JSON.stringify(l[k]);
    if (seen !== JSON.stringify(v)) onlyTemplate.push(`${k}: template ${JSON.stringify(v)} / live ${seen ?? '(missing)'}`);
  }
  return { onlyTemplate, onlyLive: [] };
}

export function lineDrift(tpl: string, live: string): { onlyTemplate: string[]; onlyLive: string[] } {
  const t = tpl.split('\n'), l = live.split('\n');
  const ls = new Set(l), ts = new Set(t);
  return {
    onlyTemplate: t.filter((x) => x.trim() && !ls.has(x)),
    onlyLive: l.filter((x) => x.trim() && !ts.has(x)),
  };
}

/**
 * CONDITION 5, WHICH I FOUND BY RUNNING THE TOOL AND NOT BY THINKING.
 *
 * The first live run reported TEN drifting files. Every single one was my own
 * worktree: `{{INSTALL_DIR}}` resolves from THIS checkout's config, so run from
 * anywhere but the install it rewrites every path in every template and then
 * reports the difference as drift -- confidently, with a direction, in the exact
 * shape a real finding takes.
 *
 * Same class as jarvis's three misses, one level out: there the resolver was
 * incomplete, here it is complete and pointed at the wrong tree. So the tool
 * refuses to compare unless it IS the install: the live tasks were seeded from
 * the main worktree, and only that checkout's placeholder values can reproduce
 * them.
 */
export function rootMismatchMessage(resolvedRoot: string, mainWorktree: string): string | null {
  if (resolvedRoot === mainWorktree) return null;
  return `this is not the install: {{INSTALL_DIR}} resolves to ${resolvedRoot}, the install lives at ${mainWorktree}. Every template path would be rewritten and reported as drift. Run it from the install.`;
}

function installRootMismatch(): string | null {
  const resolvedRoot = resolveTemplatePlaceholders('{{INSTALL_DIR}}');
  let mainWorktree: string;
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: ROOT, encoding: 'utf-8' }).trim();
    mainWorktree = dirname(common);
  } catch (e) {
    return `cannot locate the main worktree (${(e as Error).message})`;
  }
  return rootMismatchMessage(resolvedRoot, mainWorktree);
}

/** One task's files, compared. Exported so the directory rule can be tested
 *  without loosening the install-root guard that `check` performs first. */
export function compareTask(task: string, seedTask: string, liveTask: string):
    { drifts: Drift[]; stopped: string | null } {
  const drifts: Drift[] = [];
  for (const file of readdirSync(seedTask).sort()) {
    // A SUBDIRECTORY IN A TEMPLATE IS NOT MEANT TO BE INSTALLED, and the rule
    // is not mine: `ensureDefaultScheduledTasks` skips nested directories in
    // so many words ("Seeded task dirs are flat; skip any nested directory").
    // So a template subdir absent from the live task is the seeder working,
    // not drift.
    //
    // MEASURED CASE (didi, first live run of this tool): I reported
    // `bumblebee-hygiene-scan/threat-intel` as "the whole file is missing
    // from the live task". True, harmless, and the obvious remedy would have
    // been damaging -- the skill reads that catalog from the SEED path and
    // copies it to ~/.claude/tools, so installing it into the task dir would
    // have created a THIRD copy of 272 KB that then ages on its own. A
    // detector that flags correct behaviour is worse than none precisely
    // because the natural fix makes things worse.
    if (statSync(join(seedTask, file)).isDirectory()) continue;
    const liveFile = join(liveTask, file);
    if (!existsSync(liveFile)) { drifts.push({ task, file, onlyTemplate: ['(the whole file is missing from the live task)'], onlyLive: [] }); continue; }
    const resolved = resolveTemplatePlaceholders(readFileSync(join(seedTask, file), 'utf-8'));
    const left = resolved.match(UNRESOLVED);
    if (left) {
      // CONDITION 4. Reporting here would mean reporting the installer's own
      // normal behaviour as drift, confidently.
      return { drifts: [], stopped: `${task}/${file}: unresolved placeholder(s) ${[...new Set(left)].join(', ')} -- the resolver does not know them, so no comparison is possible` };
    }
    const liveText = readFileSync(liveFile, 'utf-8');
    const d = file.endsWith('.json') ? jsonDrift(resolved, liveText) : lineDrift(resolved, liveText);
    if (d.onlyTemplate.length || d.onlyLive.length) drifts.push({ task, file, ...d });
  }
  return { drifts, stopped: null };
}

export function check(): { drifts: Drift[]; unseeded: string[]; stopped: string | null } {
  if (!existsSync(SEED_DIR)) return { drifts: [], unseeded: [], stopped: `no ${SEED_DIR}` };
  const wrongRoot = installRootMismatch();
  if (wrongRoot) return { drifts: [], unseeded: [], stopped: wrongRoot };
  const drifts: Drift[] = [];
  const unseeded: string[] = [];
  for (const task of readdirSync(SEED_DIR).sort()) {
    const seedTask = join(SEED_DIR, task);
    const liveTask = join(LIVE_DIR, task);
    if (!existsSync(liveTask)) { unseeded.push(task); continue; }
    const r = compareTask(task, seedTask, liveTask);
    if (r.stopped) return { drifts: [], unseeded, stopped: r.stopped };
    drifts.push(...r.drifts);
  }
  return { drifts, unseeded, stopped: null };
}

