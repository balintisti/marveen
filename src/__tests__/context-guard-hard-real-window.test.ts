// Card b6225f23 (Isti TG 8526, 2026-10-30): the hard tier (hardPct x limitTokens, 0.97 x 200k) killed
// running background work (sub-agents, shells, gates) although limitTokens is a COST cap and the model's
// real window (Opus 5.5: 1M) was at ~20%. With room in the real window and background work running, the
// hard tier now takes the act tier's path (handoff request, then the BACKGROUND_DEFER_MAX_MS hold); on the
// hold's bound or near the real window it restarts as before.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'
import {
  BACKGROUND_DEFER_MAX_MS,
  DEFAULT_CONTEXT_GUARD,
  STALE_REFRESH_REASON_PREFIX,
  INITIAL_GUARD_STATE,
  REAL_WINDOW_HOLD_CEILING,
  decideGuard,
  type ContextGuardConfig,
  type GuardInputs,
  type GuardState,
} from '../context-guard.js'

const mkTmp = tmpDirs()
const SANDBOX = mkTmp('guard-realwin-')
let agentModel: string | null = 'claude-opus-5-5'

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../web/agent-config.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  readAgentModel: () => agentModel,
}))

const CFG: ContextGuardConfig = { ...DEFAULT_CONTEXT_GUARD, enabled: true, limitTokens: 200_000 }
const NOW = 1_000_000_000
const MIN = 60_000
const BG = { backgroundWork: 2, backgroundWorkDetail: '2 in the pane (shells / monitors / sub-agents)' }

function inputs(overrides: Partial<GuardInputs> = {}): GuardInputs {
  return {
    nowMs: NOW,
    pct: 0.98,
    running: true,
    paneIdle: true,
    paneBusy: false,
    sessionReady: false,
    handoffMtime: 100,
    paneSaturated: false,
    dailyHandoffDue: false,
    contextTokens: null,
    idleMs: null,
    ...overrides,
  }
}

// 98% of the 200k cap = 196k tokens = 19.6% of a 1M window.
const ROOM = { realWindowPct: 0.196 }

