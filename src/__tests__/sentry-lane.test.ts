import { describe, it, expect } from 'vitest'
import {
  classifyLane,
  decideSentryLanes,
  buildLaneNotice,
  laneCaveat,
  LANE_REANNOUNCE_MS,
  type SentryLaneReading,
} from '../sentry-issues.js'
import { laneFromStatsPayload } from '../web/sentry-issue-watcher.js'

// Card 6db77c30 (the B half of 32f40913). Measured 2026-09-24: delta-crm's error lane accepted 0 and
// rate-limited ~2000/day since 09-19, and the watcher's "NOTHING first appeared" was true and
// byte-identical to a healthy week.
const NOW = Date.parse('2026-09-24T12:40:00Z')
const H = 3_600_000
const zeros = (n: number) => new Array(n).fill(0)

describe('classifyLane: the state comes from the last hour that had traffic', () => {
  it('the measured 09-24 shape: rate-limited hours, then three empty ones -> CLOSED', () => {
    const acc = zeros(25)
    const rl = [...zeros(19), 70, 81, 75, 0, 0, 0]
    expect(classifyLane(acc, rl)).toEqual({ state: 'closed', dropped: 226, accepted: 0 })
  })

  it('the 09-18 shape: accepted early in the window, rate-limited later -> CLOSED, not "open by total"', () => {
    const acc = [155, ...zeros(24)]
    const rl = [0, ...zeros(10), 50, 60, ...zeros(12)]
    expect(classifyLane(acc, rl).state).toBe('closed')
  })

  it('CONTROL: accepted in the last traffic hour -> OPEN, even with rate-limiting earlier', () => {
    const acc = [...zeros(20), 4, 0, 0, 0, 0]
    const rl = [30, 40, ...zeros(23)]
    expect(classifyLane(acc, rl).state).toBe('open')
  })

  it('an hour with BOTH accepted and rate-limited is open (partial acceptance)', () => {
    expect(classifyLane([0, 3], [5, 9]).state).toBe('open')
  })

  it('no traffic in the whole window -> no-traffic, never closed', () => {
    expect(classifyLane(zeros(25), zeros(25))).toEqual({ state: 'no-traffic', dropped: 0, accepted: 0 })
  })
})

const closedLane = (org: string, dropped = 226): SentryLaneReading =>
  ({ org, ok: true, accepted: zeros(3), rateLimited: [dropped, 0, 0] })
const openLane = (org: string, accepted = 5): SentryLaneReading =>
  ({ org, ok: true, accepted: [0, accepted, 0], rateLimited: zeros(3) })
const quietLane = (org: string): SentryLaneReading => ({ org, ok: true, accepted: zeros(3), rateLimited: zeros(3) })

