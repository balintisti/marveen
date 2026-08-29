/**
 * The calendar CLI may never report a failure with an empty explanation.
 *
 * Measured by didi on the LIVE install, 2026-08-27 15:00:28 CEST:
 *
 *     bash scripts/calendar-agenda.sh --hours 24
 *     -> {"ok":false,"via":"dist","error":""}
 *
 *   and three further runs in the same minute all returned ok:true. A
 *   transient failure that reported nothing, then healed.
 *
 * `via:"dist"` places it in the CLI rather than the wrapper (every
 * `emit_error` in calendar-agenda.sh writes text and sets no `via`), so the
 * empty string came from `fetchCalendarEvents`' catch: it rendered
 * `err.message`, and an Error with an empty message trimmed to ''.
 *
 * Why an empty string is worse than a vague one HERE: card f5aee23d changed the
 * morning briefing to stop printing "no calendar" and to quote this field
 * verbatim instead. With an empty error that instruction produces an empty
 * explanation -- exactly the shape it was written to remove.
 */
import { describe, it, expect } from 'vitest';
import { describeThrown } from '../google-api.js';

describe('describeThrown — the string is never empty', () => {
  it('an Error with NO message still names the exception', () => {
    // The measured case: this is what produced `error: ""`.
    const err = new Error('');
    err.name = 'AbortError';
    expect(describeThrown(err)).toBe('AbortError');
  });

  it('CONTROL: an Error WITH a message keeps it, and gains the name', () => {
    // Without this the assertion above would also pass on a function that
    // returns a constant.
    expect(describeThrown(new TypeError('socket hang up'))).toBe(
      'TypeError: socket hang up',
    );
  });

  it('a thrown non-Error says so instead of rendering as empty', () => {
    expect(describeThrown(undefined)).toContain('nem-Error');
    expect(describeThrown('')).toContain('nem-Error');
  });

  it('CONTROL: a thrown string with content is passed through', () => {
    expect(describeThrown('boom')).toBe('boom');
  });

  it('never returns an empty string for any of the shapes that reach it', () => {
    const shapes: unknown[] = [
      new Error(''),
      new Error('   '),
      Object.assign(new Error(''), { name: '' }),
      undefined,
      null,
      '',
      0,
      {},
    ];
    for (const s of shapes) {
      expect(describeThrown(s).length).toBeGreaterThan(0);
    }
  });
});
