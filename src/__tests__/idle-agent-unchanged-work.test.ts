import { describe, it, expect } from 'vitest'
import {
  decideIdleAlert,
  sameWorkSet,
  NO_IDLE_STATE,
  type IdleAgentInput,
  type IdleAgentState,
  type IdleAgentThresholds,
} from '../idle-agent.js'

// WHY THIS EXISTS (card 0fe791fb, measured 2026-08-24 on friday). The guard woke the
// same agent five times in two and a half hours, and every wake named the IDENTICAL
// list. Each one costs a full turn -- and it happened during a fleet-wide API outage
// where two agents out of seven could still take a turn at all.
//
// The cooldown cannot stop this on its own: a spell ends every time the agent takes a
// turn, so ANSWERING the wake re-arms it. What was missing is the question "is this
// news?", and the answer is a comparison against what the last wake already said.

const TH: IdleAgentThresholds = {
  sustainedMs: 10 * 60_000,
  realertMs: 30 * 60_000,
  wakeGraceMs: 15 * 60_000,
  wakeCooldownMs: 30 * 60_000,
}
const at = (t: number) => t * 60_000
const base: IdleAgentInput = { agent: 'friday', running: true, paneIdle: true, pendingMessages: 0, ownWorkCount: 3 }
/** An agent already woken once, in a NEW spell that is past the sustained threshold and
 *  past the wake cooldown -- i.e. exactly the state in which the guard would wake again.
 *  `idleSinceMs` must be set: with a fresh spell the round returns 'not-sustained' and
 *  never reaches the wake, which is how the first draft of these tests failed. */
const wokenWith = (ids: string[], wakeAt: number): IdleAgentState => ({
  ...NO_IDLE_STATE, idleSinceMs: at(50), lastWakeAt: wakeAt, lastWakeWorkIds: ids,
})

describe('the same work list is not news', () => {
  it('does NOT wake again when the list is identical to the last wake', () => {
    const ids = ['a', 'b', 'c']
    const { decision } = decideIdleAlert(
      { ...base, ownWorkIds: ids }, wokenWith(ids, at(0)), TH, at(100),
    )
    expect(decision.alert).toBe(false)
    expect(decision.reason).toBe('unchanged-since-wake')
  })

  it('DOES wake when an item was ADDED -- growth must not be silenced', () => {
    // The half that is easy to lose: a "do not repeat" rule written slightly too well
    // silences the case the guard exists for.
    const { decision } = decideIdleAlert(
      { ...base, ownWorkCount: 4, ownWorkIds: ['a', 'b', 'c', 'd'] }, wokenWith(['a', 'b', 'c'], at(0)), TH, at(100),
    )
    expect(decision.alert).toBe(true)
    expect(decision.reason).toBe('wake-agent')
  })

  it('DOES wake when an item was REMOVED', () => {
    const { decision } = decideIdleAlert(
      { ...base, ownWorkCount: 2, ownWorkIds: ['a', 'b'] }, wokenWith(['a', 'b', 'c'], at(0)), TH, at(100),
    )
    expect(decision.alert).toBe(true)
  })

  it('DOES wake when the COUNT is unchanged but the CONTENT moved', () => {
    // The case a count-based check would miss, and it is not hypothetical: on
    // 2026-08-24 an endpoint census read 18 before and 18 after, while the population
    // and the covered set had each grown by one.
    const { decision } = decideIdleAlert(
      { ...base, ownWorkIds: ['a', 'b', 'd'] }, wokenWith(['a', 'b', 'c'], at(0)), TH, at(100),
    )
    expect(decision.alert).toBe(true)
    expect(decision.reason).toBe('wake-agent')
  })

  it('records the list it woke with, so the NEXT identical round is suppressed', () => {
    const ids = ['x', 'y']
    const first = decideIdleAlert(
      { ...base, ownWorkIds: ids }, { ...NO_IDLE_STATE, idleSinceMs: at(5) }, TH, at(20),
    )
    expect(first.decision.alert).toBe(true)
    expect(first.next.lastWakeWorkIds).toEqual(ids)
    const second = decideIdleAlert(
      { ...base, ownWorkIds: ids }, { ...first.next, idleSinceMs: at(60) }, TH, at(100),
    )
    expect(second.decision.reason).toBe('unchanged-since-wake')
  })

  it('a caller that supplies NO ids behaves exactly as before -- nothing is suppressed', () => {
    // Backward compatibility is the safety rail here: the suppression must never fire
    // on a caller that cannot say what the items are, because then "unchanged" is not
    // measured, only assumed.
    const { decision } = decideIdleAlert(base, wokenWith(['a', 'b', 'c'], at(0)), TH, at(100))
    expect(decision.alert).toBe(true)
    expect(decision.reason).toBe('wake-agent')
  })

  it('suppression does NOT leak into the stage-2 human alert path', () => {
    // A suppressed wake must be silent END TO END. If it fell through, the guard would
    // trade a wake nobody needed for a human alert nobody needed.
    const ids = ['a']
    const { decision } = decideIdleAlert(
      { ...base, ownWorkIds: ids }, wokenWith(ids, at(0)), TH, at(400),
    )
    expect(decision.alert).toBe(false)
  })
})

describe('sameWorkSet -- compared as a SET, not a count and not an order', () => {
  it('order does not matter', () => { expect(sameWorkSet(['b', 'a'], ['a', 'b'])).toBe(true) })
  it('duplicates do not matter', () => { expect(sameWorkSet(['a', 'a', 'b'], ['a', 'b'])).toBe(true) })
  it('same size, different members is NOT the same', () => { expect(sameWorkSet(['a', 'b'], ['a', 'c'])).toBe(false) })
  it('a missing side is never "same" -- absence is not evidence', () => {
    expect(sameWorkSet(['a'], null)).toBe(false)
    expect(sameWorkSet(undefined, ['a'])).toBe(false)
  })
})
