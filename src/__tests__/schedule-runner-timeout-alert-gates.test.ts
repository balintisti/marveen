import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'

// The task-timeout alert's two config gates (schedule-runner.ts, the `!token`
// and `!ownerChat` early returns in sendTaskTimeoutAlert).
//
// Why these are NOT the "noisy" half of the remainder, which is how I first
// filed them (marveen corrected the criterion, and the distinction is his):
// a missing alert is only noticeable if someone expects it. This alert fires
// on a RARE condition -- a scheduled task still busy past its timeout -- so its
// absence is indistinguishable from "there was nothing to report". Inverted,
// the gates suppress the alert exactly when the config is FINE, and the
// operator hears nothing, forever, with no signal that anything is wrong.
//
// Three cases: configured delivers, and each gate suppresses on its own.
//
// No production code changes.

const mockTelegram = vi.fn(async (..._a: unknown[]) => {})
const mockSendPrompt = vi.fn((..._a: unknown[]) => 'sent')
const mockListScheduledTasks = vi.fn(() => [] as ScheduledTask[])
let envToken = 'TELEGRAM_BOT_TOKEN=123:abc'
let ownerChat: string | null = '1268077055'

// Named so the card-moved line can be asserted: it is the only trace that the
// board was updated, and nothing pinned whether it follows the move or
// contradicts it.
const mockInfo = vi.fn()
/** What markScheduledTaskKanbanWaiting reports: a moved card id, or nothing. */
let movedCardId: string | null = null

vi.mock('../logger.js', () => ({
  logger: { info: (...a: unknown[]) => mockInfo(...a), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../web/atomic-write.js', () => ({ atomicWriteFileSync: vi.fn() }))

vi.mock('../db.js', () => ({
  appendTaskRun: vi.fn(),
  listPendingTaskRetries: () => [],
  deletePendingTaskRetry: vi.fn(),
  updatePendingTaskRetry: vi.fn(() => true),
  insertPendingTaskRetryIfNew: vi.fn(),
  markPendingTaskRetryAlert: vi.fn(() => true),
  clearPendingTaskRetryAlert: vi.fn(),
  markScheduledTaskKanbanWaiting: () => movedCardId,
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
  SCHEDULED_TASKS_DIR: '/tmp/marveen-timeout-alert-no-tasks-dir',
}))

const SEP = '─'.repeat(80)
const IDLE_PANE = ['', SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on (shift+tab to cycle)'].join('\n')
// Busy for good: the watchdog's 'alert' verdict needs a pane that is still
// working past the timeout, not one that went quiet.
const BUSY_PANE = ['✻ Cooked for 9m 9s (esc to interrupt)', SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on'].join('\n')

let paneCalls = 0
vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (name: string) => `agent-${name}`,
  isAgentRunning: () => true,
  isSessionReadyForPrompt: () => true,
  sendPromptToSession: (...a: unknown[]) => mockSendPrompt(...(a as [])),
  startAgentProcess: vi.fn(() => ({ ok: true })),
  sessionExistsOnHost: () => true,
  capturePane: () => (++paneCalls === 1 ? IDLE_PANE : BUSY_PANE),
  sendEnterToSession: vi.fn(),
  clearStaleParkedInput: vi.fn(() => false),
}))

const TASK: ScheduledTask = {
  name: 'timeout-alert-fixture',
  description: 'timeout alert gates fixture',
  prompt: 'Do the thing.',
  schedule: '30 10 * * *',
  agent: 'timeoutagent',
  enabled: true,
  createdAt: 0,
  type: 'task',
  targetSession: 'timeout-alert-session',
} as ScheduledTask

async function fireAndWaitPastTimeout() {
  vi.resetModules()
  const { startScheduleRunner, TASK_FIRE_TIMEOUT_MS } = await import('../web/schedule-runner.js')
  const stop = startScheduleRunner()
  await vi.advanceTimersByTimeAsync(61_000)
  expect(mockSendPrompt).toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(TASK_FIRE_TIMEOUT_MS + 60_000)
  clearInterval(stop)
}

describe('task-timeout alert: configured delivers, a config gap suppresses', () => {
  beforeEach(() => {
    vi.stubEnv('SCHEDULER_TZ', 'Europe/Budapest')
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T08:29:30.000Z'))
    mockListScheduledTasks.mockReturnValue([TASK])
    envToken = 'TELEGRAM_BOT_TOKEN=123:abc'
    ownerChat = '1268077055'
    paneCalls = 0
    movedCardId = null
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('a session still busy past the timeout produces the alert', async () => {
    await fireAndWaitPastTimeout()

    expect(mockTelegram).toHaveBeenCalled()
  })

  it('NO token suppresses it', async () => {
    envToken = ''
    await fireAndWaitPastTimeout()

    expect(mockTelegram).not.toHaveBeenCalled()
  })

  it('NO owner chat suppresses it', async () => {
    ownerChat = null
    await fireAndWaitPastTimeout()

    expect(mockTelegram).not.toHaveBeenCalled()
  })

  function cardMovedLines() {
    return mockInfo.mock.calls.filter((c) => String(c[1] ?? '').includes('moved to waiting')).length
  }

  it('a MOVED card is reported with its id', async () => {
    movedCardId = 'abc12345'
    await fireAndWaitPastTimeout()

    expect(cardMovedLines()).toBeGreaterThan(0)
    const call = mockInfo.mock.calls.find((c) => String(c[1] ?? '').includes('moved to waiting'))
    expect((call?.[0] as { cardId?: string })?.cardId).toBe('abc12345')
  })

  it('NO matching card means NO claim that one moved', async () => {
    // The other direction: a line saying the board was updated when it was not
    // sends the operator to a card that is still sitting in its old column.
    movedCardId = null
    await fireAndWaitPastTimeout()

    expect(cardMovedLines()).toBe(0)
  })
})
