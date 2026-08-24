import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'

// The `lateCatchUpMs != null` branch that chooses between the 'fired_late' and
// 'fired' run statuses, pinned by behaviour (card 9fc38d4b).
//
// Why this is worth a test even though it only writes a LABEL: the run-log is
// the evidence base later claims are built on. On 2026-08-24 the four-tick
// closure condition on card e4157868 was settled with exactly this field
// ("5 expected ticks / 5 fired"). Inverted, that evidence would have read
// 'fired' for ticks that were actually late catch-ups, and 'fired_late' for
// the on-time ones. Nothing in the running system breaks -- the record of what
// the running system did does.
//
// It was originally deferred as needing a redirected PROJECT_ROOT to fake a
// stale tick-state file. That was wrong, and cheaply so: with no stamp on disk
// the runner takes its cold-start window (30 minutes), so an occurrence placed
// a few minutes in the past at start-up reaches the catch-up path with no file
// mocking at all.
//
// No production code changes.

const mockAppendTaskRun = vi.fn()
const mockSendPrompt = vi.fn((..._a: unknown[]) => 'sent')
const mockListScheduledTasks = vi.fn(() => [] as ScheduledTask[])

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../web/atomic-write.js', () => ({ atomicWriteFileSync: vi.fn() }))

vi.mock('../db.js', () => ({
  appendTaskRun: (...a: unknown[]) => mockAppendTaskRun(...a),
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
  SCHEDULED_TASKS_DIR: '/tmp/marveen-late-catchup-no-tasks-dir',
}))

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

// 10:30 Europe/Budapest daily (the fixtures below use the matching UTC
// instants, +02:00 in July), mirroring the harness the other files use. The two cases differ ONLY in where the clock stands when the
// runner starts, so the status is the only thing that can explain the change.
const TASK: ScheduledTask = {
  name: 'late-catchup-fixture',
  description: 'late catch-up status fixture',
  prompt: 'Do the thing.',
  schedule: '30 10 * * *',
  agent: 'lateagent',
  enabled: true,
  createdAt: 0,
  type: 'task',
  targetSession: 'late-catchup-session',
} as ScheduledTask

async function runFromClock(iso: string) {
  vi.setSystemTime(new Date(iso))
  vi.resetModules()
  const { startScheduleRunner } = await import('../web/schedule-runner.js')
  const stop = startScheduleRunner()
  await vi.advanceTimersByTimeAsync(61_000)
  clearInterval(stop)
}

function statuses() {
  return mockAppendTaskRun.mock.calls.map((c) => String(c[2]))
}

describe('run status distinguishes a catch-up from an on-time fire', () => {
  beforeEach(() => {
    vi.stubEnv('SCHEDULER_TZ', 'Europe/Budapest')
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockListScheduledTasks.mockReturnValue([TASK])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('an occurrence recovered from the start-up window is recorded as fired_late', async () => {
    // Started at 10:40: the 10:30 occurrence is ~11 minutes old by the first
    // tick -- past the 90s late threshold, inside the 180-minute task budget.
    await runFromClock('2026-07-31T08:40:00.000Z')

    expect(mockSendPrompt).toHaveBeenCalled()
    expect(statuses()).toContain('fired_late')
    expect(statuses()).not.toContain('fired')
  })

  it('an occurrence hit inside the tick window is an ordinary fired', async () => {
    // Started at 10:29:30: the tick 61s later lands on 10:30 itself.
    await runFromClock('2026-07-31T08:29:30.000Z')

    expect(mockSendPrompt).toHaveBeenCalled()
    expect(statuses()).toContain('fired')
    expect(statuses()).not.toContain('fired_late')
  })
})
