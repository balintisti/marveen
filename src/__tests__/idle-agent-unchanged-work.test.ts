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

describe('the suppression must not become permanent', () => {
  // Measured by jarvis 2026-08-24 on the live board: with no labels set, five of six
  // agents drop to a 1-4 item queue, and those queues are STABLE for days. The fix for
  // `sameWorkSet([], [])` does nothing here -- `['x']` equals `['x']` just as well -- so
  // after a single wake the guard would fall silent forever, for exactly the agents
  // whose work is parked in testing. A repeat is cheap once a shift; silence is not.
  const TH_REARM: IdleAgentThresholds = { ...TH, wakeStaleRearmMs: 4 * 60 * 60_000 }

  it('a ONE-ITEM unchanged list is still suppressed inside the window', () => {
    const { decision } = decideIdleAlert(
      { ...base, ownWorkCount: 1, ownWorkIds: ['x'] }, wokenWith(['x'], at(0)), TH_REARM, at(100),
    )
    expect(decision.reason).toBe('unchanged-since-wake')
  })

  it('...and wakes again once the silence outlasts the window', () => {
    const { decision } = decideIdleAlert(
      { ...base, ownWorkCount: 1, ownWorkIds: ['x'] }, wokenWith(['x'], at(0)), TH_REARM, at(300),
    )
    expect(decision.alert).toBe(true)
    expect(decision.reason).toBe('wake-agent')
  })

  it('with NO re-arm configured the suppression is permanent -- the behaviour being replaced', () => {
    // Pinned so that removing the threshold is a visible decision rather than a default.
    const { decision } = decideIdleAlert(
      { ...base, ownWorkCount: 1, ownWorkIds: ['x'] }, wokenWith(['x'], at(0)), TH, at(100_000),
    )
    expect(decision.reason).toBe('unchanged-since-wake')
  })
})

describe('the ORDER of the two gates, measured by behaviour rather than by their values', () => {
  // Jarvis, reviewing the value-relation test (2026-08-24): its title said ORDER and its
  // assertion checked `cooldown < rearm`, which is the VALUES. The order -- that the
  // cooldown gate returns FIRST in the decision tree -- was not guarded at all, so
  // swapping the two branches would leave it green while the premise of the whole
  // constraint had changed. "A test can guard what FOLLOWS from a condition instead of
  // what it FOLLOWS FROM."
  //
  // Unlike "nobody calls this", this one HAS a runtime shape, so it is measured rather
  // than read from the source: invert the thresholds and see which gate speaks.
  const TH_INVERTED: IdleAgentThresholds = {
    ...TH, wakeCooldownMs: 8 * 60 * 60_000, wakeStaleRearmMs: 4 * 60 * 60_000,
  }

  it('the COOLDOWN gate answers first -- proven where BOTH gates would fire', () => {
    // MY FIRST ATTEMPT AT THIS TEST DID NOT MEASURE THE ORDER, and the mutation said so:
    // swapping the two branches left it green. The reason is worth keeping, because it is
    // easy to repeat -- the stale gate only SUPPRESSES. When it declines to suppress,
    // control simply falls through to the cooldown, so in any scenario where only one of
    // them would fire, BOTH orderings give the same answer.
    //
    // The order is only observable where BOTH would fire and the winner names itself:
    // 20 minutes since the last wake is inside the 30m cooldown AND inside the 4h re-arm
    // window, with an unchanged list. Whichever gate stands first supplies the reason.
    const TH_BOTH: IdleAgentThresholds = { ...TH, wakeStaleRearmMs: 4 * 60 * 60_000 }
    const { decision } = decideIdleAlert(
      { ...base, ownWorkCount: 1, ownWorkIds: ['x'] },
      // 20 minutes since the last wake (400 -> 420), and the spell started at 405 so the
      // wake branch is entered at all (it needs lastWakeAt < idleSinceMs).
      { ...NO_IDLE_STATE, idleSinceMs: at(405), lastWakeAt: at(400), lastWakeWorkIds: ['x'] },
      TH_BOTH,
      at(420),
    )
    expect(decision.alert).toBe(false)
    // Swap the two branches in idle-agent.ts and this becomes 'unchanged-since-wake'.
    expect(decision.reason).toBe('wake-cooling-down')
  })

  it('past the cooldown, the re-arm is the gate that speaks', () => {
    // The other side of the same pair: 5h out, the cooldown is long done, so the stale
    // gate decides -- and with 5h > 4h it re-arms rather than suppressing.
    const TH_REAL: IdleAgentThresholds = { ...TH, wakeStaleRearmMs: 4 * 60 * 60_000 }
    const { decision } = decideIdleAlert(
      { ...base, ownWorkCount: 1, ownWorkIds: ['x'] },
      { ...NO_IDLE_STATE, idleSinceMs: at(400), lastWakeAt: at(300), lastWakeWorkIds: ['x'] },
      TH_REAL,
      at(600),
    )
    expect(decision.reason).toBe('wake-agent')
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
