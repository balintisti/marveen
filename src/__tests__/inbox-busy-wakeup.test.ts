// The busy branch: may we type a wakeup into a main pane that is mid-turn?
//
// Until 2026-08-27 two writers nudged this one pane. The message router typed
// `[inbox-wakeup: ...]` every 45s with no idle gate; this watcher abstained
// whenever the pane was busy. Measured over 290,5 hours of dashboard.log:
// 5 908 router fires for 1 286 distinct messages (78,1% redundant), and 855 of
// this watcher's 883 busy abstentions (96,8%) were overridden by the router
// within 30s. Every brake here was decorative.
//
// The router block is gone and its one real job moved here: reaching a main
// agent mid-turn. Nothing else does it -- the idle nudge aborts on busy and the
// */25 memoria-heartbeat carries skipIfBusy:true.
//
// The defect was never "types into a busy pane" -- that is the useful part.
// It was typing AGAIN while the previous copy sat unread. So: at most ONE
// unconsumed line, which makes the branch self-limiting at one per drain cycle.
//
// FAILURE DIRECTION IS SEND. `already-queued` is the only suppressing branch,
// and it is bounded by a failsafe, because MEASURED (nudge-stale-backstop) the
// idle branch stops permanently once staleNudges caps out on an unchanging id.
// A misread pane must cost a delay, never silence.

import { describe, it, expect } from 'vitest'
import {
  decideBusyWakeup,
  INITIAL_NUDGE_STATE,
  BUSY_WAKEUP_DEBOUNCE_MS,
  BUSY_WAKEUP_SUPPRESS_FAILSAFE_MS,
  BUSY_WAKEUP_TEXT,
  NUDGE_MAX_CHARS,
  MIN_PENDING_AGE_MS,
  type NudgeState,
} from '../web/inbox-nudge-watcher.js'
import { promptAlreadyQueued } from '../pane-state.js'

const T0 = 10_000_000
const OLD_ENOUGH = MIN_PENDING_AGE_MS + 1
const base = (over: Partial<NudgeState> = {}): NudgeState => ({ ...INITIAL_NUDGE_STATE, ...over })
const ask = (over: Partial<Parameters<typeof decideBusyWakeup>[0]>, state = base()) =>
  decideBusyWakeup({ now: T0, oldestId: 42, oldestAgeMs: OLD_ENOUGH, alreadyQueued: false, ...over }, state)

describe('decideBusyWakeup: at most one unconsumed line', () => {
  it('sends when nothing of ours is queued -- the job the router did', () => {
    const d = ask({})
    expect(d.send).toBe(true)
    expect(d.reason).toBe('nothing-queued')
    expect(d.state.lastBusyWakeupAt).toBe(T0)
  })

  it('does NOT send while a copy is already queued unread', () => {
    // This single branch is the whole 78,1%.
    const d = ask({ alreadyQueued: true })
    expect(d.send).toBe(false)
    expect(d.reason).toBe('already-queued')
  })

  it('does not send twice inside the debounce even with nothing queued', () => {
    // Guards the tick rate (20s) from becoming the send rate on a pane whose
    // capture lags a moment behind the keystrokes.
    const after = ask({}).state
    const d = decideBusyWakeup(
      { now: T0 + BUSY_WAKEUP_DEBOUNCE_MS - 1, oldestId: 42, oldestAgeMs: OLD_ENOUGH, alreadyQueued: false }, after)
    expect(d.send).toBe(false)
    expect(d.reason).toBe('too-soon')
  })

  it('sends again once the debounce passes and the line was consumed', () => {
    const after = ask({}).state
    const d = decideBusyWakeup(
      { now: T0 + BUSY_WAKEUP_DEBOUNCE_MS + 1, oldestId: 42, oldestAgeMs: OLD_ENOUGH, alreadyQueued: false }, after)
    expect(d.send).toBe(true)
  })

  it('leaves a message younger than the grace window alone', () => {
    const d = ask({ oldestAgeMs: MIN_PENDING_AGE_MS - 1 })
    expect(d.send).toBe(false)
    expect(d.reason).toBe('too-soon')
  })

  it('does nothing, and clears the suppression clock, when there is no mail', () => {
    const d = decideBusyWakeup(
      { now: T0, oldestId: null, oldestAgeMs: 0, alreadyQueued: true },
      base({ busySuppressedSince: T0 - 5_000 }))
    expect(d.send).toBe(false)
    expect(d.state.busySuppressedSince).toBe(0)
  })
})