describe('decideSentryLanes: edges, the daily repeat, and what does NOT count as an edge', () => {
  it('first sighting of a closed lane announces once, and remembers it', () => {
    const d = decideSentryLanes([closedLane('delta-crm'), quietLane('agrotech-cv')], {}, NOW)
    expect(d.announceClosed).toEqual([{ org: 'delta-crm', dropped: 226, sinceMs: NOW, repeat: false }])
    expect(d.closed.map(c => c.org)).toEqual(['delta-crm'])
    expect(d.next).toEqual({ 'delta-crm': { sinceMs: NOW, announcedAtMs: NOW } })
  })

  it('still closed an hour later: silent, but still CLOSED for the caveat', () => {
    const prev = { 'delta-crm': { sinceMs: NOW - H, announcedAtMs: NOW - H } }
    const d = decideSentryLanes([closedLane('delta-crm')], prev, NOW)
    expect(d.announceClosed).toEqual([])
    expect(d.closed.map(c => c.org)).toEqual(['delta-crm'])
    expect(d.next).toEqual(prev)
  })

  it('the daily repeat fires at exactly LANE_REANNOUNCE_MS, not a second earlier', () => {
    const since = NOW - 3 * LANE_REANNOUNCE_MS
    const due = decideSentryLanes([closedLane('delta-crm')],
      { 'delta-crm': { sinceMs: since, announcedAtMs: NOW - LANE_REANNOUNCE_MS } }, NOW)
    expect(due.announceClosed).toEqual([{ org: 'delta-crm', dropped: 226, sinceMs: since, repeat: true }])
    expect(due.next['delta-crm']).toEqual({ sinceMs: since, announcedAtMs: NOW })
    const early = decideSentryLanes([closedLane('delta-crm')],
      { 'delta-crm': { sinceMs: since, announcedAtMs: NOW - LANE_REANNOUNCE_MS + 1000 } }, NOW)
    expect(early.announceClosed).toEqual([])
  })

  it('accepted events again -> REOPENED, and forgotten', () => {
    const d = decideSentryLanes([openLane('delta-crm', 7)], { 'delta-crm': { sinceMs: NOW - H, announcedAtMs: NOW - H } }, NOW)
    expect(d.reopened).toEqual([{ org: 'delta-crm', accepted: 7 }])
    expect(d.next).toEqual({})
    expect(d.closed).toEqual([])
  })

  it('CONTROL: an open lane that was never closed is not "reopened"', () => {
    expect(decideSentryLanes([openLane('delta-crm')], {}, NOW).reopened).toEqual([])
  })

  it('a FAILED stats call on a closed lane is neither a reopening nor a new edge', () => {
    const prev = { 'delta-crm': { sinceMs: NOW - H, announcedAtMs: NOW - H } }
    const d = decideSentryLanes([{ org: 'delta-crm', ok: false, reason: 'HTTP 429 from x' }], prev, NOW)
    expect(d.reopened).toEqual([])
    expect(d.announceClosed).toEqual([])
    expect(d.unmeasured).toEqual([{ org: 'delta-crm', reason: 'HTTP 429 from x' }])
    expect(d.next).toEqual(prev)
  })

  it('no traffic on a closed lane keeps it closed (nothing says the quota came back)', () => {
    const prev = { 'delta-crm': { sinceMs: NOW - H, announcedAtMs: NOW - H } }
    const d = decideSentryLanes([quietLane('delta-crm')], prev, NOW)
    expect(d.reopened).toEqual([])
    expect(d.closed.map(c => c.org)).toEqual(['delta-crm'])
    expect(d.next).toEqual(prev)
  })

  it('an org missing from this tick keeps its memory', () => {
    const prev = { 'delta-crm': { sinceMs: NOW - H, announcedAtMs: NOW - H } }
    expect(decideSentryLanes([openLane('agrotech-cv')], prev, NOW).next).toEqual(prev)
  })
})

describe('the notices', () => {
  it('the edge notice names the org, the dropped count, and says quiet is not an all-clear', () => {
    const n = buildLaneNotice(decideSentryLanes([closedLane('delta-crm', 1975)], {}, NOW), NOW)!
    expect(n).toContain('ERROR LANE CLOSED for delta-crm')
    expect(n).toContain('rate-limited 1975')
    expect(n).toContain('does NOT mean nothing broke')
    expect(n).not.toContain('STILL')
  })

  it('the daily repeat says STILL and for how long', () => {
    const d = decideSentryLanes([closedLane('delta-crm')],
      { 'delta-crm': { sinceMs: NOW - 2 * LANE_REANNOUNCE_MS, announcedAtMs: NOW - LANE_REANNOUNCE_MS } }, NOW)
    expect(buildLaneNotice(d, NOW)).toContain('STILL CLOSED for delta-crm (known to this poller for 2 day(s))')
  })

  it('nothing to say -> null (no message every ten minutes)', () => {
    const prev = { 'delta-crm': { sinceMs: NOW - H, announcedAtMs: NOW - H } }
    expect(buildLaneNotice(decideSentryLanes([closedLane('delta-crm')], prev, NOW), NOW)).toBeNull()
    expect(buildLaneNotice(decideSentryLanes([openLane('delta-crm')], {}, NOW), NOW)).toBeNull()
  })

  it('reopened is said', () => {
    const d = decideSentryLanes([openLane('delta-crm', 7)], { 'delta-crm': { sinceMs: 0, announcedAtMs: 0 } }, NOW)
    expect(buildLaneNotice(d, NOW)).toContain('ERROR LANE REOPENED for delta-crm: 7')
  })

  it('the caveat: closed and unmeasured are both said; an all-open tick has none', () => {
    const d = decideSentryLanes(
      [closedLane('delta-crm', 226), { org: 'agrotech-cv', ok: false, reason: 'HTTP 500 from y' }], {}, NOW)
    const c = laneCaveat(d)!
    expect(c).toContain('ERROR LANE CLOSED for delta-crm (226 dropped in 24 h)')
    expect(c).toContain('NOT MEASURED this tick (agrotech-cv: HTTP 500 from y)')
    expect(laneCaveat(decideSentryLanes([openLane('delta-crm'), quietLane('agrotech-cv')], {}, NOW))).toBeNull()
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
