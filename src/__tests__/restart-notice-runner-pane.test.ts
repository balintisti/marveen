// Card 074149c2, review finding 4 (marveen 58301): WHICH pane the hold step is handed.
//
// The hold swallows a routine restart's notice only when the pane the restart DESTROYED ends in a
// finished reply. restart-notice-runner.test.ts pins the call's position in the source; nothing
// there says what `finalPane` holds. A runner that read the pane after performRestart would hand
// over the fresh session's empty prompt, which reads as nothing at all or, worse, as a clean end.
// So this file drives the real runner through its 'restart' branch with a pane that CHANGES when
// the restart runs, and looks at what arrives.
//
// WHAT IS MOCKED, SO WHAT IS NOT PROVEN HERE: tmux (capturePane), the restart itself, the database
// and the hold step. That the hold then does the right thing with the pane is
// restart-notice-hold.test.ts; that a real capture looks like these fixtures is the snapshot
// measurement quoted in src/pane-state.ts.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const SANDBOX = mkTmp('rnrunnerpane-')
const MIN = 60_000
const T0 = 1_800_000_000_000
const SESSION_START_SEC = T0 / 1000 - 60 * 60
const NOTICE_ID = 10020077
const WINDOW_ROW = 10020001

const SEP = '─'.repeat(80)
const BOX = `${'─'.repeat(70)} Agent ─\n❯ \n${SEP}`
const FOOT = '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ↓ to manage'
/** The session the restart destroys: its turn ended in a reply. */
const OLD_PANE = `\n⏺ A HANDOFF.md megírva, megállok.\n\n✻ Worked for 2m 10s · done 19:12\n\n${BOX}\n${FOOT}`
/** The session the restart starts: nothing above the box yet. */
const NEW_PANE = `\n\n${BOX}\n${FOOT}`

const world = vi.hoisted(() => ({
  restarted: false,
  /** What capturePane answers before the restart, call by call; the last entry repeats. */
  before: [] as (string | null)[],
  after: null as string | null,
  captures: 0,
}))
const agentProcess = vi.hoisted(() => ({
  capturePane: vi.fn((s: string): string | null => {
    // The sweep reads the coordinator's pane too; only the restarted agent's captures are counted.
    if (s !== 'agent-boni') return null
    if (world.restarted) return world.after
    const i = Math.min(world.captures++, world.before.length - 1)
    return world.before[i]
  }),
  restartAgentProcess: vi.fn(async (_n: string, _o?: unknown) => {
    world.restarted = true
    return { ok: true }
  }),
}))
const hold = vi.hoisted(() => ({ holdRoutineRestartNotice: vi.fn((_n: unknown) => 'untouched') }))

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../db.js', () => ({
  createAgentMessage: vi.fn(() => ({ id: NOTICE_ID })),
  // One sender-written row delivered into the old session: the notice has something to report,
  // so it is written as a message and reaches the hold step.
  getRestartLossCandidates: () => [
    { id: WINDOW_ROW, status: 'delivered', created_at: T0 / 1000 - 400, delivered_at: T0 / 1000 - 300, from_agent: 'didi', head: 'please check the build' },
  ],
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
vi.mock('../web/system-directive.js', () => ({ sendSystemDirective: vi.fn(async () => undefined) }))
vi.mock('../web/agent-config.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  agentDir: (n: string) => join(SANDBOX, 'agents', n),
  listAllAgentNames: () => ['boni'],
  readAgentRemoteHost: () => null,
  readAgentModel: () => 'claude-opus-5-5',
}))
vi.mock('../web/active-model.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  readContextTokensFromProjectDir: () => 182_000,
  // The last work of the session is OLDER than the handoff: the handoff is fresh.
  readTranscriptMtimeFromProjectDir: () => T0 - 10 * MIN,
  readLastTurnActivityMs: () => T0 - 10 * MIN,
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
  agentRunState: () => 'running',
  agentSessionName: (n: string) => `agent-${n}`,
  restartAgentProcess: agentProcess.restartAgentProcess,
  capturePane: agentProcess.capturePane,
  sendPromptToSession: vi.fn(),
  isSessionReadyForPrompt: async () => false,
  paneEchoesInput: async () => 'echoed',
  noteSaturationBannerUntrusted: vi.fn(),
  clearSaturationBannerOverride: vi.fn(),
  getAgentRunningSince: () => SESSION_START_SEC,
}))
vi.mock('../web/front-desk-route.js', () => ({
  resolveMachineNoticeRecipient: () => ({ to: 'marveen', rerouted: false, why: 'not-configured' }),
}))
vi.mock('../web/restart-notice-hold.js', () => ({
  holdRoutineRestartNotice: hold.holdRoutineRestartNotice,
  resolveRestartNoticeHolds: vi.fn(),
  restartNoticeSwallowMode: () => 'off',
  RESTART_NOTICE_RESOLVE_MS: 60_000,
}))

