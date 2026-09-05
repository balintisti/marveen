import { describe, it, expect } from 'vitest'
import {
  seriesVerdict,
  decideUptimeAlerts,
  buildUptimeNotice,
  buildUnreadableNotice,
  NO_UPTIME_STATE,
  type UptimeSeries,
  type UptimeCondition,
} from '../uptime-alert.js'

// The live policy, measured 2026-09-05 from GET /v3/projects/<p>/alertPolicies:
// COMPARISON_LT 0.5 over 600s, trigger count 1.
const COND: UptimeCondition = { durationSeconds: 600, triggerCount: 1 }
const NOW = Date.parse('2026-09-05T17:00:00Z')

// One point per minute, which is the real cadence (12 points per 10-min window
// per series, measured on the live project).
function series(passed: boolean[], over = { checkId: 'backend', loc: 'eur-belgium' }): UptimeSeries {
  return {
    checkId: over.checkId,
    checkerLocation: over.loc,
    host: 'delta-crm-backend-755fg4x27a-ew.a.run.app',
    points: passed.map((p, i) => ({
      endTime: new Date(NOW - (passed.length - 1 - i) * 60_000).toISOString(),
      passed: p,
    })),
  }
}

describe('seriesVerdict: the condition, matched to the policy rather than invented', () => {
  it('all failing for the full window fires', () => {
    expect(seriesVerdict(series(Array(11).fill(false)), COND, NOW).verdict).toBe('firing')
  })

  it('ONE pass inside the window breaks the continuity, so it is clear', () => {
    const p = Array(11).fill(false)
    p[5] = true
    expect(seriesVerdict(series(p), COND, NOW).verdict).toBe('clear')
  })

  it('all passing is clear', () => {
    expect(seriesVerdict(series(Array(11).fill(true)), COND, NOW).verdict).toBe('clear')
  })

  // THE ANSWER THIS CARD EXISTS FOR. An alerting path that reads "no data" as
  // "fine" is the failure being fixed, not a corner case.
  it('no points in the window is UNKNOWN, never clear', () => {
    const stale = series([false, false])
    stale.points = stale.points.map(p => ({ ...p, endTime: new Date(NOW - 3 * 3600_000).toISOString() }))
    const v = seriesVerdict(stale, COND, NOW)
    expect(v.verdict).toBe('unknown')
    expect(v.verdict).not.toBe('clear')
  })

  it('a point with no boolean reading is UNKNOWN, never clear', () => {
    const s = series([false, false])
    s.points[1] = { ...s.points[1], passed: undefined }
    const v = seriesVerdict(s, COND, NOW)
    expect(v.verdict).toBe('unknown')
    expect(v.verdict).not.toBe('clear')
  })

  // Points OUTSIDE the window must not decide it -- a service that failed an
  // hour ago and recovered is not firing now.
  it('failures older than the window do not fire it', () => {
    const s = series(Array(11).fill(false))
    s.points = s.points.map(p => ({ ...p, endTime: new Date(NOW - 3 * 3600_000).toISOString() }))
    expect(seriesVerdict(s, COND, NOW).verdict).toBe('unknown')
  })
})

