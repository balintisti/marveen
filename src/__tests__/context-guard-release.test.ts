// Card 17a19228: an agent that was asked to stop (await-handoff) must leave that state by a
// restart or by a RELEASE that says so in its pane. Before this card three exits were silent: the
// guard switched off, the guard disabled, and -- the measured one -- a session that compacted
// while the request was on its way (2026-11-11: request 05:04:20, compaction done 05:05:50, the
// session was restarted at 05:09 with a context of ~54k out of 200k).
//
// The decision only. That the runner hands compactedAtMs in and sends the release is pinned in
// context-guard-survives-dashboard-restart.test.ts.
import { describe, it, expect } from 'vitest'
import {
  COMPACTION_BEFORE_REQUEST_SLACK_MS,
  DEFAULT_CONTEXT_GUARD,
  INITIAL_GUARD_STATE,
  MAX_RELEASE_ATTEMPTS,
  RELEASE_COMPACTED_REASON_PREFIX,
  RELEASE_UNDELIVERED_REASON_PREFIX,
  decideGuard,
  type ContextGuardConfig,
  type GuardInputs,
  type GuardState,
} from '../context-guard.js'

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
const allOff: ContextGuardConfig = { ...cfg, enabled: false, saturationRestart: false }

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

/** The state a real request leaves behind: idle, 83% against an 82% threshold. */
function asked(): GuardState {
  const first = decideGuard(INITIAL_GUARD_STATE, inputs(), cfg)
  expect(first.action).toBe('request-handoff')
  return first.nextState
}

describe('the request records what a later release needs', () => {
  it('when it went out and the threshold that started it', () => {
    const state = asked()
    expect(state.phase).toBe('await-handoff')
    expect(state.requestedAtMs).toBe(NOW)
    expect(state.startThresholdPct).toBe(0.82)
    expect(state.noPressure).toBeUndefined()
  })

  it('the sub-agent gate tier records the GATE\'s threshold, not actPct', () => {
    const first = decideGuard(
      INITIAL_GUARD_STATE,
      inputs({ pct: 0.78, paneIdle: true, paneBusy: false, subagentGateRefusal: { atMs: NOW - 20 * MIN, gatePct: 0.75 } }),
      { ...cfg, actPct: 0.9 },
    )
    expect(first.action).toBe('request-handoff')
    expect(first.nextState.startThresholdPct).toBe(0.75)
  })

  it('an idle-flush request records no threshold: it never was about the size', () => {
    const first = decideGuard(
      INITIAL_GUARD_STATE,
      inputs({ pct: 0.3, contextTokens: 60_000, paneIdle: true, paneBusy: false, idleMs: 60 * MIN }),
      { ...cfg, idleFlushEnabled: true, idleMinutes: 30, idleFlushTokens: 50_000 },
    )
    expect(first.action).toBe('request-handoff')
    expect(first.nextState.noPressure).toBe(true)
    expect(first.nextState.startThresholdPct).toBeUndefined()
    expect(first.nextState.requestedAtMs).toBe(NOW)
  })
})

describe('compacted after the stop request', () => {
  const later = NOW + 5 * MIN

  it('the measured case: boundary 90 s after the request, context now 27% -> release, no restart', () => {
    const d = decideGuard(asked(), inputs({ nowMs: later, pct: 0.27, compactedAtMs: NOW + 90_000 }), cfg)
    expect(d.action).toBe('release')
    expect(d.reason.startsWith(RELEASE_COMPACTED_REASON_PREFIX)).toBe(true)
    expect(d.reason).toContain('context now 27%')
    expect(d.reason).toContain('below the 82%')
    expect(d.nextState.phase).toBe('cooldown')
    expect(d.nextState.cooldownUntilMs).toBe(later + cfg.cooldownMinutes * MIN)
  })

  it('an agent that already wrote the handoff is released too, not restarted', () => {
    const d = decideGuard(
      asked(),
      inputs({ nowMs: later, pct: 0.27, compactedAtMs: NOW + 90_000, handoffMtime: NOW + 2 * MIN, paneIdle: true, paneBusy: false, idleMs: 3 * MIN }),
      cfg,
    )
    expect(d.action).toBe('release')
  })

  it('control: the same sweep WITHOUT a compaction on record waits for the handoff', () => {
    for (const compactedAtMs of [null, undefined]) {
      const d = decideGuard(asked(), inputs({ nowMs: later, pct: 0.27, compactedAtMs }), cfg)
      expect(d.action).toBe('none')
      expect(d.nextState.phase).toBe('await-handoff')
    }
  })

  it('a compaction from BEFORE the request does not release: that one is why the context is what it is', () => {
    const d = decideGuard(asked(), inputs({ nowMs: later, pct: 0.27, compactedAtMs: NOW - 30 * MIN }), cfg)
    expect(d.action).toBe('none')
    expect(d.nextState.phase).toBe('await-handoff')
  })

  it('the slack: a boundary stamped just before the request still counts, one stamped past the slack does not', () => {
    const inside = decideGuard(asked(), inputs({ nowMs: later, pct: 0.27, compactedAtMs: NOW - COMPACTION_BEFORE_REQUEST_SLACK_MS }), cfg)
    expect(inside.action).toBe('release')
    const outside = decideGuard(asked(), inputs({ nowMs: later, pct: 0.27, compactedAtMs: NOW - COMPACTION_BEFORE_REQUEST_SLACK_MS - 1 }), cfg)
    expect(outside.action).toBe('none')
  })

  it('compacted, but the context is STILL at the threshold: the request stands', () => {
    const d = decideGuard(asked(), inputs({ nowMs: later, pct: 0.82, compactedAtMs: NOW + 90_000 }), cfg)
    expect(d.action).toBe('none')
    expect(d.nextState.phase).toBe('await-handoff')
  })

  it('compacted, context unreadable: the request stands', () => {
    const d = decideGuard(asked(), inputs({ nowMs: later, pct: null, compactedAtMs: NOW + 90_000 }), cfg)
    expect(d.action).toBe('none')
    expect(d.nextState.phase).toBe('await-handoff')
  })

  it('the gate tier compares against the gate\'s threshold: 78% after a compaction is still above 75%', () => {
    const gateCfg = { ...cfg, actPct: 0.9 }
    const first = decideGuard(
      INITIAL_GUARD_STATE,
      inputs({ pct: 0.8, paneIdle: true, paneBusy: false, subagentGateRefusal: { atMs: NOW - 20 * MIN, gatePct: 0.75 } }),
      gateCfg,
    )
    const still = decideGuard(first.nextState, inputs({ nowMs: later, pct: 0.78, compactedAtMs: NOW + 90_000 }), gateCfg)
    expect(still.action).toBe('none')
    const below = decideGuard(first.nextState, inputs({ nowMs: later, pct: 0.3, compactedAtMs: NOW + 90_000 }), gateCfg)
    expect(below.action).toBe('release')
    expect(below.reason).toContain('below the 75%')
  })

  it('an idle-flush sequence is NOT released by a compaction', () => {
    const flushCfg = { ...cfg, idleFlushEnabled: true, idleMinutes: 30, idleFlushTokens: 50_000 }
    const first = decideGuard(
      INITIAL_GUARD_STATE,
      inputs({ pct: 0.3, contextTokens: 60_000, paneIdle: true, paneBusy: false, idleMs: 60 * MIN }),
      flushCfg,
    )
    expect(first.nextState.noPressure).toBe(true)
    const d = decideGuard(first.nextState, inputs({ nowMs: later, pct: 0.08, contextTokens: 16_000, compactedAtMs: NOW + 90_000 }), flushCfg)
    expect(d.action).toBe('none')
    expect(d.nextState.phase).toBe('await-handoff')
  })

  it('a saturated pane wins over the release: that agent cannot read a withdrawal', () => {
    const d = decideGuard(asked(), inputs({ nowMs: later, pct: 0.27, compactedAtMs: NOW + 90_000, paneSaturated: true }), cfg)
    expect(d.action).toBe('restart')
  })
})

