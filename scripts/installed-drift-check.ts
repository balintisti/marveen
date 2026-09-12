#!/usr/bin/env npx tsx
/**
 * INSTALLED-VS-TRACKED DRIFT, lanes C and D (card 8027ebee).
 *
 *   lane C  launchd plists   scripts/com.marveen.*.plist.template -> ~/Library/LaunchAgents/
 *   lane D  git hooks        scripts/install-*-hook.sh            -> .git/hooks/
 *
 * The seeded lane (~/.claude/scheduled-tasks) is NOT here: `scripts/seed-drift-check.ts`
 * already owns it. This is the thin half -- the filesystem and git work. Every
 * verdict comes from `src/installed-drift.ts`, which is where the specs are, and
 * which structurally refuses to decide a both-sided difference without step two.
 *
 * THIS TOOL WRITES NOTHING. It neither reinstalls nor repairs; deciding is for
 * whoever holds the context. Exit codes follow seed-drift-check:
 *   0 = no drift   1 = NOT MEASURABLE (stopped)   3 = drift found
 *
 * Usage: npx tsx scripts/installed-drift-check.ts [--plists] [--hooks]
 *        (no flag = both lanes)
 */
import { readdirSync, readFileSync, existsSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  classifyDirection, resolveWithHistory, sameAsInstaller,
  unresolvedPlaceholders, normalizeGenerated, throwawayLeak,
  type Direction,
} from '../src/installed-drift.js';

/**
 * TWO ROOTS, AND CONFLATING THEM IS THE KNOWN FAILURE (seed-drift's condition 5,
 * which that module found by running the tool and not by thinking).
 *
 *   SOURCE_ROOT   the tree whose templates and installers are under test -- this
 *                 script's own checkout, which may be any worktree.
 *   INSTALL_ROOT  the main worktree. The artifacts live there and EMBED that path,
 *                 so it is what a placeholder must resolve to. Deriving it from
 *                 this script's location instead would rewrite every path in every
 *                 template and then report the difference as drift -- confidently,
 *                 with a direction, in the exact shape a real finding takes.
 *
 * Measured 2026-09-12: `.git/hooks` is ONE directory shared by every linked
 * worktree (same inode from both), and a linked worktree's `.git` is a FILE, so
 * `SOURCE_ROOT/.git/hooks` does not even exist. Both facts point the same way --
 * the hooks anchor is the git COMMON dir, never the local tree.
 */
const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = homedir();

let GIT_COMMON: string;
try {
  GIT_COMMON = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: SOURCE_ROOT, encoding: 'utf-8' }).trim();
} catch (e) {
  console.log(`installed-drift: NEM MERHETO -- a fo worktree nem talalhato (${(e as Error).message})`);
  process.exit(1);
}
const INSTALL_ROOT = dirname(GIT_COMMON);
const HOOKS_DIR = join(GIT_COMMON, 'hooks');

/**
 * WHICH INSTALLERS MAY BE RUN -- BY NAME, AND THE PATTERN WAS MEASURED AND REJECTED.
 *
 * These five are safe to execute because their ENTIRE effect lands inside the
 * target repo's `.git/hooks`. The excluded ones patch `$HOME/.claude/settings.json`
 * -- the live config every agent in the fleet loads at session start.
 *
 * The obvious improvement is to derive this list by grepping for `$HOME`. Measured
 * 2026-09-12, it fails in BOTH directions, and the second one is why this stays a
 * hand-written list:
 *   - FALSE POSITIVE: install-prod-tree-guard-hook.sh scores 5 hits, all of them
 *     the variable names `$HOME_BRANCH` / `$HOME_WHY`. Not writes at all.
 *   - FALSE NEGATIVE: install-telegram-image-hook.sh scores a clean ZERO and is
 *     dangerous -- it is a one-line `exec` wrapper around the channel-image
 *     installer, which patches settings.json. A delegating wrapper defeats any
 *     source-text proxy, and it errs toward "safe to run".
 */
const SAFE_INSTALLERS = [
  'install-git-guard-hook.sh',
  'install-prod-tree-guard-hook.sh',
  'install-secret-gate-hook.sh',
  'install-no-force-push-hook.sh',
  'install-backup-gate-hook.sh',
] as const;

