import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The three start-up warnings in startScheduleRunner (card 9fc38d4b): the cron
// timezone falling back to UTC, an unusable SCHEDULER_TZ, and a downtime gap
// longer than one tick.
//
// All three survive a polarity inversion against the full suite, and all three
// are the kind marveen's criterion puts FIRST rather than last: they fire on a
// rare condition, so a missing one is indistinguishable from "there was nothing
// to report". Inverted, each stays silent exactly when its condition holds --
// and warns when it does not, which teaches the reader to ignore it.
//
// Each is driven from the state that produces it (environment, or a persisted
// liveness stamp), and each has its counter-case, because a warning that always
// fires is as useless as one that never does.

const mockWarn = vi.fn()
let tickStateFile: string | null = null
// Driven directly rather than through the environment: the cron zone is
// resolved from a .env FILE plus the host's own zone, so stubbing process.env
// does not reach it -- measured, the two zone cases stayed silent that way.
let cronTz = { tz: 'Europe/Budapest', source: 'SCHEDULER_TZ' as string }
let rejectedTz: string | undefined

vi.mock('../web/cron.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../web/cron.js')>()),
  effectiveCronTz: () => cronTz,
}))

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>()
  return { ...actual, get APP_TZ_INVALID() { return rejectedTz } }
})

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: (...a: unknown[]) => mockWarn(...a), debug: vi.fn(), error: vi.fn() },
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
  markScheduledTaskKanbanWaiting: vi.fn(() => null),
}))

vi.mock('../web/telegram.js', () => ({
  sendTelegramMessage: vi.fn(async () => {}),
  sendTelegramPhoto: vi.fn(async () => {}),
}))

vi.mock('../web/scheduled-tasks-io.js', () => ({
  listScheduledTasks: () => [],
  SCHEDULED_TASKS_DIR: '/tmp/marveen-startup-warn-no-tasks-dir',
}))

// Only the liveness stamp is redirected; every other read keeps the real
// implementation.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    readFileSync: (p: unknown, ...rest: unknown[]) => {
      if (typeof p === 'string' && p.endsWith('schedule-tick-state.json')) {
        if (tickStateFile == null) throw new Error('ENOENT')
        return tickStateFile
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(p, ...rest) as never
    },
  }
})

vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (n: string) => `agent-${n}`,
  isAgentRunning: () => true,
  isSessionReadyForPrompt: () => true,
  sendPromptToSession: vi.fn(() => 'sent'),
  startAgentProcess: vi.fn(() => ({ ok: true })),
  sessionExistsOnHost: () => true,
  capturePane: () => null,
  sendEnterToSession: vi.fn(),
  clearStaleParkedInput: vi.fn(() => false),
}))

async function startAndStop() {
  vi.resetModules()
  const { startScheduleRunner } = await import('../web/schedule-runner.js')
  const stop = startScheduleRunner()
  clearInterval(stop)
}

function warnsMatching(fragment: string) {
  return mockWarn.mock.calls.filter((c) => String(c[1] ?? c[0] ?? '').includes(fragment)).length
}

describe('start-up warnings fire on their own condition, and only on it', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T08:00:00.000Z'))
    tickStateFile = null
    cronTz = { tz: 'Europe/Budapest', source: 'SCHEDULER_TZ' }
    rejectedTz = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('NO configured zone: warns that cron fell back to UTC', async () => {
    cronTz = { tz: 'UTC', source: 'system-default' }
    await startAndStop()

    expect(warnsMatching('fell back to UTC')).toBeGreaterThan(0)
  })

  it('a configured zone: no fallback warning', async () => {
    await startAndStop()

    expect(warnsMatching('fell back to UTC')).toBe(0)
  })

  it('an UNUSABLE zone is named, not silently replaced', async () => {
    rejectedTz = 'Nowhere/Nothing'
    await startAndStop()

    expect(warnsMatching('is not a usable timezone')).toBeGreaterThan(0)
  })

  it('a usable zone raises no such warning', async () => {
    await startAndStop()

    expect(warnsMatching('is not a usable timezone')).toBe(0)
  })

  it('a long downtime is reported, so the catch-up scan is explained', async () => {
    // Alive two hours ago: past the cold-start window, so the runner widens its
    // scan and has to say why.
    tickStateFile = JSON.stringify({ lastTickMs: Date.now() - 2 * 60 * 60_000 })
    await startAndStop()

    expect(warnsMatching('down longer than a tick')).toBeGreaterThan(0)
  })

  it('a fresh stamp is NOT a downtime -- no report', async () => {
    tickStateFile = JSON.stringify({ lastTickMs: Date.now() - 20_000 })
    await startAndStop()

    expect(warnsMatching('down longer than a tick')).toBe(0)
  })
})
