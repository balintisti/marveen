// Card 03fa1241 (friday 6ef4c8aa), dexter 2026-11-13 18:29-18:54: the guard asked for a handoff, the
// handoff was written, background work (an e2e run, a jest run) held the restart -- and the turn died
// in "API Error: Connection lost mid-response". The idle guard writes no resume into the queue this
// phase holds (idle-agent-watcher, card 8b8864e4) and leaves the dead turn to this guard; the re-send
// answers it only BEFORE the handoff is written. Nobody answered, and dexter stood 22 minutes until
// the hold lapsed.
//
// The decision only. That the runner words it as "go on", in
// context-guard-survives-dashboard-restart.test.ts.
import { describe, it, expect } from 'vitest'
import {
  API_ERROR_HELD_RESUME_REASON_PREFIX,
  DEFAULT_CONTEXT_GUARD,
  INITIAL_GUARD_STATE,
  MAX_API_ERROR_HELD_RESUMES,
  decideGuard,
  deliveryHoldEndMs,
  type ContextGuardConfig,
  type GuardInputs,
  type GuardState,
} from '../context-guard.js'
import { validGuardState } from '../web/context-guard-state-file.js'

const NOW = 1_793_520_000_000
const MIN = 60_000

const cfg: ContextGuardConfig = {
  ...DEFAULT_CONTEXT_GUARD,
  enabled: true,
  actPct: 0.75,
  hardPct: 0.97,
  limitTokens: 200_000,
  idleFlushEnabled: false,
  dailyHandoffEnabled: false,
  handoffTimeoutMinutes: 10,
}

function inputs(overrides: Partial<GuardInputs> = {}): GuardInputs {
  return {
    nowMs: NOW,
    pct: 0.77,
    running: true,
    paneIdle: false,
    paneBusy: true,
    sessionReady: false,
    handoffMtime: null,
    paneSaturated: false,
    dailyHandoffDue: false,
    contextTokens: null,
    idleMs: 0,
    ...overrides,
  }
}

/** The state a real request leaves behind: busy, 77% against a 75% threshold. */
function asked(): GuardState {
  const first = decideGuard(INITIAL_GUARD_STATE, inputs(), cfg)
  expect(first.action).toBe('request-handoff')
  return first.nextState
}

const HANDOFF_AT = NOW + 3 * MIN
/** Five minutes in: the handoff was written at +3, nothing happened after it (the last transcript
 *  activity is the write), two background jobs run, the turn died and the error is the last block. */
const died = (overrides: Partial<GuardInputs> = {}) => {
  const nowMs = overrides.nowMs ?? NOW + 5 * MIN
  return inputs({
    nowMs,
    paneIdle: true,
    paneBusy: false,
    paneApiError: true,
    handoffMtime: HANDOFF_AT,
    idleMs: nowMs - HANDOFF_AT,
    backgroundWork: 2,
    backgroundWorkDetail: 'heavy-run: dexter e2e7, dexter jest',
    ...overrides,
  })
}

