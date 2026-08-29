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
