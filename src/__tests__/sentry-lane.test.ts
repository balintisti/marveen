import { describe, it, expect } from 'vitest'
import {
  classifyLane,
  decideSentryLanes,
  buildLaneNotice,
  laneCaveat,
  LANE_REANNOUNCE_MS,
  type SentryLaneReading,
} from '../sentry-issues.js'
import { laneFromStatsPayload, loadLaneMemory } from '../web/sentry-issue-watcher.js'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Removed when this file finishes (card 66756e73): every temp dir in a test goes through here.
const mkTmp = tmpDirs()

// Card 6db77c30 (the B half of 32f40913). Measured 2026-09-24: delta-crm's error lane accepted 0 and
// rate-limited ~2000/day since 09-19, and the watcher's "NOTHING first appeared" was true and
// byte-identical to a healthy week. Reopened 09-25 on didi's review: the state now comes from the
// SHARE dropped, and every number in a notice is measured.
const NOW = Date.parse('2026-09-24T12:40:00Z')
const H = 3_600_000
const zeros = (n: number) => new Array(n).fill(0)

describe('classifyLane: the last hour with traffic decides, by the share it dropped', () => {
  it('the measured 09-24 shape: rate-limited hours, then three empty ones -> CLOSED', () => {
    const acc = zeros(25)
    const rl = [...zeros(19), 70, 81, 75, 0, 0, 0]
    expect(classifyLane(acc, rl)).toEqual({ state: 'closed', dropped: 226, accepted: 0, hourAccepted: 0, hourDropped: 75 })
  })

  it('the 09-18 shape: accepted early in the window, rate-limited later -> CLOSED, not "open by total"', () => {
    const acc = [155, ...zeros(24)]
    const rl = [0, ...zeros(10), 50, 60, ...zeros(12)]
    expect(classifyLane(acc, rl).state).toBe('closed')
  })

  it('CONTROL: accepted in the last traffic hour, nothing dropped there -> OPEN, even with rate-limiting earlier', () => {
    const acc = [...zeros(20), 4, 0, 0, 0, 0]
    const rl = [30, 40, ...zeros(23)]
    expect(classifyLane(acc, rl).state).toBe('open')
  })

  // didi's three inputs, verbatim from the review (card comment 18741)
  it('didi 1: 1 accepted beside 999 dropped is CLOSED (it read "open" before)', () => {
    expect(classifyLane([1], [999])).toEqual({ state: 'closed', dropped: 999, accepted: 1, hourAccepted: 1, hourDropped: 999 })
  })
  it('didi 2: the lane recovered in its last traffic hour -> OPEN, and the window still holds the 900', () => {
    const c = classifyLane([0, 5], [900, 0])
    expect(c.state).toBe('open')
    expect(c.dropped).toBe(900)
  })
  it('didi 3: closed in the deciding hour, 500 accepted earlier -> CLOSED, window counts kept', () => {
    expect(classifyLane([500, 0, 0], [0, 300, 400])).toEqual({ state: 'closed', dropped: 700, accepted: 500, hourAccepted: 0, hourDropped: 400 })
  })

  it('a partly dropped hour is THROTTLED: 3 accepted / 9 dropped (75%)', () => {
    expect(classifyLane([0, 3], [5, 9]).state).toBe('throttled')
  })

  it('the thresholds, at their edges: 90% closed, 10% throttled, below that open', () => {
    expect(classifyLane([10], [90]).state).toBe('closed')
    expect(classifyLane([11], [89]).state).toBe('throttled')
    expect(classifyLane([90], [10]).state).toBe('throttled')
    expect(classifyLane([91], [9]).state).toBe('open')
  })

  it('no traffic in the whole window -> no-traffic, never closed', () => {
    expect(classifyLane(zeros(25), zeros(25))).toEqual({ state: 'no-traffic', dropped: 0, accepted: 0, hourAccepted: 0, hourDropped: 0 })
  })
})

const closedLane = (org: string, dropped = 226): SentryLaneReading =>
  ({ org, ok: true, accepted: zeros(3), rateLimited: [dropped, 0, 0] })
