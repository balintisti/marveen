import { describe, it, expect } from 'vitest'
import {
  seriesVerdict,
  decideUptimeAlerts,
  buildUptimeNotice,
  buildUnreadableNotice,
  BLIND_REANNOUNCE_MS,
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

// THE RE-ANNOUNCE WINDOW (card 71349fe1, reopened on didi's finding).
//
// The outage path announces on the EDGE; before this, the unreadable path
// announced on the LEVEL -- every tick, ~30/hour, unbounded. Neither extreme is
// right, and the two tests below are deliberately a PAIR: one goes red if the
// window collapses to 0 (back to the level), the other goes red if it grows to
// Infinity (a bare edge, which is the silent failure this card removes). A
// one-directional mutation would leave exactly the half didi argued about
// uncovered.
describe('a blind spell re-announces on a window, not on the level and not once ever', () => {
  const blind: UptimeSeries[] = []

  // Its own assertion, because every other test here now uses a literal hour.
  it('the window is one hour', () => {
    expect(BLIND_REANNOUNCE_MS).toBe(3_600_000)
  })

  it('announces on the EDGE of a blind spell', () => {
    const d = decideUptimeAlerts(blind, COND, NO_UPTIME_STATE, NOW)
    expect(d.announceBlind).toBe(true)
    expect(buildUnreadableNotice(d, 0, NOW)).toContain('NO UPTIME DATA AT ALL')
  })

  // RED if BLIND_REANNOUNCE_MS becomes 0.
  it('stays SILENT on the next tick inside the window', () => {
    const first = decideUptimeAlerts(blind, COND, NO_UPTIME_STATE, NOW)
    const twoMinLater = decideUptimeAlerts(blind, COND, first.next, NOW + 120_000)
    expect(twoMinLater.announceBlind).toBe(false)
    expect(buildUnreadableNotice(twoMinLater, 0, NOW + 120_000)).toBeNull()
  })

  // RED if BLIND_REANNOUNCE_MS becomes Infinity. This is the half that matters
  // most: "I cannot measure" has no RECOVERED event to close it, so going quiet
  // leaves the fleet believing the watcher works.
  it('RE-ANNOUNCES once the window has passed, because blindness has no recovery event', () => {
    const first = decideUptimeAlerts(blind, COND, NO_UPTIME_STATE, NOW)
    // LITERAL, not NOW + BLIND_REANNOUNCE_MS. Deriving the fixture from the
    // constant makes it move WITH a mutation of that constant: the Infinity
    // mutation SURVIVED the first version of this test for exactly that reason
    // (measured, 2026-09-05). The constant gets its own assertion below instead.
    const later = NOW + 3_600_000
    const d = decideUptimeAlerts(blind, COND, first.next, later)
    expect(d.announceBlind).toBe(true)
    const n = buildUnreadableNotice(d, 0, later)!
    // and the repeat is LABELLED, or identical hourly notices read as flapping
    expect(n).toContain('STILL BLIND since')
    expect(n).toContain('this is a repeat, not a new event')
  })

  // The window must not survive the spell that opened it: a spell that ends and
  // a new one that starts 10 minutes later is a NEW event, not a suppressed repeat.
  it('resets when sight returns, so the next blind spell announces on its own edge', () => {
    const first = decideUptimeAlerts(blind, COND, NO_UPTIME_STATE, NOW)
    const sighted = decideUptimeAlerts([series(Array(11).fill(true))], COND, first.next, NOW + 60_000)
    expect(sighted.announceBlind).toBe(false)
    expect(sighted.blindSinceMs).toBeNull()
    const blindAgain = decideUptimeAlerts(blind, COND, sighted.next, NOW + 600_000)
    expect(blindAgain.announceBlind).toBe(true)
  })

  // CONTROL: the window must not turn the loud path into a quiet one for a
  // HEALTHY fetch -- otherwise "silent" and "capped" become the same output.
  it('CONTROL: a healthy tick is silent for its own reason, not the window', () => {
    const healthy = decideUptimeAlerts([series(Array(11).fill(true))], COND, NO_UPTIME_STATE, NOW)
    expect(healthy.announceBlind).toBe(false)
    expect(healthy.noSeries).toBe(false)
    expect(buildUnreadableNotice(healthy, 1, NOW)).toBeNull()
  })

  // The unknown path shares the window: it is the same "cannot measure" claim.
  it('applies to the unknown path too, not only to zero series', () => {
    const first = decideUptimeAlerts([series([])], COND, NO_UPTIME_STATE, NOW)
    expect(first.announceBlind).toBe(true)
    const soon = decideUptimeAlerts([series([])], COND, first.next, NOW + 120_000)
    expect(buildUnreadableNotice(soon, 1, NOW + 120_000)).toBeNull()
  })
})
