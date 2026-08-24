import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'

// runScheduledTaskNow's retry-queue mapping (schedule-runner.ts, the
// `result === 'starting' || 'busy' || 'mcp-missing' || 'first-run'` check).
//
// Why (card 9fc38d4b): it survives a polarity inversion against the full suite,
// and unlike the rest of the remainder it is not an alert -- it is the queue
// that makes a manual run eventually land. Inverted, a run-now that could not
// be delivered gets NO retry row (the request is silently dropped, and the
// caller was told 'busy' as if that were the end of it), while a run that DID
// deliver gets one (a second delivery of work that already ran).
//
// The comment above the branch states the intent -- a manual run always wants
// delivery, and deliberately ignores skipIfBusy. Nothing asserted it.
//
// Two cases, because one direction cannot pin a polarity: undeliverable queues,
// delivered does not.
//
// No production code changes.

const mockInsertPendingRetry = vi.fn()
const mockListScheduledTasks = vi.fn(() => [] as ScheduledTask[])
const mockSendPrompt = vi.fn((..._a: unknown[]) => 'sent')
let sessionReady = false

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../web/atomic-write.js', () => ({ atomicWriteFileSync: vi.fn() }))

vi.mock('../db.js', () => ({
  appendTaskRun: vi.fn(),
  listPendingTaskRetries: () => [],
  deletePendingTaskRetry: vi.fn(),
  updatePendingTaskRetry: vi.fn(() => true),
  insertPendingTaskRetryIfNew: (...a: unknown[]) => mockInsertPendingRetry(...a),
  markPendingTaskRetryAlert: vi.fn(() => false),
  clearPendingTaskRetryAlert: vi.fn(),
  markScheduledTaskKanbanWaiting: vi.fn(),
}))

vi.mock('../web/telegram.js', () => ({
  sendTelegramMessage: vi.fn(async () => {}),
  sendTelegramPhoto: vi.fn(async () => {}),
}))

vi.mock('../web/scheduled-tasks-io.js', () => ({
  listScheduledTasks: () => mockListScheduledTasks(),
  SCHEDULED_TASKS_DIR: '/tmp/marveen-run-now-no-tasks-dir',
}))

const SEP = '─'.repeat(80)
const IDLE_PANE = ['', SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on (shift+tab to cycle)'].join('\n')

vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (name: string) => `agent-${name}`,
  isAgentRunning: () => true,
  // The single knob: a session that is not ready makes the fire report 'busy'.
  isSessionReadyForPrompt: () => sessionReady,
  sendPromptToSession: (...a: unknown[]) => mockSendPrompt(...(a as [])),
  startAgentProcess: vi.fn(() => ({ ok: true })),
  sessionExistsOnHost: () => true,
  capturePane: () => IDLE_PANE,
  sendEnterToSession: vi.fn(),
  clearStaleParkedInput: vi.fn(() => false),
}))

const TASK: ScheduledTask = {
  name: 'run-now-retry-fixture',
  description: 'run-now retry queue fixture',
  prompt: 'Do the thing.',
  schedule: '30 10 * * *',
  agent: 'runnowagent',
  enabled: true,
  createdAt: 0,
  type: 'task',
  targetSession: 'run-now-session',
} as ScheduledTask

async function runNow() {
  vi.resetModules()
  const { runScheduledTaskNow } = await import('../web/schedule-runner.js')
  return runScheduledTaskNow(TASK.name)
}

function retriesFor(reason: string) {
  return mockInsertPendingRetry.mock.calls.filter((c) => String(c[3]) === reason)
}

describe('run-now always leaves a way for the work to land', () => {
  beforeEach(() => {
    vi.stubEnv('SCHEDULER_TZ', 'Europe/Budapest')
    vi.clearAllMocks()
    mockListScheduledTasks.mockReturnValue([TASK])
    sessionReady = false
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('an UNDELIVERABLE run-now queues a retry -- the request is not dropped', async () => {
    sessionReady = false
    const res = await runNow()

    expect(res.ok).toBe(true)
    expect(res.result).toContain('busy')
    expect(mockSendPrompt).not.toHaveBeenCalled()
    expect(retriesFor('busy').length).toBe(1)
  })

  it('a DELIVERED run-now queues nothing -- no second delivery of work that ran', async () => {
    sessionReady = true
    const res = await runNow()

    expect(res.ok).toBe(true)
    expect(mockSendPrompt).toHaveBeenCalled()
    expect(mockInsertPendingRetry).not.toHaveBeenCalled()
  })
})
