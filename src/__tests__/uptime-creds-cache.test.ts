/**
 * ONE gcloud CALL PER TOKEN LIFETIME, NOT TWO PER TICK (card 3d038bac).
 *
 * The poller asked gcloud for a token and a project on EVERY 2-minute tick -- ~60 processes an hour
 * for a token that lives an hour -- and rare 15 s spikes on those calls were most of 09-28's
 * "NOT MEASURED" notices. These pin the cache: fetched once, kept until 5 min before the token's
 * OWN expiry (from config-helper, not a guessed TTL), still used when a refresh fails but the token
 * is valid, and dropped when the API refuses it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ calls: 0, fail: false, expiresInMs: 3_600_000, fetchStatus: 200 }))

vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  execFileSync: vi.fn((_bin: string, args: string[]) => {
    if (!args.includes('config-helper')) throw new Error(`unexpected gcloud call: ${args.join(' ')}`)
    h.calls += 1
    if (h.fail) throw Object.assign(new Error('gcloud timed out'), { code: 'ETIMEDOUT', signal: 'SIGTERM' })
    return JSON.stringify({
      credential: { access_token: `tok${h.calls}`, token_expiry: new Date(Date.now() + h.expiresInMs).toISOString() },
      configuration: { properties: { core: { project: 'proj' } } },
    })
  }),
}))
vi.mock('../logger.js', () => ({ logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } }))

const w = await import('../web/uptime-alert-watcher.js')

beforeEach(() => {
  w.invalidateCredentials()
  h.calls = 0; h.fail = false; h.expiresInMs = 3_600_000; h.fetchStatus = 200
  process.env.UPTIME_PROBE_RETRY_DELAY_MS = '0'
})

describe('parseConfigHelper', () => {
  const out = (o: object) => JSON.stringify(o)
  it('takes token, expiry and project from the one answer', () => {
    const r = w.parseConfigHelper(out({ credential: { access_token: 't', token_expiry: '2026-09-29T00:41:58Z' }, configuration: { properties: { core: { project: 'p' } } } }))
    expect(r).toEqual({ ok: true, value: { token: 't', project: 'p', expiresAt: Date.parse('2026-09-29T00:41:58Z') } })
  })
  it('names what is missing: token, expiry, project -- and a non-JSON answer', () => {
    expect(w.parseConfigHelper(out({ credential: {}, configuration: {} }))).toMatchObject({ ok: false, reason: expect.stringContaining('no access_token') })
    expect(w.parseConfigHelper(out({ credential: { access_token: 't' } }))).toMatchObject({ ok: false, reason: expect.stringContaining('token_expiry') })
    expect(w.parseConfigHelper(out({ credential: { access_token: 't', token_expiry: '2026-09-29T00:41:58Z' }, configuration: { properties: { core: {} } } })))
      .toMatchObject({ ok: false, reason: expect.stringContaining('(unset)') })
    expect(w.parseConfigHelper('not json')).toMatchObject({ ok: false })
  })
})

describe('credentials()', () => {
  it('one gcloud call, then the cache for the token\'s lifetime', async () => {
    const t0 = Date.now()
    for (const m of [0, 2, 20, 50]) {
      const r = await w.credentials(t0 + m * 60_000)
      expect(r.ok).toBe(true)
    }
    expect(h.calls).toBe(1)
  })

  it('refetches inside the last 5 minutes of the token\'s OWN expiry', async () => {
    const t0 = Date.now()
    h.expiresInMs = 10 * 60_000                      // a token gcloud handed back already old
    await w.credentials(t0)
    await w.credentials(t0 + 4 * 60_000)              // 6 min left: cached
    expect(h.calls).toBe(1)
    await w.credentials(t0 + 6 * 60_000)              // 4 min left: fetched again
    expect(h.calls).toBe(2)
  })

  it('a failed refresh still uses a cached token that has not expired -- a spike no longer blinds a tick', async () => {
    const t0 = Date.now()
    h.expiresInMs = 10 * 60_000
    const first = await w.credentials(t0)
    h.fail = true
    const r = await w.credentials(t0 + 7 * 60_000)    // in the margin, refresh fails, token still valid
    expect(r).toEqual(first)
  })

  it('CONTROL: once the cached token has expired, a failed refresh is a failure', async () => {
    const t0 = Date.now()
    h.expiresInMs = 10 * 60_000
    await w.credentials(t0)
    h.fail = true
    const r = await w.credentials(t0 + 11 * 60_000)
    expect(r.ok).toBe(false)
  })

  it('invalidateCredentials() makes the next call fetch', async () => {
    await w.credentials()
    w.invalidateCredentials()
    await w.credentials()
    expect(h.calls).toBe(2)
  })
})

describe('the tick drops a token the API refuses', () => {
  it('after a 401 from the monitoring API, the next tick asks gcloud again', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: h.fetchStatus }))
    vi.stubGlobal('fetch', fetchMock)
    h.fetchStatus = 401
    await w.uptimeTick(Date.now())
    const before = h.calls
    h.fetchStatus = 200
    await w.uptimeTick(Date.now() + 120_000)
    expect(h.calls).toBe(before + 1)
    vi.unstubAllGlobals()
  })

  it('CONTROL: after a 200, the next tick uses the cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })))
    await w.uptimeTick(Date.now())
    const before = h.calls
    await w.uptimeTick(Date.now() + 120_000)
    expect(h.calls).toBe(before)
    vi.unstubAllGlobals()
  })
})
