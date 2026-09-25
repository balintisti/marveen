// Card 77c305a4: every uptime-poller API call now has a post-connect cap. The connect phase
// was already capped by undici (10 s); a call whose connection stood up had none -- one took
// 73.8 s in didi's 1283-call measurement, and a hung one would never return.
//
// What this pins, beyond "a timeout exists":
//   - the NUMBER sits in the measured band: above the slowest successful call (73.8 s), so it
//     interrupts none of the measured population, and below the 120 s tick, so a hung call
//     ends inside the tick that started it;
//   - a hung call really ENDS at the cap, is reported transient, and leaves the in-flight
//     registry (otherwise the overdue warning would keep naming a call that is gone);
//   - the signal reaches fetch at all (a cap defined but not passed is the inert version);
//   - a body that never finishes is capped by the same signal.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getJson, pollerInFlight, resetPollerInFlight, CALL_TIMEOUT_MS } from '../web/uptime-alert-watcher.js'

const SLOWEST_MEASURED_OK_MS = 73_800
const TICK_MS = 120_000

// A fetch that never answers on its own and honours the abort signal, like the real one.
function hangingFetch(capture?: (init: RequestInit | undefined) => void, headersThenHang = false) {
  return (_url: string, init?: RequestInit) => {
    capture?.(init)
    const signal = init?.signal as AbortSignal | undefined
    const hang = new Promise<never>((_, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    if (!headersThenHang) return hang
    return Promise.resolve({ ok: true, status: 200, json: () => hang } as unknown as Response)
  }
}

describe('the cap number is the measured band', () => {
  it('above the slowest measured successful call, below the poll tick', () => {
    expect(CALL_TIMEOUT_MS).toBeGreaterThan(SLOWEST_MEASURED_OK_MS)
    expect(CALL_TIMEOUT_MS).toBeLessThan(TICK_MS)
  })
})

describe('getJson under the cap', () => {
  beforeEach(() => resetPollerInFlight())
  afterEach(() => { vi.unstubAllGlobals(); resetPollerInFlight() })

  it('passes an AbortSignal to fetch', async () => {
    let seen: RequestInit | undefined
    vi.stubGlobal('fetch', hangingFetch((init) => { seen = init }))
    await getJson('https://example.invalid/v3/timeSeries?x=1', 'tok', 20)
    expect(seen?.signal).toBeInstanceOf(AbortSignal)
  })

  it('a hung call ENDS at the cap, transient, and leaves the in-flight registry', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const t0 = Date.now()
    const r = await getJson('https://example.invalid/v3/timeSeries?x=1', 'tok', 30)
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(r.ok).toBe(false)
    expect((r as { transient?: boolean }).transient).toBe(true)
    expect(pollerInFlight()).toHaveLength(0)
  })

  it('a body that never finishes is capped by the same signal', async () => {
    vi.stubGlobal('fetch', hangingFetch(undefined, true))
    const r = await getJson('https://example.invalid/v3/alertPolicies', 'tok', 30)
    expect(r.ok).toBe(false)
    expect(pollerInFlight()).toHaveLength(0)
  })

  it('CONTROL: a normal answer is untouched by the cap', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ a: 1 }) }) as unknown as Response)
    const r = await getJson('https://example.invalid/v3/alertPolicies', 'tok', 1_000)
    expect(r).toEqual({ ok: true, value: { a: 1 } })
  })
})
