/**
 * INSTALLED-VS-TRACKED DRIFT (card 8027ebee).
 *
 * Three deployment lanes install a copy of a tracked source OUTSIDE the repo --
 * launchd plists into ~/Library/LaunchAgents, hook scripts into .git/hooks, seed
 * tasks into ~/.claude/scheduled-tasks. The repo cannot see any of them, so a
 * `git status` is clean while an installed copy runs an older form. Nothing in
 * the fleet answered "which copy is authoritative"; deciding it was hand work.
 *
 * The seeded lane already has its tool (`src/seed-drift.ts`, card a22c9fe8) and
 * is NOT re-implemented here -- this module covers the other two and reuses that
 * module's `lineDrift` rather than growing a second differ.
 *
 * WHAT THIS MODULE IS FOR, and why it is the pure half: the expensive mistake on
 * this card was not the diffing. It was the VERDICT. A line-count classifier
 * called a REPLACEMENT ("these two lines moved from the installer into history")
 * a live hand-edit, in the costly direction -- "do not reinstall, read it first".
 * Both hooks it flagged were merely stale, and reinstalling them was the fix.
 *
 * So the type below makes the second step unskippable rather than advisory: when
 * both sides carry lines, `classifyDirection` CANNOT return a verdict. It returns
 * `needs-history`, and only `resolveWithHistory` -- which asks whether the
 * installed-only lines ever existed in the INSTALLER's own history -- produces one.
 * The page's rule, applied to itself: the condition belongs in the tool, not in
 * the discipline of whoever runs it.
 */
import { lineDrift } from './seed-drift.js';

/** A rendered plist still holding `__X__` was installed by a renderer that did
 *  not know that placeholder -- the same class as seed-drift's `{{X}}` check.
 *  It is DANGEROUS rather than merely wrong: the path it names does not exist,
 *  so the unit fails at load time, far from here. */
export const UNRESOLVED_PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;

export function unresolvedPlaceholders(rendered: string): string[] {
  return [...new Set(rendered.match(UNRESOLVED_PLACEHOLDER) ?? [])];
}

/**
 * The installer compares with `[ "$rendered" = "$(cat "$TARGET")" ]` and writes
 * with `printf '%s'`. Both sides of ITS check have trailing newlines stripped by
 * command substitution, so an installed copy legitimately lacks the template's
 * final newline. Comparing raw would report every single unit as drift. This
 * mirrors the installer's own idempotence check exactly -- it is not tolerance.
 */
export function sameAsInstaller(rendered: string, installed: string): boolean {
  return rendered.replace(/\n+$/, '') === installed.replace(/\n+$/, '');
}

export type Direction =
  | { kind: 'identical' }
  /** Only the freshly generated side has lines: the installed copy is an older
   *  form. Reinstalling ADDS and cannot delete -- it is safe, and an upgrade. */
  | { kind: 'installed-stale'; onlyGenerated: string[] }
  /** Only the installed side has lines, and the generator never produced them:
   *  someone edited the live copy. Reinstalling DESTROYS that. Read it first. */
  | { kind: 'local-edit'; onlyInstalled: string[] }
  /** NOT A VERDICT. Lines on both sides look identical whether a replacement
   *  landed in the installer or a human edited the live file. `resolveWithHistory`
   *  decides; nothing else may. */
  | { kind: 'needs-history'; onlyGenerated: string[]; onlyInstalled: string[] }
  /** The two files differ, yet no line is unique to either side: the lines were
   *  REORDERED or one was DUPLICATED.
   *
   *  This branch exists because the tool had a false green here. `lineDrift` is
   *  set-based -- deliberately reused rather than reimplemented -- and measured
   *  2026-09-12 it calls both a reorder and a duplicate `identical` (control: an
   *  added line is seen). Without this case the caller printed AZONOS for a file
   *  it had already established was different, which is the costly direction: in
   *  a shell hook, order is behaviour. */
  | { kind: 'reordered' };

export function classifyDirection(generated: string, installed: string): Direction {
  const { onlyTemplate: onlyGenerated, onlyLive: onlyInstalled } = lineDrift(generated, installed);
  if (!onlyGenerated.length && !onlyInstalled.length) {
    return sameAsInstaller(generated, installed) ? { kind: 'identical' } : { kind: 'reordered' };
  }
  if (!onlyInstalled.length) return { kind: 'installed-stale', onlyGenerated };
  if (!onlyGenerated.length) return { kind: 'local-edit', onlyInstalled };
  return { kind: 'needs-history', onlyGenerated, onlyInstalled };
}

export type HistoryVerdict =
  | { kind: 'installed-stale' }
  | { kind: 'local-edit'; unseen: string[] }
  /** Some installed-only lines are a former installer state and some are not:
   *  a hand-edit on top of an already-stale copy. The local-edit risk dominates,
   *  so this reads as "read it", never as stale. */
  | { kind: 'mixed'; unseen: string[] }
  /** NO history was supplied, so "never appeared" is indistinguishable from
   *  "nobody looked". An empty history must never read as `local-edit`: that is
   *  a blind measurer's zero, and it errs toward the expensive direction. */
  | { kind: 'unmeasurable'; reason: string };

/**
 * STEP TWO, and the whole reason this module exists.
 *
 * @param onlyInstalled lines present only in the installed copy
 * @param installerHistory the INSTALLER's content at each historical commit --
 *        not the installed artifact's, which is untracked and has no history
 */
export function resolveWithHistory(onlyInstalled: string[], installerHistory: string[]): HistoryVerdict {
  if (!installerHistory.length) {
    return { kind: 'unmeasurable', reason: 'no installer history was supplied -- a zero here would mean "nobody looked", not "never existed"' };
  }
  const meaningful = onlyInstalled.filter((l) => l.trim());
  if (!meaningful.length) return { kind: 'installed-stale' };
  const unseen = meaningful.filter((line) => !installerHistory.some((rev) => rev.includes(line.trim())));
  if (!unseen.length) return { kind: 'installed-stale' };
  if (unseen.length === meaningful.length) return { kind: 'local-edit', unseen };
  return { kind: 'mixed', unseen };
}

/**
 * A hook generated into a throwaway repo embeds THAT repo's path. Comparing raw
 * would report the generator working normally as drift on every file -- exactly
 * the false-positive class this card exists to remove. So normalize first, then
 * STOP rather than report if any throwaway path survived: a leak means the
 * substitution is incomplete and every verdict downstream is untrustworthy.
 */
export function normalizeGenerated(generated: string, throwawayRoot: string, realRoot: string): string {
  return generated.split(throwawayRoot).join(realRoot);
}

export function throwawayLeak(normalized: string, throwawayMarker: string): string | null {
  if (!normalized.includes(throwawayMarker)) return null;
  const line = normalized.split('\n').find((l) => l.includes(throwawayMarker)) ?? '';
  return `a throwaway path survived normalization: ${line.trim().slice(0, 120)}`;
}