describe('decideUptimeAlerts: announce on the EDGE, not the level', () => {
  const down = series(Array(11).fill(false))
  const up = series(Array(11).fill(true))

  it('a new outage announces once', () => {
    const d = decideUptimeAlerts([down], COND, NO_UPTIME_STATE, NOW)
    expect(d.newlyFiring).toHaveLength(1)
    expect(d.policyWouldFire).toBe(true)
  })

  it('the SAME outage on the next tick announces nothing', () => {
    const first = decideUptimeAlerts([down], COND, NO_UPTIME_STATE, NOW)
    const second = decideUptimeAlerts([down], COND, first.next, NOW)
    expect(second.newlyFiring).toHaveLength(0)
    // still firing, just not re-announced
    expect(second.policyWouldFire).toBe(true)
    expect(buildUptimeNotice(second, 1)).toBeNull()
  })

  it('recovery is announced, so the fleet is not left believing prod is still down', () => {
    const first = decideUptimeAlerts([down], COND, NO_UPTIME_STATE, NOW)
    const back = decideUptimeAlerts([up], COND, first.next, NOW)
    expect(back.recovered).toHaveLength(1)
    expect(back.next.firing).toHaveLength(0)
    expect(buildUptimeNotice(back, 1)).toContain('RECOVERED')
  })

  // AN UNKNOWN MUST NOT SILENTLY RETRACT AN OPEN OUTAGE. Dropping it would
  // close the incident and then re-open it on the next readable tick, which
  // reads as flapping and trains people to ignore it.
  it('an unreadable series keeps an open outage open', () => {
    const first = decideUptimeAlerts([down], COND, NO_UPTIME_STATE, NOW)
    const blind = series([])
    const next = decideUptimeAlerts([blind], COND, first.next, NOW)
    expect(next.recovered).toHaveLength(0)
    expect(next.next.firing).toEqual(first.next.firing)
    expect(next.unknown).toHaveLength(1)
  })

  it('one failing location out of six meets the live trigger of 1', () => {
    const six = [
      down,
      ...['usa-iowa', 'usa-oregon', 'usa-virginia', 'apac-singapore', 'sa-brazil'].map(loc =>
        series(Array(11).fill(true), { checkId: 'backend', loc }),
      ),
    ]
    const d = decideUptimeAlerts(six, COND, NO_UPTIME_STATE, NOW)
    expect(d.policyWouldFire).toBe(true)
    expect(d.newlyFiring).toHaveLength(1)
  })
})

describe('the notices say what a reader must not conclude', () => {
  it('the outage notice names host AND location, and warns about the 1-series trigger', () => {
    const d = decideUptimeAlerts([series(Array(11).fill(false))], COND, NO_UPTIME_STATE, NOW)
    const n = buildUptimeNotice(d, 12)!
    expect(n).toContain('eur-belgium')
    expect(n).toContain('delta-crm-backend')
    expect(n).toMatch(/not by itself proof/)
  })

  // "CANNOT MEASURE" IS A SEPARATE MESSAGE FROM "IS DOWN", and collapsing them
  // is the exact failure mode of the backup alert that sat on 403 for months.
  it('unreadable produces its own notice, and never a clear one', () => {
    const d = decideUptimeAlerts([series([])], COND, NO_UPTIME_STATE, NOW)
    expect(buildUptimeNotice(d, 12)).toBeNull()
    const u = buildUnreadableNotice(d, 12)!
    expect(u).toContain('CANNOT MEASURE')
    expect(u).toMatch(/NOT a clear result/)
  })

  // MARVEEN'S REQUIREMENT, AND IT FOUND A HOLE THE OTHER 14 TESTS DID NOT.
  // "A missing or expired gcloud token must NEVER read as no alerts." A total
  // fetch failure hands in ZERO series -- and before this, every field then
  // reported the shape of good news: nothing firing, nothing unknown,
  // policyWouldFire false, both notices null. Silence, which is what health
  // looks like, and byte-for-byte the backup alert that sat on a 403 for months.
  //
  // The 14 tests and 7 caught mutations all missed it because every one handed
  // in at least one series. The gap was in the INPUT SPACE, not the logic.
  it('ZERO series -- the no-token path -- is LOUD, not silent', () => {
    const d = decideUptimeAlerts([], COND, NO_UPTIME_STATE, NOW)
    expect(d.noSeries).toBe(true)
    const n = buildUnreadableNotice(d, 0)
    expect(n).not.toBeNull()
    expect(n).toContain('NO UPTIME DATA AT ALL')
    expect(n).toMatch(/NOT a clear result/)
    // CONTROL: a populated, healthy fetch must NOT trip this -- otherwise the
    // loud path fires forever and gets ignored, which is the same silence by
    // another route.
    const healthy = decideUptimeAlerts([series(Array(11).fill(true))], COND, NO_UPTIME_STATE, NOW)
    expect(healthy.noSeries).toBe(false)
    expect(buildUnreadableNotice(healthy, 1)).toBeNull()
  })

  it('nothing happening produces no notice at all', () => {
    const d = decideUptimeAlerts([series(Array(11).fill(true))], COND, NO_UPTIME_STATE, NOW)
    expect(buildUptimeNotice(d, 12)).toBeNull()
    expect(buildUnreadableNotice(d, 12)).toBeNull()
  })
})