describe('decideBusyWakeup: suppression is bounded, never permanent', () => {
  it('starts the clock on the first suppressed tick', () => {
    const d = ask({ alreadyQueued: true })
    expect(d.state.busySuppressedSince).toBe(T0)
  })

  it('keeps suppressing while the failsafe window has not elapsed', () => {
    const s = base({ busySuppressedSince: T0 - (BUSY_WAKEUP_SUPPRESS_FAILSAFE_MS - 1) })
    const d = decideBusyWakeup({ now: T0, oldestId: 42, oldestAgeMs: OLD_ENOUGH, alreadyQueued: true }, s)
    expect(d.send).toBe(false)
  })

  it('SENDS once the failsafe window elapses, even though a copy looks queued', () => {
    // The load-bearing case. A pane we misread would otherwise suppress for
    // ever, and nothing behind this is guaranteed to fire (nudge-stale-backstop).
    const s = base({ busySuppressedSince: T0 - BUSY_WAKEUP_SUPPRESS_FAILSAFE_MS })
    const d = decideBusyWakeup({ now: T0, oldestId: 42, oldestAgeMs: OLD_ENOUGH, alreadyQueued: true }, s)
    expect(d.send).toBe(true)
    expect(d.reason).toBe('failsafe')
  })

  it('restarts the clock after a failsafe send, so it cannot free-run', () => {
    // The failsafe must not become a new 20s cadence once it trips.
    const s = base({ busySuppressedSince: T0 - BUSY_WAKEUP_SUPPRESS_FAILSAFE_MS })
    const after = decideBusyWakeup({ now: T0, oldestId: 42, oldestAgeMs: OLD_ENOUGH, alreadyQueued: true }, s).state
    const next = decideBusyWakeup(
      { now: T0 + BUSY_WAKEUP_DEBOUNCE_MS + 1, oldestId: 42, oldestAgeMs: OLD_ENOUGH, alreadyQueued: true }, after)
    expect(next.send).toBe(false)
  })

  it('a failsafe send consumes the DEBOUNCE too, not just the suppression clock', () => {
    // Measured 2026-08-27: the case above passes even when the failsafe forgets
    // to stamp lastBusyWakeupAt, because resetting the suppression clock alone
    // already blocks the next tick. It therefore does not measure what its name
    // claims. This one isolates the debounce: right after a failsafe send, a
    // tick that sees NOTHING queued must still be held off -- otherwise the
    // failsafe hands the branch back to the 20s tick rate, which is the loop we
    // are removing.
    const s = base({ busySuppressedSince: T0 - BUSY_WAKEUP_SUPPRESS_FAILSAFE_MS })
    const after = decideBusyWakeup({ now: T0, oldestId: 42, oldestAgeMs: OLD_ENOUGH, alreadyQueued: true }, s).state
    expect(after.lastBusyWakeupAt).toBe(T0)
    const next = decideBusyWakeup(
      { now: T0 + 1, oldestId: 42, oldestAgeMs: OLD_ENOUGH, alreadyQueued: false }, after)
    expect(next.send).toBe(false)
    expect(next.reason).toBe('too-soon')
  })

  it('a suppressed spell never blocks a DIFFERENT, unqueued line', () => {
    // The pane drained ours and is busy again: nothing queued -> send.
    const s = base({ busySuppressedSince: T0 - 60_000 })
    const d = decideBusyWakeup({ now: T0, oldestId: 42, oldestAgeMs: OLD_ENOUGH, alreadyQueued: false }, s)
    expect(d.send).toBe(true)
    expect(d.state.busySuppressedSince).toBe(0)
  })
})

describe('the wakeup text and the predicate that must match it', () => {
  it('is a single visual row on the 80-column headless pane', () => {
    // Multi-row parked text on the MAIN pane has no automatic recovery; the
    // stuck-input bare-Enter branch only submits single-row text.
    expect(BUSY_WAKEUP_TEXT.includes('\n')).toBe(false)
    expect(BUSY_WAKEUP_TEXT.length).toBeLessThanOrEqual(NUDGE_MAX_CHARS)
  })

  it('is found by queuedPromptLines when queued -- the two must not drift apart', () => {
    // If the text and the predicate ever diverge, the branch silently reverts
    // to the old behaviour: it would never see its own line and retype forever.
    const busyPaneWithOurLineQueued = [
      '  ⎿  … tool output …',
      '',
      `❯ ${BUSY_WAKEUP_TEXT}`,
      '',
      '✳ Forming… (12m 04s · ↓ 40.2k tokens)',
      '────────────────────────────────────────────────────────────────────────────────',
      '❯ Press up to edit queued messages',
      '────────────────────────────────────────────────────────────────────────────────',
      '  Opus 5 · ctx 406k/1.0M · 41%',
      '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
    ].join('\n')
    expect(promptAlreadyQueued(busyPaneWithOurLineQueued, BUSY_WAKEUP_TEXT)).toBe(true)
  })
})
