// `measured_at` was UTC-only while the snapshot it reads carries BOTH a UTC and a
// local stamp. On 2026-08-29 two agents read two DIFFERENT real fields about the
// same instant and appeared to contradict each other for two hours -- neither was
// wrong, and the output never said which zone it was in (card 9ca92d74).
import { describe, it, expect } from 'vitest'
import { formatLocalStamp } from '../config.js'

describe('formatLocalStamp', () => {
  // FIXTURES CHOSEN SO A WRONG IMPLEMENTATION DIVERGES, not for realism.
  // 12:00Z in July is 14:00 CEST (+2); in January it is 13:00 CET (+1).
  // A UTC passthrough gets BOTH wrong; a hardcoded +1 gets the summer one wrong;
  // a hardcoded +2 gets the winter one wrong. A single fixture would let two of
  // those three through.
  const JULY = Date.UTC(2026, 6, 15, 12, 0, 0)
  const JAN = Date.UTC(2026, 0, 15, 12, 0, 0)

  it('renders summer time with the +2 offset and names the zone', () => {
    expect(formatLocalStamp(JULY, 'Europe/Budapest')).toBe('2026-07-15 14:00:00 CEST')
  })

  it('renders winter time with the +1 offset -- so the offset is not hardcoded', () => {
    expect(formatLocalStamp(JAN, 'Europe/Budapest')).toBe('2026-01-15 13:00:00 CET')
  })

  it('is NOT the UTC value (the failure this card exists for)', () => {
    // The precise defect: a reader comparing this against a UTC field two hours
    // apart concludes the two disagree. Asserting "not equal" is weak on its own,
    // so the two cases above pin the exact rendering; this one names the defect.
    const utc = new Date(JULY).toISOString()
    expect(formatLocalStamp(JULY, 'Europe/Budapest')).not.toContain(utc.slice(11, 16))
  })

  it('honours the zone it is given, so the install can change zone in ONE place', () => {
    // config.ts states the ~15 hardcoded 'Europe/Budapest' literals were replaced
    // precisely so the zone lives in one place. If this ignored its argument, that
    // property would be silently gone and every caller would still look correct.
    expect(formatLocalStamp(JULY, 'UTC')).toBe('2026-07-15 12:00:00 UTC')
  })
})
