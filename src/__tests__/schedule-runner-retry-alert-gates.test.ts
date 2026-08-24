import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'

// The pending-retry alert's two config gates (schedule-runner.ts, the `!token`
// and `!ownerChat` early returns in sendPendingRetryAlert).
//
// Same shape and same reason as the task-timeout gates (card 9fc38d4b): the
// alert fires only when a retry has been waiting past its threshold, which is
// rare, so a missing one is indistinguishable from "nothing was stuck".
// Inverted, the gates suppress delivery exactly when the config is FINE.
//
// The gates' own comment explains why they return WITHOUT clearing the stamp:
// an earlier version cleared it, so the alert re-fired every 60 seconds
// forever. That makes the suppression deliberate, and worth pinning as
// suppression rather than as failure.
//
// No production code changes.

const mockTelegram = vi.fn(async (..._a: unknown[]) => {})
const mockListScheduledTasks = vi.fn(() => [] as ScheduledTask[])
const mockListPendingRetries = vi.fn(() => [] as unknown[])
let envToken = 'TELEGRAM_BOT_TOKEN=123:abc'
let ownerChat: string | null = '1268077055'

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../web/atomic-write.js', () => ({ atomicWriteFileSync: vi.fn() }))

vi.mock('../db.js', () => ({
  appendTaskRun: vi.fn(),
  listPendingTaskRetries: () => mockListPendingRetries(),
  deletePendingTaskRetry: vi.fn(),
  updatePendingTaskRetry: vi.fn(() => true),
  insertPendingTaskRetryIfNew: vi.fn(),
  // The claim succeeds: this test is about the config gates AFTER the claim,
  // not about the race the claim guards.
  markPendingTaskRetryAlert: vi.fn(() => true),
  clearPendingTaskRetryAlert: vi.fn(),
  markScheduledTaskKanbanWaiting: vi.fn(() => null),
}))

vi.mock('../web/telegram.js', () => ({
  sendTelegramMessage: (...a: unknown[]) => mockTelegram(...a),
  sendTelegramPhoto: vi.fn(async () => {}),
}))

vi.mock('../web/agent-config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../web/agent-config.js')>()),
  readFileOr: () => envToken,
}))

vi.mock('../owner-chat.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../owner-chat.js')>()),
  resolveOwnerChatId: () => ownerChat,
}))

vi.mock('../web/scheduled-tasks-io.js', () => ({
  listScheduledTasks: () => mockListScheduledTasks(),
  SCHEDULED_TASKS_DIR: '/tmp/marveen-retry-alert-no-tasks-dir',
}))

const SEP = '─'.repeat(80)
const BUSY_PANE = ['✻ Cooked for 2m 2s (esc to interrupt)', SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on'].join('\n')

vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (name: string) => `agent-${name}`,
  isAgentRunning: () => true,
  // Not ready: the retry stays queued, which is the state the alert reports.
  isSessionReadyForPrompt: () => false,
  sendPromptToSession: vi.fn(() => 'sent'),
  startAgentProcess: vi.fn(() => ({ ok: true })),
  sessionExistsOnHost: () => true,
  capturePane: () => BUSY_PANE,
  sendEnterToSession: vi.fn(),
  clearStaleParkedInput: vi.fn(() => false),
}))

const TASK: ScheduledTask = {
  name: 'retry-alert-fixture',
  description: 'retry alert gates fixture',
  prompt: 'Do the thing.',
  schedule: '0 3 * * *',
  agent: 'retryalertagent',
  enabled: true,
  createdAt: 0,
  type: 'task',
  targetSession: 'retry-alert-session',
} as ScheduledTask

// Waiting well past the one-hour alert threshold, never alerted before.
function agedRow(now: number) {
  return {
    id: 1,
    task_name: TASK.name,
    agent_name: 'retryalertagent',
    first_attempt: now - 3 * 60 * 60_000,
    last_attempt: now - 60_000,
    attempt_count: 120,
    last_reason: 'busy',
    alert_sent_at: null,
  }
}

async function runOneTick() {
  vi.resetModules()
  const { startScheduleRunner } = await import('../web/schedule-runner.js')
  const stop = startScheduleRunner()
  await vi.advanceTimersByTimeAsync(16_000)
  clearInterval(stop)
}

describe('pending-retry alert: configured delivers, a config gap suppresses', () => {
  beforeEach(() => {
    vi.stubEnv('SCHEDULER_TZ', 'Europe/Budapest')
    vi.clearAllMocks()
    vi.useFakeTimers()
    // A quiet moment: no cron occurrence for the fixture, so only the
    // pending-retry loop acts.
    vi.setSystemTime(new Date('2026-07-31T10:30:00.000Z'))
    mockListScheduledTasks.mockReturnValue([TASK])
    mockListPendingRetries.mockReturnValue([agedRow(Date.now())])
    envToken = 'TELEGRAM_BOT_TOKEN=123:abc'
    ownerChat = '1268077055'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('a retry waiting past the threshold produces the alert', async () => {
    await runOneTick()

    expect(mockTelegram).toHaveBeenCalled()
  })

  it('NO token suppresses it', async () => {
    envToken = ''
    await runOneTick()

    expect(mockTelegram).not.toHaveBeenCalled()
  })

  it('NO owner chat suppresses it', async () => {
    ownerChat = null
    await runOneTick()

    expect(mockTelegram).not.toHaveBeenCalled()
  })
})