/** Known to write outside the repo. Listed rather than merely omitted so that a
 *  NEW installer belongs to neither list and trips the guard below, instead of
 *  being silently skipped -- an allowlist that grows only when someone remembers
 *  is the shape this repo keeps measuring as a hole. */
const KNOWN_UNSAFE_INSTALLERS = [
  'install-channel-image-hook.sh',
  'install-skills-snapshot-hook.sh',
  'install-telegram-image-hook.sh',
  'install-telegram-progress-hook.sh',
] as const;

type Finding = { name: string; lane: string; text: string; drift: boolean; via?: string };
const findings: Finding[] = [];
let stopped: string | null = null;

/** Every revision of the generating source, newest first. No cap: measured at
 *  1-9 revisions per file, so truncation is not a risk -- and a capped history
 *  that came back "unseen" would be a truncated view read as a population. */
function sourceHistory(relPath: string): string[] {
  let shas: string[];
  try {
    shas = execFileSync('git', ['log', '--format=%H', '--', relPath], { cwd: SOURCE_ROOT, encoding: 'utf-8' })
      .split('\n').filter(Boolean);
  } catch { return []; }
  const out: string[] = [];
  for (const sha of shas) {
    // execFileSync passes an ARGUMENT ARRAY -- no shell. The `<sha>:<path>` form
    // is what zsh mangles with its `:s` modifier (this card's comment 1), and
    // that trap cannot occur here because no shell ever sees the string.
    try {
      out.push(execFileSync('git', ['show', `${sha}:${relPath}`], { cwd: SOURCE_ROOT, encoding: 'utf-8' }));
    } catch { /* the file did not exist at that revision */ }
  }
  return out;
}

/** The one place a verdict is rendered, so both lanes get step two identically. */
function verdict(d: Direction, sourceRel: string): { text: string; drift: boolean } {
  switch (d.kind) {
    case 'identical':
      return { text: 'AZONOS', drift: false };
    case 'reordered':
      return { text: 'ATRENDEZVE VAGY DUPLIKALVA -- a ket fajl ELTER, de egyetlen sor sem egyedi egyik oldalon sem. A sor-alapu differ ezt nem tudja iranyitani; olvasd el a kulonbseget kezzel (diff).', drift: true };
    case 'installed-stale':
      return { text: `TELEPITETT-REGI -- +${d.onlyGenerated.length} sor csak a generaltban; ujratelepites BIZTONSAGOS (nem torol semmit)`, drift: true };
    case 'local-edit':
      return { text: `KEZI ELES SZERKESZTES -- ${d.onlyInstalled.length} sor CSAK a telepitettben; az ujratelepites ELVINNE. OLVASD EL:\n      ${d.onlyInstalled.slice(0, 5).map((l) => l.trim().slice(0, 110)).join('\n      ')}`, drift: true };
    case 'needs-history': {
      // STEP TWO. A both-sided difference looks the same whether the installer
      // replaced those lines or a human added them. Only the installer's own
      // history separates them, and skipping this is what produced a confident
      // false alarm in the expensive direction.
      const v = resolveWithHistory(d.onlyInstalled, sourceHistory(sourceRel));
      if (v.kind === 'installed-stale') {
        return { text: `TELEPITETT-REGI (CSERE) -- mindket oldalon van sor, de a ${d.onlyInstalled.length} telepitett-only sor MEGVAN a(z) ${basename(sourceRel)} tortenetében: egy korabbi installer-allapot, nem kezi szerkesztes. Ujratelepites BIZTONSAGOS es FRISSITES.`, drift: true };
      }
      if (v.kind === 'unmeasurable') {
        return { text: `NEM MERHETO -- ${v.reason}`, drift: true };
      }
      const lines = v.unseen.slice(0, 5).map((l) => l.trim().slice(0, 110)).join('\n      ');
      const head = v.kind === 'local-edit'
        ? 'KEZI ELES SZERKESZTES -- egyetlen telepitett-only sor sem szerepelt soha az installer tortenetében'
        : 'VEGYES -- kezi szerkesztes egy MAR ELAVULT peldany tetejen; a torles-kockazat dominal';
      return { text: `${head}. Az ujratelepites ELVINNE:\n      ${lines}`, drift: true };
    }
  }
}

