// Card 8b8864e4 (marveen 57334), the didi case of 2026-11-10: the guard asked didi to stop and write
// a handoff, the turn died in "API Error: Connection lost mid-response", and await-handoff waited for
// a handoff no turn was left to write. Nothing re-asked; the deadline restarted the session with no
// handoff, and the delivery hold kept didi's queue shut the whole time.
//
// The decision only. That the runner reads the error off the pane and words the re-send is pinned in
// context-guard-survives-dashboard-restart.test.ts; that the idle watcher writes no resume into the
// held queue, in idle-guard-api-error-resume.test.ts.
import { describe, it, expect } from 'vitest'
import {
  API_ERROR_RESEND_REASON_PREFIX,
  DEFAULT_CONTEXT_GUARD,
  INITIAL_GUARD_STATE,
  MAX_API_ERROR_RESENDS,
  decideGuard,
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
  actPct: 0.82,
  hardPct: 0.97,
  limitTokens: 200_000,
  idleFlushEnabled: false,
  dailyHandoffEnabled: false,
}

function inputs(overrides: Partial<GuardInputs> = {}): GuardInputs {
  return {
    nowMs: NOW,
    pct: 0.83,
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

/** The state a real request leaves behind: busy, 83% against an 82% threshold. */
function asked(): GuardState {
  const first = decideGuard(INITIAL_GUARD_STATE, inputs(), cfg)
  expect(first.action).toBe('request-handoff')
  expect(first.nextState.phase).toBe('await-handoff')
  return first.nextState
}

/** The pane five minutes later: the turn died, the prompt is free, the error is the last block. */
const died = (overrides: Partial<GuardInputs> = {}) =>
  inputs({ nowMs: NOW + 5 * MIN, paneIdle: true, paneBusy: false, paneApiError: true, ...overrides })

describe('await-handoff -- the turn that was to write the handoff died in an API error', () => {
  it('THE CASE: no handoff, the pane ends in the error -> the request goes out again, once', () => {
    const d = decideGuard(asked(), died(), cfg)
    expect(d.action).toBe('request-handoff')
    expect(d.reason.startsWith(API_ERROR_RESEND_REASON_PREFIX)).toBe(true)
    expect(d.nextState.phase).toBe('await-handoff')
    expect(d.nextState.apiErrorResends).toBe(1)
  })

  it('the re-send keeps the deadline: a second loss ends in the restart, not in a loop', () => {
    const start = asked()
    const resent = decideGuard(start, died(), cfg)
    expect(resent.nextState.deadlineMs).toBe(start.deadlineMs)
    expect(MAX_API_ERROR_RESENDS).toBe(1)
    const again = decideGuard(resent.nextState, died({ nowMs: NOW + 10 * MIN }), cfg)
    expect(again.action).toBe('none')
    const atDeadline = decideGuard(again.nextState, died({ nowMs: start.deadlineMs }), cfg)
    expect(atDeadline.action).toBe('restart')
    expect(atDeadline.reason).toContain('handoff timeout')
  })

  it('CONTROL: the same idle pane WITHOUT the error -> waits, as before', () => {
    const d = decideGuard(asked(), died({ paneApiError: false }), cfg)
    expect(d.action).toBe('none')
    expect(d.reason).toBe('waiting for handoff')
  })

  it('a handoff already written wins: the error at the tail is no reason to ask for it again', () => {
    const d = decideGuard(asked(), died({ handoffMtime: NOW + 4 * MIN }), cfg)
    expect(d.action).toBe('restart')
  })

  it('a handoff already written, on a pane that reads neither idle nor busy: still no re-send', () => {
    const d = decideGuard(asked(), died({ handoffMtime: NOW + 4 * MIN, paneIdle: false }), cfg)
    expect(d.action).toBe('none')
    expect(d.reason).toBe('handoff written, waiting for idle pane')
  })

  it('a busy pane is a running turn: no re-send', () => {
    const d = decideGuard(asked(), died({ paneIdle: false, paneBusy: true }), cfg)
    expect(d.action).toBe('none')
  })

  it('past the deadline the restart is the answer, not a re-send', () => {
    const start = asked()
    const d = decideGuard(start, died({ nowMs: start.deadlineMs }), cfg)
    expect(d.action).toBe('restart')
  })

  it('a new sequence gets its re-send back: a restart state does not carry the count', () => {
    const resent = decideGuard(asked(), died(), cfg)
    const restarted = decideGuard(resent.nextState, died({ handoffMtime: NOW + 6 * MIN, nowMs: NOW + 7 * MIN }), cfg)
    expect(restarted.action).toBe('restart')
    expect(restarted.nextState.apiErrorResends).toBeUndefined()
  })

  it('the count survives the state file (a dashboard restart must not hand out a second re-send)', () => {
    const resent = decideGuard(asked(), died(), cfg).nextState
    const read = validGuardState(JSON.parse(JSON.stringify(resent)))
    expect(read?.apiErrorResends).toBe(1)
    expect(validGuardState({ ...resent, apiErrorResends: 'one' })).toBeNull()
  })
})
