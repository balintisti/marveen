// Boot-wedge rescue (card b1f0011b, marveen msg 10011703): a sub-agent pane the
// context guard restarted moments ago, whose input box cannot be emptied and whose
// new session has written no transcript, is restarted ONCE through the guard's own
// path. Measured case: didi 2026-11-08 22:01 (the TUI read the resume directive,
// then ignored every key; only a restart cured it).
//
// Three layers: the pure decision, the signal hook, and the runner path (driven
// through the REAL runner, same harness as context-guard-delivery-hold.test.ts).

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { INITIAL_GUARD_STATE, READY_POLL_MS } from '../context-guard.js'

const mkTmp = tmpDirs()
const SANDBOX = mkTmp('cgbootwedge-')
// The runner asks heavy-run-jobs whether the agent has a live job before it restarts; without
// this it reads the REAL ~/.heavy-run, and a live 'didi' job there turned a test red (didi 56593).
process.env.HEAVY_RUN_DIR = mkTmp('cgbootwedge-heavy-')

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }))
const agentProcess = vi.hoisted(() => ({
  agentRunState: vi.fn((_n: string) => 'running'),
  capturePane: vi.fn((_s: string): string | null => null),
  isSessionReadyForPrompt: vi.fn(async (_s: string) => false),
  restartAgentProcess: vi.fn(async (_n: string, _o?: unknown) => ({ ok: true }) as { ok: boolean; error?: string }),
  getAgentRunningSince: vi.fn((_n: string): number | null => 1_800_000_000),
}))
const transcript = vi.hoisted(() => ({ mtime: null as number | null, unreadable: false }))
const directive = vi.hoisted(() => ({ sendSystemDirective: vi.fn(async (..._a: unknown[]) => undefined) }))
const monitor = vi.hoisted(() => ({ hardRestartMarveenChannels: vi.fn(() => ({ ok: true })), markAgentRestartPending: vi.fn() }))

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({ logger: log }))
vi.mock('../db.js', () => ({ createAgentMessage: vi.fn(), getRestartLossCandidates: () => [] }))
vi.mock('../web/channel-monitor.js', () => ({
  hardRestartMarveenChannels: monitor.hardRestartMarveenChannels,
  lastMainRespawnAt: () => null,
  MARVEEN_POST_RESPAWN_GRACE_MS: 0,
  markAgentRestartPending: monitor.markAgentRestartPending,
}))
vi.mock('../web/agent-config.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listAllAgentNames: () => ['didi'],
  readAgentRemoteHost: () => null,
  readAgentModel: () => 'claude-opus-5-5',
}))
vi.mock('../web/stuck-tool-call-watcher.js', () => ({ shouldDeferForRecentRespawn: () => false }))
vi.mock('../web/system-directive.js', () => directive)
vi.mock('../web/active-model.js', async (orig) => {
  const actual = await orig<typeof import('../web/active-model.js')>()
  return {
    ...actual,
    readTranscriptMtimeFromProjectDir: (_w: string, _c?: string, since?: number) => actual.predatesSession(transcript.mtime, since) ? null : transcript.mtime,
    transcriptWrittenSince: (_w: string, _c: string | undefined, since: number) =>
      transcript.unreadable ? null : transcript.mtime !== null && !actual.predatesSession(transcript.mtime, since),
  }
})
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
  restartAgentProcess: agentProcess.restartAgentProcess,
  capturePane: agentProcess.capturePane,
  sendPromptToSession: vi.fn(),
  isSessionReadyForPrompt: agentProcess.isSessionReadyForPrompt,
  paneEchoesInput: async () => 'echoed',
  noteSaturationBannerUntrusted: vi.fn(),
  clearSaturationBannerOverride: vi.fn(),
  getAgentRunningSince: agentProcess.getAgentRunningSince,
}))

const { decideBootWedgeRescue, reportInputNotEmptied, setInputNotEmptiedHandler, BOOT_WEDGE_WINDOW_MS } =
  await import('../web/boot-wedge-rescue.js')
const { rescueBootWedge, _setGuardRestartForTest, _setGuardStateForTest, getHardGuardPhase, startContextGuardRunner } =
  await import('../web/context-guard-runner.js')
const { setDeliveryHoldProbe } = await import('../web/delivery-hold.js')
const { FLEET_FREEZE_PATH, writeFleetFreeze, clearFleetFreeze } = await import('../web/fleet-freeze.js')

const T0 = 1_800_000_060_000 // the session (getAgentRunningSince) started 60 s before this
const SESSION_START_MS = 1_800_000_000_000
const rescueWarns = () => log.warn.mock.calls.filter((c) => String(c[1]).includes('boot-wedge rescue --'))

