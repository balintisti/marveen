import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'

// The tick-stamp write interval (schedule-runner.ts,
// `now - lastPersistedTickMs >= TICK_STATE_PERSIST_INTERVAL_MS`).
//
// Why (card 9fc38d4b): it survives a polarity inversion against the full suite.
// I first filed it under "loses state silently" on the assumption that
// inverting it would stop the stamp being refreshed. Working the inversion
// through before measuring shows the opposite: with the comparison flipped the
// branch fires whenever LESS than the interval has passed, and since it updates
// the stamp on every write, the gap never grows -- so it writes on EVERY tick
// instead of every fourth. The stamp stays fresh; what breaks is write volume.
//
// That makes this a wear guard, not a correctness one, and it belongs at the
// back of the remaining list rather than the front. The source comment says the
// same thing: writing on every 15s tick would be 5.7k atomic writes a day.
//
// Two-sided on purpose: a lower bound so the assertion cannot pass on a runner
// that never writes at all, and an upper bound that is what the interval buys.
//
// No production code changes.

const mockAtomicWrite = vi.fn((..._a: unknown[]) => {})
const mockListScheduledTasks = vi.fn(() => [] as ScheduledTask[])

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../web/atomic-write.js', () => ({
  atomicWriteFileSync: (...a: unknown[]) => mockAtomicWrite(...a),
}))

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
  SCHEDULED_TASKS_DIR: '/tmp/marveen-tick-stamp-no-tasks-dir',
}))

vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (name: string) => `agent-${name}`,
  isAgentRunning: () => true,
  isSessionReadyForPrompt: () => true,
  sendPromptToSession: vi.fn(() => 'sent'),
  startAgentProcess: vi.fn(() => ({ ok: true })),
  sessionExistsOnHost: () => true,
  capturePane: () => null,
  sendEnterToSession: vi.fn(),
  clearStaleParkedInput: vi.fn(() => false),
}))

function tickStampWrites() {
  return mockAtomicWrite.mock.calls.filter((c) => String(c[0]).endsWith('schedule-tick-state.json')).length
}

describe('the liveness stamp is written on an interval, not on every tick', () => {
  beforeEach(() => {
    vi.stubEnv('SCHEDULER_TZ', 'Europe/Budapest')
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T08:00:00.000Z'))
    // No due task in the window: only the tick machinery runs.
    mockListScheduledTasks.mockReturnValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('five minutes of ticks produce interval-spaced writes, not one per tick', async () => {
    vi.resetModules()
    const { startScheduleRunner, SCHEDULE_TICK_MS } = await import('../web/schedule-runner.js')
    const stop = startScheduleRunner()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    clearInterval(stop)

    const ticks = Math.floor((5 * 60_000) / SCHEDULE_TICK_MS)
    const writes = tickStampWrites()

    // Lower bound: the runner must record liveness at all. Without this the
    // upper bound alone would pass on a runner that never writes.
    expect(writes).toBeGreaterThan(1)
    // Upper bound: this is what the interval buys. One write per tick is the
    // volume the constant exists to avoid.
    expect(writes).toBeLessThan(ticks / 2)
  })
})
