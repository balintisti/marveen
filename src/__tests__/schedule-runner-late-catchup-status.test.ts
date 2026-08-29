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
const mockTelegram = vi.fn(async (..._a: unknown[]) => {})
let envToken = 'TELEGRAM_BOT_TOKEN=123:abc'
let ownerChat: string | null = '1268077055'

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
  sendTelegramMessage: (...a: unknown[]) => mockTelegram(...a),
  sendTelegramPhoto: vi.fn(async () => {}),
}))

// The alert's two config gates. Both read outside the repo (an .env file and
// the channel access.json), so the test controls the readers rather than the
// filesystem.
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
    envToken = 'TELEGRAM_BOT_TOKEN=123:abc'
    ownerChat = '1268077055'
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

  it('the catch-up summary names what was recovered', async () => {
    await runFromClock('2026-07-31T08:40:00.000Z')

    expect(mockTelegram).toHaveBeenCalled()
    const text = mockTelegram.mock.calls.map((c) => String(c[2] ?? c[1] ?? '')).join('\n')
    expect(text).toContain('Pótlás elindítva')
    expect(text).toContain(TASK.name)
  })

  it('an occurrence PAST its budget is reported as stale, not silently dropped', async () => {
    // The start-up scan window is 30 minutes, so anything older is never even
    // seen -- a task type whose own budget is also 30 minutes can therefore
    // never be reported stale. The per-task override is what makes the state
    // reachable at all: budget 5 minutes, occurrence 20 minutes old, so it is
    // inside the window and past its budget.
    mockListScheduledTasks.mockReturnValue([{ ...TASK, catchUpMaxAgeMinutes: 5 } as ScheduledTask])
    await runFromClock('2026-07-31T08:50:00.000Z')

    expect(mockSendPrompt).not.toHaveBeenCalled()
    const text = mockTelegram.mock.calls.map((c) => String(c[2] ?? c[1] ?? '')).join('\n')
    expect(text).toContain('Nem pótolva, mert elavult')
    expect(text).toContain(TASK.name)
  })

  it('NO token suppresses the summary instead of half-sending it', async () => {
    // A config gap must not become a delivery attempt with an empty token: the
    // operator hears nothing either way, but a suppressed send leaves a warn
    // and no failed HTTP call.
    envToken = ''
    await runFromClock('2026-07-31T08:40:00.000Z')

    expect(mockTelegram).not.toHaveBeenCalled()
  })

  it('NO owner chat suppresses it too -- never guess a recipient for an alert', async () => {
    ownerChat = null
    await runFromClock('2026-07-31T08:40:00.000Z')

    expect(mockTelegram).not.toHaveBeenCalled()
  })

  it('an occurrence hit inside the tick window is an ordinary fired', async () => {
    // Started at 10:29:30: the tick 61s later lands on 10:30 itself.
    await runFromClock('2026-07-31T08:29:30.000Z')

    expect(mockSendPrompt).toHaveBeenCalled()
    expect(statuses()).toContain('fired')
    expect(statuses()).not.toContain('fired_late')
  })
})
