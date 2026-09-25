// Card 507992c5: a thrown poller call names its CAUSE in the notice, not only "fetch failed".
//
// Every connect failure 09-22..09-25 reached the coordinator as "threw: fetch failed" while the
// log beside it held the reason one level down, in err.cause. The two shapes below are the ones
// the live log recorded; the errors are built the way undici builds them (name, code, cause).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { getJson, describeThrow, resetPollerInFlight } from '../web/uptime-alert-watcher.js'

const URL = 'https://monitoring.googleapis.com/v3/projects/p/timeSeries'

function connectTimeout() {
  const cause = Object.assign(
    new Error('Connect Timeout Error (attempted address: monitoring.googleapis.com:443, timeout: 10000ms)'),
    { name: 'ConnectTimeoutError', code: 'UND_ERR_CONNECT_TIMEOUT' },
  )
  return new TypeError('fetch failed', { cause })
}
function allAddressesTimedOut() {
  const cause = Object.assign(new AggregateError([], ''), { code: 'ETIMEDOUT' })
  return new TypeError('fetch failed', { cause })
}

describe('a thrown call names its cause (507992c5)', () => {
  afterEach(() => { vi.unstubAllGlobals(); resetPollerInFlight() })

  it('the connect-timeout shape reaches the REASON, with code and address', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(connectTimeout())))
    const r = await getJson(URL, 'tok')
    expect(r.ok).toBe(false)
    const reason = (r as { reason: string }).reason
    expect(reason).toContain('fetch failed -- caused by: ConnectTimeoutError [UND_ERR_CONNECT_TIMEOUT]')
    expect(reason).toContain('monitoring.googleapis.com:443, timeout: 10000ms')
  })

  it('the every-address-timed-out shape: an EMPTY message still names its code', () => {
    expect(describeThrow(allAddressesTimedOut())).toBe('fetch failed -- caused by: AggregateError [ETIMEDOUT]')
  })

  it('CONTROL: an error without a cause reads exactly as before', () => {
    expect(describeThrow(new Error('boom'))).toBe('boom')
    expect(describeThrow('plain string')).toBe('plain string')
  })

  it('a cause chain that points at itself ends, and a deep one is bounded', () => {
    const loop = new Error('outer') as Error & { cause?: unknown }
    const inner = new Error('inner', { cause: loop })
    loop.cause = inner
    expect(describeThrow(loop)).toBe('outer -- caused by: Error: inner')
    let deep: Error = new Error('level 9')
    for (let i = 8; i >= 0; i--) deep = new Error(`level ${i}`, { cause: deep })
    expect(describeThrow(deep).split(' <- ')).toHaveLength(3)
  })
})
