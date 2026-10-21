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
  let stop: ReturnType<typeof setInterval>
  beforeEach(async () => {
    vi.stubEnv('SCHEDULER_TZ', 'Europe/Budapest')
    vi.clearAllMocks()
    mockWrites.length = 0
    quotaAction = 'defer'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T10:30:00.000Z'))
    vi.resetModules()
    const { startScheduleRunner } = await import('../web/schedule-runner.js')
    stop = startScheduleRunner()
  })
  afterEach(() => {
    clearInterval(stop)
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('quota skips build a streak; the owner is alerted ONCE with task, count and reason; a real run resets and recovers', async () => {
    tasks = [hourly()]
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
    // Quota stays 'defer': if the pre-check did not win first, a streak would build.
    await vi.advanceTimersByTimeAsync(35 * 60_000)
    expect(lastOutcome('due-fixture-precheck')?.lastSkipReason).toBe('precheck-cron')
    expect(lastOutcome('due-fixture-precheck')?.skipStreak).toBeUndefined()
    expect(alertTexts().filter(t => t.includes('Kimaradt futás'))).toHaveLength(0)
  })
})
