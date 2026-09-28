// ONE UPTIME TICK AT A TIME -- card 77c305a4, didi 03:10, marveen's decision 03:18.
//
// The per-call cap ends a hung CALL inside its tick, but a tick makes two calls, each with a
// retry: worst case 402 s, and setInterval does not wait -- up to four ticks at once against a
// stalled API. A tick that finds the previous one still running is skipped, with one log line.
// Drives the real uptimeTick with gcloud and fetch stubbed; the first tick is held open by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ warns: [] as unknown[][] }))

vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  // gcloud: `config config-helper --format=json` answers token, expiry and project at once (3d038bac)
  execFileSync: vi.fn(() => JSON.stringify({
    credential: { access_token: 'tok', token_expiry: new Date(Date.now() + 3_600_000).toISOString() },
    configuration: { properties: { core: { project: 'proj' } } },
  })),
}))
vi.mock('../logger.js', () => ({
  logger: { warn: (...a: unknown[]) => { h.warns.push(a) }, info: () => {}, debug: () => {}, error: () => {} },
}))
vi.mock('../db.js', async (orig) => ({
  ...(await orig<typeof import('../db.js')>()),
  createAgentMessage: () => ({ id: 1 }),
  getAgentMessage: () => ({ id: 1 }),
}))

const { uptimeTick, resetUptimeTickGuard, resetPollerInFlight } = await import('../web/uptime-alert-watcher.js')

// Every fetch returns a promise the test resolves by hand; `calls` counts what the poller asked.
let calls: { url: string; release: () => void }[] = []
function heldFetch(url: string) {
  return new Promise<Response>((resolve) => {
    calls.push({ url, release: () => resolve({ ok: true, status: 200, json: async () => ({}) } as unknown as Response) })
  })
}
const flush = () => new Promise((r) => setTimeout(r, 0))
const releaseAll = async () => {
  for (let i = 0; i < 10; i++) { calls.forEach((c) => c.release()); await flush() }
}
const skipped = () => h.warns.filter((w) => String(w[1]).includes('this tick is SKIPPED')).length

describe('uptimeTick runs one tick at a time (77c305a4)', () => {
  beforeEach(() => {
    calls = []; h.warns.length = 0
    resetUptimeTickGuard(); resetPollerInFlight()
    vi.stubGlobal('fetch', vi.fn(heldFetch))
  })
  afterEach(async () => { await releaseAll(); vi.unstubAllGlobals(); resetUptimeTickGuard(); resetPollerInFlight() })

  it('the first tick hangs on its API call; the second tick makes NO call and says it skipped', async () => {
    const first = uptimeTick()
    await flush(); await flush()
    expect(calls).toHaveLength(1)          // the first tick is waiting on alertPolicies
    await uptimeTick()                     // the next interval fires while it hangs
    expect(calls).toHaveLength(1)          // ...and asks nothing
    expect(skipped()).toBe(1)
    await releaseAll()
    await first
  })

  it('the way out: once the hung tick finishes, the next tick runs normally', async () => {
    const first = uptimeTick()
    await flush()
    await releaseAll()
    await first
    const before = calls.length
    const third = uptimeTick()
    await flush(); await flush()
    expect(calls.length).toBeGreaterThan(before)   // it called the API again
    expect(skipped()).toBe(0)
    await releaseAll()
    await third
  })

  it('a tick that THROWS still releases the guard (finally)', async () => {
    // A failing fetch does NOT do it -- getJson catches it and the tick completes normally (the
    // first version of this test proved nothing for that reason; a mutant caught it). What escapes
    // the body is outside every try: an invalid `now` makes toISOString() throw a RangeError.
    // The expectation is attached IN THE SAME STATEMENT as the call (card c9add760): awaited only
    // after the flushes, the rejection sat unhandled for a macrotask, vitest reported it, and the
    // whole `npm test` exited 1 with every test green.
    const bad = expect(uptimeTick(Number.NaN)).rejects.toThrow(RangeError)
    await flush()
    await releaseAll()
    await bad
    const next = uptimeTick()
    await flush(); await flush()
    expect(calls.length).toBeGreaterThan(0)
    expect(skipped()).toBe(0)
    await releaseAll()
    await next
  })
})
