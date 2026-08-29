import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The apply endpoint's USE of the preflight verdict (card bae4df49 / round
// 2c4717dc).
//
// checkUpdatePreflight is well covered as a pure function -- including the
// "not measurable is not zero" case this branch adds. What nothing covered is
// the route that consults it. Measured on this branch: replacing
// `if (!preflight.ok)` with `if (false)` -- the route ignoring the verdict
// entirely -- leaves all 4165 tests green, twice.
//
// A control on the same subject DOES fire: disabling the detached-head branch
// inside the pure function fails three tests. The suite is not blind here; no
// test imports routes/updates at all.
//
// That gap restores exactly the failure the card exists to fix: update.sh runs
// detached, dies on `git pull --ff-only`, and the dashboard shows "update
// started" followed by the same commit list. The preflight was written to turn
// that silent death into a 409 with a reason.

const mockSpawn = vi.fn(() => ({ unref: () => {}, on: () => {}, pid: 4242 }))
let preflightResult: unknown = { ok: true }

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    default: actual,
    spawn: (...a: unknown[]) => mockSpawn(...(a as [])),
    // The route builds its GitRunner from execFileSync; the preflight itself is
    // mocked below, so these values only have to be harmless.
    execFileSync: () => 'main\n',
  }
})

vi.mock('../update-preflight.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../update-preflight.js')>()),
  checkUpdatePreflight: () => preflightResult,
  checkNoConcurrentUpdate: () => ({ ok: true }),
}))

function fakeCtx(body: Record<string, unknown> = {}) {
  const chunks = [JSON.stringify(body)]
  const req = {
    on(ev: string, fn: (arg?: unknown) => void) {
      if (ev === 'data') for (const c of chunks) fn(Buffer.from(c))
      if (ev === 'end') fn()
      return req
    },
    headers: {},
  }
  const captured: { status?: number; body?: unknown } = {}
  const res = {
    writeHead(status: number) { captured.status = status; return res },
    setHeader() { return res },
    end(payload?: string) {
      if (payload) { try { captured.body = JSON.parse(payload) } catch { captured.body = payload } }
      return res
    },
  }
  return {
    ctx: {
      req, res, path: '/api/updates/apply', method: 'POST',
      url: new URL('http://x/api/updates/apply'),
    } as never,
    captured,
  }
}

describe('the apply endpoint refuses when the preflight refuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    preflightResult = { ok: true }
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('a FAILED preflight answers 409 with the reason, and update.sh is never spawned', async () => {
    preflightResult = {
      ok: false,
      reason: 'detached-head',
      message: 'Repository is in a detached-HEAD state.',
    }
    const { tryHandleUpdates } = await import('../web/routes/updates.js')
    const { ctx, captured } = fakeCtx()

    await tryHandleUpdates(ctx)

    expect(captured.status).toBe(409)
    expect((captured.body as { reason?: string })?.reason).toBe('detached-head')
    // The point of the gate: the update must not start.
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('a PASSING preflight does NOT answer 409 -- the gate is not always-refuse', async () => {
    // Without this the first case is satisfied by a route that refuses
    // everything, which would be just as broken and much louder.
    preflightResult = { ok: true }
    const { tryHandleUpdates } = await import('../web/routes/updates.js')
    const { ctx, captured } = fakeCtx()

    await tryHandleUpdates(ctx)

    expect(captured.status).not.toBe(409)
  })
})