const throttledLane = (org: string): SentryLaneReading =>
  ({ org, ok: true, accepted: [0, 30, 0], rateLimited: [0, 70, 0] })
const openLane = (org: string, accepted = 5): SentryLaneReading =>
  ({ org, ok: true, accepted: [0, accepted, 0], rateLimited: zeros(3) })
const quietLane = (org: string): SentryLaneReading => ({ org, ok: true, accepted: zeros(3), rateLimited: zeros(3) })
const closedMem = (at: number) => ({ sinceMs: at, announcedAtMs: at, state: 'closed' as const })

describe('decideSentryLanes: edges, the daily repeat, and what does NOT count as an edge', () => {
  it('first sighting of a closed lane announces once, with the measured numbers, and remembers it', () => {
    const d = decideSentryLanes([closedLane('delta-crm'), quietLane('agrotech-cv')], {}, NOW)
    expect(d.announce).toEqual([{
      org: 'delta-crm', state: 'closed', dropped: 226, accepted: 0,
      hourAccepted: 0, hourDropped: 226, sinceMs: NOW, repeat: false,
    }])
    expect(d.degraded.map(c => [c.org, c.state])).toEqual([['delta-crm', 'closed']])
    expect(d.next).toEqual({ 'delta-crm': closedMem(NOW) })
  })

  it('still closed an hour later: silent, but still CLOSED for the caveat', () => {
    const prev = { 'delta-crm': closedMem(NOW - H) }
    const d = decideSentryLanes([closedLane('delta-crm')], prev, NOW)
    expect(d.announce).toEqual([])
    expect(d.degraded.map(c => c.org)).toEqual(['delta-crm'])
    expect(d.next).toEqual(prev)
  })

  it('the daily repeat fires at exactly LANE_REANNOUNCE_MS, not a second earlier', () => {
    const since = NOW - 3 * LANE_REANNOUNCE_MS
    const due = decideSentryLanes([closedLane('delta-crm')],
      { 'delta-crm': { sinceMs: since, announcedAtMs: NOW - LANE_REANNOUNCE_MS, state: 'closed' } }, NOW)
    expect(due.announce.map(a => [a.state, a.sinceMs, a.repeat])).toEqual([['closed', since, true]])
    expect(due.next['delta-crm']).toEqual({ sinceMs: since, announcedAtMs: NOW, state: 'closed' })
    const early = decideSentryLanes([closedLane('delta-crm')],
      { 'delta-crm': { sinceMs: since, announcedAtMs: NOW - LANE_REANNOUNCE_MS + 1000, state: 'closed' } }, NOW)
    expect(early.announce).toEqual([])
  })

  it('closed -> throttled is an EDGE of its own (a new state is news), not a reopening', () => {
    const d = decideSentryLanes([throttledLane('delta-crm')], { 'delta-crm': closedMem(NOW - H) }, NOW)
    expect(d.announce.map(a => [a.state, a.repeat])).toEqual([['throttled', false]])
    expect(d.reopened).toEqual([])
    expect(d.next['delta-crm'].state).toBe('throttled')
  })

  it('a memory written before the throttled state (no `state`) is read as CLOSED -- no false edge', () => {
    const d = decideSentryLanes([closedLane('delta-crm')], { 'delta-crm': { sinceMs: NOW - H, announcedAtMs: NOW - H } }, NOW)
    expect(d.announce).toEqual([])
  })

  it('open again -> REOPENED with the window numbers, and forgotten', () => {
    const d = decideSentryLanes([openLane('delta-crm', 7)], { 'delta-crm': closedMem(NOW - H) }, NOW)
    expect(d.reopened).toEqual([{ org: 'delta-crm', accepted: 7, dropped: 0 }])
    expect(d.next).toEqual({})
    expect(d.degraded).toEqual([])
  })

  it('CONTROL: an open lane that was never degraded is not "reopened"', () => {
    expect(decideSentryLanes([openLane('delta-crm')], {}, NOW).reopened).toEqual([])
  })

  it('an OPEN lane that dropped a significant share over the window is LEAKY (caveat, no edge)', () => {
    const d = decideSentryLanes([{ org: 'delta-crm', ok: true, accepted: [0, 5], rateLimited: [900, 0] }], {}, NOW)
    expect(d.leaky).toEqual([{ org: 'delta-crm', dropped: 900, accepted: 5 }])
    expect(d.announce).toEqual([])
    expect(decideSentryLanes([openLane('delta-crm')], {}, NOW).leaky).toEqual([])
  })

  it('a FAILED stats call on a closed lane is neither a reopening nor a new edge', () => {
    const prev = { 'delta-crm': closedMem(NOW - H) }
    const d = decideSentryLanes([{ org: 'delta-crm', ok: false, reason: 'HTTP 429 from x' }], prev, NOW)
    expect(d.reopened).toEqual([])
    expect(d.announce).toEqual([])
    expect(d.unmeasured).toEqual([{ org: 'delta-crm', reason: 'HTTP 429 from x' }])
    expect(d.next).toEqual(prev)
  })

  it('no traffic on a closed lane keeps it closed (nothing says the quota came back)', () => {
    const prev = { 'delta-crm': closedMem(NOW - H) }
    const d = decideSentryLanes([quietLane('delta-crm')], prev, NOW)
    expect(d.reopened).toEqual([])
    expect(d.degraded.map(c => [c.org, c.state])).toEqual([['delta-crm', 'closed']])
    expect(d.next).toEqual(prev)
  })

  it('an org missing from this tick keeps its memory', () => {
    const prev = { 'delta-crm': closedMem(NOW - H) }
    expect(decideSentryLanes([openLane('agrotech-cv')], prev, NOW).next).toEqual(prev)
  })
})

