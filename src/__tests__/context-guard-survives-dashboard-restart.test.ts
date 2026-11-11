// Card 17a19228 (didi, 2026-11-10): an agent obeyed the guard's stop request, wrote its handoff,
// stopped, and stood for 53 minutes: no restart, no release. The guard's sequence lived in the
// dashboard's memory only, and a dashboard restart in the middle of it forgot the agent.
//
// Through the REAL runner (harness of context-guard-subagent-gate-runner.test.ts), with the real
// state file in a sandbox. "The dashboard restarts" is vi.resetModules() and a second import: a
// new module instance, an empty map, the same file on disk -- what a new process sees.
//
// Also here, because they are runner lines no decision test reaches: the release is SENT and
// rolled back when it does not land, the last compaction is handed to decideGuard, and the hold
// for background work is said in the log once.
//
// NOT PROVEN HERE: a real process exit (the file is written with atomicWriteFileSync, whose own
// tests cover a kill between write and rename); the transcript reading (mocked to a number here,
// real in compact-boundary-reader.test.ts).

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { INITIAL_GUARD_STATE, MAX_RELEASE_ATTEMPTS, READY_TIMEOUT_MS, type GuardState } from '../context-guard.js'

const mkTmp = tmpDirs()
const SANDBOX = mkTmp('cgsurvives-')
const STATE_FILE = join(SANDBOX, 'store', 'context-guard-state.json')
const MIN = 60_000
const T0 = 1_800_000_000_000
const LIMIT = 200_000
// 92% of the cap: above actPct (90%), below hardPct (97%) -- a request, not a forced restart.
const HEAVY = 184_000
const LIGHT = 54_000

const world = vi.hoisted(() => ({
  tokens: 0 as number | null,
  compactedAtMs: null as number | null,
  runningSinceSec: null as number | null,
  backgroundWork: 0,
  allOff: false,
  sessionReady: false,
  send: vi.fn(async (..._args: unknown[]): Promise<string> => 'sent'),
  restart: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({ logger: world.log }))
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
vi.mock('../web/system-directive.js', () => ({ sendSystemDirective: world.send }))
vi.mock('../web/agent-config.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listAllAgentNames: () => ['boni'],
  readAgentRemoteHost: () => null,
  readAgentModel: () => 'claude-opus-5-5',
}))
vi.mock('../web/active-model.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  readContextTokensFromProjectDir: () => world.tokens,
  readTranscriptMtimeFromProjectDir: () => Date.now(),
  readLastTurnActivityMs: () => Date.now(),
  readActiveModelFromProjectDir: () => null,
  readLastCompactionMs: () => world.compactedAtMs,
  predatesSession: () => false,
}))
vi.mock('../pane-state.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  runningBackgroundWork: () => world.backgroundWork,
}))
vi.mock('../heavy-run-jobs.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  liveHeavyRunJobs: () => [],
}))
vi.mock('../web/context-guard-store.js', async (orig) => {
  const actual = await orig<typeof import('../web/context-guard-store.js')>()
  const { DEFAULT_CONTEXT_GUARD } = await import('../context-guard.js')
  const on = { ...DEFAULT_CONTEXT_GUARD, enabled: true, limitTokens: 200_000, actPct: 0.9, hardPct: 0.97 }
  const off = { ...on, enabled: false, saturationRestart: false, idleFlushEnabled: false, dailyHandoffEnabled: false }
  return {
    ...actual,
    readContextGuardConfig: () => (world.allOff ? off : on),
    readAllContextGuardConfigs: () => ({}),
  }
})
vi.mock('../web/agent-process.js', () => ({
  clearFeedbackModalAndRecheck: () => false,
  agentRunState: () => 'running',
  agentSessionName: (n: string) => `agent-${n}`,
  restartAgentProcess: world.restart,
  capturePane: () => '',
  sendPromptToSession: vi.fn(),
  isSessionReadyForPrompt: async () => world.sessionReady,
  paneEchoesInput: async () => 'echoed',
  noteSaturationBannerUntrusted: vi.fn(),
  clearSaturationBannerOverride: vi.fn(),
  getAgentRunningSince: () => world.runningSinceSec,
}))

type Runner = typeof import('../web/context-guard-runner.js')
let runner: Runner
let timer: NodeJS.Timeout | null = null

/** A dashboard process comes up: a new module instance, and the guard's runner starts in it. */
async function dashboardStarts(): Promise<void> {
  vi.resetModules()
  runner = await import('../web/context-guard-runner.js')
  timer = runner.startContextGuardRunner()
}

