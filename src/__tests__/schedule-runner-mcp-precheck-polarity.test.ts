import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'

// The MCP pre-check deferral (schedule-runner.ts, the
// `if (!check.ok)` / `if (task.forceSend)` pair), pinned by BEHAVIOUR.
//
// Why this file exists (card 9fc38d4b, 2026-08-24). A polarity sweep over the
// runner mutated every single-line `if` condition in turn and ran the full
// suite: 32 of 64 survived, meaning nothing in the repo asserts which way they
// point. Two of the survivors are these, and they carry the same weight as the
// forceSend saturation deferral fixed in b4898de5 -- this branch also exists
// because of a real incident (2026-07-08: the morning briefing ran against a
// silently dead gmail MCP server).
//
// Inverting `!check.ok` defers the task when the required MCP server is ALIVE
// and delivers when it is DEAD -- precisely backwards, and silent.
// Inverting `task.forceSend` inside it swaps which kind of task gets to ignore
// a dead dependency.
//
// Both conditions need BOTH directions asserted: a test that only proves
// "missing => deferred" would also pass on code that always defers, and one
// that only proves "present => delivered" would pass on code that never
// defers. Three cases pin both conditions.
//
// No production code changes. Harness per schedule-runner-retry-missing.test.ts.

const mockAppendTaskRun = vi.fn()
const mockInsertPendingRetry = vi.fn()
const mockListPendingRetries = vi.fn(() => [] as unknown[])
const mockSendPrompt = vi.fn(() => 'sent')
const mockListScheduledTasks = vi.fn(() => [] as ScheduledTask[])
const mockMcpCheck = vi.fn(() => ({ ok: true, missing: [] as string[], unknown: [] as string[] }))

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../web/atomic-write.js', () => ({ atomicWriteFileSync: vi.fn() }))

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

vi.mock('../web/telegram.js', () => ({
  sendTelegramMessage: vi.fn(async () => {}),
  sendTelegramPhoto: vi.fn(async () => {}),
}))

vi.mock('../web/scheduled-tasks-io.js', () => ({
  listScheduledTasks: () => mockListScheduledTasks(),
  SCHEDULED_TASKS_DIR: '/tmp/marveen-mcp-precheck-no-tasks-dir',
}))

vi.mock('../web/schedule-mcp-precheck.js', () => ({
  checkTaskMcpRequirements: () => mockMcpCheck(),
}))

const SEP = '─'.repeat(80)
const HEALTHY_PANE = ['', SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on (shift+tab to cycle)'].join('\n')

vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (name: string) => `agent-${name}`,
  isAgentRunning: () => true,
  // Ready, so a non-forceSend task reaches the MCP check instead of stopping at
  // the ordinary busy gate above it.
  isSessionReadyForPrompt: () => true,
  sendPromptToSession: (...a: unknown[]) => mockSendPrompt(...(a as [])),
  startAgentProcess: vi.fn(() => ({ ok: true })),
  sessionExistsOnHost: () => true,
  capturePane: () => HEALTHY_PANE,
  sendEnterToSession: vi.fn(),
  clearStaleParkedInput: vi.fn(() => false),
}))

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    name: 'mcp-precheck-polarity-fixture',
    description: 'MCP pre-check polarity fixture',
    prompt: 'Do the thing.',
    schedule: '30 10 * * *',
    agent: 'mcpagent',
    enabled: true,
    createdAt: 0,
    type: 'task',
    targetSession: 'mcp-precheck-session',
    requires: { mcp_servers: ['gmail'] },
    ...overrides,
  } as ScheduledTask
}

async function runOneTick() {
  vi.resetModules()
  const { startScheduleRunner } = await import('../web/schedule-runner.js')
  const stop = startScheduleRunner()
  await vi.advanceTimersByTimeAsync(61_000)
  clearInterval(stop)
}

describe('MCP pre-check: a dead dependency defers, a live one delivers', () => {
  beforeEach(() => {
    vi.stubEnv('SCHEDULER_TZ', 'Europe/Budapest')
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T08:29:30.000Z'))
    mockListPendingRetries.mockReturnValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('a MISSING required server defers the task -- nothing is delivered', async () => {
    mockListScheduledTasks.mockReturnValue([task()])
    mockMcpCheck.mockReturnValue({ ok: false, missing: ['gmail'], unknown: [] })
    await runOneTick()

    expect(mockSendPrompt).not.toHaveBeenCalled()
    const reasons = mockInsertPendingRetry.mock.calls.map((c) => String(c[3]))
    expect(reasons.some((r) => r.startsWith('mcp-missing'))).toBe(true)
  })

  it('a LIVE required server delivers -- this is the half that fixes the polarity', async () => {
    mockListScheduledTasks.mockReturnValue([task()])
    mockMcpCheck.mockReturnValue({ ok: true, missing: [], unknown: [] })
    await runOneTick()

    expect(mockSendPrompt).toHaveBeenCalled()
    const reasons = mockInsertPendingRetry.mock.calls.map((c) => String(c[3]))
    expect(reasons.some((r) => r.startsWith('mcp-missing'))).toBe(false)
  })

  it('forceSend delivers ANYWAY on a missing server -- the loud-gap contract', async () => {
    mockListScheduledTasks.mockReturnValue([task({ forceSend: true })])
    mockMcpCheck.mockReturnValue({ ok: false, missing: ['gmail'], unknown: [] })
    await runOneTick()

    expect(mockSendPrompt).toHaveBeenCalled()
    const reasons = mockInsertPendingRetry.mock.calls.map((c) => String(c[3]))
    expect(reasons.some((r) => r.startsWith('mcp-missing'))).toBe(false)
  })
})
