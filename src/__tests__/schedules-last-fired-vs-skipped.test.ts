import { beforeEach, describe, expect, it, vi } from 'vitest'

// `/api/schedules` must not report a HELD-BACK tick as a firing (card 0376e54f).
//
// The route used to read `scheduleLastRun` for `last_fired_at`. That map is
// written on four paths in schedule-runner.ts and TWO of them are skips -- the
// quota gate (:1539) and the cron pre-check (:1551) -- because a skipped
// occurrence still has to be consumed so the catch-up window does not fire it
// later. Correct for catch-up, false as run evidence.
//
// Measured 2026-09-20: five scheduled meters had been dark for 8-18 days while
// /api/schedules reported `last_fired_at` minutes ago for every one of them. A
// dark meter was byte-identical to a healthy one, which is the exact shape this
// fleet calls a silent success.
//
// The first test below is the discriminating one: the legacy number is mocked
// FRESH, the way the quota gate really leaves it, and the response must still
// refuse to call it a firing.

const mockListScheduledTasks = vi.fn(() => [] as unknown[])

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../web/scheduled-tasks-io.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../web/scheduled-tasks-io.js')>()),
  listScheduledTasks: () => mockListScheduledTasks(),
}))

const mockLastFired = vi.fn(() => undefined as number | undefined)
const mockLastOutcome = vi.fn(() => undefined as
  | { lastFiredAt?: number; lastSkippedAt?: number; lastSkipReason?: string }
  | undefined)

vi.mock('../web/schedule-runner.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../web/schedule-runner.js')>()),
  readScheduleLastFired: () => mockLastFired(),
  readScheduleLastOutcome: () => mockLastOutcome(),
}))

function fakeCtx(path: string) {
  const captured: { status?: number; body?: unknown } = {}
  const res = {
    writeHead(status: number) { captured.status = status; return res },
    setHeader() { return res },
    end(payload?: string) {
      if (payload) { try { captured.body = JSON.parse(payload) } catch { captured.body = payload } }
      return res
    },
  }
  const req = { on: () => req, headers: {} }
  return {
    ctx: { req, res, path, method: 'GET', url: new URL(`http://x${path}`) } as never,
    captured,
  }
}

const HEARTBEAT_TASK = {
  name: 'sentry-or', type: 'heartbeat', schedule: '0 * * * *',
  agent: 'marveen', enabled: true, createdAt: 0, description: 'd', prompt: 'p',
}

const FIRED_AT = Date.UTC(2026, 8, 12, 6, 0, 0)   // 2026-09-12, the last REAL run
const SKIPPED_AT = Date.UTC(2026, 8, 20, 16, 23, 13) // 2026-09-20 18:23:13 CEST

async function getRows() {
  const { tryHandleSchedules } = await import('../web/routes/schedules.js')
  const { ctx, captured } = fakeCtx('/api/schedules')
  await tryHandleSchedules(ctx)
  return captured.body as Array<Record<string, unknown>>
}

describe('/api/schedules separates a FIRING from a held-back tick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockListScheduledTasks.mockReturnValue([HEARTBEAT_TASK])
    mockLastFired.mockReturnValue(undefined)
    mockLastOutcome.mockReturnValue(undefined)
  })

  it('a quota-deferred tick is NOT served as last_fired_at, even though the legacy map is fresh', async () => {
    // Exactly the live state: the defer branch stamped the run map seconds ago.
    mockLastFired.mockReturnValue(SKIPPED_AT)
    mockLastOutcome.mockReturnValue({ lastSkippedAt: SKIPPED_AT, lastSkipReason: 'quota' })

    const rows = await getRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].last_fired_at).toBeUndefined()
    expect(rows[0].last_skipped_at).toBe(new Date(SKIPPED_AT).toISOString())
    expect(rows[0].last_skip_reason).toBe('quota')
  })

  it('CONTROL -- a real firing still carries last_fired_at', async () => {
    mockLastOutcome.mockReturnValue({ lastFiredAt: FIRED_AT })

    const rows = await getRows()
    expect(rows[0].last_fired_at).toBe(new Date(FIRED_AT).toISOString())
    expect(rows[0].last_skipped_at).toBeUndefined()
  })

  it('a week of skips does not erase WHEN the task last really ran', async () => {
    mockLastOutcome.mockReturnValue({
      lastFiredAt: FIRED_AT,
      lastSkippedAt: SKIPPED_AT,
      lastSkipReason: 'quota',
    })

    const rows = await getRows()
    // Both are present, and they are DIFFERENT instants: this is the whole
    // point -- "it last ran on the 12th, and it has been deferred since".
    expect(rows[0].last_fired_at).toBe(new Date(FIRED_AT).toISOString())
    expect(rows[0].last_skipped_at).toBe(new Date(SKIPPED_AT).toISOString())
    expect(rows[0].last_fired_at).not.toBe(rows[0].last_skipped_at)
  })

  it('CONTROL -- with no outcome record yet the legacy map still answers', async () => {
    // Entries written before this shipped have no outcome. Dropping the field
    // for them would turn a real past firing into "it never ran" -- the mirror
    // error, and the one the route's own docblock exists to prevent.
    mockLastFired.mockReturnValue(FIRED_AT)
    mockLastOutcome.mockReturnValue(undefined)

    const rows = await getRows()
    expect(rows[0].last_fired_at).toBe(new Date(FIRED_AT).toISOString())
    expect(rows[0].last_skipped_at).toBeUndefined()
  })
})
