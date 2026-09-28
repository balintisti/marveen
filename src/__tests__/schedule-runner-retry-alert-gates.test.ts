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
const mockClearAlertStamp = vi.fn()
/** Set to make the Telegram send reject with this message. */
let sendError: string | null = null
const mockListScheduledTasks = vi.fn(() => [] as ScheduledTask[])
const mockListPendingRetries = vi.fn(() => [] as unknown[])
let envToken = 'TELEGRAM_BOT_TOKEN=123:abc'
let ownerChat: string | null = '1268077055'

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../web/atomic-write.js', () => ({ atomicWriteFileSync: vi.fn() }))

vi.mock('../db.js', () => ({
  // merge 88c366f2: the merged scheduler also records run completion/delivery and the owner-alert claim; neutral here.
  markTaskRunCompleted: () => true,
  setTaskRunDelivery: () => true,
  getTaskRunStatus: () => null,
  reconcileOpenTaskRuns: () => 0,
  getTaskRunMedianDurationMs: () => null,
  markPendingTaskRetryOwnerAlert: () => true,
  // The owner alert's stamp (upstream's stage-2 claim, merge 88c366f2): the spy this file asserts on.
  clearPendingTaskRetryOwnerAlert: (...a: unknown[]) => mockClearAlertStamp(...a),
  appendTaskRun: vi.fn(),
  listPendingTaskRetries: () => mockListPendingRetries(),
  deletePendingTaskRetry: vi.fn(),
  updatePendingTaskRetry: vi.fn(() => true),
  insertPendingTaskRetryIfNew: vi.fn(),
  // The claim succeeds: this test is about the config gates AFTER the claim,
  // not about the race the claim guards.
  markPendingTaskRetryAlert: vi.fn(() => true),
  clearPendingTaskRetryAlert: vi.fn(() => true),
  markScheduledTaskKanbanWaiting: vi.fn(() => null),
}))

// merge 88c366f2: the owner alert now leaves through the MAIN agent's channel provider
// (getProvider(CHANNEL_PROVIDER).sendMessage), not sendTelegramMessage directly. Same spy, same
// failure injection, so the four gates below keep meaning what they meant.
vi.mock('../channel-provider.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../channel-provider.js')>()),
  // The token lookup now also falls back to the channel STATE DIR's .env -- on a live host that is
  // the real Telegram channel's file, so without this the "NO token" case found a live token and
  // the test depended on the machine it ran on. Driven by the same `envToken` as before.
  readChannelToken: () => (envToken.includes('=') ? envToken.split('=')[1] || null : null),
  getProvider: () => ({
    sendMessage: async (...a: unknown[]) => {
      await mockTelegram(...a)
      if (sendError) throw new Error(sendError)
    },
  }),
}))

vi.mock('../web/telegram.js', () => ({
  sendTelegramMessage: async (...a: unknown[]) => {
    await mockTelegram(...a)
    if (sendError) throw new Error(sendError)
  },
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
  MAX_SCHEDULED_TASK_PROMPT_LEN: 50_000,
  // merge 88c366f2: imported by the merged scheduler (upstream); real value / install default here.
  SCHEDULED_TASK_INLINE_MAX_CHARS: 1_500,
  SCHEDULED_TASK_BODY_WARN_CHARS: 20_000,
  listScheduledTasks: () => mockListScheduledTasks(),
  SCHEDULED_TASKS_DIR: '/tmp/marveen-retry-alert-no-tasks-dir',
}))

const SEP = '─'.repeat(80)
const BUSY_PANE = ['✻ Cooked for 2m 2s (esc to interrupt)', SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on'].join('\n')

vi.mock('../web/agent-process.js', () => ({
  // merge 88c366f2: imported by the merged scheduler (upstream); real value / install default here.
  resolveAgentProvider: () => 'telegram' as const,
  // merge 88c366f2: the merged code also calls these; neutral here (the file measures something else).
  clearFeedbackModalAndRecheck: vi.fn(async () => false),
  saturationRefusesDispatch: () => false,
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
    sendError = null
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

  // A failed DELIVERY is a third state, and which way it goes decides whether
  // the alert ever arrives. The stamp is the throttle: cleared, the next tick
  // retries; kept, it never fires again for this row.
  it('a TRANSIENT failure clears the stamp so the next tick retries', async () => {
    sendError = 'Telegram API 429 Too Many Requests'
    await runOneTick()

    expect(mockTelegram).toHaveBeenCalled()
    expect(mockClearAlertStamp).toHaveBeenCalled()
  })

  it('a PERMANENT failure KEEPS the stamp -- no 60-second spin on a bad config', async () => {
    // The other direction, and the reason the branch exists: retrying a 400
    // every minute repeats the same rejection and buries the log.
    sendError = 'Telegram API 400 Bad Request: chat not found'
    await runOneTick()

    expect(mockTelegram).toHaveBeenCalled()
    expect(mockClearAlertStamp).not.toHaveBeenCalled()
  })
})