/**
 * The dashboard process ends: its timers go with it. The state file stays, and so does the time:
 * vi.clearAllTimers() also puts the fake clock back to where useFakeTimers() found it (the real
 * date), which mid-test would move every saved deadline months away.
 */
function dashboardStops(): void {
  const now = Date.now()
  if (timer) clearInterval(timer)
  timer = null
  vi.clearAllTimers()
  vi.setSystemTime(now)
}

const sentTo = (name: string) => world.send.mock.calls.filter((c) => c[0] === name).map((c) => String(c[2]))
const restartsOf = (name: string) => world.restart.mock.calls.filter((c) => c[0] === name).length
const savedState = (name: string): GuardState | undefined =>
  (JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as { states: Record<string, GuardState> }).states[name]
/** Log lines with this text; the main agent is swept too, so a line about an agent is asked BY NAME. */
const logged = (level: 'info' | 'warn', text: string, name?: string) =>
  world.log[level].mock.calls.filter((c) =>
    String(c[c.length - 1]).includes(text) && (name === undefined || (c[0] as { name?: string }).name === name))

/** Sweeps until the stop request is out: boni is in await-handoff, asked at T0 + 4.5 min. */
async function askedToStop(): Promise<void> {
  world.tokens = HEAVY
  await dashboardStarts()
  await vi.advanceTimersByTimeAsync(5 * MIN)
  expect(sentTo('boni')).toHaveLength(1)
  expect(sentTo('boni')[0]).toContain('HANDOFF.md')
  expect(runner.getHardGuardPhase('boni')).toBe('await-handoff')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  rmSync(join(SANDBOX, 'store'), { recursive: true, force: true })
  Object.assign(world, { tokens: 0, compactedAtMs: null, runningSinceSec: T0 / 1000 - 3600, backgroundWork: 0, allOff: false, sessionReady: false })
  world.send.mockReset().mockImplementation(async () => 'sent')
  world.restart.mockReset().mockImplementation(async () => ({ ok: true }))
  for (const fn of Object.values(world.log)) fn.mockClear()
})

afterEach(() => {
  dashboardStops()
  vi.useRealTimers()
})