describe('the hard tier holds for background work while the real window has room', () => {
  it('(1) idle phase, 98% of the cap, real window 20%, two shells running: no restart, a handoff request', () => {
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ ...ROOM, ...BG }), CFG)
    expect(d.action).toBe('request-handoff')
    expect(d.reason).toBe(
      'hard threshold (98% >= 97%), but the real window is at 20% and background work is running: ' +
        '2 (2 in the pane (shells / monitors / sub-agents)) -- requesting a handoff, the restart waits like the act tier\'s',
    )
    expect(d.nextState.phase).toBe('await-handoff')
  })

  it('(1) await-handoff, handoff written, pane idle: holding, not restarting', () => {
    const asked = decideGuard(INITIAL_GUARD_STATE, inputs({ ...ROOM, ...BG }), CFG).nextState
    const d = decideGuard(asked, inputs({ ...ROOM, ...BG, handoffMtime: 200, nowMs: NOW + 2 * MIN }), CFG)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('handoff written, but background work is running: 2 (')
    expect(d.reason).toContain('holding the restart (0m of 45m)')
    expect(d.nextState.backgroundDeferSinceMs).toBe(NOW + 2 * MIN)
  })

  it('(1) await-handoff, handoff not yet written, before the deadline: waits for it', () => {
    const asked = decideGuard(INITIAL_GUARD_STATE, inputs({ ...ROOM, ...BG }), CFG).nextState
    const d = decideGuard(asked, inputs({ ...ROOM, ...BG, nowMs: NOW + 5 * MIN }), CFG)
    expect(d.action).toBe('none')
    expect(d.reason).toBe('waiting for handoff')
  })

  it('(2) the same hold restarts at its 45-minute bound, and names what it kills', () => {
    const asked = decideGuard(INITIAL_GUARD_STATE, inputs({ ...ROOM, ...BG }), CFG).nextState
    const held = decideGuard(asked, inputs({ ...ROOM, ...BG, handoffMtime: 200, nowMs: NOW + 2 * MIN }), CFG).nextState
    const inside = decideGuard(held, inputs({ ...ROOM, ...BG, handoffMtime: 200, nowMs: NOW + 2 * MIN + BACKGROUND_DEFER_MAX_MS - 1 }), CFG)
    expect(inside.action).toBe('none')
    const bound = decideGuard(inside.nextState, inputs({ ...ROOM, ...BG, handoffMtime: 200, nowMs: NOW + 2 * MIN + BACKGROUND_DEFER_MAX_MS }), CFG)
    expect(bound.action).toBe('restart')
    expect(bound.reason).toBe(
      'handoff written -- held 45m for background work, the 45m bound is reached -- KILLS running background work: ' +
        '2 (2 in the pane (shells / monitors / sub-agents))',
    )
  })

  it('(2) a handoff that never comes: the deadline, then the same bounded hold', () => {
    const asked = decideGuard(INITIAL_GUARD_STATE, inputs({ ...ROOM, ...BG }), CFG).nextState
    const late = decideGuard(asked, inputs({ ...ROOM, ...BG, nowMs: asked.deadlineMs }), CFG)
    expect(late.action).toBe('none')
    expect(late.reason).toContain('handoff timeout, but background work is running')
    const bound = decideGuard(late.nextState, inputs({ ...ROOM, ...BG, nowMs: asked.deadlineMs + BACKGROUND_DEFER_MAX_MS }), CFG)
    expect(bound.action).toBe('restart')
    expect(bound.reason).toContain('handoff timeout -- force restart -- held 45m for background work, the 45m bound is reached -- KILLS')
  })

  it('(2) the hold ends as soon as the real window reaches the ceiling', () => {
    const asked = decideGuard(INITIAL_GUARD_STATE, inputs({ ...ROOM, ...BG }), CFG).nextState
    const held = decideGuard(asked, inputs({ ...ROOM, ...BG, handoffMtime: 200, nowMs: NOW + 2 * MIN }), CFG).nextState
    const near = decideGuard(held, inputs({ realWindowPct: REAL_WINDOW_HOLD_CEILING, ...BG, handoffMtime: 200, nowMs: NOW + 3 * MIN }), CFG)
    expect(near.action).toBe('restart')
    expect(near.reason).toBe('handoff written -- KILLS running background work: 2 (2 in the pane (shells / monitors / sub-agents))')
  })

  it('a held handoff written before more work gets the act tier\'s refresh request, not a stale ship (didi 49405 L2)', () => {
    const asked = decideGuard(INITIAL_GUARD_STATE, inputs({ ...ROOM, ...BG }), CFG).nextState
    const d = decideGuard(asked, inputs({ ...ROOM, ...BG, handoffMtime: NOW + MIN, idleMs: 0, nowMs: NOW + 7 * MIN }), CFG)
    expect(d.action).toBe('request-handoff')
    expect(d.reason).toBe(`${STALE_REFRESH_REASON_PREFIX}: handoff written but ~6m of work happened after it -- requesting refresh`)
  })

  it('only work in the pane holds it: detached work survives the restart (didi 49405 P1)', () => {
    const allDetached = { ...BG, detachedWork: 2, detachedWorkDetail: '2 heavy-run' }
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ ...ROOM, ...allDetached }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toContain('expected to SURVIVE the restart')
    expect(d.reason).not.toContain('KILLS')
    const oneInPane = decideGuard(INITIAL_GUARD_STATE, inputs({ ...ROOM, ...BG, detachedWork: 1 }), CFG)
    expect(oneInPane.action).toBe('request-handoff')
  })
})

