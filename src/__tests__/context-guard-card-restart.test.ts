// Card 00262e3f: the card-aligned restart tier, as a decision.
//
// The tier restarts an agent WITHOUT a handoff, on the claim that the card it has just handed over
// is the handoff. Every line of decideCardRestart that says "no" is therefore a protection, and
// each has its own case here: removing the line turns exactly that case red (the mutant list is in
// the card's hand-off comment). The runner's side is in card-boundary-runner.test.ts.

import { describe, it, expect } from 'vitest'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import {
  decideGuard, normalizeContextGuardConfig, DEFAULT_CONTEXT_GUARD, INITIAL_GUARD_STATE,
  CARD_RESTART_REASON_PREFIX, CARD_RESTART_SKIPPED_REQUEST_MARK, IDLE_FLUSH_REASON_PREFIX, SUBAGENT_GATE_REASON_PREFIX,
  type CardBoundary, type CardRestartFacts, type ContextGuardConfig, type GuardInputs, type GuardState,
} from '../context-guard.js'
import { validGuardState, readGuardStateFile, writeGuardStateFile } from '../web/context-guard-state-file.js'

const mkTmp = tmpDirs()
const NOW = 1_800_000_000_000
const MIN = 60_000
const BOUNDARY: CardBoundary = { cardId: 'c0ffee11', toStatus: 'testing', movedAtMs: NOW - 2 * MIN }
const CLEAR: CardRestartFacts = { boundary: BOUNDARY, blockers: [] }

// Card tier only: nothing else can speak, so a `none` is this tier's or nobody's.
const CARD_ONLY: ContextGuardConfig = {
  ...DEFAULT_CONTEXT_GUARD,
  enabled: false,
  saturationRestart: false,
  idleFlushEnabled: false,
  dailyHandoffEnabled: false,
  cardRestartEnabled: true,
  cardRestartTokens: 80_000,
}

function inputs(overrides: Partial<GuardInputs> = {}): GuardInputs {
  return {
    nowMs: NOW,
    pct: null,
    running: true,
    paneIdle: true,
    paneBusy: false,
    sessionReady: false,
    handoffMtime: null,
    paneSaturated: false,
    dailyHandoffDue: false,
    contextTokens: 120_000,
    idleMs: 30_000,
    cardRestart: CLEAR,
    ...overrides,
  }
}

const decide = (i: Partial<GuardInputs> = {}, cfg: ContextGuardConfig = CARD_ONLY, state: GuardState = INITIAL_GUARD_STATE) =>
  decideGuard(state, inputs(i), cfg)
const isCardReason = (reason: string) => reason.startsWith(CARD_RESTART_REASON_PREFIX)

describe('card-aligned restart: the case it exists for', () => {
  it('idle at a card boundary with a heavy context: restart, no handoff request, and the boundary travels in the state', () => {
    const d = decide()
    expect(d.action).toBe('restart')
    expect(isCardReason(d.reason)).toBe(true)
    expect(d.reason).toContain('c0ffee11')
    expect(d.reason).toContain('in_progress -> testing')
    expect(d.reason).toContain('120k >= 80k')
    expect(d.reason).toContain('no handoff requested')
    expect(d.nextState.phase).toBe('await-ready')
    // The fresh session's first message is chosen by this field: without it the session is sent
    // to a HANDOFF.md nobody wrote.
    expect(d.nextState.cardRestart).toEqual(BOUNDARY)
  })

  it('the threshold is inclusive: exactly at it restarts, one token below does not', () => {
    expect(decide({ contextTokens: 80_000 }).action).toBe('restart')
    const below = decide({ contextTokens: 79_999 })
    expect(below.action).toBe('none')
    // Below the threshold is not a refusal: the tier has nothing to say, so nothing is logged for it.
    expect(isCardReason(below.reason)).toBe(false)
  })

  it('switched off: the same facts do nothing', () => {
    const d = decide({}, { ...CARD_ONLY, cardRestartEnabled: false })
    expect(d.action).toBe('none')
    expect(isCardReason(d.reason)).toBe(false)
    expect(d.nextState.cardRestart).toBeUndefined()
  })
})