describe('decideBootWedgeRescue', () => {
  const didi = { isMainAgent: false, lastGuardRestart: { atMs: 0, rescue: false }, nowMs: 35_000, sessionHasTranscript: false }

  it('rescues the measured shape: a sub-agent, 35 s after a guard restart, no transcript yet', () => {
    expect(decideBootWedgeRescue(didi)).toEqual({ rescue: true })
  })

  it('never the main agent, even in the exact shape', () => {
    expect(decideBootWedgeRescue({ ...didi, isMainAgent: true })).toEqual({ rescue: false, reason: 'main-agent' })
  })

  it('only after a guard restart on record', () => {
    expect(decideBootWedgeRescue({ ...didi, lastGuardRestart: null })).toEqual({ rescue: false, reason: 'no-guard-restart' })
  })

  it('only inside the window: its edge is in, one ms past it and a negative age are out', () => {
    expect(decideBootWedgeRescue({ ...didi, nowMs: BOOT_WEDGE_WINDOW_MS })).toEqual({ rescue: true })
    expect(decideBootWedgeRescue({ ...didi, nowMs: BOOT_WEDGE_WINDOW_MS + 1 })).toEqual({ rescue: false, reason: 'outside-window' })
    expect(decideBootWedgeRescue({ ...didi, nowMs: -1 })).toEqual({ rescue: false, reason: 'outside-window' })
  })

  it('once: a session the rescue itself started is not rescued again', () => {
    expect(decideBootWedgeRescue({ ...didi, lastGuardRestart: { atMs: 0, rescue: true } })).toEqual({ rescue: false, reason: 'already-rescued' })
  })

  it('never when the session has a transcript, nor when that cannot be told', () => {
    expect(decideBootWedgeRescue({ ...didi, sessionHasTranscript: true })).toEqual({ rescue: false, reason: 'transcript-exists' })
    expect(decideBootWedgeRescue({ ...didi, sessionHasTranscript: null })).toEqual({ rescue: false, reason: 'transcript-unknown' })
  })
})

describe('reportInputNotEmptied (the signal hook)', () => {
  afterEach(() => setInputNotEmptiedHandler(null))

  it('hands the agent name to the handler on a LATER tick, never inside the clear that failed', async () => {
    const h = vi.fn()
    setInputNotEmptiedHandler(h)
    reportInputNotEmptied('agent-didi', null)
    expect(h).not.toHaveBeenCalled()
    await new Promise((r) => setImmediate(r))
    expect(h.mock.calls).toEqual([['didi']])
  })

  it('ignores a remote pane, a session that is not an agent pane, and a missing handler', async () => {
    const h = vi.fn()
    setInputNotEmptiedHandler(h)
    reportInputNotEmptied('agent-didi', 'vps1')
    reportInputNotEmptied('marveen-channels', null)
    await new Promise((r) => setImmediate(r))
    expect(h).not.toHaveBeenCalled()
    setInputNotEmptiedHandler(null)
    expect(() => reportInputNotEmptied('agent-didi', null)).not.toThrow()
  })
})