describe('(3) negative controls: everywhere else the hard tier is unchanged', () => {
  it('a 200k-window model (the real window IS the cap): restarts and names what it kills', () => {
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ realWindowPct: 0.98, ...BG }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toMatch(/^hard threshold \(98% >= 97%\) -- KILLS running background work: 2 \(/)
  })

  it('no real-window reading (absent or null): restarts as before', () => {
    expect(decideGuard(INITIAL_GUARD_STATE, inputs({ ...BG }), CFG).action).toBe('restart')
    expect(decideGuard(INITIAL_GUARD_STATE, inputs({ realWindowPct: null, ...BG }), CFG).action).toBe('restart')
  })

  it('room in the real window but nothing running: nothing to protect, restarts as before', () => {
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ ...ROOM }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toBe('hard threshold (98% >= 97%)')
  })

  it('await-handoff at the hard threshold without room: no hold, handoff written or not', () => {
    const awaiting: GuardState = { ...INITIAL_GUARD_STATE, phase: 'await-handoff', handoffMtimeAtRequest: 100, deadlineMs: NOW + 10 * MIN }
    const notWritten = decideGuard(awaiting, inputs({ realWindowPct: 0.98, ...BG }), CFG)
    expect(notWritten.action).toBe('restart')
    expect(notWritten.reason).toContain('hard threshold during await-handoff -- KILLS running background work')
    const written = decideGuard(awaiting, inputs({ realWindowPct: 0.98, ...BG, handoffMtime: 200 }), CFG)
    expect(written.action).toBe('restart')
    expect(written.reason).toBe('handoff written -- KILLS running background work: 2 (2 in the pane (shells / monitors / sub-agents))')
  })

  it('the saturation net ignores the room: a saturated pane is already wedged', () => {
    const awaiting: GuardState = { ...INITIAL_GUARD_STATE, phase: 'await-handoff', handoffMtimeAtRequest: 100, deadlineMs: NOW + 10 * MIN }
    const d = decideGuard(awaiting, inputs({ ...ROOM, ...BG, paneSaturated: true }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toContain('pane saturated during await-handoff -- KILLS')
  })
})

describe('the runner re-reads the cap pct against the model window, from the same reading', () => {
  it('a 1M model: 98% of the 200k cap is 19.6% of its window', async () => {
    const { realWindowPctOf } = await import('../web/context-guard-runner.js')
    agentModel = 'claude-opus-5-5'
    expect(realWindowPctOf('dexter', 0.98, 200_000)).toBeCloseTo(0.196, 5)
  })

  it('a 200k model: the same reading stays 98%, so the hold does not apply', async () => {
    const { realWindowPctOf } = await import('../web/context-guard-runner.js')
    agentModel = 'claude-haiku-4-5'
    expect(realWindowPctOf('trillian', 0.98, 200_000)).toBeCloseTo(0.98, 5)
  })

  it('the mapping: capped at or above hardPct re-read, below it and uncapped the measured pct (didi 49405 L1)', async () => {
    const { hardTierRealWindowPct } = await import('../web/context-guard-runner.js')
    const toReal = (p: number, l: number) => (p * l) / 1_000_000
    const capped = { limitTokens: 200_000, hardPct: 0.97 }
    const uncapped = { limitTokens: null, hardPct: 0.97 }
    expect(hardTierRealWindowPct(0.96, capped, toReal)).toBeCloseTo(0.96, 5)
    expect(hardTierRealWindowPct(0.97, capped, toReal)).toBeCloseTo(0.194, 5)
    expect(hardTierRealWindowPct(0.98, capped, toReal)).toBeCloseTo(0.196, 5)
    expect(hardTierRealWindowPct(0.98, uncapped, toReal)).toBeCloseTo(0.98, 5)
    expect(hardTierRealWindowPct(null, capped, toReal)).toBeNull()
  })

  it('checkAgent feeds it to the decision without a second transcript read', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'context-guard-runner.ts'), 'utf8')
    const body = src.slice(src.indexOf('async function checkAgent('), src.indexOf('export function getContextGuardStatus('))
    expect(body).toMatch(/= hardTierRealWindowPct\(measuredPct, cfg, \(p, l\) => realWindowPctOf\(name, p, l\)\)/)
    expect(body).toMatch(/realWindowPct: cfg\.enabled \? realWindowPct : null,/)
    expect(body.match(/measurePct\(/g) ?? []).toHaveLength(1)
  })
})
