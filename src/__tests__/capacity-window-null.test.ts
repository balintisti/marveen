// Card 466b8998: `Number(null) === 0`, and 0 is finite -- so the old capacity-cli guard let a
// null used_percent through as "no consumption at all" and a null resets_at through as epoch 0
// (read as UNDERUSE at 80% used). Both errors pointed the reassuring way. didi and mandark
// measured it on the shipped bytes: paceRatio 0 and 0.00027 where the truth was "unknown".
//
// What this pins, beyond "null is rejected":
//   - a REAL 0% stays valid (a guard that also drops genuine zeros would be the opposite bug);
//   - undefined was already rejected (the control didi and mandark used) and still is;
//   - end to end through paceRatio: a null field yields null ("not measurable"), not 0;
//   - capacity-cli uses this parse, not a private copy of the old one.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { windowFromUsage, paceRatio } from '../capacity-report.js'

const RESET_SEC = Math.floor(Date.now() / 1000) + 3 * 86400 // 3 days ahead, a live weekly window

describe('windowFromUsage: "not measurable" is never zero', () => {
  it('null used_percent -> null (was {usedPercent: 0})', () => {
    expect(windowFromUsage({ used_percent: null, resets_at: RESET_SEC })).toBeNull()
  })
  it('null resets_at -> null (was resetsAtMs 0)', () => {
    expect(windowFromUsage({ used_percent: 80, resets_at: null })).toBeNull()
  })
  it('both null -> null', () => {
    expect(windowFromUsage({ used_percent: null, resets_at: null })).toBeNull()
  })
  it('CONTROL: undefined was rejected before and still is', () => {
    expect(windowFromUsage({ used_percent: 80 })).toBeNull()
    expect(windowFromUsage({ resets_at: RESET_SEC })).toBeNull()
  })
  it('a numeric STRING is not a number here either (same rule as quota-gate.ts)', () => {
    expect(windowFromUsage({ used_percent: '80', resets_at: RESET_SEC })).toBeNull()
  })
  it('NEGATIVE CONTROL: a genuine 0% is a measurement and stays valid', () => {
    expect(windowFromUsage({ used_percent: 0, resets_at: RESET_SEC })).toEqual({ usedPercent: 0, resetsAtMs: RESET_SEC * 1000 })
  })
  it('seconds and milliseconds resets_at are both understood (unchanged behaviour)', () => {
    expect(windowFromUsage({ used_percent: 5, resets_at: RESET_SEC })!.resetsAtMs).toBe(RESET_SEC * 1000)
    expect(windowFromUsage({ used_percent: 5, resets_at: RESET_SEC * 1000 })!.resetsAtMs).toBe(RESET_SEC * 1000)
  })
})

describe('end to end: paceRatio on a null field is null, not a reassuring number', () => {
  const now = Date.now()
  it('null used_percent -> paceRatio null (the shipped code gave 0)', () => {
    expect(paceRatio(windowFromUsage({ used_percent: null, resets_at: RESET_SEC }), now)).toBeNull()
  })
  it('null resets_at -> paceRatio null (the shipped code gave ~0.00027)', () => {
    expect(paceRatio(windowFromUsage({ used_percent: 80, resets_at: null }), now)).toBeNull()
  })
  it('CONTROL: a real window still yields a real ratio', () => {
    const r = paceRatio(windowFromUsage({ used_percent: 80, resets_at: RESET_SEC }), now)
    expect(r).not.toBeNull()
    expect(r!).toBeGreaterThan(1)
  })
})

describe('wiring', () => {
  it('capacity-cli parses windows with windowFromUsage and keeps no Number() copy of the old guard', () => {
    const src = readFileSync(new URL('../capacity-cli.ts', import.meta.url), 'utf-8')
    expect(src).toContain('const win = windowFromUsage')
    expect(src).not.toMatch(/Number\(r\.used_percent\)|Number\(r\.resets_at\)/)
  })
})
