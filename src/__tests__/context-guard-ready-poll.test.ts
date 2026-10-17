import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { INITIAL_GUARD_STATE, READY_POLL_MS, type GuardState } from '../context-guard.js'

const mkTmp = tmpDirs()

// Card 9c182807: await-ready was checked once per 5-min sweep, so a restarted
// session not ready at that one sweep never got its resume prompt. The runner
// now re-checks await-ready agents (and only those) every READY_POLL_MS.
const SANDBOX = mkTmp('cgreadypoll-')

const agentProcess = vi.hoisted(() => ({
  agentRunState: vi.fn((_n: string) => 'running'),
  capturePane: vi.fn((_s: string): string | null => null),
  isSessionReadyForPrompt: vi.fn(async (_s: string) => false),
}))
const directive = vi.hoisted(() => ({ sendSystemDirective: vi.fn(async (..._args: unknown[]) => undefined) }))

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../db.js', () => ({ createAgentMessage: vi.fn(), getRestartLossCandidates: () => [] }))
vi.mock('../web/channel-monitor.js', () => ({
  hardRestartMarveenChannels: vi.fn(() => ({ ok: true })),
  lastMainRespawnAt: () => null,
  MARVEEN_POST_RESPAWN_GRACE_MS: 0,
  markAgentRestartPending: vi.fn(),
}))
vi.mock('../web/stuck-tool-call-watcher.js', () => ({ shouldDeferForRecentRespawn: () => false }))
vi.mock('../web/system-directive.js', () => directive)
vi.mock('../web/context-guard-store.js', async (orig) => {
  const actual = await orig<typeof import('../web/context-guard-store.js')>()
  const { DEFAULT_CONTEXT_GUARD } = await import('../context-guard.js')
  return {
    ...actual,
    readContextGuardConfig: () => ({ ...DEFAULT_CONTEXT_GUARD, enabled: true }),
    readAllContextGuardConfigs: () => ({}),
  }
})
vi.mock('../web/agent-process.js', () => ({
  clearFeedbackModalAndRecheck: () => false,
  agentRunState: agentProcess.agentRunState,
  agentSessionName: (n: string) => `agent-${n}`,
  restartAgentProcess: vi.fn(),
  capturePane: agentProcess.capturePane,
  sendPromptToSession: vi.fn(),
  isSessionReadyForPrompt: agentProcess.isSessionReadyForPrompt,
  noteSaturationBannerUntrusted: vi.fn(),
  clearSaturationBannerOverride: vi.fn(),
  getAgentRunningSince: () => null,
}))

const { awaitReadyAgents, makeGuardTicks, startContextGuardRunner, _setGuardStateForTest, getHardGuardPhase } =
  await import('../web/context-guard-runner.js')

/** A check that stays pending until released, to hold a tick open. */
function gate() {
  let release!: () => void
  const done = new Promise<void>((r) => { release = r })
  return { done, release }
}

describe('ready poll (card 9c182807)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('targets only the agents waiting for a restarted session', () => {
    const states = new Map<string, GuardState>([
      ['a', { ...INITIAL_GUARD_STATE, phase: 'await-ready' }],
      ['b', { ...INITIAL_GUARD_STATE, phase: 'await-handoff' }],
      ['c', { ...INITIAL_GUARD_STATE, phase: 'cooldown' }],
      ['d', INITIAL_GUARD_STATE],
      ['e', { ...INITIAL_GUARD_STATE, phase: 'await-ready' }],
    ])
    expect(awaitReadyAgents(states)).toEqual(['a', 'e'])
    expect(awaitReadyAgents(new Map())).toEqual([])
  })

  it('the poll checks the await-ready agents at the current clock, and nothing else', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    const check = vi.fn(async () => undefined)
    const { readyPoll } = makeGuardTicks({ sweepNames: () => ['a', 'b', 'c'], awaitReadyNames: () => ['a'], check })
    vi.setSystemTime(1_800_000_020_000)
    await readyPoll()
    expect(check.mock.calls).toEqual([['a', 1_800_000_020_000]])
  })

  it('the poll does nothing when no agent is in await-ready', async () => {
    const check = vi.fn(async () => undefined)
    const { readyPoll } = makeGuardTicks({ sweepNames: () => ['a'], awaitReadyNames: () => [], check })
    await readyPoll()
    expect(check).not.toHaveBeenCalled()
  })

  it('a sweep that collides with a poll in flight WAITS for it, then checks every agent (didi 38459)', async () => {
    const held = gate()
    const order: string[] = []
    const check = vi.fn(async (name: string) => {
      order.push(name)
      if (name === 'a' && order.length === 1) await held.done
    })
    const { sweep, readyPoll } = makeGuardTicks({ sweepNames: () => ['a', 'b', 'c'], awaitReadyNames: () => ['a'], check })
    const poll = readyPoll()
    const sw = sweep()
    await Promise.resolve()
    expect(order).toEqual(['a']) // the sweep has not interleaved with the poll's check
    held.release()
    await Promise.all([poll, sw])
    expect(order).toEqual(['a', 'a', 'b', 'c'])
  })

  it('a poll never starts while a sweep runs; an overlapping sweep is skipped', async () => {
    const held = gate()
    const check = vi.fn(async (name: string) => { if (name === 'a') await held.done })
    const { sweep, readyPoll } = makeGuardTicks({ sweepNames: () => ['a', 'b'], awaitReadyNames: () => ['b'], check })
    const first = sweep()
    await Promise.resolve()
    await readyPoll()
    await sweep()
    expect(check.mock.calls.map((c) => c[0])).toEqual(['a'])
    held.release()
    await first
    expect(check.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })

  describe('through the real runner', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      _setGuardStateForTest('ready-late', { ...INITIAL_GUARD_STATE, phase: 'await-ready', deadlineMs: Date.now() + 15 * 60_000 })
      _setGuardStateForTest('idle-one', INITIAL_GUARD_STATE)
    })
    afterEach(() => {
      _setGuardStateForTest('ready-late', null)
      _setGuardStateForTest('idle-one', null)
    })

    it('a session that turns ready between sweeps gets its resume prompt within READY_POLL_MS', async () => {
      const timers = [startContextGuardRunner()]
      try {
        await vi.advanceTimersByTimeAsync(READY_POLL_MS)
        expect(agentProcess.isSessionReadyForPrompt).toHaveBeenCalledTimes(1)
        expect(directive.sendSystemDirective).not.toHaveBeenCalled()
        expect(getHardGuardPhase('ready-late')).toBe('await-ready')

        agentProcess.isSessionReadyForPrompt.mockResolvedValue(true)
        await vi.advanceTimersByTimeAsync(READY_POLL_MS)
        expect(directive.sendSystemDirective).toHaveBeenCalledTimes(1)
        expect(directive.sendSystemDirective.mock.calls[0]?.[0]).toBe('ready-late')
        expect(getHardGuardPhase('ready-late')).toBe('cooldown')
        // 40 s in: the first sweep (270 s) has not run -- the poll did this, not the sweep.
        // The idle agent was never probed: the poll checks await-ready agents only.
        expect(agentProcess.agentRunState.mock.calls.map((c) => c[0])).not.toContain('idle-one')
      } finally {
        agentProcess.isSessionReadyForPrompt.mockResolvedValue(false)
        for (const t of timers) clearInterval(t)
        vi.clearAllTimers()
      }
    })
  })
})
