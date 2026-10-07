import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

// Card 997515c0. The unit tests (prompt-task-due.test.ts) pin the rules; this one
// drives the REAL scheduler tick, because the failure it exists for is a wiring
// failure: a quota-gate skip that records nothing the alert can see, or an alert
// that is never called. A hourly heartbeat is held back by the quota gate every
// tick; the owner must hear it exactly once, with task + count + reason, and
// hear the recovery when the gate opens and the task really fires.

const mockSend = vi.fn(async () => {})
const mockWrites: Array<{ path: string; body: string }> = []
let quotaAction: 'defer' | 'run' = 'defer'
let tasks: ScheduledTask[] = []
// The outcome file the runner reads at start (restart scenarios); null = the real read.
let seededOutcomeFile: string | null = null
const mockDueCheck = vi.fn()

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  const readFileSync = ((p: unknown, ...rest: unknown[]) =>
    seededOutcomeFile !== null && String(p).endsWith('schedule-last-outcome.json')
      ? seededOutcomeFile
      : (real.readFileSync as (...a: unknown[]) => unknown)(p, ...rest)) as typeof real.readFileSync
  return { ...real, readFileSync, default: { ...real, readFileSync } }
})
vi.mock('../web/prompt-task-due.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../web/prompt-task-due.js')>()
  return {
    ...real,
    runPromptTaskDueCheck: (...a: Parameters<typeof real.runPromptTaskDueCheck>) => {
      mockDueCheck()
      return real.runPromptTaskDueCheck(...a)
    },
  }
})

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../web/atomic-write.js', () => ({
  atomicWriteFileSync: (path: string, body: string) => { mockWrites.push({ path, body }) },
}))
vi.mock('../quota-gate.js', () => ({
  decideQuotaAction: () => (quotaAction === 'defer'
    ? { action: 'defer', reason: 'test pressure', pressure: 'high' }
    : { action: 'run', reason: 'ok' }),
}))
vi.mock('../owner-chat.js', () => ({
  resolveOwnerChatId: () => '4242',
  configuredOwnerChatFor: () => undefined,
}))
vi.mock('../channel-provider.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../channel-provider.js')>()
  return {
    ...real,
    readChannelToken: () => 'test-token',
    getProvider: (type: Parameters<typeof real.getProvider>[0]) => ({
      ...real.getProvider(type),
      sendMessage: (...a: unknown[]) => (mockSend as (...x: unknown[]) => Promise<void>)(...a),
      sendPhoto: vi.fn(async () => {}),
    }),
  }
})
vi.mock('../db.js', () => ({
  markTaskRunCompleted: () => true,
  setTaskRunDelivery: () => true,
  getTaskRunStatus: () => null,
  reconcileOpenTaskRuns: () => 0,
  getTaskRunMedianDurationMs: () => null,
  markPendingTaskRetryOwnerAlert: () => true,
  clearPendingTaskRetryOwnerAlert: () => true,
  appendTaskRun: vi.fn(() => 1),
  listPendingTaskRetries: () => [],
  deletePendingTaskRetry: vi.fn(),
  updatePendingTaskRetry: vi.fn(() => true),
  insertPendingTaskRetryIfNew: vi.fn(),
  markPendingTaskRetryAlert: vi.fn(() => false),
  clearPendingTaskRetryAlert: vi.fn(),
  markScheduledTaskKanbanWaiting: vi.fn(),
  isLedgerInboundAnswered: () => false,
  createAgentMessage: vi.fn(),
}))
vi.mock('../web/scheduled-tasks-io.js', () => ({
  listScheduledTasks: () => tasks,
  // SCHEDFRESH1007: a fire reads its one task by name (card 69f5373a).
  readScheduledTask: (n: string) => (tasks as Array<{ name: string }>).find(t => t.name === n) ?? null,
  SCHEDULED_TASKS_DIR: '/tmp/marveen-prompt-due-no-tasks-dir',
  SCHEDULED_TASK_INLINE_MAX_CHARS: 1_500,
  SCHEDULED_TASK_BODY_WARN_CHARS: 20_000,
  MAX_SCHEDULED_TASK_PROMPT_LEN: 50_000,
}))
vi.mock('../web/agent-process.js', () => ({
  saturationRefusesDispatch: () => false,
  clearFeedbackModalAndRecheck: () => false,
  agentSessionName: (name: string) => `agent-${name}`,
  isAgentRunning: () => true,
  isSessionReadyForPrompt: () => true,
  sendPromptToSession: vi.fn(() => 'sent'),
  startAgentProcess: vi.fn(() => ({ ok: false, error: 'not in tests' })),
  sessionExistsOnHost: () => true,
  capturePane: () => null,
  sendEnterToSession: vi.fn(),
  clearStaleParkedInput: vi.fn(() => false),
  resolveAgentProvider: () => 'telegram',
}))

