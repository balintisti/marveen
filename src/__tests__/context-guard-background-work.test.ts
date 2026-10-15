// Card c8852bba (Isti TG 6875, 2026-10-15): "ha van futó folyamat, akkor ne legyen újraindítás, mert
// akkor dupla munka van". The context guard restarted sessions whose turn had ended but whose
// background work (test gates, watcher shells, sub-agents) was still running, and every restart
// killed that work: 4/4 on 2026-10-07, 6 in ~70 minutes on 10-08. A ROUTINE restart now waits for
// the work (bounded by BACKGROUND_DEFER_MAX_MS); a HARD one still fires and names what it kills.
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'
import {
  BACKGROUND_DEFER_MAX_MS,
  DEFAULT_CONTEXT_GUARD,
  INITIAL_GUARD_STATE,
  SATURATION_CONFIRM_SWEEPS,
  decideGuard,
  type ContextGuardConfig,
  type GuardInputs,
  type GuardState,
} from '../context-guard.js'
import { detectPaneState } from '../pane-state.js'
import { liveHeavyRunJobs } from '../heavy-run-jobs.js'

const mkTmp = tmpDirs()
const SANDBOX = mkTmp('guardbg-')

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../db.js', () => ({ createAgentMessage: vi.fn() }))
vi.mock('../web/channel-monitor.js', () => ({
  hardRestartMarveenChannels: vi.fn(() => ({ ok: true })),
  lastMainRespawnAt: () => null,
  MARVEEN_POST_RESPAWN_GRACE_MS: 0,
}))
vi.mock('../web/stuck-tool-call-watcher.js', () => ({ shouldDeferForRecentRespawn: () => false }))
vi.mock('../web/agent-process.js', () => ({
  clearFeedbackModalAndRecheck: () => false,
  agentRunState: () => 'stopped',
  agentSessionName: (n: string) => `agent-${n}`,
  restartAgentProcess: vi.fn(),
  capturePane: () => null,
  sendPromptToSession: vi.fn(),
  isSessionReadyForPrompt: async () => false,
}))
vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'marveen-channels' }))

const { measureBackgroundWork } = await import('../web/context-guard-runner.js')

const HERE = dirname(fileURLToPath(import.meta.url))
// A live pane, 80 columns, captured 2026-10-15 22:51 (computress; the first line's card id replaced):
// the turn is over ("done 22:51 · 2 shells still running"), the prompt is free, two shells run.
const TURN_ENDED_2_SHELLS = readFileSync(join(HERE, 'fixtures', 'pane', 'turn-ended-2-shells-still-running.txt'), 'utf8')

const CFG: ContextGuardConfig = { ...DEFAULT_CONTEXT_GUARD, enabled: true }
const NOW = 1_000_000_000
const MIN = 60_000

function inputs(overrides: Partial<GuardInputs> = {}): GuardInputs {
  return {
    nowMs: NOW,
    pct: 0.8,
    running: true,
    paneIdle: true,
    paneBusy: false,
    sessionReady: false,
    handoffMtime: null,
    paneSaturated: false,
    dailyHandoffDue: false,
    contextTokens: null,
    idleMs: null,
    ...overrides,
  }
}

const awaiting: GuardState = {
  phase: 'await-handoff',
  handoffMtimeAtRequest: 100,
  deadlineMs: NOW + 10 * MIN,
  cooldownUntilMs: 0,
  saturatedStreak: 0,
  staleRefreshCount: 0,
  handoffStaleMinutes: null,
}
const BG = { backgroundWork: 2, backgroundWorkDetail: '2 in the pane (shells / monitors / sub-agents)' }


