import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'

// Restoring the persisted last-run map across a restart (schedule-runner.ts,
// the `raw && typeof raw === 'object'` guard in loadScheduleLastRun).
//
// Why (card 9fc38d4b): it survives a polarity inversion against the full suite,
// and like the run-now queue it is not an alert -- it is what stops a restart
// from re-firing work that already ran. The cron loop skips an occurrence whose
// recorded run falls inside the scan window; with the map never populated, that
// guard has nothing to consult and every occurrence inside the start-up window
// fires a second time.
//
// Two cases, one knob: the same tick, with and without a restored stamp.
//
// No production code changes.

const mockSendPrompt = vi.fn((..._a: unknown[]) => 'sent')
const mockListScheduledTasks = vi.fn(() => [] as ScheduledTask[])
let lastRunFile: string | null = null

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../web/atomic-write.js', () => ({ atomicWriteFileSync: vi.fn() }))

vi.mock('../db.js', () => ({
  appendTaskRun: vi.fn(),
  listPendingTaskRetries: () => [],
  deletePendingTaskRetry: vi.fn(),
  updatePendingTaskRetry: vi.fn(() => true),
  insertPendingTaskRetryIfNew: vi.fn(),
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
  SCHEDULED_TASKS_DIR: '/tmp/marveen-last-run-no-tasks-dir',
}))

// Only the one file the restore reads is redirected; every other readFileSync
// in the import graph keeps the real implementation. Replacing node:fs wholesale
// would change far more than the thing under test.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    readFileSync: (p: unknown, ...rest: unknown[]) => {
      if (typeof p === 'string' && p.endsWith('schedule-last-run.json')) {
        if (lastRunFile == null) throw new Error('ENOENT: no such file')
        return lastRunFile
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(p, ...rest)
    },
  }
})

const SEP = '─'.repeat(80)
const IDLE_PANE = ['', SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on (shift+tab to cycle)'].join('\n')

vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (name: string) => `agent-${name}`,
  isAgentRunning: () => true,
  isSessionReadyForPrompt: () => true,
  sendPromptToSession: (...a: unknown[]) => mockSendPrompt(...(a as [])),
  startAgentProcess: vi.fn(() => ({ ok: true })),
  sessionExistsOnHost: () => true,
  capturePane: () => IDLE_PANE,
  sendEnterToSession: vi.fn(),
  clearStaleParkedInput: vi.fn(() => false),
}))

const TASK: ScheduledTask = {
  name: 'last-run-restore-fixture',
  description: 'last-run restore fixture',
  prompt: 'Do the thing.',
  schedule: '30 10 * * *',
  agent: 'restoreagent',
  enabled: true,
  createdAt: 0,
  type: 'task',
  targetSession: 'last-run-restore-session',
} as ScheduledTask

// Start-up at 10:40 local: the 10:30 occurrence is inside the 30-minute
// cold-start scan window, so it is a catch-up candidate -- unless the restored
// map says it already ran.
const START = '2026-07-31T08:40:00.000Z'

async function runOneTick() {
  vi.resetModules()
  const { startScheduleRunner } = await import('../web/schedule-runner.js')
  const stop = startScheduleRunner()
  await vi.advanceTimersByTimeAsync(61_000)
  clearInterval(stop)
}

describe('a restart does not re-fire what already ran', () => {
  beforeEach(() => {
    vi.stubEnv('SCHEDULER_TZ', 'Europe/Budapest')
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    mockListScheduledTasks.mockReturnValue([TASK])
    lastRunFile = null
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('a RESTORED stamp inside the scan window suppresses the catch-up', async () => {
    // Recorded as run at 10:35 local -- after the window opened at 10:10.
    lastRunFile = JSON.stringify({ [TASK.name]: new Date('2026-07-31T08:35:00.000Z').getTime() })
    await runOneTick()

    expect(mockSendPrompt).not.toHaveBeenCalled()
  })

  it('with NO stored map the same occurrence IS caught up', async () => {
    lastRunFile = null
    await runOneTick()

    expect(mockSendPrompt).toHaveBeenCalled()
  })
})