describe('rescueBootWedge, through the real runner', () => {
  let timers: NodeJS.Timeout[] = []
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    log.warn.mockClear()
    log.error.mockClear()
    agentProcess.restartAgentProcess.mockClear()
    agentProcess.restartAgentProcess.mockResolvedValue({ ok: true })
    agentProcess.getAgentRunningSince.mockReturnValue(SESSION_START_MS / 1000)
    monitor.hardRestartMarveenChannels.mockClear()
    directive.sendSystemDirective.mockClear()
    transcript.mtime = SESSION_START_MS - 3_000 // the OLD session's file: predates this session
    transcript.unreadable = false
    _setGuardStateForTest('didi', { ...INITIAL_GUARD_STATE, phase: 'cooldown', cooldownUntilMs: T0 + 30 * 60_000 })
    _setGuardRestartForTest('didi', { atMs: SESSION_START_MS, rescue: false, staleMinutes: null })
  })
  afterEach(() => {
    for (const t of timers) clearInterval(t)
    timers = []
    vi.clearAllTimers()
    vi.useRealTimers()
    _setGuardStateForTest('didi', null)
    _setGuardStateForTest('marveen', null)
    _setGuardRestartForTest('didi', null)
    _setGuardRestartForTest('marveen', null)
    setInputNotEmptiedHandler(null)
    setDeliveryHoldProbe(null)
    agentProcess.isSessionReadyForPrompt.mockResolvedValue(false)
  })

  it('restarts the wedged pane FRESH once, re-arms await-ready, and logs the trigger', async () => {
    expect(await rescueBootWedge('didi', T0)).toBe(true)
    expect(agentProcess.restartAgentProcess.mock.calls).toEqual([['didi', { fresh: true }]])
    expect(getHardGuardPhase('didi')).toBe('await-ready')
    expect(rescueWarns()).toHaveLength(1)
    expect(rescueWarns()[0][0]).toMatchObject({ agent: 'didi', trigger: 'input-not-emptied', msSinceGuardRestart: 60_000 })
  })

  it('the second wedge in the rescued session is refused: once per guard restart', async () => {
    await rescueBootWedge('didi', T0)
    agentProcess.restartAgentProcess.mockClear()
    expect(await rescueBootWedge('didi', T0 + 20_000)).toBe(false)
    expect(agentProcess.restartAgentProcess).not.toHaveBeenCalled()
    expect(log.warn.mock.calls.some((c) => (c[0] as { reason?: string }).reason === 'already-rescued')).toBe(true)
  })

  it('a session that has written a transcript is left alone (its work would be lost)', async () => {
    transcript.mtime = SESSION_START_MS + 5_000
    expect(await rescueBootWedge('didi', T0)).toBe(false)
    expect(agentProcess.restartAgentProcess).not.toHaveBeenCalled()
    expect(getHardGuardPhase('didi')).toBe('cooldown')
  })

  it('an unknown session start is not read as "no transcript"', async () => {
    agentProcess.getAgentRunningSince.mockReturnValue(null)
    expect(await rescueBootWedge('didi', T0)).toBe(false)
    expect(agentProcess.restartAgentProcess).not.toHaveBeenCalled()
  })

  it('a transcript dir that cannot be read is not read as "no transcript"', async () => {
    transcript.unreadable = true
    expect(await rescueBootWedge('didi', T0)).toBe(false)
    expect(agentProcess.restartAgentProcess).not.toHaveBeenCalled()
    expect(log.warn.mock.calls.some((c) => (c[0] as { reason?: string }).reason === 'transcript-unknown')).toBe(true)
  })

  it('under a fleet freeze the signal restarts nothing; lifting the freeze lets the next one through', async () => {
    // The freeze file must be the SANDBOX one: writing the live store/fleet-freeze.json would freeze the fleet.
    expect(FLEET_FREEZE_PATH.startsWith(SANDBOX)).toBe(true)
    mkdirSync(join(SANDBOX, 'store'), { recursive: true })
    timers.push(startContextGuardRunner())
    writeFleetFreeze({ mode: 'freeze', reason: 'test', by: 'boot-wedge-rescue.test', at: new Date(T0).toISOString() })
    try {
      reportInputNotEmptied('agent-didi', null)
      await vi.advanceTimersByTimeAsync(0)
      expect(agentProcess.restartAgentProcess).not.toHaveBeenCalled()
    } finally {
      clearFleetFreeze()
    }
    reportInputNotEmptied('agent-didi', null)
    await vi.advanceTimersByTimeAsync(0)
    expect(agentProcess.restartAgentProcess.mock.calls).toEqual([['didi', { fresh: true }]])
  })

  it('past the window, nothing (and no log line)', async () => {
    expect(await rescueBootWedge('didi', SESSION_START_MS + BOOT_WEDGE_WINDOW_MS + 1)).toBe(false)
    expect(agentProcess.restartAgentProcess).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('never the main agent', async () => {
    _setGuardRestartForTest('marveen', { atMs: SESSION_START_MS, rescue: false, staleMinutes: null })
    expect(await rescueBootWedge('marveen', T0)).toBe(false)
    expect(agentProcess.restartAgentProcess).not.toHaveBeenCalled()
    expect(monitor.hardRestartMarveenChannels).not.toHaveBeenCalled()
  })

  it('a failed restart rolls the guard state back', async () => {
    agentProcess.restartAgentProcess.mockResolvedValue({ ok: false, error: 'boom' })
    expect(await rescueBootWedge('didi', T0)).toBe(false)
    expect(getHardGuardPhase('didi')).toBe('cooldown')
    expect(log.error.mock.calls.some((c) => String(c[1]).includes('boot-wedge rescue restart FAILED'))).toBe(true)
  })

  it('end to end: the signal restarts the pane, and the ready poll delivers the resume prompt to the new session', async () => {
    timers.push(startContextGuardRunner())
    reportInputNotEmptied('agent-didi', null)
    await vi.advanceTimersByTimeAsync(0)
    expect(agentProcess.restartAgentProcess.mock.calls).toEqual([['didi', { fresh: true }]])
    expect(getHardGuardPhase('didi')).toBe('await-ready')
    agentProcess.isSessionReadyForPrompt.mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(READY_POLL_MS)
    expect(directive.sendSystemDirective).toHaveBeenCalledTimes(1)
    expect(directive.sendSystemDirective.mock.calls[0][0]).toBe('didi')
    expect(getHardGuardPhase('didi')).toBe('cooldown')
  })

  it('a guard restart is what puts the agent on record (no record, no rescue)', async () => {
    _setGuardRestartForTest('didi', null)
    _setGuardStateForTest('didi', { ...INITIAL_GUARD_STATE, phase: 'await-handoff', deadlineMs: T0 - 1, handoffMtimeAtRequest: null })
    expect(await rescueBootWedge('didi', T0)).toBe(false)
    timers.push(startContextGuardRunner())
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(agentProcess.restartAgentProcess).toHaveBeenCalledTimes(1)
    agentProcess.restartAgentProcess.mockClear()
    expect(await rescueBootWedge('didi', Date.now() + 10_000)).toBe(true)
    expect(agentProcess.restartAgentProcess).toHaveBeenCalledTimes(1)
  })
})
