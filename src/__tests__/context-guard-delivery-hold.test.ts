// The context-guard's delivery hold (contextGuardDeliveryHold, registered into
// delivery-hold.ts when the runner starts): held from the handoff request until the
// fresh session has its resume prompt, released after, and never past the phase
// deadline. Driven through the REAL runner (same harness as context-guard-ready-poll.test.ts):
// the guard state is placed in a phase, the ready poll delivers the resume.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { INITIAL_GUARD_STATE, READY_POLL_MS } from '../context-guard.js'

const mkTmp = tmpDirs()
const SANDBOX = mkTmp('cgholdtest-')
const MIN = 60_000

const warn = vi.hoisted(() => vi.fn())
const agentProcess = vi.hoisted(() => ({
  agentRunState: vi.fn((_n: string) => 'running'),
  capturePane: vi.fn((_s: string): string | null => null),
  isSessionReadyForPrompt: vi.fn(async (_s: string) => false),
}))
const directive = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  sendSystemDirective: vi.fn(async (..._args: unknown[]) => { if (directive.gate) await directive.gate; return undefined }),
}))

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn, debug: vi.fn(), error: vi.fn() },
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

const { startContextGuardRunner, _setGuardStateForTest, getHardGuardPhase, contextGuardDeliveryHold } =
  await import('../web/context-guard-runner.js')
const { setDeliveryHoldProbe, deliveryHoldFor } = await import('../web/delivery-hold.js')

const T0 = 1_800_000_000_000
const lapsedWarns = () => warn.mock.calls.filter((c) => String(c[1]).includes('delivery hold lapsed'))

describe('context-guard delivery hold, through the real runner', () => {
  let timers: NodeJS.Timeout[] = []
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    warn.mockClear()
    directive.gate = null
    directive.sendSystemDirective.mockClear()
  })
  afterEach(() => {
    for (const t of timers) clearInterval(t)
    timers = []
    vi.clearAllTimers()
    vi.useRealTimers()
    for (const n of ['boni', 'ana']) _setGuardStateForTest(n, null)
    setDeliveryHoldProbe(null)
    agentProcess.isSessionReadyForPrompt.mockResolvedValue(false)
  })

  it('the runner registers the probe at start; nothing is held while the agent is idle or unknown', () => {
    expect(deliveryHoldFor('boni', Date.now())).toBeNull()
    timers.push(startContextGuardRunner())
    _setGuardStateForTest('boni', INITIAL_GUARD_STATE)
    expect(deliveryHoldFor('boni', Date.now())).toBeNull()
    expect(deliveryHoldFor('nobody', Date.now())).toBeNull()
  })

  it('held through await-handoff and await-ready; released once the resume is in, with no lapse warning', async () => {
    timers.push(startContextGuardRunner())
    _setGuardStateForTest('boni', { ...INITIAL_GUARD_STATE, phase: 'await-handoff', deadlineMs: T0 + 20 * MIN })
    expect(deliveryHoldFor('boni', Date.now())).toMatchObject({ phase: 'await-handoff', untilMs: T0 + 25 * MIN })

    _setGuardStateForTest('boni', { ...INITIAL_GUARD_STATE, phase: 'await-ready', deadlineMs: T0 + 20 * MIN })
    expect(deliveryHoldFor('boni', Date.now())).toMatchObject({ phase: 'await-ready', untilMs: T0 + 25 * MIN })

    agentProcess.isSessionReadyForPrompt.mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(READY_POLL_MS)
    expect(directive.sendSystemDirective).toHaveBeenCalledTimes(1)
    expect(getHardGuardPhase('boni')).toBe('cooldown')
    expect(deliveryHoldFor('boni', Date.now())).toBeNull()
    expect(lapsedWarns()).toHaveLength(0)
  })

  it("another agent is never held by this one's restart", () => {
    timers.push(startContextGuardRunner())
    _setGuardStateForTest('boni', { ...INITIAL_GUARD_STATE, phase: 'await-ready', deadlineMs: T0 + 20 * MIN })
    expect(deliveryHoldFor('ana', Date.now())).toBeNull()
  })

  it('fail-open: the hold lapses at the phase deadline plus one sweep, with one warning', () => {
    _setGuardStateForTest('boni', { ...INITIAL_GUARD_STATE, phase: 'await-ready', deadlineMs: T0 + 20 * MIN })
    const at = T0 + 25 * MIN
    expect(contextGuardDeliveryHold('boni', at - 1)).not.toBeNull()
    expect(contextGuardDeliveryHold('boni', at)).toBeNull()
    expect(contextGuardDeliveryHold('boni', at + 60_000)).toBeNull()
    expect(lapsedWarns()).toHaveLength(1)
  })

  it('a phase that outlasts its deadline does not renew the hold from now', () => {
    _setGuardStateForTest('boni', { ...INITIAL_GUARD_STATE, phase: 'await-handoff', deadlineMs: T0 - 10 * MIN })
    expect(contextGuardDeliveryHold('boni', T0)).toBeNull()
    expect(contextGuardDeliveryHold('boni', T0 + 30 * MIN)).toBeNull()
  })

  it('held while the resume prompt is being typed, although the phase already says cooldown; bounded from the send start', async () => {
    timers.push(startContextGuardRunner())
    _setGuardStateForTest('boni', { ...INITIAL_GUARD_STATE, phase: 'await-ready', deadlineMs: T0 + 20 * MIN })
    let release!: () => void
    directive.gate = new Promise<void>((resolve) => { release = resolve })
    agentProcess.isSessionReadyForPrompt.mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(READY_POLL_MS)
    expect(directive.sendSystemDirective).toHaveBeenCalledTimes(1)
    expect(getHardGuardPhase('boni')).toBe('cooldown')
    const sending = deliveryHoldFor('boni', Date.now())
    expect(sending).toMatchObject({ phase: 'resume-sending' })
    // a send that never returns cannot keep the inbox shut: one sweep from the start of the send
    expect(sending!.untilMs - Date.now()).toBeLessThanOrEqual(5 * MIN)
    expect(contextGuardDeliveryHold('boni', sending!.untilMs - 1)).not.toBeNull()
    expect(contextGuardDeliveryHold('boni', sending!.untilMs)).toBeNull()
    expect(lapsedWarns()).toHaveLength(1)

    directive.gate = null
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(deliveryHoldFor('boni', Date.now())).toBeNull()
  })
})