describe('the notices', () => {
  it('the edge notice names the org, the MEASURED counts, and says quiet is not an all-clear', () => {
    const n = buildLaneNotice(decideSentryLanes([closedLane('delta-crm', 1975)], {}, NOW), NOW)!
    expect(n).toContain('ERROR LANE CLOSED for delta-crm')
    expect(n).toContain('dropped 1975 of 1975 error events (100%)')
    expect(n).toContain('accepted 0 and rate-limited 1975')
    expect(n).toContain('does NOT mean nothing broke')
    expect(n).not.toContain('STILL')
  })

  it('didi 3, the closing day: the 24 h window still holds 500 accepted, and the notice SAYS 500', () => {
    const d = decideSentryLanes([{ org: 'delta-crm', ok: true, accepted: [500, 0, 0], rateLimited: [0, 300, 400] }], {}, NOW)
    const n = buildLaneNotice(d, NOW)!
    expect(n).toContain('accepted 500 and rate-limited 700')
    expect(n).toContain('dropped 400 of 400')
    expect(n).not.toContain('accepted 0 ')
  })

  it('throttled has its own wording: part of the errors arrive', () => {
    const n = buildLaneNotice(decideSentryLanes([throttledLane('delta-crm')], {}, NOW), NOW)!
    expect(n).toContain('ERROR LANE THROTTLED for delta-crm')
    expect(n).toContain('dropped 70 of 100 error events (70%)')
    expect(n).toContain('Only part of the errors arrive')
  })

  it('the daily repeat says STILL and for how long', () => {
    const d = decideSentryLanes([closedLane('delta-crm')],
      { 'delta-crm': { sinceMs: NOW - 2 * LANE_REANNOUNCE_MS, announcedAtMs: NOW - LANE_REANNOUNCE_MS, state: 'closed' } }, NOW)
    expect(buildLaneNotice(d, NOW)).toContain('STILL CLOSED for delta-crm (known to this poller for 2 day(s))')
  })

  it('nothing to say -> null (no message every ten minutes)', () => {
    const prev = { 'delta-crm': closedMem(NOW - H) }
    expect(buildLaneNotice(decideSentryLanes([closedLane('delta-crm')], prev, NOW), NOW)).toBeNull()
    expect(buildLaneNotice(decideSentryLanes([openLane('delta-crm')], {}, NOW), NOW)).toBeNull()
  })

  it('reopened is said, with the window numbers', () => {
    const d = decideSentryLanes([openLane('delta-crm', 7)], { 'delta-crm': closedMem(0) }, NOW)
    expect(buildLaneNotice(d, NOW)).toContain('ERROR LANE REOPENED for delta-crm')
    expect(buildLaneNotice(d, NOW)).toContain('7 error event(s) accepted and 0 rate-limited')
  })

  it('the caveat: closed, throttled, leaky and unmeasured are each said; an all-open tick has none', () => {
    const d = decideSentryLanes([
      closedLane('delta-crm', 226),
      throttledLane('agrotech-cv'),
      { org: 'leaky-org', ok: true, accepted: [0, 5], rateLimited: [900, 0] },
      { org: 'x-org', ok: false, reason: 'HTTP 500 from y' },
    ], {}, NOW)
    const c = laneCaveat(d)!
    expect(c).toContain('ERROR LANE CLOSED for delta-crm (226 dropped, 0 accepted in 24 h)')
    expect(c).toContain('ERROR LANE THROTTLED for agrotech-cv (70 dropped, 30 accepted in 24 h)')
    expect(c).toContain('Error lane open now, but leaky-org (900 dropped, 5 accepted in 24 h)')
    expect(c).toContain('NOT MEASURED this tick (x-org: HTTP 500 from y)')
    expect(laneCaveat(decideSentryLanes([openLane('delta-crm'), quietLane('agrotech-cv')], {}, NOW))).toBeNull()
  })
})

