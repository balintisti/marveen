import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'

// The post-fire watchdog's TURN-EVIDENCE branch (schedule-runner.ts:
// `if (!entry.sawTurn)` and the `state === 'busy'` test inside it), pinned by
// behaviour through real ticks.
//
// Why this file exists (card 9fc38d4b, 2026-08-24). The polarity sweep found
// both conditions among the 32 whose direction nothing in the repo asserts.
// These two are not bookkeeping: they decide whether a delivered task is
// declared LOST. Inverted, `!entry.sawTurn` means sawTurn can never be set
// from false, so EVERY injection eventually looks like it never started a
// turn -- the runner would overwrite good run records with 'lost' and re-queue
// work that already ran. Inverted, `state === 'busy'` throws away the direct
// observation and leaves only the transcript-mtime fallback.
//
// The decision function (decideTaskTimeout) is already covered as a pure unit.
// What was unmeasured is the evidence-gathering that feeds it -- the same
// split this card keeps finding: a proven core joined to the caller by prose.
//
// Three cases, so the two conditions are told apart rather than both being
// caught by one:
//   busy pane      -> evidence via the direct observation  (kills `=== 'busy'`)
//   idle + fresh transcript -> evidence via the mtime fallback (kills `!sawTurn`)
//   idle + nothing -> no evidence, and past the grace window the task IS lost
//
// No production code changes.

const mockAppendTaskRun = vi.fn()
const mockInsertPendingRetry = vi.fn()
const mockSendPrompt = vi.fn((..._a: unknown[]) => 'sent')
const mockListScheduledTasks = vi.fn(() => [] as ScheduledTask[])
const mockCapturePane = vi.fn((): string | null => null)
const mockTranscriptMtime = vi.fn((): number | null => null)

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../web/atomic-write.js', () => ({ atomicWriteFileSync: vi.fn() }))

vi.mock('../db.js', () => ({
  appendTaskRun: (...a: unknown[]) => mockAppendTaskRun(...a),
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
  SCHEDULED_TASKS_DIR: '/tmp/marveen-turn-evidence-no-tasks-dir',
}))

vi.mock('../web/active-model.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../web/active-model.js')>()),
  readTranscriptMtimeFromProjectDir: () => mockTranscriptMtime(),
}))

const SEP = '─'.repeat(80)
const IDLE_PANE = ['', SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on (shift+tab to cycle)'].join('\n')
const BUSY_PANE = ['✻ Cooked for 1m 2s (esc to interrupt)', SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on'].join('\n')

vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (name: string) => `agent-${name}`,
  isAgentRunning: () => true,
  isSessionReadyForPrompt: () => true,
  sendPromptToSession: (...a: unknown[]) => mockSendPrompt(...(a as [])),
  startAgentProcess: vi.fn(() => ({ ok: true })),
  sessionExistsOnHost: () => true,
  capturePane: () => mockCapturePane(),
  sendEnterToSession: vi.fn(),
  clearStaleParkedInput: vi.fn(() => false),
}))

const TASK: ScheduledTask = {
  name: 'turn-evidence-fixture',
  description: 'post-fire turn evidence fixture',
  prompt: 'Do the thing.',
  schedule: '30 10 * * *',
  agent: 'turnagent',
  enabled: true,
  createdAt: 0,
  type: 'task',
  targetSession: 'turn-evidence-session',
} as ScheduledTask

let runner: { stop: ReturnType<typeof setInterval> } | null = null

async function fireThenSweep(sweepMs: number) {
  vi.resetModules()
  const { startScheduleRunner } = await import('../web/schedule-runner.js')
  const stop = startScheduleRunner()
  runner = { stop }
  // First tick lands on the cron occurrence and delivers the prompt.
  await vi.advanceTimersByTimeAsync(61_000)
  expect(mockSendPrompt).toHaveBeenCalled()
  // Subsequent ticks are the watchdog sweeps over the in-flight entry.
  await vi.advanceTimersByTimeAsync(sweepMs)
  clearInterval(stop)
  runner = null
}

function lostRuns() {
  return mockAppendTaskRun.mock.calls.filter((c) => c[2] === 'lost')
}
function lostRetries() {
  return mockInsertPendingRetry.mock.calls.filter((c) => String(c[3]) === 'lost-injection')
}

describe('post-fire watchdog: a task is declared lost only with NO evidence of a turn', () => {
  beforeEach(() => {
    vi.stubEnv('SCHEDULER_TZ', 'Europe/Budapest')
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T08:29:30.000Z'))
    mockListScheduledTasks.mockReturnValue([TASK])
    mockCapturePane.mockReturnValue(IDLE_PANE)
    mockTranscriptMtime.mockReturnValue(null)
  })

  afterEach(() => {
    if (runner) clearInterval(runner.stop)
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('a BUSY pane is direct evidence -- and it still protects the task once the pane goes idle', async () => {
    // The pane must go busy and then IDLE. A pane that merely stays busy proves
    // nothing here: decideTaskTimeout cannot return 'lost' while it is busy, so
    // the assertion would hold even with the evidence branch broken. The idle
    // tail is what makes this case load-bearing -- that is where a task with no
    // recorded turn gets declared lost.
    let sweep = 0
    mockCapturePane.mockImplementation(() => {
      sweep += 1
      if (sweep === 1) return IDLE_PANE // the readiness/fire sample
      if (sweep <= 4) return BUSY_PANE // the turn actually starts
      return IDLE_PANE // and finishes: from here on the watchdog sees idle
    })
    await fireThenSweep(120_000)

    expect(lostRuns()).toEqual([])
    expect(lostRetries()).toEqual([])
  })

  it('a fresh TRANSCRIPT is evidence too, on a pane that never looked busy', async () => {
    mockCapturePane.mockReturnValue(IDLE_PANE)
    // Written after the injection: the turn ran and finished between sweeps.
    mockTranscriptMtime.mockReturnValue(new Date('2026-07-31T23:00:00.000Z').getTime())
    await fireThenSweep(120_000)

    expect(lostRuns()).toEqual([])
    expect(lostRetries()).toEqual([])
  })

  it('NO evidence past the grace window IS a loss -- recorded and re-queued', async () => {
    mockCapturePane.mockReturnValue(IDLE_PANE)
    mockTranscriptMtime.mockReturnValue(null)
    await fireThenSweep(120_000)

    expect(lostRuns().length).toBeGreaterThan(0)
    expect(lostRetries().length).toBeGreaterThan(0)
  })
})