describe('a stop request that was obeyed survives a dashboard restart', () => {
  it('the card: asked to stop, the dashboard restarts, the context is small by then -> the agent is still restarted at the deadline', async () => {
    await askedToStop()
    expect(savedState('boni')?.phase).toBe('await-handoff')
    const deadlineMs = savedState('boni')?.deadlineMs ?? 0
    expect(deadlineMs).toBeGreaterThan(Date.now())

    dashboardStops()
    expect(Date.now()).toBeLessThan(deadlineMs) // the restart below is the deadline's, not a stale clock's
    world.tokens = LIGHT
    await dashboardStarts()
    expect(runner.getHardGuardPhase('boni')).toBe('await-handoff')
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(restartsOf('boni')).toBe(0) // not before the deadline
    expect(logged('info', 'restored from before the dashboard restart', 'boni')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(deadlineMs - Date.now() + 5 * MIN)
    expect(restartsOf('boni')).toBe(1)
    expect(sentTo('boni')).toHaveLength(1) // no second request, no release: the restart is the exit
    expect(runner.getHardGuardPhase('boni')).toBe('await-ready')
    expect(savedState('boni')?.phase).toBe('await-ready')
  })

  it('control, the stranding itself: the same run WITHOUT the file never restarts and never releases', async () => {
    await askedToStop()
    const deadlineMs = savedState('boni')?.deadlineMs ?? 0
    dashboardStops()
    rmSync(STATE_FILE)
    world.tokens = LIGHT
    await dashboardStarts()
    expect(runner.getHardGuardPhase('boni')).toBe('idle')
    await vi.advanceTimersByTimeAsync(deadlineMs - Date.now() + 60 * MIN)
    expect(restartsOf('boni')).toBe(0)
    expect(sentTo('boni')).toHaveLength(1)
  })

  it('a cooldown survives too: no new request until it is over', async () => {
    mkdirSync(join(SANDBOX, 'store'), { recursive: true })
    const cooling: GuardState = { ...INITIAL_GUARD_STATE, phase: 'cooldown', cooldownUntilMs: T0 + 30 * MIN }
    writeFileSync(STATE_FILE, JSON.stringify({ version: 1, savedAtMs: T0 - MIN, states: { boni: cooling } }))
    world.tokens = HEAVY
    await dashboardStarts()
    expect(runner.getHardGuardPhase('boni')).toBe('cooldown')
    await vi.advanceTimersByTimeAsync(25 * MIN)
    expect(sentTo('boni')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(15 * MIN)
    expect(sentTo('boni')).toHaveLength(1)
  })

  it('the session that was asked is gone (it started after the request): the saved request is dropped, not acted on', async () => {
    await askedToStop()
    const askedAtMs = savedState('boni')?.requestedAtMs ?? 0
    expect(askedAtMs).toBeGreaterThan(T0)
    dashboardStops()
    world.tokens = LIGHT
    world.runningSinceSec = askedAtMs / 1000 + 60
    await dashboardStarts()
    expect(runner.getHardGuardPhase('boni')).toBe('idle')
    expect(logged('info', 'saved await-handoff dropped', 'boni')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60 * MIN)
    expect(restartsOf('boni')).toBe(0)
    expect(sentTo('boni')).toHaveLength(1)
  })

  it('control: a session that started BEFORE the request keeps it (the boundary: the same second)', async () => {
    await askedToStop()
    const askedAtMs = savedState('boni')?.requestedAtMs ?? 0
    dashboardStops()
    world.runningSinceSec = askedAtMs / 1000
    await dashboardStarts()
    expect(runner.getHardGuardPhase('boni')).toBe('await-handoff')
  })

  // didi's review (comment 58639, G6). The file is rewritten on EVERY state change of ANY agent, so
  // its savedAtMs can be minutes after the request. Dated by the file, a session that started in
  // between would pass for the one that was asked, and be force-restarted at the deadline.
  it('the request is dated by its OWN time, not the file\'s: a session started between the request and a later save is dropped', async () => {
    await askedToStop()
    const askedAtMs = savedState('boni')?.requestedAtMs ?? 0
    await vi.advanceTimersByTimeAsync(3 * MIN)
    runner._setGuardStateForTest('didi', { ...INITIAL_GUARD_STATE, phase: 'cooldown', cooldownUntilMs: Date.now() + 30 * MIN })
    const savedAtMs = (JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as { savedAtMs: number }).savedAtMs
    const startedSec = Math.floor(askedAtMs / 1000) + 120
    // The premise: the session start lies strictly between the two times, and the request is still in the file.
    expect(startedSec * 1000).toBeGreaterThan(askedAtMs)
    expect(startedSec * 1000).toBeLessThan(savedAtMs)
    expect(savedState('boni')?.phase).toBe('await-handoff')
    expect(savedState('boni')?.requestedAtMs).toBe(askedAtMs)

    dashboardStops()
    world.tokens = LIGHT
    world.runningSinceSec = startedSec
    await dashboardStarts()
    expect(runner.getHardGuardPhase('boni')).toBe('idle')
    expect(logged('info', 'saved await-handoff dropped', 'boni')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60 * MIN)
    expect(restartsOf('boni')).toBe(0)
    expect(sentTo('boni')).toHaveLength(1)
  })

  // didi's review (comment 58639, G7). An agent the guard restarted and that waits for its resume
  // prompt: forgotten by a dashboard restart, the fresh session would never be told to read its handoff.
  it('await-ready comes back from the file: the restarted session still gets its resume prompt once it is ready', async () => {
    mkdirSync(join(SANDBOX, 'store'), { recursive: true })
    const waiting: GuardState = { ...INITIAL_GUARD_STATE, phase: 'await-ready', deadlineMs: T0 + READY_TIMEOUT_MS }
    writeFileSync(STATE_FILE, JSON.stringify({ version: 1, savedAtMs: T0 - MIN, states: { boni: waiting } }))
    world.tokens = LIGHT
    await dashboardStarts()
    expect(runner.getHardGuardPhase('boni')).toBe('await-ready')
    expect(logged('info', 'restored from before the dashboard restart', 'boni')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(sentTo('boni')).toHaveLength(0) // the session is not ready yet
    expect(runner.getHardGuardPhase('boni')).toBe('await-ready')

    world.sessionReady = true
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(Date.now()).toBeLessThan(waiting.deadlineMs) // delivered because it was awaited, not at the give-up
    expect(sentTo('boni')).toHaveLength(1)
    expect(sentTo('boni')[0]).toMatch(/^\[CONTEXT-GUARD\] Friss kontextussal indultál/)
    expect(runner.getHardGuardPhase('boni')).toBe('cooldown')
    expect(savedState('boni')?.phase).toBe('cooldown')
    expect(restartsOf('boni')).toBe(0)
  })

  it('...and its give-up time is the saved one: a session that never reads ready is let go at the deadline, not before', async () => {
    mkdirSync(join(SANDBOX, 'store'), { recursive: true })
    const waiting: GuardState = { ...INITIAL_GUARD_STATE, phase: 'await-ready', deadlineMs: T0 + READY_TIMEOUT_MS }
    writeFileSync(STATE_FILE, JSON.stringify({ version: 1, savedAtMs: T0 - MIN, states: { boni: waiting } }))
    world.tokens = LIGHT
    await dashboardStarts()
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS - MIN)
    expect(runner.getHardGuardPhase('boni')).toBe('await-ready')
    await vi.advanceTimersByTimeAsync(MIN + 5 * MIN)
    expect(runner.getHardGuardPhase('boni')).toBe('cooldown')
    expect(savedState('boni')?.phase).toBe('cooldown')
    expect(sentTo('boni')).toHaveLength(0)
    expect(restartsOf('boni')).toBe(0)
  })
})

describe('the state file and the runner', () => {
  it('nothing is written before the runner starts; the start writes what memory holds', async () => {
    vi.resetModules()
    runner = await import('../web/context-guard-runner.js')
    runner._setGuardStateForTest('boni', { ...INITIAL_GUARD_STATE, phase: 'cooldown', cooldownUntilMs: T0 + MIN })
    expect(existsSync(STATE_FILE)).toBe(false)
    timer = runner.startContextGuardRunner()
    expect(savedState('boni')?.phase).toBe('cooldown')
  })

  it('a state this run already holds wins over the file', async () => {
    mkdirSync(join(SANDBOX, 'store'), { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify({
      version: 1,
      savedAtMs: T0 - MIN,
      states: { boni: { ...INITIAL_GUARD_STATE, phase: 'cooldown', cooldownUntilMs: T0 + 30 * MIN } },
    }))
    vi.resetModules()
    runner = await import('../web/context-guard-runner.js')
    runner._setGuardStateForTest('boni', { ...INITIAL_GUARD_STATE, phase: 'await-ready', deadlineMs: T0 + 15 * MIN })
    timer = runner.startContextGuardRunner()
    expect(runner.getHardGuardPhase('boni')).toBe('await-ready')
    expect(savedState('boni')?.phase).toBe('await-ready')
  })

  it('an unreadable file: said in the log, everybody starts idle, and the next change replaces it', async () => {
    mkdirSync(join(SANDBOX, 'store'), { recursive: true })
    writeFileSync(STATE_FILE, '{"version":1,"savedAtMs":18000000')
    world.tokens = HEAVY
    await dashboardStarts()
    expect(logged('warn', 'guard state file is not readable')).toHaveLength(1)
    expect(runner.getHardGuardPhase('boni')).toBe('idle')
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(savedState('boni')?.phase).toBe('await-handoff')
  })

  it('an entry that is not a state: named in the log, that agent starts idle', async () => {
    mkdirSync(join(SANDBOX, 'store'), { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify({ version: 1, savedAtMs: T0 - MIN, states: { boni: { phase: 'await-handoff' } } }))
    await dashboardStarts()
    const warned = logged('warn', 'saved guard state not usable')
    expect(warned).toHaveLength(1)
    expect((warned[0]?.[0] as { agents: string[] }).agents).toEqual(['boni'])
    expect(runner.getHardGuardPhase('boni')).toBe('idle')
  })
})

describe('the release is sent, and it has to land', () => {
  it('compacted after the request: the withdrawal goes out in the agent\'s pane, and nothing is restarted', async () => {
    await askedToStop()
    const askedAtMs = savedState('boni')?.requestedAtMs ?? 0
    world.tokens = LIGHT
    world.compactedAtMs = askedAtMs + 90_000
    await vi.advanceTimersByTimeAsync(5 * MIN)
    const texts = sentTo('boni')
    expect(texts).toHaveLength(2)
    expect(texts[1]).toMatch(/^\[CONTEXT-GUARD\] /)
    expect(texts[1]).toContain('VISSZAVONVA')
    expect(texts[1]).toContain('NEM lesz újraindítás')
    expect(texts[1]).toContain('tömörített')
    expect(texts[1]).toBe(runner.releasePrompt('compacted after the stop request: x', Math.round((Date.now() - askedAtMs) / MIN)))
    expect(runner.getHardGuardPhase('boni')).toBe('cooldown')
    expect(savedState('boni')?.phase).toBe('cooldown')
    await vi.advanceTimersByTimeAsync(20 * MIN)
    expect(restartsOf('boni')).toBe(0)
    expect(sentTo('boni')).toHaveLength(2)
  })

  it('control: the same sweep with no compaction on record waits, and the deadline restarts', async () => {
    await askedToStop()
    world.tokens = LIGHT
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(sentTo('boni')).toHaveLength(1)
    expect(runner.getHardGuardPhase('boni')).toBe('await-handoff')
    await vi.advanceTimersByTimeAsync(25 * MIN)
    expect(restartsOf('boni')).toBe(1)
  })

  it('the guard is switched off for an agent that waits behind a request: it is told, then forgotten', async () => {
    await askedToStop()
    world.allOff = true
    await vi.advanceTimersByTimeAsync(5 * MIN)
    const texts = sentTo('boni')
    expect(texts).toHaveLength(2)
    expect(texts[1]).toContain('VISSZAVONVA')
    expect(texts[1]).toContain('kikapcsolták')
    await vi.advanceTimersByTimeAsync(30 * MIN)
    expect(sentTo('boni')).toHaveLength(2)
    expect(restartsOf('boni')).toBe(0)
    expect(savedState('boni')).toBeUndefined()
  })

  for (const [what, failing] of [
    ['is not delivered', async () => 'held'],
    ['throws', async () => { throw new Error('tmux: no such session') }],
  ] as const) {
    it(`a release that ${what} is tried again on the next sweep, and lands`, async () => {
      await askedToStop()
      const askedAtMs = savedState('boni')?.requestedAtMs ?? 0
      world.tokens = LIGHT
      world.compactedAtMs = askedAtMs + 90_000
      world.send.mockImplementation(failing as () => Promise<string>)
      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(world.send.mock.calls.filter((c) => c[0] === 'boni')).toHaveLength(2)
      expect(runner.getHardGuardPhase('boni')).toBe('await-handoff')
      expect(savedState('boni')?.releaseAttempts).toBe(1)
      expect(logged('warn', 'was not delivered', 'boni')).toHaveLength(1)

      world.send.mockImplementation(async () => 'sent')
      await vi.advanceTimersByTimeAsync(5 * MIN)
      expect(world.send.mock.calls.filter((c) => c[0] === 'boni')).toHaveLength(3)
      expect(runner.getHardGuardPhase('boni')).toBe('cooldown')
      expect(restartsOf('boni')).toBe(0)
    })
  }

  it(`a release that never lands is given up after ${MAX_RELEASE_ATTEMPTS} tries, and the log says the agent was not told`, async () => {
    await askedToStop()
    const askedAtMs = savedState('boni')?.requestedAtMs ?? 0
    world.tokens = LIGHT
    world.compactedAtMs = askedAtMs + 90_000
    world.send.mockImplementation(async () => 'held')
    await vi.advanceTimersByTimeAsync((MAX_RELEASE_ATTEMPTS + 2) * 5 * MIN)
    expect(world.send.mock.calls.filter((c) => c[0] === 'boni')).toHaveLength(1 + MAX_RELEASE_ATTEMPTS)
    expect(logged('warn', 'never reached the pane', 'boni')).toHaveLength(1)
    expect(runner.getHardGuardPhase('boni')).toBe('cooldown')
    expect(restartsOf('boni')).toBe(0)
  })
})

describe('a restart held for background work is said once', () => {
  it('one info line when the hold begins, none on the sweeps that keep holding, and the restart when the work is done', async () => {
    await askedToStop()
    const deadlineMs = savedState('boni')?.deadlineMs ?? 0
    world.backgroundWork = 2
    await vi.advanceTimersByTimeAsync(deadlineMs - Date.now() + 5 * MIN)
    expect(restartsOf('boni')).toBe(0)
    expect(logged('info', 'restart held while', 'boni')).toHaveLength(1)
    expect(savedState('boni')?.backgroundDeferSinceMs).toBeGreaterThanOrEqual(deadlineMs)
    await vi.advanceTimersByTimeAsync(10 * MIN)
    expect(logged('info', 'restart held while', 'boni')).toHaveLength(1)
    expect(restartsOf('boni')).toBe(0)
    world.backgroundWork = 0
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(restartsOf('boni')).toBe(1)
  })
})
