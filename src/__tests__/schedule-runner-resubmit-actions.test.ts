import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'

// The post-send resubmit escalation (schedule-runner.ts: the `action ===
// 'giveup'` and `action === 'reinject'` branches, and the
// `await clearStaleParkedInput(...)` choice inside reinject), pinned by
// behaviour on a pane that keeps the prompt parked.
//
// Why (card 9fc38d4b): all three survive a polarity inversion against the full
// suite. The escalation exists because a swallowed Enter leaves a prompt typed
// but never submitted, while the run-log already says 'fired' -- the silent
// lost task the giveup branch compensates for. Inverted, the compensation is
// queued when the prompt DID submit and skipped when it did not; and the
// reinject branch types a fresh prompt on top of an input box it failed to
// clear, which is how a duplicated span gets into someone's session.
//
// decideScheduledResubmitAction is already covered as a pure unit. Unmeasured
// was what the caller DOES with each verdict.
//
// No production code changes.

const mockSendPrompt = vi.fn(async (..._a: unknown[]) => 'sent')
// Invocation ORDER, not wall-clock windows: the escalation chain is a detached
// timer whose steps interleave with the tick advance, so "advance N ms and
// count" cannot separate the early bare-Enter attempts from the later
// re-injections. Which came FIRST can.
const order: string[] = []
const mockSendEnter = vi.fn((..._a: unknown[]) => { order.push('enter') })
const mockClearParked = vi.fn(async (..._a: unknown[]) => { order.push('clear'); return clearResult })
let clearResult = true
const mockInsertPendingRetry = vi.fn()
const mockListScheduledTasks = vi.fn(() => [] as ScheduledTask[])
const mockCapturePane = vi.fn((): string | null => null)

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
  SCHEDULED_TASKS_DIR: '/tmp/marveen-resubmit-actions-no-tasks-dir',
}))

vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (name: string) => `agent-${name}`,
  isAgentRunning: () => true,
  isSessionReadyForPrompt: () => true,
  sendPromptToSession: (...a: unknown[]) => mockSendPrompt(...(a as [])),
  startAgentProcess: vi.fn(() => ({ ok: true })),
  sessionExistsOnHost: () => true,
  capturePane: () => mockCapturePane(),
  sendEnterToSession: (...a: unknown[]) => mockSendEnter(...a),
  clearStaleParkedInput: (...a: unknown[]) => mockClearParked(...(a as [])),
}))

const SEP = '─'.repeat(80)
const TASK_NAME = 'resubmit-actions-fixture'
// The prompt typed into the box but never submitted: idle pane, marker sitting
// in the input region after the prompt glyph. This is exactly what
// isScheduledPromptStuck looks for.
const PARKED_PANE = [
  '  earlier output',
  SEP,
  `❯ [Utemezett feladat: ${TASK_NAME}] Az eredmenyt kuldd el`,
  SEP,
  '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
].join('\n')

// The same pane AFTER a normal submit: the input box is empty, so nothing is
// stuck and no escalation should happen at all.
const SUBMITTED_PANE = [
  `  [Utemezett feladat: ${TASK_NAME}] Az eredmenyt kuldd el`,
  '  (running)',
  SEP,
  '❯ ',
  SEP,
  '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
].join('\n')

const TASK: ScheduledTask = {
  name: TASK_NAME,
  description: 'resubmit escalation fixture',
  prompt: 'Do the thing.',
  schedule: '30 10 * * *',
  agent: 'resubagent',
  enabled: true,
  createdAt: 0,
  type: 'task',
  targetSession: 'resubmit-actions-session',
} as ScheduledTask

async function fireAndEscalate(ms: number) {
  vi.resetModules()
  const { startScheduleRunner } = await import('../web/schedule-runner.js')
  const stop = startScheduleRunner()
  await vi.advanceTimersByTimeAsync(61_000)
  expect(mockSendPrompt).toHaveBeenCalled()
  // The resubmit chain is a detached timer: 2s to the first probe, then 3s per
  // escalation step.
  await vi.advanceTimersByTimeAsync(ms)
  clearInterval(stop)
}

function giveupRetries() {
  return mockInsertPendingRetry.mock.calls.filter((c) => String(c[3]) === 'giveup')
}

describe('post-send resubmit: what the caller DOES with each verdict', () => {
  beforeEach(() => {
    vi.stubEnv('SCHEDULER_TZ', 'Europe/Budapest')
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T08:29:30.000Z'))
    mockListScheduledTasks.mockReturnValue([TASK])
    mockCapturePane.mockReturnValue(PARKED_PANE)
    order.length = 0
    clearResult = true
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('a prompt that stays parked to the end queues the giveup compensation', async () => {
    await fireAndEscalate(40_000)

    // Without this row the run-log says 'fired' for a task that never ran.
    expect(giveupRetries().length).toBeGreaterThan(0)
    expect(giveupRetries()[0]?.[0]).toBe(TASK_NAME)
  })

  it('a SUBMITTED prompt escalates nothing -- no keystrokes, no giveup row', async () => {
    // Guards the 'none' verdict: a submitted prompt must cost no keystrokes.
    // Stated plainly so it is not mistaken for the pin -- measured, this case
    // does NOT discriminate any of the three conditions this file targets
    // (with the giveup branch inverted it never reaches that branch at all).
    // It is here because escalating on an already-submitted prompt is its own
    // bug, not because it carries the polarity.
    mockCapturePane.mockReturnValue(SUBMITTED_PANE)
    await fireAndEscalate(40_000)

    expect(giveupRetries()).toEqual([])
    expect(mockSendEnter).not.toHaveBeenCalled()
    expect(mockClearParked).not.toHaveBeenCalled()
    expect(mockSendPrompt.mock.calls.length).toBe(1)
  })

  it('the EARLY attempts are bare Enter -- the box is only cleared later', async () => {
    // Pins WHICH verdict does what. Over a whole chain the TOTALS cannot tell
    // 'enter' from 'reinject' apart, because both eventually happen; the ORDER
    // can. Measured: without this case, inverting the reinject branch left
    // every other assertion in this file green.
    await fireAndEscalate(40_000)

    expect(order).toContain('enter')
    expect(order).toContain('clear')
    expect(order.indexOf('enter')).toBeLessThan(order.indexOf('clear'))
  })

  it('reinject RE-TYPES the prompt when the box was actually cleared', async () => {
    clearResult = true
    await fireAndEscalate(40_000)

    expect(mockClearParked).toHaveBeenCalled()
    // One delivery + at least one re-injection.
    expect(mockSendPrompt.mock.calls.length).toBeGreaterThan(1)
  })

  it('a REFUSED clear falls back to a bare Enter -- never re-types onto a box it could not empty', async () => {
    clearResult = false
    await fireAndEscalate(40_000)

    expect(mockClearParked).toHaveBeenCalled()
    // Exactly the original delivery: re-typing over an uncleared box is how a
    // duplicated span reaches the session.
    expect(mockSendPrompt.mock.calls.length).toBe(1)
    expect(mockSendEnter).toHaveBeenCalled()
  })
})
