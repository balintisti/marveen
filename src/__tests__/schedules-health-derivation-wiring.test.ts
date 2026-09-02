import { beforeEach, describe, expect, it, vi } from 'vitest'

// The /api/schedules route's USE of the derived health (card bae4df49 / round
// 2c4717dc).
//
// assessCommandHealth is well covered as a pure function. What nothing covered
// is the route that applies it: dropping the `health` field from the response
// -- the route handing back the raw stored list, exactly as before the fix --
// left all 4172 tests green, twice.
//
// The suite is not blind, and that was measured: changing the pure function's
// 'ok' verdict to 'fail' fails four tests on the SAME total (4172), so the
// populations are comparable. An earlier control attempt was discarded because
// it dropped the total to 4153 -- fewer tests ran, so nothing could be
// concluded from it.
//
// Why the field matters: the stored lastStatus is written only when the task
// RUNS, so a task that never runs again stays "ok" forever. The derivation is
// the entire fix; served raw, the dashboard shows a green row for a command
// that has been dead for a week.

const mockListScheduledTasks = vi.fn(() => [] as unknown[])
const mockReadCommandHealth = vi.fn(() => undefined as unknown)

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../web/scheduled-tasks-io.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../web/scheduled-tasks-io.js')>()),
  listScheduledTasks: () => mockListScheduledTasks(),
}))

vi.mock('../web/command-task.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../web/command-task.js')>()),
  readCommandHealth: () => mockReadCommandHealth(),
}))

const mockLastFired = vi.fn(() => undefined as number | undefined)
vi.mock('../web/schedule-runner.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../web/schedule-runner.js')>()),
  readScheduleLastFired: () => mockLastFired(),
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

const COMMAND_TASK = {
  name: 'usage-snapshot', type: 'command', schedule: '*/10 * * * *',
  agent: 'marveen', enabled: true, createdAt: 0, description: 'd', prompt: 'p',
}
const HEARTBEAT_TASK = { ...COMMAND_TASK, name: 'memoria-heartbeat', type: 'heartbeat' }

describe('/api/schedules serves DERIVED health, not the stored row', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockReadCommandHealth.mockReturnValue(undefined)
  })

  it('a COMMAND task carries a derived health verdict', async () => {
    mockListScheduledTasks.mockReturnValue([COMMAND_TASK])
    const { tryHandleSchedules } = await import('../web/routes/schedules.js')
    const { ctx, captured } = fakeCtx('/api/schedules')

    await tryHandleSchedules(ctx)

    const rows = captured.body as Array<Record<string, unknown>>
    expect(Array.isArray(rows)).toBe(true)
    // Never run: the derivation must SAY so. Serving the row raw omits the
    // field entirely, which is the regression this pins.
    expect(rows[0]).toHaveProperty('health')
    expect((rows[0].health as { verdict?: string })?.verdict).toBe('never-run')
  })

  it('a NON-command task is passed through untouched', async () => {
    // The other half: a derivation applied to everything would be a different
    // bug, and the first case alone cannot tell the two apart.
    mockListScheduledTasks.mockReturnValue([HEARTBEAT_TASK])
    const { tryHandleSchedules } = await import('../web/routes/schedules.js')
    const { ctx, captured } = fakeCtx('/api/schedules')

    await tryHandleSchedules(ctx)

    const rows = captured.body as Array<Record<string, unknown>>
    expect(rows[0]).not.toHaveProperty('health')
  })
})


// ---------------------------------------------------------------------------
// Run evidence for EVERY type -- card 6b6c7e93.
//
// The endpoint returned run evidence for `command` only, because that is the one
// type with an exit code. So an agent asking "did my scheduled task fire?" got
// silence for task / heartbeat / dream-engine -- and silence is indistinguishable
// from "it never fired". The scheduler had the answer persisted the whole time,
// for the catch-up window; it was recorded and never surfaced.
// ---------------------------------------------------------------------------
const FIRED_MS = Date.UTC(2026, 7, 31, 7, 0, 7)   // 2026-08-31 09:00:07 CEST

describe('/api/schedules reports the last FIRING, for every type', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockReadCommandHealth.mockReturnValue(undefined)
    mockLastFired.mockReturnValue(undefined)
  })

  // PER TYPE, NOT AGGREGATED. A single "some row has it" assertion would stay green
  // with only one type wired -- which is exactly the defect being fixed.
  for (const type of ['heartbeat', 'task', 'dream-engine']) {
    it(`a ${type} task that HAS fired carries last_fired_at`, async () => {
      mockListScheduledTasks.mockReturnValue([{ ...HEARTBEAT_TASK, type }])
      mockLastFired.mockReturnValue(FIRED_MS)
      const { tryHandleSchedules } = await import('../web/routes/schedules.js')
      const { ctx, captured } = fakeCtx('/api/schedules')

      await tryHandleSchedules(ctx)

      const rows = captured.body as Array<Record<string, unknown>>
      expect(rows[0].last_fired_at).toBe(new Date(FIRED_MS).toISOString())
      // The local stamp beside it, for the same reason the CLIs grew one: two
      // agents once read two real fields in two zones and appeared to disagree.
      expect(String(rows[0].last_fired_at_local)).toMatch(/^2026-08-31 \d\d:\d\d:07 CEST$/)
    })
  }

  it('a task that has NEVER fired does NOT carry the field at all', async () => {
    // THE DISCRIMINATING CASE. Returning 0, or "now", or a null would make "never
    // fired" indistinguishable from "fired at the epoch" -- and telling those two
    // apart is the only reason to return this at all.
    mockListScheduledTasks.mockReturnValue([HEARTBEAT_TASK])
    mockLastFired.mockReturnValue(undefined)
    const { tryHandleSchedules } = await import('../web/routes/schedules.js')
    const { ctx, captured } = fakeCtx('/api/schedules')

    await tryHandleSchedules(ctx)

    const rows = captured.body as Array<Record<string, unknown>>
    expect(rows[0]).not.toHaveProperty('last_fired_at')
    expect(rows[0]).not.toHaveProperty('last_fired_at_local')
  })

  it('a COMMAND task keeps its derived health AND gains the firing time', async () => {
    // The two mechanisms are independent; wiring one must not drop the other.
    mockListScheduledTasks.mockReturnValue([COMMAND_TASK])
    mockLastFired.mockReturnValue(FIRED_MS)
    const { tryHandleSchedules } = await import('../web/routes/schedules.js')
    const { ctx, captured } = fakeCtx('/api/schedules')

    await tryHandleSchedules(ctx)

    const rows = captured.body as Array<Record<string, unknown>>
    expect(rows[0]).toHaveProperty('health')
    expect(rows[0].last_fired_at).toBe(new Date(FIRED_MS).toISOString())
  })
})
