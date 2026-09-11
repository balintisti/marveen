/**
 * Card 8027ebee. These specs pin the DIRECTION LOGIC, because that is where the
 * measured mistake was -- not in the diffing.
 *
 * The live case they are built from: `.git/hooks/pre-commit.d/05-prod-tree-guard`
 * differed from what today's installer generates, with lines on BOTH sides. A
 * line-count classifier called that a live hand-edit ("do not reinstall"). It was
 * a REPLACEMENT: the two installed-only lines existed verbatim in installer commit
 * 845e97b and were dropped by 035c1e4 when the override reason became mandatory.
 * Reinstalling was safe, and was the fix for a prod guard running in warn-only form.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyDirection, resolveWithHistory, sameAsInstaller,
  unresolvedPlaceholders, normalizeGenerated, throwawayLeak,
} from '../installed-drift.js';

describe('classifyDirection', () => {
  it('calls identical content identical', () => {
    expect(classifyDirection('a\nb\n', 'a\nb\n')).toEqual({ kind: 'identical' });
  });

  it('added-only lines are a stale install, which is safe to overwrite', () => {
    const d = classifyDirection('a\nb\nNEW\n', 'a\nb\n');
    expect(d.kind).toBe('installed-stale');
  });

  it('installed-only lines with nothing added are a live hand-edit', () => {
    const d = classifyDirection('a\nb\n', 'a\nb\nHAND\n');
    expect(d.kind).toBe('local-edit');
  });

  /** THE REGRESSION. A both-sided difference must not yield a verdict at all --
   *  this is the shape that produced the false alarm, and no amount of counting
   *  separates a replacement from a hand-edit. */
  it('REFUSES to decide when both sides carry lines', () => {
    const d = classifyDirection('a\nNEW\n', 'a\nOLD\n');
    expect(d.kind).toBe('needs-history');
    expect(['local-edit', 'installed-stale']).not.toContain(d.kind);
  });

  /** The tool's own false green, found by asking what the reused differ CANNOT
   *  see. `lineDrift` is set-based, so a reorder or a duplicate leaves no line
   *  unique to either side -- and the caller printed AZONOS for a file it had
   *  already established was different. In a shell hook, order is behaviour. */
  it('a REORDER is not identical', () => {
    expect(classifyDirection('alpha\nbeta\ngamma\n', 'gamma\nbeta\nalpha\n').kind).toBe('reordered');
  });

  it('a DUPLICATED line is not identical', () => {
    expect(classifyDirection('alpha\nbeta\ngamma\n', 'alpha\nbeta\nbeta\ngamma\n').kind).toBe('reordered');
  });

  it('but a trailing-newline-only difference is still identical (not a reorder)', () => {
    expect(classifyDirection('alpha\nbeta\n', 'alpha\nbeta').kind).toBe('identical');
  });

  it('still refuses when the added side is overwhelmingly larger (the live 66-vs-2 shape)', () => {
    const generated = ['common', ...Array.from({ length: 66 }, (_, i) => `added-${i}`)].join('\n');
    const installed = 'common\nindok nelkul; add meg: MARVEEN_PROD_COMMIT_REASON\nmasodik regi sor';
    expect(classifyDirection(generated, installed).kind).toBe('needs-history');
  });
});

describe('resolveWithHistory', () => {
  const stale = ['indok nelkul; add meg: MARVEEN_PROD_COMMIT_REASON', 'masodik regi sor'];

  it('lines found in the installer history are a former installer state -> stale', () => {
    const history = ['... indok nelkul; add meg: MARVEEN_PROD_COMMIT_REASON ...\nmasodik regi sor\n', 'later revision without them'];
    expect(resolveWithHistory(stale, history)).toEqual({ kind: 'installed-stale' });
  });

  it('lines the installer never produced are a real local edit', () => {
    const v = resolveWithHistory(['echo I_WAS_ADDED_BY_HAND'], ['rev one', 'rev two']);
    expect(v.kind).toBe('local-edit');
  });

  it('a hand-edit on top of a stale copy reads as mixed, never as stale', () => {
    const v = resolveWithHistory([...stale, 'echo HAND'], ['indok nelkul; add meg: MARVEEN_PROD_COMMIT_REASON\nmasodik regi sor']);
    expect(v.kind).toBe('mixed');
    expect(v.kind === 'mixed' && v.unseen).toEqual(['echo HAND']);
  });

  /** A zero from a measurer that was never given anything to look at is not a
   *  negative. Without this branch an empty history reads as `local-edit` -- a
   *  blind measurer producing a confident finding in the expensive direction. */
  it('an EMPTY history is unmeasurable, NOT a local edit', () => {
    const v = resolveWithHistory(stale, []);
    expect(v.kind).toBe('unmeasurable');
    expect(v.kind).not.toBe('local-edit');
  });

  it('blank-only differences are not a finding', () => {
    expect(resolveWithHistory(['   ', ''], ['anything'])).toEqual({ kind: 'installed-stale' });
  });
});

describe('sameAsInstaller', () => {
  /** The installer writes with `printf '%s'`, so the installed copy has no final
   *  newline. Raw comparison would flag all 8 units; this mirrors the installer's
   *  own `[ "$rendered" = "$(cat "$TARGET")" ]`, which strips both sides. */
  it('ignores the trailing newline the installer itself strips', () => {
    expect(sameAsInstaller('<plist/>\n', '<plist/>')).toBe(true);
  });

  it('but still sees a real difference (positive control)', () => {
    expect(sameAsInstaller('<plist>a</plist>\n', '<plist>b</plist>')).toBe(false);
  });

  it('does not ignore an interior blank line', () => {
    expect(sameAsInstaller('a\n\nb\n', 'a\nb')).toBe(false);
  });
});

describe('unresolvedPlaceholders', () => {
  it('finds a placeholder the renderer did not know', () => {
    expect(unresolvedPlaceholders('<string>__NEW_THING__/x</string>')).toEqual(['__NEW_THING__']);
  });

  it('is empty on a fully rendered unit', () => {
    expect(unresolvedPlaceholders('<string>/Users/isti/marveen/x</string>')).toEqual([]);
  });

  it('does not mistake an ordinary SHOUTING word for a placeholder', () => {
    expect(unresolvedPlaceholders('<key>RunAtLoad</key> PATH HOME')).toEqual([]);
  });
});

describe('normalizeGenerated / throwawayLeak', () => {
  it('rewrites the throwaway repo path so generation is not reported as drift', () => {
    const out = normalizeGenerated('cd /tmp/x9/repo1 && run', '/tmp/x9/repo1', '/Users/isti/marveen');
    expect(out).toBe('cd /Users/isti/marveen && run');
    expect(throwawayLeak(out, '/tmp/x9')).toBeNull();
  });

  it('STOPS instead of reporting when a throwaway path survives', () => {
    const out = normalizeGenerated('a\nsource /tmp/x9/other/f\n', '/tmp/x9/repo1', '/Users/isti/marveen');
    expect(throwawayLeak(out, '/tmp/x9')).toMatch(/survived normalization/);
  });
});
