// Card b83e079c, didi 50873 F1: the sub-agent gate tier through the REAL runner (same harness as
// context-guard-delivery-hold.test.ts). The decision is pinned in context-guard-subagent-gate-tier.test.ts;
// this pins the two runner lines it depends on, which no decision test reaches: checkAgent hands the
// gate's refusal to decideGuard (subagentGateRefusal, an optional input, so dropping the line still
// compiles), and the request goes out with the sub-agent gate's own prompt, not the "critical" one.
// The line also sits in an existing merge-conflict hunk (port/6525aba3-c7-sched, c8-misc): taking the
// other side must turn this red.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const SANDBOX = mkTmp('cggaterunner-')
const MIN = 60_000
const T0 = 1_800_000_000_000
const SESSION_START_SEC = T0 / 1000 - 60 * 60
// 78% of the 200k cap: above the gate (75%), below actPct (90%).
const TOKENS = 156_000

const agentProcess = vi.hoisted(() => ({
  agentRunState: vi.fn((_n: string) => 'running'),
  capturePane: vi.fn((_s: string): string | null => ''),
  isSessionReadyForPrompt: vi.fn(async (_s: string) => false),
}))
const directive = vi.hoisted(() => ({
  sendSystemDirective: vi.fn(async (..._args: unknown[]) => undefined),
}))

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../db.js', () => ({
  createAgentMessage: vi.fn(),
  getRestartLossCandidates: () => [],
  getAgentCommentsSince: () => [],
  getAgentMessagesSince: () => [],
  markMessageDone: vi.fn(),
}))
vi.mock('../notify.js', () => ({ notifyChannel: vi.fn() }))
vi.mock('../web/channel-monitor.js', () => ({
  hardRestartMarveenChannels: vi.fn(() => ({ ok: true })),
  lastMainRespawnAt: () => null,
  MARVEEN_POST_RESPAWN_GRACE_MS: 0,
  markAgentRestartPending: vi.fn(),
}))
vi.mock('../web/stuck-tool-call-watcher.js', () => ({ shouldDeferForRecentRespawn: () => false }))
vi.mock('../web/system-directive.js', () => directive)
vi.mock('../web/agent-config.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listAllAgentNames: () => ['boni'],
  readAgentRemoteHost: () => null,
  readAgentModel: () => 'claude-opus-5-5',
}))
// The transcript reading itself has its own tests: here it is a fixed 156k-token, live reading.
vi.mock('../web/active-model.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  readContextTokensFromProjectDir: () => TOKENS,
  readTranscriptMtimeFromProjectDir: () => Date.now(),
  readLastTurnActivityMs: () => Date.now(),
  readActiveModelFromProjectDir: () => null,
  predatesSession: () => false,
}))
vi.mock('../pane-state.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  runningBackgroundWork: () => 0,
}))
vi.mock('../heavy-run-jobs.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  liveHeavyRunJobs: () => [],
}))
vi.mock('../web/context-guard-store.js', async (orig) => {
  const actual = await orig<typeof import('../web/context-guard-store.js')>()
  const { DEFAULT_CONTEXT_GUARD } = await import('../context-guard.js')
  return {
    ...actual,
    readContextGuardConfig: () => ({ ...DEFAULT_CONTEXT_GUARD, enabled: true, limitTokens: 200_000, actPct: 0.9 }),
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
  paneEchoesInput: async () => 'echoed',
  noteSaturationBannerUntrusted: vi.fn(),
  clearSaturationBannerOverride: vi.fn(),
  getAgentRunningSince: () => SESSION_START_SEC,
}))

const { startContextGuardRunner, _setGuardStateForTest, getHardGuardPhase, SUBAGENT_GATE_REFUSAL_DIR, subagentGateHandoffPrompt } =
  await import('../web/context-guard-runner.js')
const { setDeliveryHoldProbe } = await import('../web/delivery-hold.js')

const refusalFile = join(SUBAGENT_GATE_REFUSAL_DIR, 'boni.json')
const boniDirectives = () => directive.sendSystemDirective.mock.calls.filter((c) => c[0] === 'boni')

describe('the sub-agent gate tier, through the real runner', () => {
  let timer: NodeJS.Timeout | null = null
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    directive.sendSystemDirective.mockClear()
    mkdirSync(SUBAGENT_GATE_REFUSAL_DIR, { recursive: true })
  })
  afterEach(() => {
    if (timer) clearInterval(timer)
    timer = null
    vi.clearAllTimers()
    vi.useRealTimers()
    for (const n of ['boni', 'marveen']) _setGuardStateForTest(n, null)
    setDeliveryHoldProbe(null)
    rmSync(refusalFile, { force: true })
  })

  async function oneSweep(): Promise<void> {
    timer = startContextGuardRunner()
    // the first sweep runs after the initial delay; one interval covers it
    await vi.advanceTimersByTimeAsync(5 * MIN)
  }

  it('a refusal in this session at 78%: the handoff request goes out with the gate\'s own prompt', async () => {
    writeFileSync(refusalFile, JSON.stringify({ atMs: T0 - 10 * MIN, pct: 0.78, gatePct: 0.75 }))
    await oneSweep()
    const calls = boniDirectives()
    expect(calls).toHaveLength(1)
    const prompt = String(calls[0][2])
    const path = /\(([^)]*HANDOFF\.md)\)/.exec(prompt)?.[1] ?? ''
    expect(path).toContain('boni')
    expect(prompt).toBe(subagentGateHandoffPrompt(78, path))
    expect(prompt).not.toContain('kritikus')
    expect(getHardGuardPhase('boni')).toBe('await-handoff')
  })

  it('negative control: the same 78% with no refusal is below threshold, nothing goes out', async () => {
    await oneSweep()
    expect(boniDirectives()).toHaveLength(0)
    expect(getHardGuardPhase('boni')).toBe('idle')
  })
})