describe('a ROUTINE restart waits for background work', () => {
  it('handoff written, pane idle, two shells running: holds, and records when the hold began', () => {
    const d = decideGuard(awaiting, inputs({ handoffMtime: 200, ...BG }), CFG)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('background work is running: 2 (2 in the pane')
    expect(d.nextState.phase).toBe('await-handoff')
    expect(d.nextState.backgroundDeferSinceMs).toBe(NOW)
  })

  it('keeps holding inside the bound, without moving the start of the hold', () => {
    const since = NOW - 30 * MIN
    const d = decideGuard({ ...awaiting, backgroundDeferSinceMs: since }, inputs({ handoffMtime: 200, ...BG }), CFG)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('(30m of 45m)')
    expect(d.nextState.backgroundDeferSinceMs).toBe(since)
  })

  it('restarts once the work is done, and says how long it waited', () => {
    const d = decideGuard({ ...awaiting, backgroundDeferSinceMs: NOW - 20 * MIN }, inputs({ handoffMtime: 200 }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toBe('handoff written -- held 20m until the background work finished')
    expect(d.nextState.backgroundDeferSinceMs ?? null).toBeNull()
  })

  it('at the bound it restarts as before, and names the work it kills', () => {
    const d = decideGuard(
      { ...awaiting, backgroundDeferSinceMs: NOW - BACKGROUND_DEFER_MAX_MS },
      inputs({ handoffMtime: 200, ...BG }),
      CFG,
    )
    expect(d.action).toBe('restart')
    expect(d.reason).toContain('held 45m for background work, the 45m bound is reached')
    expect(d.reason).toContain('KILLS running background work: 2 (2 in the pane')
  })

  it('the handoff timeout waits too, and is bounded the same way', () => {
    const late = { ...awaiting, deadlineMs: NOW - 1 }
    const held = decideGuard(late, inputs({ ...BG }), CFG)
    expect(held.action).toBe('none')
    expect(held.reason).toContain('handoff timeout, but background work is running')
    const bound = decideGuard({ ...late, backgroundDeferSinceMs: NOW - BACKGROUND_DEFER_MAX_MS }, inputs({ ...BG }), CFG)
    expect(bound.action).toBe('restart')
    expect(bound.reason).toMatch(/^handoff timeout -- force restart -- held 45m .*KILLS running background work/)
  })

  it('with nothing running the restart is exactly what it was', () => {
    expect(decideGuard(awaiting, inputs({ handoffMtime: 200 }), CFG).reason).toBe('handoff written')
    expect(decideGuard(awaiting, inputs({ handoffMtime: 200, backgroundWork: 0 }), CFG).action).toBe('restart')
    expect(decideGuard({ ...awaiting, deadlineMs: NOW - 1 }, inputs(), CFG).reason).toBe('handoff timeout -- force restart')
  })
})

describe('a HARD restart does not wait, and names what it kills', () => {
  it('hard threshold in the idle phase', () => {
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ pct: 0.99, ...BG }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toMatch(/^hard threshold \(99% >= 97%\) -- KILLS running background work: 2 \(/)
  })

  it('hard threshold during await-handoff, handoff not written', () => {
    const d = decideGuard(awaiting, inputs({ pct: 0.99, ...BG }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toContain('hard threshold during await-handoff -- KILLS running background work')
  })

  it('hard threshold during await-handoff, handoff written: no hold either', () => {
    const d = decideGuard(awaiting, inputs({ pct: 0.99, handoffMtime: 200, ...BG }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toBe('handoff written -- KILLS running background work: 2 (2 in the pane (shells / monitors / sub-agents))')
  })

  it('the saturation net, in both phases', () => {
    const sat = decideGuard(
      { ...INITIAL_GUARD_STATE, saturatedStreak: SATURATION_CONFIRM_SWEEPS - 1 },
      inputs({ paneSaturated: true, ...BG }),
      CFG,
    )
    expect(sat.action).toBe('restart')
    expect(sat.reason).toContain('KILLS running background work')
    const satAwait = decideGuard(awaiting, inputs({ paneSaturated: true, ...BG }), CFG)
    expect(satAwait.action).toBe('restart')
    expect(satAwait.reason).toBe('pane saturated during await-handoff -- KILLS running background work: 2 (2 in the pane (shells / monitors / sub-agents))')
  })
})

describe('the inputs come from the live pane and from heavy-run', () => {
  it('the real turn-ended pane reads idle AND counts its two shells; fed to the guard, it holds', () => {
    expect(detectPaneState(TURN_ENDED_2_SHELLS)).toBe('idle')
    const empty = mkTmp('heavy-empty-')
    const bg = measureBackgroundWork('computress', TURN_ENDED_2_SHELLS, empty)
    expect(bg).toEqual({ backgroundWork: 2, backgroundWorkDetail: '2 in the pane (shells / monitors / sub-agents)' })
    const d = decideGuard(awaiting, inputs({ handoffMtime: 200, paneIdle: true, ...bg }), CFG)
    expect(d.action).toBe('none')
  })

  it('the same pane with the shells line and footer count gone reads as nothing running', () => {
    const quiet = TURN_ENDED_2_SHELLS.replace(' · 2 shells still running', '').replace('on · 2 shells · ↓ to manage', 'on (shift+tab to cycle)')
    expect(measureBackgroundWork('computress', quiet, mkTmp('heavy-empty2-'))).toEqual({ backgroundWork: 0, backgroundWorkDetail: '' })
  })

  it('live heavy-run jobs of THIS agent count, held and queued; dead ones and other agents do not', () => {
    const dir = mkTmp('heavy-')
    mkdirSync(join(dir, 'tickets'), { recursive: true })
    const live = process.pid
    const dead = 2 ** 22 + 12345 // above macOS / Linux default pid_max
    writeFileSync(join(dir, 'slot-0'), JSON.stringify({ agent: 'dexter', pid: live, label: 'dexter-gate' }))
    writeFileSync(join(dir, 'slot-1'), JSON.stringify({ agent: 'dexter', pid: dead, label: 'finished-gate' }))
    writeFileSync(join(dir, 'light-0'), JSON.stringify({ agent: 'friday', pid: live, label: 'friday-gate' }))
    writeFileSync(join(dir, 'tickets', '0000000042'), JSON.stringify({ agent: 'dexter', pid: live, label: 'dexter-e2e', seq: 42 }))
    writeFileSync(join(dir, 'slot-2'), 'not json')
    expect(liveHeavyRunJobs('dexter', dir)).toEqual([
      { label: 'dexter-gate', waiting: false },
      { label: 'dexter-e2e', waiting: true },
    ])
    expect(measureBackgroundWork('dexter', null, dir)).toEqual({
      backgroundWork: 2,
      backgroundWorkDetail: 'heavy-run: dexter-gate, dexter-e2e (queued)',
    })
  })

  it('a missing heavy-run directory is no work, not an error', () => {
    expect(liveHeavyRunJobs('dexter', join(SANDBOX, 'no-such-dir'))).toEqual([])
  })

  it('checkAgent feeds the measurement into the guard inputs', () => {
    // checkAgent is private inside a module full of IO; pin the wiring at the source, brace-matched
    // to its own body (the same approach as context-guard-hidden-worker's performRestart check).
    const src = readFileSync(join(HERE, '..', 'web', 'context-guard-runner.ts'), 'utf8')
    const m = /async function checkAgent\s*\([^)]*\)[^{]*\{/.exec(src)
    expect(m, 'checkAgent not found').not.toBeNull()
    let depth = 0
    let end = src.length
    for (let i = src.indexOf('{', m!.index); i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) { end = i; break }
    }
    const body = src.slice(m!.index, end + 1)
    expect(body).toMatch(/const background = running && needPct \? measureBackgroundWork\(name, pane\)/)
    const inputsObj = body.slice(body.indexOf('const inputs: GuardInputs = {'), body.indexOf('const decision = decideGuard('))
    expect(inputsObj).toContain('...background,')
  })
})
