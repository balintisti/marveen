import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getJson,
  overdueCalls,
  pollerInFlight,
  resetPollerInFlight,
  type InFlightCall,
} from '../web/uptime-alert-watcher.js'

// WHAT THESE PIN, AND WHY NOT THE HAPPY PATH (card 77c305a4). The defect is not "a call is
// slow". It is that `getJson` has no timeout, so a HUNG call never returns -- and a duration
// is only recorded when a call RETURNS. Instrumentation that measures only completions is
// therefore blind to precisely the event it exists to find. The load-bearing assertions are
// the two about the in-flight registry: that a call is visible WHILE it runs, and that it
// leaves the registry on EVERY exit path. A leak there would report a permanent hang after
// one ordinary network error, which is the alarming direction.
//
// The threshold is deliberately absent. marveen's ruling on this card forbids guessing it,
// and the only limit used here is INTERVAL_MS -- a number WE chose, not a claim about Google.

describe('overdueCalls -- a call that outlives our own poll interval', () => {
  const calls: InFlightCall[] = [
    { url: 'https://example.invalid/a', startedAt: 1_000 },
    { url: 'https://example.invalid/b', startedAt: 5_000 },
  ]

  it('says NO while both are inside the limit', () => {
    expect(overdueCalls(calls, 6_000, 10_000)).toEqual([])
  })

  // A KONTROLL, es ez a fele szamit: a mero tudjon IGENT is mondani.
  it('says YES for the one that crossed it, and only that one', () => {
    const late = overdueCalls(calls, 12_000, 10_000)
    expect(late.map((c) => c.url)).toEqual(['https://example.invalid/a'])
  })

  it('is inclusive at the boundary -- exactly the limit already counts', () => {
    expect(overdueCalls([{ url: 'u', startedAt: 0 }], 10_000, 10_000)).toHaveLength(1)
  })
})

describe('getJson -- a running call is VISIBLE, and it always leaves the registry', () => {
  beforeEach(() => resetPollerInFlight())
  afterEach(() => {
    vi.unstubAllGlobals()
    resetPollerInFlight()
  })

  // EZ A TEHERHORDO: ha a hivas csak a VISSZATERESEKOR latszana, egy beakadas nyomtalan lenne.
  it('registers the call WHILE it is still running', async () => {
    let release!: (v: unknown) => void
    const pending = new Promise((r) => {
      release = r
    })
    vi.stubGlobal('fetch', () => pending)
    const p = getJson('https://example.invalid/v3/alertPolicies?x=1', 'tok')
    await Promise.resolve()
    const live = pollerInFlight()
    expect(live).toHaveLength(1)
    // A QUERY-STRING LEVAGVA: a mero a VEGPONTOT nevezze meg, ne egy egyedi URL-t -- kulonben
    // minden hivas sajat "kategoria" lenne, es nem all ossze eloszlas belole.
    expect(live[0].url).toBe('https://example.invalid/v3/alertPolicies')
    release({ ok: true, json: async () => ({}) })
    await p
    expect(pollerInFlight()).toHaveLength(0)
  })

  it('clears the registry on a NON-OK http status', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503, json: async () => ({}) }))
    const r = await getJson('https://example.invalid/v3/timeSeries', 'tok')
    expect(r.ok).toBe(false)
    expect(pollerInFlight()).toHaveLength(0)
  })

  // A SZIVARGAS IRANYA A ROSSZABBIK: egy bent ragadt bejegyzes MINDEN kesobbi tick elejen
  // "beakadt hivas" figyelmeztetest adna, egyetlen atmeneti halozati hiba utan, orokre.
  it('clears the registry when fetch THROWS', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('fetch failed')
    })
    const r = await getJson('https://example.invalid/v3/timeSeries', 'tok')
    expect(r.ok).toBe(false)
    expect(pollerInFlight()).toHaveLength(0)
  })

  // A TESTBEN akad el, nem a fejlecben: a valasz megjon, a `json()` sosem fejezodik be.
  it('keeps the call registered while the BODY is still being read', async () => {
    let release!: (v: unknown) => void
    const body = new Promise((r) => {
      release = r
    })
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: () => body }))
    const p = getJson('https://example.invalid/v3/alertPolicies', 'tok')
    await Promise.resolve()
    await Promise.resolve()
    expect(pollerInFlight()).toHaveLength(1)
    release({})
    await p
    expect(pollerInFlight()).toHaveLength(0)
  })
})
