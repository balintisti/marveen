import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Card 6db77c30. The pure half is tested in sentry-lane.test.ts; THIS file drives the real tick
// with fetch, the vault and the queue stubbed, so the path from the stats_v2 call to the enqueued
// text is exercised -- a lane that is decided correctly but never fetched, or fetched and never
// reaching the notice, would leave every pure test green.
const ROOT = mkdtempSync(join(tmpdir(), 'sentry-lane-tick-'))
mkdirSync(join(ROOT, 'store'), { recursive: true })

const sent: string[] = []
vi.mock('../config.js', async (orig) => ({ ...(await orig<typeof import('../config.js')>()), PROJECT_ROOT: ROOT }))
vi.mock('../web/vault.js', () => ({ getSecret: () => 'test-token' }))
vi.mock('../db.js', () => {
  const rows = new Map<number, { id: number; content: string }>()
  let id = 0
  return {
    createAgentMessage: (_f: string, _t: string, content: string) => {
      id += 1; rows.set(id, { id, content }); sent.push(content); return { id }
    },
    getAgentMessage: (n: number) => rows.get(n) ?? null,
  }
})

const { sentryTick, __resetSentryState, SENTRY_LANE_PATH } = await import('../web/sentry-issue-watcher.js')

const STATS_CLOSED = {
  intervals: ['a', 'b', 'c'],
  groups: [{ by: { outcome: 'rate_limited' }, series: { 'sum(quantity)': [70, 81, 0] } }],
}
const STATS_OPEN = {
  intervals: ['a', 'b', 'c'],
  groups: [{ by: { outcome: 'accepted' }, series: { 'sum(quantity)': [0, 4, 0] } }],
}

function stubSentry(stats: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    // WITHOUT `category=error` the real endpoint sums every category, and `transaction` was
    // accepted all along (4548 on 09-24) -- so the stub answers "open" to an unfiltered query,
    // and a caller that lost the filter reads a closed lane as open, as it would in production.
    const body = url.includes('/stats_v2/') ? (url.includes('category=error') ? stats : STATS_OPEN)
      : url.endsWith('/organizations/') ? [{ slug: 'delta-crm' }]
      : [{ id: '1', title: 'old issue', firstSeen: '2026-09-01T00:00:00Z', count: '3' }]
    return new Response(JSON.stringify(body), { status: 200 })
  }))
}

const NOW = Date.parse('2026-09-24T12:40:00Z')
// a watermark ten minutes back makes the first tick a RESTART -- the measured "RESUMED ... NOTHING
// first appeared" line, which is the quiet sentence this card is about
const WATERMARK = NOW - 10 * 60_000

beforeEach(() => { sent.length = 0; __resetSentryState(WATERMARK) })
afterEach(() => { vi.unstubAllGlobals() })

describe('sentryTick carries the closed error lane to the queue', () => {
  it('closed lane: the edge notice goes out, AND the RESUMED line carries the caveat', async () => {
    stubSentry(STATS_CLOSED)
    await sentryTick(NOW)
    const edge = sent.find(s => s.includes('ERROR LANE CLOSED for delta-crm:'))
    expect(edge).toContain('rate-limited 151')
    const resumed = sent.find(s => s.includes('RESUMED'))!
    expect(resumed).toContain('NOTHING first appeared')
    expect(resumed).toContain('ERROR LANE CLOSED for delta-crm (151 dropped, 0 accepted in 24 h)')
    // and the memory is on disk, so a dashboard restart does not re-announce the edge
    expect(JSON.parse(readFileSync(SENTRY_LANE_PATH, 'utf8'))['delta-crm'].sinceMs).toBe(NOW)
  })

  it('CONTROL: open lane -> no lane notice and a RESUMED line without the caveat', async () => {
    stubSentry(STATS_OPEN)
    await sentryTick(NOW)
    expect(sent.some(s => s.includes('ERROR LANE'))).toBe(false)
    const resumed = sent.find(s => s.includes('RESUMED'))!
    expect(resumed).toContain('NOTHING first appeared')
    expect(resumed).not.toContain('ERROR LANE')
  })

  it('a failed stats call makes the quiet line say it is unverified', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/stats_v2/')) return new Response('{}', { status: 429 })
      // one standing issue, so the RESUMED line goes out (a zero-issue cold start is silent)
      const body = url.endsWith('/organizations/') ? [{ slug: 'delta-crm' }]
        : [{ id: '1', title: 'old issue', firstSeen: '2026-09-01T00:00:00Z', count: '3' }]
      return new Response(JSON.stringify(body), { status: 200 })
    }))
    await sentryTick(NOW)
    const resumed = sent.find(s => s.includes('RESUMED'))!
    expect(resumed).toContain('Error lane NOT MEASURED this tick (delta-crm: HTTP 429')
    expect(sent.some(s => s.includes('ERROR LANE CLOSED') || s.includes('REOPENED'))).toBe(false)
  })
})