const { startContextGuardRunner, _setGuardStateForTest } = await import('../web/context-guard-runner.js')
const { INITIAL_GUARD_STATE } = await import('../context-guard.js')
const { setDeliveryHoldProbe } = await import('../web/delivery-hold.js')
const { restartPaneTail } = await import('../restart-notice-trace.js')

const HANDOFF = join(SANDBOX, 'agents', 'boni', 'HANDOFF.md')
const SNAPSHOT = join(SANDBOX, 'store', 'context-guard-last-pane-boni.txt')

describe('the pane the hold step gets is the one the restart destroyed', () => {
  let timer: NodeJS.Timeout | null = null
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    world.restarted = false
    world.before = [OLD_PANE]
    world.after = NEW_PANE
    world.captures = 0
    agentProcess.capturePane.mockClear()
    agentProcess.restartAgentProcess.mockClear()
    hold.holdRoutineRestartNotice.mockClear()
    mkdirSync(join(SANDBOX, 'store'), { recursive: true })
    mkdirSync(join(SANDBOX, 'agents', 'boni'), { recursive: true })
    writeFileSync(HANDOFF, '# handoff\n')
    // Written a minute ago, after the session's last work.
    utimesSync(HANDOFF, (T0 - MIN) / 1000, (T0 - MIN) / 1000)
    rmSync(SNAPSHOT, { force: true })
  })
  afterEach(() => {
    if (timer) clearInterval(timer)
    timer = null
    vi.clearAllTimers()
    vi.useRealTimers()
    for (const n of ['boni', 'marveen']) _setGuardStateForTest(n, null)
    setDeliveryHoldProbe(null)
  })

  async function oneSweep(): Promise<void> {
    timer = startContextGuardRunner()
    await vi.advanceTimersByTimeAsync(5 * MIN)
  }

  const heldWith = () => hold.holdRoutineRestartNotice.mock.calls.map((c) => c[0] as { agent: string; noticeId: number; reason: string; finalPane: string | null; snapshotPath: string | null })

  it('the fixtures differ where it matters: the old pane is a clean end, the new one is not', () => {
    expect(restartPaneTail(OLD_PANE)).toBe('clean')
    expect(restartPaneTail(NEW_PANE)).toBe('unknown')
  })

  it('a routine "handoff written" restart: the pane read in the tick, before the restart ran', async () => {
    _setGuardStateForTest('boni', { ...INITIAL_GUARD_STATE, phase: 'await-handoff', handoffMtimeAtRequest: null, deadlineMs: T0 + 30 * MIN })
    await oneSweep()
    expect(agentProcess.restartAgentProcess).toHaveBeenCalledTimes(1)
    expect(heldWith()).toEqual([expect.objectContaining({ agent: 'boni', noticeId: NOTICE_ID, reason: 'handoff written', finalPane: OLD_PANE, snapshotPath: SNAPSHOT })])
    // The restart came first, the hold after it: the pane was not read in between.
    expect(agentProcess.restartAgentProcess.mock.invocationCallOrder[0]).toBeLessThan(hold.holdRoutineRestartNotice.mock.invocationCallOrder[0])
    expect(readFileSync(SNAPSHOT, 'utf8')).toBe(OLD_PANE)
  })

  it('the tick could not capture the pane: the second try is still made BEFORE the restart', async () => {
    // First capture fails (so the pane state is unknown and only the deadline can restart), the
    // capture in the restart branch succeeds.
    world.before = [null, OLD_PANE]
    _setGuardStateForTest('boni', { ...INITIAL_GUARD_STATE, phase: 'await-handoff', handoffMtimeAtRequest: null, deadlineMs: T0 - 1 })
    await oneSweep()
    expect(agentProcess.restartAgentProcess).toHaveBeenCalledTimes(1)
    const calls = heldWith()
    expect(calls).toHaveLength(1)
    expect(calls[0].reason).toContain('handoff timeout')
    expect(calls[0].finalPane).toBe(OLD_PANE)
    expect(readFileSync(SNAPSHOT, 'utf8')).toBe(OLD_PANE)
  })

  it('no capture before the restart at all: null, never the new session\'s pane', async () => {
    world.before = [null]
    _setGuardStateForTest('boni', { ...INITIAL_GUARD_STATE, phase: 'await-handoff', handoffMtimeAtRequest: null, deadlineMs: T0 - 1 })
    await oneSweep()
    expect(agentProcess.restartAgentProcess).toHaveBeenCalledTimes(1)
    expect(heldWith().map((c) => c.finalPane)).toEqual([null])
  })
})
