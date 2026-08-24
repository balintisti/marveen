import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'

// The forceSend context-saturation deferral (schedule-runner.ts, inside the
// `if (task.forceSend)` branch), pinned by BEHAVIOUR rather than by the shape
// of the source text.
//
// Why this file exists (card b4898de5, 2026-08-24). The deferral was guarded
// only by schedule-runner-injection-priority.test.ts, which asserts that the
// strings `paneShowsContextSaturation` and `return 'busy'` both OCCUR inside an
// 1800-character window after `if (task.forceSend) {`. Neither assertion binds
// the two together, and neither binds the DIRECTION of the condition: negating
// it kept the whole suite (332 files / 4464 tests) green. That negation is not
// a theoretical regression -- it restores the 2026-07-17 incident and worsens
// it: a healthy pane would be deferred and a SATURATED one injected, which is
// exactly the silent loss the branch was written to prevent.
//
// The detector itself is already covered behaviourally (pane-state.test.ts,
// `paneShowsContextSaturation` on a real saved capture plus negative controls),
// and the deferral's return value is wired to the retry queue on both call
// paths. The untested piece was the JOIN between them, so that is what this
// file asserts: saturated pane => nothing delivered + a retry queued; healthy
// pane => delivered. The two cases together fix the polarity.
//
// No production code changes: the harness mirrors
// schedule-runner-retry-missing.test.ts, which already module-mocks
// agent-process.js (the module capturePane comes from).

const mockAppendTaskRun = vi.fn()
const mockInsertPendingRetry = vi.fn()
const mockListPendingRetries = vi.fn(() => [] as unknown[])
const mockSendPrompt = vi.fn(() => 'sent')
const mockCapturePane = vi.fn((): string | null => null)
const mockListScheduledTasks = vi.fn(() => [] as ScheduledTask[])

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../web/atomic-write.js', () => ({
  atomicWriteFileSync: vi.fn(),
}))

vi.mock('../db.js', () => ({
  appendTaskRun: (...a: unknown[]) => mockAppendTaskRun(...a),
  listPendingTaskRetries: () => mockListPendingRetries(),
  deletePendingTaskRetry: vi.fn(),
  updatePendingTaskRetry: vi.fn(() => true),
  insertPendingTaskRetryIfNew: (...a: unknown[]) => mockInsertPendingRetry(...a),
  markPendingTaskRetryAlert: vi.fn(() => false),
  clearPendingTaskRetryAlert: vi.fn(),
  markScheduledTaskKanbanWaiting: vi.fn(),
}))

// The runner's alert paths would resolve a REAL bot token from install-level
// config and message the operator. Neutralize the sink: a green suite must
// never cost the operator's attention.
vi.mock('../web/telegram.js', () => ({
  sendTelegramMessage: vi.fn(async () => {}),
  sendTelegramPhoto: vi.fn(async () => {}),
}))

vi.mock('../web/scheduled-tasks-io.js', () => ({
  listScheduledTasks: () => mockListScheduledTasks(),
  SCHEDULED_TASKS_DIR: '/tmp/marveen-force-send-saturation-no-tasks-dir',
}))

vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (name: string) => `agent-${name}`,
  isAgentRunning: () => true,
  // Deliberately NOT ready: forceSend is supposed to bypass the ordinary busy
  // gate, so this also proves the bypass still happens on a healthy pane.
  isSessionReadyForPrompt: () => false,
  sendPromptToSession: (...a: unknown[]) => mockSendPrompt(...(a as [])),
  startAgentProcess: vi.fn(() => ({ ok: true })),
  sessionExistsOnHost: () => true,
  capturePane: () => mockCapturePane(),
  sendEnterToSession: vi.fn(),
  clearStaleParkedInput: vi.fn(() => false),
}))

const SEP = '─'.repeat(80)

// The real capture shape: an idle-looking footer with the saturation banner one
// line above it -- the combination that lets a saturated session keep silently
// accepting dispatches. Same fixture family as pane-state.test.ts.
const SATURATED_PANE = [
  '  some prior assistant output',
  '',
  '✻ Cooked for 3m 7s',
  '                                                              100% context used',
  SEP,
  '❯ ',
  SEP,
  '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
].join('\n')

const HEALTHY_PANE = [
  '',
  SEP,
  '❯ ',
  SEP,
  '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
].join('\n')

const FORCE_TASK: ScheduledTask = {
  name: 'force-send-saturation-fixture',
  description: 'forceSend saturation deferral fixture',
  prompt: 'Do the thing.',
  schedule: '30 10 * * *',
  agent: 'forceagent',
  enabled: true,
  createdAt: 0,
  type: 'heartbeat',
  forceSend: true,
  targetSession: 'force-saturation-session',
}

async function runOneTick() {
  vi.resetModules()
  const { startScheduleRunner } = await import('../web/schedule-runner.js')
  const stop = startScheduleRunner()
  await vi.advanceTimersByTimeAsync(61_000)
  clearInterval(stop)
}

describe('forceSend defers on a context-saturated pane instead of injecting', () => {
  beforeEach(() => {
    vi.stubEnv('SCHEDULER_TZ', 'Europe/Budapest')
    vi.clearAllMocks()
    vi.useFakeTimers()
    // One minute before the fixture's cron occurrence, so the tick 61s later
    // lands exactly on it.
    vi.setSystemTime(new Date('2026-07-31T08:29:30.000Z'))
    mockListScheduledTasks.mockReturnValue([FORCE_TASK])
    mockListPendingRetries.mockReturnValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('a SATURATED pane is never injected into -- the prompt is queued for retry', async () => {
    mockCapturePane.mockReturnValue(SATURATED_PANE)
    await runOneTick()

    expect(mockSendPrompt).not.toHaveBeenCalled()
    expect(mockInsertPendingRetry).toHaveBeenCalledWith(
      FORCE_TASK.name,
      'forceagent',
      expect.any(Number),
      'busy',
    )
    // A deferral must not be recorded as a delivery.
    const firedRuns = mockAppendTaskRun.mock.calls.filter((c) => c[2] === 'fired')
    expect(firedRuns).toEqual([])
  })

  it('a HEALTHY pane IS injected into -- forceSend still bypasses the ordinary busy gate', async () => {
    mockCapturePane.mockReturnValue(HEALTHY_PANE)
    await runOneTick()

    expect(mockSendPrompt).toHaveBeenCalled()
    // Assert the absence of the SATURATION deferral specifically, not of every
    // retry: the post-send resubmit check independently queues a
    // 'lost-injection' row here, because the mocked pane never echoes the
    // prompt back. That is a different mechanism, and asserting "no retry at
    // all" would couple this file to it.
    const busyDeferrals = mockInsertPendingRetry.mock.calls.filter((c) => c[3] === 'busy')
    expect(busyDeferrals).toEqual([])
  })
})
