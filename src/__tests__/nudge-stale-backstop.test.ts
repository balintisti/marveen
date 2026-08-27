// Is the idle nudge a guaranteed backstop? Measured, not assumed.
//
// The busy-branch design (card 835384e6) suppresses a wakeup when a copy is
// already queued unread in the pane. Whether that suppression is the CHEAP
// error rests entirely on one claim: "the idle branch will fire eventually
// anyway". Marveen made that argument explicitly and asked for it to be
// measured rather than believed -- two "never to loss" doc claims had already
// collapsed under measurement the same day.
//
// It does not hold. These tests drive the watcher's own pure decision functions
// and show that a still-pending message can silence the idle branch FOREVER.
//
// Consequence, and the reason this file exists next to the change: the failure
// direction of the busy branch must be SEND, not suppress. Suppression may only
// ever be bounded by a failsafe, because nothing behind it is guaranteed.

import { describe, it, expect } from 'vitest'
import {
  decideNudgePreflight,
  recordNudge,
  INITIAL_NUDGE_STATE,
  MAX_STALE_NUDGES,
  STALE_NUDGE_COOLDOWN_MS,
  NUDGE_DEBOUNCE_MS,
  MAX_NUDGES_PER_HOUR,
  MIN_PENDING_AGE_MS,
  type NudgeState,
} from '../web/inbox-nudge-watcher.js'

const HOUR = 60 * 60_000
const OLD_ENOUGH = MIN_PENDING_AGE_MS + 1

/** Drive the watcher forward while ONE message stays pending, and report every
 *  moment it decided to nudge. Time advances by `stepMs` per tick. */
function runSpell(opts: { oldestId: number; ticks: number; stepMs: number; from?: number }): {
  fires: number[]
  state: NudgeState
} {
  let state: NudgeState = { ...INITIAL_NUDGE_STATE }
  let now = opts.from ?? 1_000_000
  const fires: number[] = []
  for (let i = 0; i < opts.ticks; i++) {
    const r = decideNudgePreflight({ now, oldestId: opts.oldestId, oldestAgeMs: OLD_ENOUGH }, state)
    state = r.state
    if (r.proceed) {
      fires.push(now)
      state = recordNudge(state, now, opts.oldestId)
    }
    now += opts.stepMs
  }
  return { fires, state }
}

describe('the idle nudge is NOT a guaranteed backstop', () => {
  it('stops permanently after MAX_STALE_NUDGES while the same message stays pending', () => {
    // Six hours of ticks, one every 30s. If the idle branch were a backstop,
    // fires would keep coming; the hourly budget alone would allow 10/hour.
    const { fires } = runSpell({ oldestId: 42, ticks: 720, stepMs: 30_000 })
    expect(fires.length).toBe(MAX_STALE_NUDGES)

    // And the silence is not a slow cadence -- it is terminal. Nothing after
    // the third fire, across the remaining ~5.9 hours.
    const spanAfterLast = 720 * 30_000 - (fires[fires.length - 1] - 1_000_000)
    expect(spanAfterLast).toBeGreaterThan(5 * HOUR)
  })

  it('stays silent even after a full day, so no cooldown ever rescues it', () => {
    // One tick per 10 minutes for 6 days: far past every window in the module
    // (debounce 60s, stale cooldown 5min, budget window 1h).
    const { fires } = runSpell({ oldestId: 42, ticks: 864, stepMs: 10 * 60_000 })
    expect(fires.length).toBe(MAX_STALE_NUDGES)
  })

  it('the hourly budget, by contrast, DOES recover -- so the two are different', () => {
    // Control for the claim above: not every brake in this module is terminal.
    // A changing oldest id (a live stream of mail) keeps resetting the stale
    // counter, so only the budget limits it -- and the budget is rolling.
    let state: NudgeState = { ...INITIAL_NUDGE_STATE }
    let now = 1_000_000
    let fires = 0
    for (let i = 0; i < 400; i++) {
      const r = decideNudgePreflight({ now, oldestId: 1000 + i, oldestAgeMs: OLD_ENOUGH }, state)
      state = r.state
      if (r.proceed) {
        fires++
        state = recordNudge(state, now, 1000 + i)
      }
      now += 90_000 // 400 * 90s = 10 hours
    }
    // Rolling cap, not a permanent stop: roughly MAX_NUDGES_PER_HOUR per hour.
    expect(fires).toBeGreaterThan(MAX_NUDGES_PER_HOUR)
  })

  it('only an EMPTY inbox clears the stale spell -- which needs the drain it stopped', () => {
    // The circularity, stated as a test: the spell resets on oldestId === null,
    // i.e. after a claim; the claim needs a prompt; the prompt is what stopped.
    const { state } = runSpell({ oldestId: 42, ticks: 100, stepMs: 60_000 })
    expect(state.staleAlerted).toBe(true)

    // Still stuck at the same id: no.
    const stuck = decideNudgePreflight(
      { now: 99_000_000, oldestId: 42, oldestAgeMs: OLD_ENOUGH }, state)
    expect(stuck.proceed).toBe(false)

    // Inbox emptied by something else (a human prompt drained it): the spell
    // clears, and the NEXT message is nudged normally.
    const cleared = decideNudgePreflight(
      { now: 99_000_000, oldestId: null, oldestAgeMs: 0 }, state)
    expect(cleared.state.staleNudges).toBe(0)
    expect(cleared.state.staleAlerted).toBe(false)
    const next = decideNudgePreflight(
      { now: 99_000_000 + NUDGE_DEBOUNCE_MS + 1, oldestId: 43, oldestAgeMs: OLD_ENOUGH },
      cleared.state)
    expect(next.proceed).toBe(true)
  })

  it('the third fire is separated by the stale cooldown, so the stop is deliberate', () => {
    // Guards against reading the count above as an accident of the tick rate.
    const { fires } = runSpell({ oldestId: 42, ticks: 720, stepMs: 30_000 })
    expect(fires[1] - fires[0]).toBeGreaterThanOrEqual(STALE_NUDGE_COOLDOWN_MS)
    expect(fires[2] - fires[1]).toBeGreaterThanOrEqual(STALE_NUDGE_COOLDOWN_MS)
  })
})