function record(lane: string, name: string, d: Direction, sourceRel: string, via?: string): void {
  const { text, drift } = verdict(d, sourceRel);
  findings.push({ lane, name, text, drift, via });
}

// --- LANE C: launchd plists -------------------------------------------------
// No installer is executed and `launchctl` is never invoked: the rendering is a
// two-placeholder substitution, reproduced here exactly as install-launchd-unit.sh
// performs it. Measuring must not be able to load or unload a real unit.
function laneC(): void {
  const targetDir = process.env.LAUNCH_AGENTS_DIR ?? join(HOME, 'Library', 'LaunchAgents');
  const templates = readdirSync(join(SOURCE_ROOT, 'scripts')).filter((f) => f.endsWith('.plist.template')).sort();
  if (!templates.length) { stopped ??= 'nincs egyetlen plist-sablon sem -- a mero vak lenne'; return; }

  for (const tpl of templates) {
    const label = tpl.replace(/\.plist\.template$/, '');
    const rel = `scripts/${tpl}`;
    const rendered = readFileSync(join(SOURCE_ROOT, rel), 'utf-8')
      .split('__MARVEEN_ROOT__').join(INSTALL_ROOT)
      .split('__HOME__').join(HOME);

    // A placeholder this renderer did not know would install a path that does not
    // exist, and the unit would fail at load time -- far from here.
    const left = unresolvedPlaceholders(rendered);
    if (left.length) {
      findings.push({ lane: 'C plist', name: label, text: `FELOLDATLAN PLACEHOLDER: ${left.join(', ')} -- a rendereles hianyos, a verdikt nem megbizhato`, drift: true });
      continue;
    }

    const installed = join(targetDir, `${label}.plist`);
    if (!existsSync(installed)) {
      findings.push({ lane: 'C plist', name: label, text: 'NINCS TELEPITVE (nem drift: a sablon letezik, a unit nincs feltelepitve)', drift: false });
      continue;
    }
    const live = readFileSync(installed, 'utf-8');
    if (sameAsInstaller(rendered, live)) { findings.push({ lane: 'C plist', name: label, text: 'AZONOS', drift: false }); continue; }
    record('C plist', label, classifyDirection(rendered, live), rel);
  }
}