describe('the turn died while a written handoff\'s restart waited for background work', () => {
  it('THE CASE: the agent is told to go on; the hold and the phase stay', () => {
    const d = decideGuard(asked(), died(), cfg)
    expect(d.action).toBe('request-handoff')
    expect(d.reason.startsWith(API_ERROR_HELD_RESUME_REASON_PREFIX)).toBe(true)
    expect(d.reason).toContain('holding the restart')
    expect(d.nextState.phase).toBe('await-handoff')
    expect(d.nextState.backgroundDeferSinceMs).toBe(NOW + 5 * MIN)
    expect(d.nextState.apiErrorHeldResumes).toBe(1)
    expect(d.nextState.apiErrorHeldResumedAtMs).toBe(NOW + 5 * MIN)
  })

  it('CONTROL: the same held pane WITHOUT the error -> the hold, as before', () => {
    const d = decideGuard(asked(), died({ paneApiError: false }), cfg)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('holding the restart')
    expect(d.nextState.apiErrorHeldResumes).toBeUndefined()
  })

  it('CONTROL: no background work -> the restart, the error at the tail changes nothing', () => {
    const d = decideGuard(asked(), died({ backgroundWork: 0, backgroundWorkDetail: '' }), cfg)
    expect(d.action).toBe('restart')
  })

  it('a busy pane is a running turn: no resume', () => {
    const d = decideGuard(asked(), died({ paneBusy: true }), cfg)
    expect(d.action).toBe('none')
  })

  it('the same error is answered once: no turn ran since the resume, so no second one', () => {
    const first = decideGuard(asked(), died(), cfg)
    // Eight minutes later, inside the delivery hold, the transcript still ends at the handoff write:
    // the resume did not land.
    const again = decideGuard(first.nextState, died({ nowMs: NOW + 13 * MIN }), cfg)
    expect(again.action).toBe('none')
    expect(again.reason).toContain('holding the restart')
    // An unmeasured transcript is not evidence of a new loss either.
    expect(decideGuard(first.nextState, died({ nowMs: NOW + 13 * MIN, idleMs: null }), cfg).action).toBe('none')
  })

  it('a turn that ran after the resume and died again gets its own answer, up to the cap', () => {
    let state = decideGuard(asked(), died(), cfg).nextState
    // Past the handoff deadline (+10), so the refresh request below does not apply; before the
    // delivery hold ends (+15), the window this guard answers in.
    const roundAt = (n: number) => NOW + 10 * MIN + (n - 2) * 90_000
    expect(roundAt(MAX_API_ERROR_HELD_RESUMES + 1)).toBeLessThan(deliveryHoldEndMs(state))
    for (let n = 2; n <= MAX_API_ERROR_HELD_RESUMES; n++) {
      const nowMs = roundAt(n)
      // The resumed turn wrote half a minute ago, then died.
      const d = decideGuard(state, died({ nowMs, idleMs: 30_000 }), cfg)
      expect(d.action).toBe('request-handoff')
      expect(d.reason.startsWith(API_ERROR_HELD_RESUME_REASON_PREFIX)).toBe(true)
      expect(d.nextState.apiErrorHeldResumes).toBe(n)
      state = d.nextState
    }
    const nowMs = roundAt(MAX_API_ERROR_HELD_RESUMES + 1)
    const capped = decideGuard(state, died({ nowMs, idleMs: 30_000 }), cfg)
    expect(capped.action).toBe('none')
    expect(capped.reason).toContain('holding the restart')
  })

  it('once the delivery hold has lapsed the idle guard answers, not this one (one answer per loss)', () => {
    const state = decideGuard(asked(), died(), cfg).nextState
    const end = deliveryHoldEndMs(state)
    // The same fresh loss, a moment before and at the hold's end: the restart is still held both times.
    const before = decideGuard(state, died({ nowMs: end - 1, idleMs: 30_000 }), cfg)
    expect(before.action).toBe('request-handoff')
    expect(before.reason.startsWith(API_ERROR_HELD_RESUME_REASON_PREFIX)).toBe(true)
    const at = decideGuard(state, died({ nowMs: end, idleMs: 30_000 }), cfg)
    expect(at.action).toBe('none')
    expect(at.reason).toContain('holding the restart')
    expect(at.nextState.apiErrorHeldResumes).toBe(1)
  })

  it('before the deadline, work after the handoff gets the refresh request first (it answers the dead turn too)', () => {
    const first = decideGuard(asked(), died(), cfg)
    const d = decideGuard(first.nextState, died({ nowMs: NOW + 8 * MIN, idleMs: MIN }), cfg)
    expect(d.action).toBe('request-handoff')
    expect(d.reason.startsWith(API_ERROR_HELD_RESUME_REASON_PREFIX)).toBe(false)
    expect(d.nextState.apiErrorHeldResumes).toBe(1)
  })

  it('the hold\'s bound still restarts: the resume does not move it', () => {
    const start = decideGuard(asked(), died(), cfg)
    const bound = (start.nextState.backgroundDeferSinceMs as number) + 46 * MIN
    const d = decideGuard(start.nextState, died({ nowMs: bound, idleMs: MIN }), cfg)
    expect(d.action).toBe('restart')
  })

  it('a new sequence starts from zero: the restart state does not carry the count', () => {
    const resumed = decideGuard(asked(), died(), cfg)
    const done = decideGuard(resumed.nextState, died({ nowMs: NOW + 8 * MIN, backgroundWork: 0, backgroundWorkDetail: '', paneApiError: false }), cfg)
    expect(done.action).toBe('restart')
    expect(done.nextState.apiErrorHeldResumes).toBeUndefined()
    expect(done.nextState.apiErrorHeldResumedAtMs).toBeUndefined()
  })

  it('the count and the time survive the state file (a dashboard restart must not reset the cap)', () => {
    const resumed = decideGuard(asked(), died(), cfg).nextState
    const read = validGuardState(JSON.parse(JSON.stringify(resumed)))
    expect(read?.apiErrorHeldResumes).toBe(1)
    expect(read?.apiErrorHeldResumedAtMs).toBe(NOW + 5 * MIN)
    expect(validGuardState({ ...resumed, apiErrorHeldResumes: 'one' })).toBeNull()
    expect(validGuardState({ ...resumed, apiErrorHeldResumedAtMs: 'now' })).toBeNull()
  })
})