describe('loadLaneMemory keeps the state, and tolerates the older shape', () => {
  it('state round-trips; absent or unknown state is left out (read as closed)', () => {
    const dir = mkTmp('lane-mem-')
    try {
      const p = join(dir, 'm.json')
      writeFileSync(p, JSON.stringify({
        a: { sinceMs: 1, announcedAtMs: 2, state: 'throttled' },
        b: { sinceMs: 3, announcedAtMs: 4 },
        c: { sinceMs: 5, announcedAtMs: 6, state: 'bogus' },
        d: { sinceMs: 'x' },
      }))
      expect(loadLaneMemory(p)).toEqual({
        a: { sinceMs: 1, announcedAtMs: 2, state: 'throttled' },
        b: { sinceMs: 3, announcedAtMs: 4 },
        c: { sinceMs: 5, announcedAtMs: 6 },
      })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('laneFromStatsPayload: Sentry omits a zero outcome, and an unknown shape is NOT zero', () => {
  const intervals = ['2026-09-24T10:00:00Z', '2026-09-24T11:00:00Z', '2026-09-24T12:00:00Z']
  it('the measured 09-24 payload: no `accepted` group at all -> accepted zeros, lane closed', () => {
    const payload = {
      start: 'x', end: 'y', intervals,
      groups: [
        { by: { outcome: 'client_discard' }, totals: { 'sum(quantity)': 125 }, series: { 'sum(quantity)': [46, 43, 36] } },
        { by: { outcome: 'rate_limited' }, totals: { 'sum(quantity)': 226 }, series: { 'sum(quantity)': [70, 81, 75] } },
      ],
    }
    const lane = laneFromStatsPayload(payload, 'delta-crm')
    expect(lane).toEqual({ org: 'delta-crm', ok: true, accepted: [0, 0, 0], rateLimited: [70, 81, 75] })
    if (lane.ok) expect(classifyLane(lane.accepted, lane.rateLimited).state).toBe('closed')
  })

  it('no groups (the measured agrotech-cv answer) -> no-traffic, not closed', () => {
    const lane = laneFromStatsPayload({ intervals, groups: [] }, 'agrotech-cv')
    expect(lane.ok).toBe(true)
    if (lane.ok) expect(classifyLane(lane.accepted, lane.rateLimited).state).toBe('no-traffic')
  })

  it('an unknown shape is UNMEASURED, not quiet', () => {
    expect(laneFromStatsPayload({ data: [] }, 'delta-crm').ok).toBe(false)
    expect(laneFromStatsPayload(null, 'delta-crm').ok).toBe(false)
  })
})
