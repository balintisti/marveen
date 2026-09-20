import { describe, expect, it } from 'vitest'
import { decideIdleAlert, NO_IDLE_STATE, type IdleAgentInput, type IdleAgentThresholds } from '../idle-agent.js'

// The ownerless pull-list notice must not re-send an UNCHANGED list (card 88998fea).
//
// The wake path has said "THE SAME LIST IS NOT NEWS" since 2026-08-24, comparing
// ownWorkIds as a set. The idle-no-work branch never reached it: it returns first,
// so its only gate was realertMs -- TIME, where the question is CONTENT.
//
// Measured 2026-09-20 by deeper, from the store: ten notices in five hours on a
// ~30 minute cadence (exactly realertMs), every one naming the identical nine
// cards. The list was CORRECT every time -- deeper's own pull-list computation
// agreed -- which is the point: nothing was broken, it was simply repeated.
//
// The re-arm cases matter as much as the suppression. A guard that goes quiet and
// STAYS quiet is not an improvement over one that repeats; the last two tests are
// what separate the two.

const TH: IdleAgentThresholds = {
  sustainedMs: 10 * 60_000,
  realertMs: 30 * 60_000,
  wakeGraceMs: 15 * 60_000,
  wakeCooldownMs: 30 * 60_000,
  wakeStaleRearmMs: 4 * 60 * 60_000,
}

const base: IdleAgentInput = {
  agent: 'deeper',
  running: true,
  paneIdle: true,
  pendingMessages: 0,
  ownWorkCount: 0,
  // `none` short-circuits earlier and never reaches this branch at all; a REAL
  // declared check with zero cards is the case that produces the notice.
  workCheckKind: 'assigned_open_cards',
}

const NINE = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']
const T0 = 1_000_000
const sustained = T0 + TH.sustainedMs + 1

/** Drive the spell to its first notice and hand back the state it left behind. */
function firstNotice(pullWorkIds: readonly string[] | undefined) {
  const input = { ...base, pullWorkIds }
  const s1 = decideIdleAlert(input, NO_IDLE_STATE, TH, T0)
  const s2 = decideIdleAlert(input, s1.next, TH, sustained)
  expect(s2.decision.alert).toBe(true)
  expect(s2.decision.reason).toBe('idle-no-work')
  return s2.next
}

describe('the ownerless pull-list notice stops repeating an unchanged list', () => {
  it('re-sends nothing when the same nine cards are still the whole list', () => {
    const after = firstNotice(NINE)
    // Past realertMs, so the TIME gate is open: only a content gate can stop this.
    const again = decideIdleAlert(
      { ...base, pullWorkIds: NINE },
      after,
      TH,
      sustained + TH.realertMs + 1,
    )
    expect(again.decision.alert).toBe(false)
    expect(again.decision.reason).toBe('unchanged-pull-list')
  })

  it('CONTROL -- the time gate still works on its own, before realertMs', () => {
    const after = firstNotice(NINE)
    const soon = decideIdleAlert({ ...base, pullWorkIds: NINE }, after, TH, sustained + 60_000)
    expect(soon.decision.alert).toBe(false)
    expect(soon.decision.reason).toBe('recently-alerted')
  })

  it('a card LEAVING the list is news -- the set is compared, not the count', () => {
    const after = firstNotice(NINE)
    const eight = NINE.slice(0, 8)
    const again = decideIdleAlert(
      { ...base, pullWorkIds: eight },
      after,
      TH,
      sustained + TH.realertMs + 1,
    )
    expect(again.decision.alert).toBe(true)
    expect(again.decision.reason).toBe('idle-no-work')
  })

  it('a SWAP is news too, though the count never moves', () => {
    const after = firstNotice(NINE)
    const swapped = [...NINE.slice(0, 8), 'c10']
    const again = decideIdleAlert(
      { ...base, pullWorkIds: swapped },
      after,
      TH,
      sustained + TH.realertMs + 1,
    )
    expect(again.decision.alert).toBe(true)
  })

  it('order alone is NOT news', () => {
    const after = firstNotice(NINE)
    const reordered = [...NINE].reverse()
    const again = decideIdleAlert(
      { ...base, pullWorkIds: reordered },
      after,
      TH,
      sustained + TH.realertMs + 1,
    )
    expect(again.decision.reason).toBe('unchanged-pull-list')
  })

  it('an unchanged list IS news again after the stale re-arm window', () => {
    // A guard that suppresses forever is not better than one that repeats: after
    // hours of an untouched pull-list, "nobody has taken any of these" is itself
    // the finding.
    const after = firstNotice(NINE)
    const muchLater = decideIdleAlert(
      { ...base, pullWorkIds: NINE },
      after,
      TH,
      sustained + TH.wakeStaleRearmMs! + 1,
    )
    expect(muchLater.decision.alert).toBe(true)
    expect(muchLater.decision.reason).toBe('idle-no-work')
  })

  it('CONTROL -- with no ids measured the suppression is SKIPPED, not guessed', () => {
    // Same contract as ownWorkIds on the wake path: absent means "not measured",
    // and an unmeasured "unchanged" must never silence a notice.
    const after = firstNotice(undefined)
    const again = decideIdleAlert(
      { ...base, pullWorkIds: undefined },
      after,
      TH,
      sustained + TH.realertMs + 1,
    )
    expect(again.decision.alert).toBe(true)
    expect(again.decision.reason).toBe('idle-no-work')
  })

  it('an EMPTY list twice is also not news -- that notice goes to the coordinator', () => {
    const after = firstNotice([])
    const again = decideIdleAlert({ ...base, pullWorkIds: [] }, after, TH, sustained + TH.realertMs + 1)
    expect(again.decision.reason).toBe('unchanged-pull-list')
  })
})
