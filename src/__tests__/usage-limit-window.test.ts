// THE LIMIT VERDICT EXPIRES (card d3f92923, didi's finding 2026-09-28 19:22): the banner outlives the
// limit on an idle pane, so a text-only verdict never let go. Real pane-state predicate, real parser;
// times are LOCAL, as Claude Code renders them.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  usageLimitHolds, usageLimitReleaseAt, resetUsageLimitWindows, USAGE_LIMIT_MAX_HOLD_MS,
} from '../usage-limit-window.js'

const local = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime()
const MIN = 60_000
const pane = (banner: string) => ['some output', banner, '', '❯ ', '  ⏵⏵ bypass permissions on'].join('\n')

describe('usageLimitReleaseAt -- the reset the banner names', () => {
  it('reads "5:50pm", "3pm", "at 2am" and 24-hour "18:00", two minutes of slack after each', () => {
    expect(usageLimitReleaseAt(pane('You hit your session limit · resets 5:50pm'), local(28, 14))).toBe(local(28, 17, 52))
    expect(usageLimitReleaseAt(pane('5-hour limit reached ∙ resets 3pm'), local(28, 13))).toBe(local(28, 15, 2))
    expect(usageLimitReleaseAt(pane('Your limit will reset at 18:00'), local(28, 14))).toBe(local(28, 18, 2))
  })

  it('a clock time already past when first seen is TOMORROW\'s (23:00 -> "at 2am" -> 02:02 next day)', () => {
    expect(usageLimitReleaseAt(pane('Session limit reached ∙ resets at 2am'), local(28, 23))).toBe(local(29, 2, 2))
  })

  it('the two twelves (didi): "12am" is midnight, "12pm" is noon', () => {
    expect(usageLimitReleaseAt(pane('Session limit reached ∙ resets 12am'), local(28, 21))).toBe(local(29, 0, 2))
    expect(usageLimitReleaseAt(pane('Session limit reached ∙ resets 12pm'), local(28, 9))).toBe(local(28, 12, 2))
  })

  it('no clock time in the banner: the cap', () => {
    expect(usageLimitReleaseAt(pane("You've reached your weekly limit for Opus. Resets Oct 3"), local(28, 10)))
      .toBe(local(28, 10) + USAGE_LIMIT_MAX_HOLD_MS)
  })

  it('never longer than the cap, even when the banner names a later time', () => {
    expect(usageLimitReleaseAt(pane('Session limit reached ∙ resets 9pm'), local(28, 10)))
      .toBe(local(28, 15))
  })
})

describe('usageLimitHolds -- first seen, then released', () => {
  beforeEach(() => resetUsageLimitWindows())

  it("didi's case: hit at 23:00, banner still on the idle pane at 03:00 -> released", () => {
    const p = pane('Session limit reached ∙ resets at 2am')
    expect(usageLimitHolds('idle:x', p, local(28, 23))).toBe(true)
    expect(usageLimitHolds('idle:x', p, local(29, 1, 59))).toBe(true)
    expect(usageLimitHolds('idle:x', p, local(29, 3))).toBe(false)
  })

  it('the clock starts when the banner is FIRST seen, not at every look', () => {
    const p = pane('You have reached your usage limit. Try again later.')   // no time: the cap
    expect(usageLimitHolds('k', p, local(28, 10))).toBe(true)
    expect(usageLimitHolds('k', p, local(28, 14, 59))).toBe(true)
    expect(usageLimitHolds('k', p, local(28, 15, 1))).toBe(false)
  })

  it('the banner gone forgets the clock, so a NEW limit gets a new window', () => {
    const p = pane('You have reached your usage limit. Try again later.')
    usageLimitHolds('k', p, local(28, 10))
    expect(usageLimitHolds('k', pane('all good'), local(28, 12))).toBe(false)
    expect(usageLimitHolds('k', p, local(28, 16))).toBe(true)   // 10:00's window would be over by now
  })

  it('keys are separate: one consumer cannot move another one\'s clock', () => {
    const p = pane('You have reached your usage limit. Try again later.')
    usageLimitHolds('idle:x', p, local(28, 10))
    expect(usageLimitHolds('guard:x', p, local(28, 15, 30))).toBe(true)    // first seen by the guard now
    expect(usageLimitHolds('idle:x', p, local(28, 15, 30))).toBe(false)
  })

  it('CONTROL: the soft warning never holds at all', () => {
    expect(usageLimitHolds('k', pane('Approaching Opus weekly limit ∙ 5% left'), local(28, 10))).toBe(false)
  })
})