// --- LANE D: .git/hooks -----------------------------------------------------
// A hook is GENERATED from a heredoc and never committed, so the "did this blob
// ever exist in history" probe says OUTSIDE for all of them and that is not a
// finding. The right question for a generated artifact is whether a reinstall
// would change anything -- so each installer runs into its own throwaway repo.
function laneD(): void {
  const present = readdirSync(join(SOURCE_ROOT, 'scripts')).filter((f) => /^install-.*hook.*\.sh$/.test(f)).sort();
  // CLASS-LEVEL GUARD: a new installer that is on neither list must force a
  // decision. Without this the allowlist silently shrinks in coverage every time
  // someone adds one, while the tool keeps reporting green.
  const unclassified = present.filter((f) => !SAFE_INSTALLERS.includes(f as never) && !KNOWN_UNSAFE_INSTALLERS.includes(f as never));
  if (unclassified.length) {
    stopped ??= `BESOROLATLAN INSTALLER: ${unclassified.join(', ')}. Vedd fel a SAFE_INSTALLERS vagy a KNOWN_UNSAFE_INSTALLERS listara -- a futtatasa a repon KIVULRE is irhat.`;
    return;
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'installed-drift-'));
  try {
    let i = 0;
    for (const inst of SAFE_INSTALLERS) {
      if (!existsSync(join(SOURCE_ROOT, 'scripts', inst))) { stopped ??= `hianyzik a nevesitett installer: ${inst}`; return; }
      // Each installer gets its OWN fresh repo: run into one repo they mask each
      // other (git-guard installs the same pre-push chain no-force-push owns).
      const repo = join(tmpRoot, `repo${++i}`);
      mkdirSync(join(repo, 'scripts', 'hooks'), { recursive: true });
      mkdirSync(join(repo, 'store'), { recursive: true });
      cpSync(join(SOURCE_ROOT, 'scripts', inst), join(repo, 'scripts', inst));
      if (existsSync(join(SOURCE_ROOT, 'scripts', 'pre-modify-backup.sh'))) {
        cpSync(join(SOURCE_ROOT, 'scripts', 'pre-modify-backup.sh'), join(repo, 'scripts', 'pre-modify-backup.sh'));
      }
      cpSync(join(SOURCE_ROOT, 'scripts', 'hooks'), join(repo, 'scripts', 'hooks'), { recursive: true });
      const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf-8', stdio: 'pipe' });
      git('init', '-q');
      git('config', 'user.email', 'drift@local');
      git('config', 'user.name', 'drift');
      execFileSync('bash', ['-c', 'printf "store/\\n" > "$1/.gitignore"', '_', repo]);
      git('add', '-A'); git('commit', '-qm', 'init');
      try {
        execFileSync('bash', [join(repo, 'scripts', inst)], { cwd: '/', stdio: 'pipe' });
      } catch { findings.push({ lane: 'D hook', name: inst, text: 'az installer nem 0-val tert vissza -- nem mertem', drift: true }); continue; }

      const genDir = join(repo, '.git', 'hooks');
      const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.sample') ? [] : [join(d, e.name)]);
      for (const g of walk(genDir).sort()) {
        const rel = g.slice(genDir.length + 1);
        const installedPath = join(HOOKS_DIR, rel);
        if (!existsSync(installedPath)) { findings.push({ lane: 'D hook', name: rel, text: `HIANYZIK a telepitesbol (${inst} generalja)`, drift: true }); continue; }

        // NORMALIZE BEFORE COMPARING: the generated copy embeds its OWN repo path.
        // Raw comparison would report the generator working normally as drift on
        // every file -- the exact false-positive class this card exists to remove.
        const norm = normalizeGenerated(readFileSync(g, 'utf-8'), repo, INSTALL_ROOT);
        // ...then STOP rather than report: a surviving throwaway path means the
        // substitution is incomplete and every verdict below it is untrustworthy.
        const leak = throwawayLeak(norm, tmpRoot);
        if (leak) { stopped ??= `${rel}: ${leak}`; return; }

        const live = readFileSync(installedPath, 'utf-8');
        if (sameAsInstaller(norm, live)) { findings.push({ lane: 'D hook', name: rel, text: 'AZONOS', drift: false, via: inst }); continue; }
        record('D hook', rel, classifyDirection(norm, live), `scripts/${inst}`, inst);
      }
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function main(): number {
  const args = process.argv.slice(2);
  const both = !args.includes('--plists') && !args.includes('--hooks');
  if (both || args.includes('--plists')) laneC();
  if (!stopped && (both || args.includes('--hooks'))) laneD();

  if (stopped) { console.log(`installed-drift: NEM MERHETO -- ${stopped}`); return 1; }

  const drifting = findings.filter((f) => f.drift);
  // THE INSTALLER IS PART OF THE IDENTITY, NOT DECORATION. Three hook files are generated by
  // TWO of the five installers, so the same path is compared twice -- and measured 2026-09-12,
  // `pre-push.d/10-no-force-push-protected` comes back AZONOS from one and DRIFTING from the
  // other. Without the installer name those two lines are indistinguishable, and whoever
  // reinstalls cannot tell WHICH installer actually closes the gap.
  for (const f of findings.filter((x) => !x.drift)) console.log(`  ${f.lane.padEnd(8)} ${f.name.padEnd(46)} ${f.text}${f.via ? `  [${f.via}]` : ''}`);
  if (!drifting.length) {
    console.log(`\ninstalled-drift: nincs elteres (${findings.length} osszevetes).`);
    return 0;
  }
  console.log(`\ninstalled-drift: ${drifting.length} elteres ${findings.length} osszevetesbol. A tool NEM IR SEMMIT -- a dontes azé, aki a kontextust ismeri.`);
  for (const f of drifting) console.log(`\n  ${f.lane} ${f.name}${f.via ? `  [generalta: ${f.via}]` : ''}\n    ${f.text}`);
  return 3;
}

if (process.argv[1]?.endsWith('installed-drift-check.ts')) process.exit(main());