describe('card-aligned restart: every "no" has its own words', () => {
  const refused = (i: Partial<GuardInputs>, words: string) => {
    const d = decide(i)
    expect(d.action, words).toBe('none')
    expect(isCardReason(d.reason), d.reason).toBe(true)
    expect(d.reason).toContain(words)
    expect(d.nextState.phase).toBe('idle')
    expect(d.nextState.cardRestart).toBeUndefined()
  }

  it('armed but the board facts were not gathered', () => refused({ cardRestart: undefined }, 'board facts were not gathered'))
  it('the context size cannot be measured', () => refused({ contextTokens: null }, 'context size unmeasurable'))
  it('the last card move could not be read', () => refused({ cardRestart: { boundary: 'unknown', blockers: [] } }, 'could not be read'))
  it('the pane is not confirmed idle', () => refused({ paneIdle: false, paneBusy: true }, 'the pane is not confirmed idle'))
  it('background work is running', () => refused({ backgroundWork: 1, backgroundWorkDetail: '1 shell' }, 'background work is running'))
  it('the plan usage limit is reached', () => refused({ paneUsageLimited: true }, 'the plan usage limit is reached'))
  it('a blocker from the board or the queues, in its own words', () => {
    refused({ cardRestart: { boundary: BOUNDARY, blockers: ['another own card is in_progress: aa11', '2 approval(s) pending'] } },
      'another own card is in_progress: aa11; 2 approval(s) pending')
  })

  it('a refusal at a boundary names the card and the move, so the log line stands on its own', () => {
    const d = decide({ paneIdle: false })
    expect(d.reason).toContain('refused at a card boundary (card c0ffee11 moved in_progress -> testing at ')
  })

  it('not at a boundary: silent, not a refusal', () => {
    const d = decide({ cardRestart: { boundary: null, blockers: [] } })
    expect(d.action).toBe('none')
    expect(isCardReason(d.reason)).toBe(false)
  })

  it('only from the idle phase: a sequence under way is not interrupted by the card tier', () => {
    const cooling: GuardState = { ...INITIAL_GUARD_STATE, phase: 'cooldown', cooldownUntilMs: NOW + 10 * MIN }
    const d = decide({}, CARD_ONLY, cooling)
    expect(d.action).toBe('none')
    expect(isCardReason(d.reason)).toBe(false)
  })
})

describe('card-aligned restart among the other tiers', () => {
  const WITH_ACT: ContextGuardConfig = { ...CARD_ONLY, enabled: true, actPct: 0.9, hardPct: 0.97, limitTokens: 200_000 }
  const NO_CARD: ContextGuardConfig = { ...WITH_ACT, cardRestartEnabled: false }

  it('beats the act tier\'s handoff REQUEST, and the reason names what was skipped', () => {
    const i = { pct: 0.92, contextTokens: 184_000 }
    const without = decide(i, NO_CARD)
    expect(without.action).toBe('request-handoff')
    const d = decide(i, WITH_ACT)
    expect(d.action).toBe('restart')
    expect(isCardReason(d.reason)).toBe(true)
    expect(d.reason).toContain(CARD_RESTART_SKIPPED_REQUEST_MARK)
    // ...and which request: the act tier's own reason is carried inside.
    expect(d.reason).toContain(without.reason)
    expect(d.nextState.cardRestart).toEqual(BOUNDARY)
  })

  it('a card restart that skipped nothing does not carry the mark', () => {
    expect(decide({ pct: 0.5 }, WITH_ACT).reason).not.toContain(CARD_RESTART_SKIPPED_REQUEST_MARK)
  })

  it('a REFUSED card restart leaves the act tier its request', () => {
    const blocked: CardRestartFacts = { boundary: BOUNDARY, blockers: ['1 inbound message(s) not delivered yet'] }
    const d = decide({ pct: 0.92, contextTokens: 184_000, cardRestart: blocked }, WITH_ACT)
    expect(d.action).toBe('request-handoff')
    expect(isCardReason(d.reason)).toBe(false)
    expect(d.nextState.cardRestart).toBeUndefined()
  })

  it('the hard tier is untouched: at 98% the decision is byte-identical with and without the card tier', () => {
    const i = { pct: 0.98, contextTokens: 196_000 }
    const d = decide(i, WITH_ACT)
    expect(d).toEqual(decide(i, NO_CARD))
    expect(d.action).toBe('restart')
    expect(isCardReason(d.reason)).toBe(false)
    // A hard-tier restart is not a card restart: its fresh session gets the ordinary first message.
    expect(d.nextState.cardRestart).toBeUndefined()
  })

  it('the sub-agent gate tier keeps its request: its fresh session was promised the HANDOFF', () => {
    const i = { pct: 0.78, contextTokens: 156_000, subagentGateRefusal: { atMs: NOW - 20 * MIN, gatePct: 0.75 } }
    const d = decide(i, WITH_ACT)
    expect(d.action).toBe('request-handoff')
    expect(d.reason.startsWith(SUBAGENT_GATE_REASON_PREFIX)).toBe(true)
    // Positive control: the same sweep without the refusal IS a card restart.
    expect(decide({ ...i, subagentGateRefusal: null }, WITH_ACT).action).toBe('restart')
  })

  const WITH_FLUSH: ContextGuardConfig = { ...CARD_ONLY, idleFlushEnabled: true, idleFlushTokens: 100_000, idleMinutes: 20 }
  const quiet = { contextTokens: 150_000, idleMs: 30 * MIN }

  it('beats the idle flush\'s handoff request too', () => {
    const without = decide(quiet, { ...WITH_FLUSH, cardRestartEnabled: false })
    expect(without.action).toBe('request-handoff')
    expect(without.reason.startsWith(IDLE_FLUSH_REASON_PREFIX)).toBe(true)
    const d = decide(quiet, WITH_FLUSH)
    expect(d.action).toBe('restart')
    expect(isCardReason(d.reason)).toBe(true)
  })

  it('a refused card restart leaves the idle flush its request', () => {
    const d = decide({ ...quiet, cardRestart: { boundary: BOUNDARY, blockers: ['a channel message is unanswered'] } }, WITH_FLUSH)
    expect(d.action).toBe('request-handoff')
    expect(d.reason.startsWith(IDLE_FLUSH_REASON_PREFIX)).toBe(true)
  })

  it('when neither acts, the card tier\'s refusal is the reason that reaches the log', () => {
    // Heavy for the card tier (>= 80k), not for the flush (< 100k): the flush has nothing to say.
    const d = decide({ contextTokens: 90_000, cardRestart: { boundary: BOUNDARY, blockers: ['2 approval(s) pending'] } }, WITH_FLUSH)
    expect(d.action).toBe('none')
    expect(isCardReason(d.reason)).toBe(true)
  })

  // Heavy for both, quiet for 5 of the flush's 20 minutes: the flush only waits, and says so.
  const waiting = { contextTokens: 150_000, idleMs: 5 * MIN }

  it('a flush that only WAITS does not speak over the card tier\'s refusal', () => {
    const blocked: CardRestartFacts = { boundary: BOUNDARY, blockers: ['2 approval(s) pending'] }
    const d = decide({ ...waiting, cardRestart: blocked }, WITH_FLUSH)
    expect(d.action).toBe('none')
    expect(isCardReason(d.reason)).toBe(true)
    expect(d.reason).toContain('2 approval(s) pending')
  })

  it('CONTROL: with no boundary the waiting flush keeps its own words, as before the card tier', () => {
    const d = decide({ ...waiting, cardRestart: { boundary: null, blockers: [] } }, WITH_FLUSH)
    expect(d.action).toBe('none')
    expect(d.reason).toMatch(/^idle-flush: heavy \(150k\) but quiet for only 5m of 20m/)
    expect(d).toEqual(decide(waiting, { ...WITH_FLUSH, cardRestartEnabled: false }))
  })
})

