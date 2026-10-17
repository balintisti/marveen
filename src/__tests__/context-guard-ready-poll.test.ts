import { describe, it, expect, vi, afterEach } from 'vitest'

import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { INITIAL_GUARD_STATE, READY_POLL_MS, type GuardState } from '../context-guard.js'

const mkTmp = tmpDirs()

// Card 9c182807: await-ready was checked once per 5-min sweep, so a restarted
// session not ready at that one sweep never got its resume prompt. The runner
// now re-checks await-ready agents (and only those) every READY_POLL_MS.
const SANDBOX = mkTmp('cgreadypoll-')

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

const { awaitReadyAgents, startContextGuardRunner } = await import('../web/context-guard-runner.js')

describe('ready poll (card 9c182807)', () => {
  afterEach(() => { vi.restoreAllMocks() })

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

  it('the runner arms a ready poll at READY_POLL_MS next to the sweep', () => {
    const timers: ReturnType<typeof setInterval>[] = []
    const real = globalThis.setInterval
    const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
      const t = real(fn, ms)
      timers.push(t)
      return t
    }) as typeof setInterval)
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((() => 0) as unknown as typeof setTimeout)
    try {
      startContextGuardRunner()
      const periods = spy.mock.calls.map((c) => c[1])
      expect(periods).toContain(READY_POLL_MS)
      expect(periods).toContain(300_000)
    } finally {
      for (const t of timers) clearInterval(t)
      timeoutSpy.mockRestore()
    }
  })
})
