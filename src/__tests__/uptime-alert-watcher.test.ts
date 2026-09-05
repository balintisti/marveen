import { describe, it, expect } from 'vitest'
import { conditionFromPolicies, seriesFromPayload } from '../web/uptime-alert-watcher.js'

// VERBATIM SHAPES from the live project, 2026-09-05, GET
// /v3/projects/delta-crm-483922/{alertPolicies,timeSeries}. Trimmed to the
// fields the parser reads -- not invented, which is the difference between a
// parser test and a test of my idea of the payload.
const POLICY_PAYLOAD = {
  alertPolicies: [{
    displayName: 'Delta-CRM uptime -- egy szolgaltatas nem valaszol',
    conditions: [{
      displayName: 'uptime check bukik 10+ percen at',
      conditionThreshold: {
        filter: 'metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND resource.type="uptime_url"',
        comparison: 'COMPARISON_LT',
        thresholdValue: 0.5,
        duration: '600s',
        trigger: { count: 1 },
      },
    }],
    notificationChannels: ['projects/delta-crm-483922/notificationChannels/478665159464137764'],
  }],
}

const SERIES_PAYLOAD = {
  timeSeries: [{
    metric: { labels: { check_id: 'delta-crm-backend-jsIag_Nlopc', checker_location: 'eur-belgium' } },
    resource: { labels: { host: 'delta-crm-backend-755fg4x27a-ew.a.run.app' } },
    points: [
      { interval: { endTime: '2026-09-05T17:00:00Z' }, value: { boolValue: true } },
      { interval: { endTime: '2026-09-05T16:59:00Z' }, value: { boolValue: false } },
    ],
  }],
}

describe('conditionFromPolicies: read the policy, never hardcode it', () => {
  it('reads duration and trigger off the live payload shape', () => {
    expect(conditionFromPolicies(POLICY_PAYLOAD)).toEqual({ durationSeconds: 600, triggerCount: 1 })
  })

  // THE POINT OF READING IT AT ALL. If the threshold is tightened in the
  // console, the poller must follow -- a hardcoded 600 would keep answering
  // yesterday's question and nothing about the output would look wrong.
  it('follows the policy when the threshold changes', () => {
    const tightened = structuredClone(POLICY_PAYLOAD)
    tightened.alertPolicies[0].conditions[0].conditionThreshold.duration = '300s'
    tightened.alertPolicies[0].conditions[0].conditionThreshold.trigger.count = 3
    expect(conditionFromPolicies(tightened)).toEqual({ durationSeconds: 300, triggerCount: 3 })
  })

  // null, NOT a silent default. The caller substitutes a fallback AND says so in
  // the notice; returning 600 here would make "policy unreadable" and "policy
  // says 600" the same value, which is the collapse this whole card is about.
  it('returns null on junk rather than inventing a condition', () => {
    expect(conditionFromPolicies(null)).toBeNull()
    expect(conditionFromPolicies({})).toBeNull()
    expect(conditionFromPolicies({ alertPolicies: [] })).toBeNull()
    expect(conditionFromPolicies({ alertPolicies: [{ conditions: [{}] }] })).toBeNull()
  })
})

describe('seriesFromPayload', () => {
  it('flattens the live shape into what the decision layer consumes', () => {
    const s = seriesFromPayload(SERIES_PAYLOAD)
    expect(s).toHaveLength(1)
    expect(s[0].checkId).toBe('delta-crm-backend-jsIag_Nlopc')
    expect(s[0].checkerLocation).toBe('eur-belgium')
    expect(s[0].host).toContain('delta-crm-backend')
    expect(s[0].points.map(p => p.passed)).toEqual([true, false])
  })

  // A MISSING boolValue MUST SURVIVE AS undefined, because the decision layer
  // turns that into 'unknown'. Defaulting it to false here would manufacture an
  // outage out of a gap in the data; defaulting to true would hide one.
  it('preserves a missing boolValue as undefined, inventing neither pass nor fail', () => {
    const gap = structuredClone(SERIES_PAYLOAD)
    // @ts-expect-error deliberately modelling a point the API returned without a value
    gap.timeSeries[0].points[0].value = {}
    const s = seriesFromPayload(gap)
    expect(s[0].points[0].passed).toBeUndefined()
  })

  // An empty/failed fetch yields ZERO series -- which the decision layer treats
  // as the loud no-data case. This pins the handoff between the two layers.
  it('returns [] for a failed or empty fetch', () => {
    expect(seriesFromPayload(null)).toEqual([])
    expect(seriesFromPayload({})).toEqual([])
    expect(seriesFromPayload({ timeSeries: [] })).toEqual([])
  })
})