describe('card-aligned restart: config', () => {
  it('all three switches default off, the threshold to 80k', () => {
    const c = normalizeContextGuardConfig({})
    expect(c.cardRestartEnabled).toBe(false)
    expect(c.cardRestartSignal).toBe(false)
    expect(c.cardRestartTokens).toBe(80_000)
    expect(DEFAULT_CONTEXT_GUARD.cardRestartEnabled).toBe(false)
    expect(DEFAULT_CONTEXT_GUARD.cardRestartSignal).toBe(false)
  })

  it('only a real true arms either half', () => {
    for (const v of ['true', 1, 'on', null, {}]) {
      const c = normalizeContextGuardConfig({ cardRestartEnabled: v, cardRestartSignal: v })
      expect(c.cardRestartEnabled, String(v)).toBe(false)
      expect(c.cardRestartSignal, String(v)).toBe(false)
    }
    const on = normalizeContextGuardConfig({ cardRestartEnabled: true, cardRestartSignal: true })
    expect(on.cardRestartEnabled).toBe(true)
    expect(on.cardRestartSignal).toBe(true)
  })

  it('a threshold below the floor falls back to the default instead of restarting every small session', () => {
    expect(normalizeContextGuardConfig({ cardRestartTokens: 9_999 }).cardRestartTokens).toBe(80_000)
    expect(normalizeContextGuardConfig({ cardRestartTokens: 0 }).cardRestartTokens).toBe(80_000)
    expect(normalizeContextGuardConfig({ cardRestartTokens: '120000' }).cardRestartTokens).toBe(80_000)
    expect(normalizeContextGuardConfig({ cardRestartTokens: 10_000 }).cardRestartTokens).toBe(10_000)
    expect(normalizeContextGuardConfig({ cardRestartTokens: 120_000.7 }).cardRestartTokens).toBe(120_000)
  })
})

describe('card-aligned restart: the boundary survives a dashboard restart between the restart and the first message', () => {
  const awaiting: GuardState = { ...decide().nextState }

  it('round-trips through the state file', () => {
    const dir = mkTmp('cardrestart-state-')
    try {
      const path = join(dir, 'state.json')
      writeGuardStateFile(path, new Map([['computress', awaiting]]), NOW)
      const read = readGuardStateFile(path)
      expect(typeof read).toBe('object')
      const states = (read as { states: Map<string, GuardState> | Record<string, GuardState> }).states
      const got = states instanceof Map ? states.get('computress') : states['computress']
      expect(got?.cardRestart).toEqual(BOUNDARY)
      expect(got?.phase).toBe('await-ready')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a boundary that does not read back refuses the whole state: the session must not be sent to a HANDOFF nobody wrote', () => {
    expect(validGuardState(awaiting)?.cardRestart).toEqual(BOUNDARY)
    for (const bad of [{}, { cardId: '', toStatus: 'testing', movedAtMs: 1 }, { cardId: 'a', toStatus: 'testing' }, 'c0ffee11', null]) {
      expect(validGuardState({ ...awaiting, cardRestart: bad }), JSON.stringify(bad)).toBeNull()
    }
    // A state without the field is an ordinary state.
    const { cardRestart: _dropped, ...plain } = awaiting
    expect(validGuardState(plain)).not.toBeNull()
    expect(validGuardState(plain)?.cardRestart).toBeUndefined()
  })
})
