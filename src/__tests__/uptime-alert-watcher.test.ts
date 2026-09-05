import { describe, it, expect } from 'vitest'
import { conditionFromPolicies, seriesFromPayload, describeExecFailure, redactSecrets, GCLOUD_STDIO } from '../web/uptime-alert-watcher.js'

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

// ---- card 8fe678ef: three causes must stop arriving as one null ----
//
// The notice on 2026-09-05 20:43 had to list three possibilities and could rule
// out none, because stderr went to 'ignore' and the catch was bare. marveen
// closed it BY HAND: production was up (12 series / 275 points / zero failures),
// the token worked in the service's own environment, ~30x timeout headroom. The
// poller was right to be loud -- it just could not say why.
describe('describeExecFailure names ONE cause instead of a disjunction', () => {
  it('a missing binary is named, not guessed at', () => {
    const r = describeExecFailure(Object.assign(new Error('spawn gcloud ENOENT'), { code: 'ENOENT' }))
    expect(r).toContain('not on PATH')
    expect(r).toContain('ENOENT')
  })

  it('a timeout is named, with the budget it blew', () => {
    expect(describeExecFailure(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), 15_000))
      .toContain('timed out after 15000 ms')
  })

  // node kills a timed-out child with SIGTERM and reports the SIGNAL, not the
  // code -- so matching only on ETIMEDOUT would misfile the commonest timeout.
  it('a SIGTERM kill is read as the timeout it is, not as an unknown failure', () => {
    expect(describeExecFailure({ signal: 'SIGTERM', status: null }, 15_000)).toContain('timed out')
  })

  it('a non-zero exit carries the exit code AND what gcloud actually said', () => {
    const r = describeExecFailure({ status: 1, stderr: 'ERROR: (gcloud.auth) You do not currently have an active account' })
    expect(r).toContain('exited 1')
    expect(r).toContain('do not currently have an active account')
  })

  it('an empty stderr says so, rather than implying gcloud was silent by choice', () => {
    expect(describeExecFailure({ status: 2, stderr: '' })).toContain('printed nothing to stderr')
  })

  it('truncates, so a runaway stderr cannot flood the fleet queue', () => {
    const r = describeExecFailure({ status: 1, stderr: 'x'.repeat(5000) })
    expect(r.length).toBeLessThan(400)
  })
})

// THE SAFETY PROPERTY, and the reason it is not paranoia here: the command whose
// stderr we now quote is `gcloud auth print-access-token`, and this notice is
// fleet-visible. The module's header already forbids putting the token on a
// command line; capturing stderr must not become the hole that rule closed.
describe('redactSecrets keeps a credential out of a fleet-visible notice', () => {
  it('redacts a Google access token', () => {
    const out = redactSecrets('warning: reusing ya29.a0ARrdaM9xKfQ2bLm3nPqRsTuVwXyZ0123456789abcdef for auth')
    expect(out).not.toContain('a0ARrdaM9xKfQ2')
    expect(out).toContain('[REDACTED]')
  })

  it('redacts a long opaque secret that does not look like ya29.', () => {
    const secret = 'A'.repeat(64)
    expect(redactSecrets(`token=${secret}`)).not.toContain(secret)
  })

  // CONTROL, and it is the load-bearing half: a redactor that ate everything
  // would pass both tests above while destroying the diagnosis the card exists
  // to deliver. Ordinary gcloud prose must survive intact.
  it('CONTROL: ordinary error prose survives untouched', () => {
    const msg = 'ERROR: (gcloud.auth) You do not currently have an active account selected'
    expect(redactSecrets(msg)).toBe(msg)
  })
})

// THE WIRING, not the formatter. Reverting stdio[2] to 'ignore' -- the exact
// defect this card names -- left all fifteen tests above GREEN, because they hand
// describeExecFailure an error that already carries .stderr. Measured, not
// assumed: the mutation survived, so this test exists.
describe('gcloud stderr is CAPTURED, which is the defect itself', () => {
  it('stdio[2] is pipe, not ignore', () => {
    expect(GCLOUD_STDIO[2]).toBe('pipe')
    expect(GCLOUD_STDIO[1]).toBe('pipe') // stdout still needed: it carries the token
  })
})
