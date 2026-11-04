import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Card a10a5b6d. The delta-crm issues and stats_v2 calls answered in 33.9-47.6 s on 2026-11-03
// against a 15 s timeout, so every slow round read as PARTIALLY UNREADABLE. This file drives the
// real tick (fetch, vault and queue stubbed): the timeout must reach every call, the tick must fit
// its interval, and a tick still running must not be joined by the next one.
const mkTmp = tmpDirs()
const ROOT = mkTmp('sentry-tick-budget-')
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

const { sentryTick, __resetSentryState, FETCH_TIMEOUT_MS, INTERVAL_MS } = await import('../web/sentry-issue-watcher.js')

const ORGS = [{ slug: 'delta-crm' }, { slug: 'agrotech-cv' }]
const STATS = { intervals: ['a'], groups: [{ by: { outcome: 'accepted' }, series: { 'sum(quantity)': [1] } }] }
const body = (url: string): unknown =>
  url.includes('/stats_v2/') ? STATS : url.endsWith('/organizations/') ? ORGS : []

const NOW = Date.parse('2026-11-04T12:00:00Z')

beforeEach(() => { sent.length = 0; __resetSentryState(NOW - 10 * 60_000) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('sentry tick time budget (a10a5b6d)', () => {
  it('waits longer than the slowest measured answer, and five calls still fit the interval', () => {
    expect(FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(Math.ceil(47_600 * 1.5))
    expect(5 * FETCH_TIMEOUT_MS).toBeLessThan(INTERVAL_MS)
  })

  it('gives every call of a tick the timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetchStub = vi.fn(async (url: string) => new Response(JSON.stringify(body(url)), { status: 200 }))
    vi.stubGlobal('fetch', fetchStub)
    await sentryTick(NOW)
    expect(fetchStub).toHaveBeenCalledTimes(5)
    expect(timeout.mock.calls).toEqual(Array(5).fill([FETCH_TIMEOUT_MS]))
  })

  it('skips a tick while the previous one is still reading, and runs the next one after it', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const fetchStub = vi.fn(async (url: string) => {
      await gate
      return new Response(JSON.stringify(body(url)), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchStub)

    const first = sentryTick(NOW)
    await sentryTick(NOW + 1)
    expect(fetchStub).toHaveBeenCalledTimes(1)

    release()
    await first
    expect(fetchStub).toHaveBeenCalledTimes(5)

    await sentryTick(NOW + INTERVAL_MS)
    expect(fetchStub).toHaveBeenCalledTimes(10)
  })
})