describe('the guard is switched off while an agent waits behind a request', () => {
  it('every tier off: release, and the sequence is over', () => {
    const d = decideGuard(asked(), inputs({ nowMs: NOW + MIN }), allOff)
    expect(d.action).toBe('release')
    expect(d.reason).toContain('switched off')
    expect(d.nextState).toEqual(INITIAL_GUARD_STATE)
  })

  it('only the pressure tier off (saturation rescue still on): release, into cooldown', () => {
    const d = decideGuard(asked(), inputs({ nowMs: NOW + MIN }), { ...cfg, enabled: false, saturationRestart: true })
    expect(d.action).toBe('release')
    expect(d.reason).toContain('disabled')
    expect(d.nextState.phase).toBe('cooldown')
  })

  it('control: every tier off in any OTHER phase stays silent', () => {
    for (const phase of ['idle', 'await-ready', 'cooldown'] as const) {
      const d = decideGuard({ ...INITIAL_GUARD_STATE, phase }, inputs(), allOff)
      expect(d.action).toBe('none')
      expect(d.nextState).toEqual(INITIAL_GUARD_STATE)
    }
  })
})

describe('a release has somebody to reach, and is tried a bounded number of times', () => {
  it('agent not running: nobody to release, the sequence ends silently', () => {
    const d = decideGuard(asked(), inputs({ nowMs: NOW + MIN, running: false }), allOff)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('nobody to release')
    expect(d.nextState).toEqual(INITIAL_GUARD_STATE)
  })

  it(`tries below ${MAX_RELEASE_ATTEMPTS}: release again; at ${MAX_RELEASE_ATTEMPTS}: the sequence ends and the reason says the release never landed`, () => {
    const base = asked()
    for (let tried = 0; tried < MAX_RELEASE_ATTEMPTS; tried++) {
      const d = decideGuard({ ...base, releaseAttempts: tried }, inputs({ nowMs: NOW + 5 * MIN, pct: 0.27, compactedAtMs: NOW + 90_000 }), cfg)
      expect(d.action).toBe('release')
    }
    const last = decideGuard(
      { ...base, releaseAttempts: MAX_RELEASE_ATTEMPTS },
      inputs({ nowMs: NOW + 5 * MIN, pct: 0.27, compactedAtMs: NOW + 90_000 }),
      cfg,
    )
    expect(last.action).toBe('none')
    expect(last.reason.startsWith(RELEASE_UNDELIVERED_REASON_PREFIX)).toBe(true)
    expect(last.nextState.phase).toBe('cooldown')
  })

  it('the state after a release carries no attempt count into the next sequence', () => {
    const d = decideGuard({ ...asked(), releaseAttempts: 2 }, inputs({ nowMs: NOW + 5 * MIN, pct: 0.27, compactedAtMs: NOW + 90_000 }), cfg)
    expect(d.action).toBe('release')
    expect(d.nextState.releaseAttempts).toBeUndefined()
    expect(d.nextState.requestedAtMs).toBeUndefined()
    expect(d.nextState.startThresholdPct).toBeUndefined()
  })
})