function hourly(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    name: 'due-fixture-stepper', description: 'fixture', prompt: 'go', schedule: '* * * * *',
    agent: 'dueagent', enabled: true, createdAt: 0, type: 'heartbeat', targetSession: 'due-test-session',
    ...over,
  }
}

function lastOutcome(name: string): Record<string, unknown> | undefined {
  const w = [...mockWrites].reverse().find(x => x.path.endsWith('schedule-last-outcome.json'))
  return w ? (JSON.parse(w.body) as Record<string, Record<string, unknown>>)[name] : undefined
}
const alertTexts = () => mockSend.mock.calls.map(c => String((c as unknown[])[2]))

describe('prompt-task missed-run alert, through the real tick (card 997515c0)', () => {
  let stop: ReturnType<typeof setInterval> | undefined
  const START = new Date('2026-10-20T10:30:00.000Z').getTime()
  // The runner is started by each test, AFTER it has seeded the outcome file.
  async function start() {
    vi.resetModules()
    const mod = await import('../web/schedule-runner.js')
    stop = mod.startScheduleRunner()
    return mod
  }
  beforeEach(() => {
    vi.stubEnv('SCHEDULER_TZ', 'Europe/Budapest')
    vi.clearAllMocks()
    mockWrites.length = 0
    quotaAction = 'defer'
    seededOutcomeFile = null
    stop = undefined
    vi.useFakeTimers()
    vi.setSystemTime(START)
  })
  afterEach(() => {
    if (stop) clearInterval(stop)
    seededOutcomeFile = null
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('quota skips build a streak; the owner is alerted ONCE with task, count and reason; a real run resets and recovers', async () => {
    tasks = [hourly()]
    await start()
    // 5 minutes of quota pressure: streak is stored, but the 15-minute tolerance has not passed -> no alert yet.
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    const early = lastOutcome('due-fixture-stepper')
    expect(early?.lastSkipReason).toBe('quota')
    expect(Number(early?.skipStreak)).toBeGreaterThanOrEqual(3)
    expect(alertTexts().filter(t => t.includes('Kimaradt futás'))).toHaveLength(0)

    // Past the tolerance: exactly one alert, however many more ticks pass.
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const alerts = alertTexts().filter(t => t.includes('Kimaradt futás'))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toContain('due-fixture-stepper')
    expect(alerts[0]).toMatch(/\d+ menetrend szerinti futás/)
    expect(alerts[0]).toMatch(/\d+ egymás utáni kihagyás/)
    expect(alerts[0]).toContain('quota')
    expect(Number(lastOutcome('due-fixture-stepper')?.skipStreak)).toBeGreaterThan(10)

    // Gate opens: a real firing resets the streak and the owner hears the recovery.
    quotaAction = 'run'
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    const after = lastOutcome('due-fixture-stepper')
    expect(after?.lastFiredAt).toBeGreaterThan(Number(after?.lastSkippedAt) - 1)
    expect(after?.skipStreak).toBeUndefined()
    expect(alertTexts().filter(t => t.includes('Helyreállt'))).toHaveLength(1)
  })

  it('NEGATIVE CONTROL: a task whose pre-check says SKIP (precheck-cron) builds no streak and is never alerted', async () => {
    const dir = mkTmp('prompt-due-')
    const script = join(dir, 'pre-check.sh')
    writeFileSync(script, '#!/usr/bin/env bash\necho SKIP\n', { mode: 0o755 })
    tasks = [hourly({ name: 'due-fixture-precheck', preCheck: script })]
    await start()
    // Quota stays 'defer': if the pre-check did not win first, a streak would build.
    await vi.advanceTimersByTimeAsync(35 * 60_000)
    expect(lastOutcome('due-fixture-precheck')?.lastSkipReason).toBe('precheck-cron')
    expect(lastOutcome('due-fixture-precheck')?.skipStreak).toBeUndefined()
    expect(alertTexts().filter(t => t.includes('Kimaradt futás'))).toHaveLength(0)
  })

  // dueAlertedAt must survive a restart, because that is what keeps it one alert per episode.
  it('RESTART: dueAlertedAt is loaded from the outcome file -- a still-not-firing alerted task gets no recovery and no second alert', async () => {
    const alertedAt = START - 24 * 3_600_000
    seededOutcomeFile = JSON.stringify({
      'due-fixture-stepper': {
        lastFiredAt: START - 3 * 24 * 3_600_000, lastSkippedAt: START - 3_600_000,
        lastSkipReason: 'quota', skipStreak: 5, dueAlertedAt: alertedAt,
      },
    })
    tasks = [hourly()]
    await start()
    await vi.advanceTimersByTimeAsync(30 * 60_000) // floor = start: first 17 min count 0 slots, then 2+
    expect(alertTexts().filter(t => t.includes('Helyreállt'))).toHaveLength(0)
    expect(alertTexts().filter(t => t.includes('Kimaradt futás'))).toHaveLength(0)
    expect(lastOutcome('due-fixture-stepper')?.dueAlertedAt).toBe(alertedAt)
  })

  it('an OLD outcome entry without dueAlertedAt still parses, and the task is alerted normally', async () => {
    seededOutcomeFile = JSON.stringify({
      'due-fixture-stepper': { lastFiredAt: START - 3 * 3_600_000, lastSkippedAt: START - 60_000, lastSkipReason: 'quota' },
    })
    tasks = [hourly()]
    const mod = await start()
    expect(mod.readScheduleLastOutcome('due-fixture-stepper')).toEqual({
      lastFiredAt: START - 3 * 3_600_000, lastSkippedAt: START - 60_000, lastSkipReason: 'quota',
    })
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(alertTexts().filter(t => t.includes('Kimaradt futás'))).toHaveLength(1)
  })

  it('the public reader returns dueAlertedAt when the file has it', async () => {
    seededOutcomeFile = JSON.stringify({ x: { lastFiredAt: 5, dueAlertedAt: 9 } })
    tasks = []
    const mod = await start()
    expect(mod.readScheduleLastOutcome('x')).toEqual({ lastFiredAt: 5, dueAlertedAt: 9 })
  })

  it('TICK GAP (sleep): slots inside the gap are left to catch-up -- no alert for them; detection resumes after', async () => {
    tasks = [hourly()]
    await start()
    await vi.advanceTimersByTimeAsync(90_000)
    vi.setSystemTime(Date.now() + 60 * 60_000) // the machine slept: no tick ran for an hour
    await vi.advanceTimersByTimeAsync(20_000)
    expect(alertTexts().filter(t => t.includes('Kimaradt futás'))).toHaveLength(0)
    // Positive control: the floor moved to the gap's end, it did not disable detection.
    await vi.advanceTimersByTimeAsync(25 * 60_000)
    expect(alertTexts().filter(t => t.includes('Kimaradt futás'))).toHaveLength(1)
  })

  it('THROTTLE: the due-check is evaluated about once a minute, not on every 15 s tick', async () => {
    tasks = [hourly()]
    await start()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(mockDueCheck.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(mockDueCheck.mock.calls.length).toBeLessThanOrEqual(6) // unthrottled it would be ~20
  })
})
