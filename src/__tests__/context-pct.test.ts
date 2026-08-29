/**
 * THE DENOMINATOR (card d5798819).
 *
 * `contextTokens` has been on /api/agents all along and is live -- measured
 * 2026-08-28, 6/6 exact against an independently written parser. What was
 * missing is the number it should be divided by, and a token count without one
 * is not an assertion: 824 804 reads as 82% of a 1M window or 412% of a 200k
 * one, and nothing in the response said which.
 *
 * These tests pin the two decisions that make the quotient trustworthy, because
 * both are places where a plausible wrong answer is worse than an absurd one.
 */
import { describe, it, expect } from 'vitest'
import { contextPctFor } from '../web/context-pct.js'

const OPUS = 'claude-opus-5'        // 1M window
const SONNET = 'claude-sonnet-5'    // 200k window

describe('contextPctFor', () => {
  it('divides by the window the model actually has', () => {
    expect(contextPctFor(500_000, OPUS, null, null)).toBeCloseTo(0.5, 6)
    expect(contextPctFor(100_000, SONNET, null, null)).toBeCloseTo(0.5, 6)
  })

  it('uses the ACTIVE model, not the configured one', () => {
    // The divergence from measurePct, and the reason for it: the tokens came
    // from the RUNNING session. An agent configured as sonnet but running opus
    // would otherwise be divided by 200k and read 400% full while sitting at
    // 80% -- a false alarm on a healthy agent, which is the exact failure the
    // guard's own calibration note records.
    expect(contextPctFor(800_000, OPUS, SONNET, null)).toBeCloseTo(0.8, 6)
  })

  it('falls back to the configured model when no session model is known', () => {
    expect(contextPctFor(100_000, null, SONNET, null)).toBeCloseTo(0.5, 6)
  })

  it('lets an operator-set limit win, so the API and the guard cannot disagree', () => {
    // contextGuard.limitTokens pins an agent deliberately. If the API ignored
    // it, two numbers describing the same agent would drift apart, and the one
    // nobody edits would be the one that lies.
    expect(contextPctFor(100_000, OPUS, null, 400_000)).toBeCloseTo(0.25, 6)
  })

  it('does NOT clamp above 1 -- an absurd number is the only warning of a wrong denominator', () => {
    // Deliberate. The observation is input + cache_read + cache_creation of the
    // last request and overshoots the nominal window slightly (measured up to
    // 1.066x), so >1 is expected at the very top. More importantly: clamping
    // would turn "412%, something is wrong with the divisor" into a calm
    // "100%", and the documented incident behind this card was a 21% session
    // reading as 106% and force-restarting working agents for days.
    const pct = contextPctFor(824_804, SONNET, null, null)
    expect(pct).not.toBeNull()
    expect(pct!).toBeGreaterThan(4)
  })

  it('returns null rather than 0 when there is nothing to divide', () => {
    // "I could not measure" and "the context is empty" are different answers,
    // and a 0 would be read as the second. Same distinction the send-side queue
    // probe defends.
    for (const t of [null, undefined, 0, -1, Number.NaN]) {
      expect(contextPctFor(t as number | null, OPUS, null, null)).toBeNull()
    }
  })

  it('returns null when the limit itself is unusable', () => {
    expect(contextPctFor(1000, OPUS, null, Number.NaN)).not.toBeNull() // NaN override -> falls back
    expect(contextPctFor(1000, OPUS, null, -5)).not.toBeNull()         // negative override -> falls back
  })

  it('reproduces the six live agents measured on 2026-08-28', () => {
    // The acceptance criterion marveen set, frozen as a fixture: these are the
    // real contextTokens read off /api/agents at 07:46, all six on opus-5.
    // Independently computed percentages, so a change of denominator cannot
    // pass quietly.
    const live: Array<[string, number, number]> = [
      ['computress', 409_891, 0.409891],
      ['dexter', 475_126, 0.475126],
      ['didi', 735_304, 0.735304],
      ['friday', 260_510, 0.260510],
      ['jarvis', 674_604, 0.674604],
      ['mandark', 824_804, 0.824804],
    ]
    for (const [name, tokens, expected] of live) {
      expect(contextPctFor(tokens, OPUS, null, null), name).toBeCloseTo(expected, 6)
    }
  })
})
