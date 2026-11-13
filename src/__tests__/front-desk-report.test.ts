// Card f043d3f5: a REPORT addressed to the front desk goes to the coordinator only when the desk
// measurably cannot read it (not running, or a running desk whose oldest pending row is too old).
// Pure rule, driven with probes; the live POST path is in messages-post-front-desk.test.ts.
import { describe, it, expect } from 'vitest'
import {
  FRONT_DESK_DOWN_TAG,
  FRONT_DESK_STALL_SEC,
  frontDeskDownHeader,
  frontDeskReportRecipient,
  type FrontDeskReportProbe,
} from '../front-desk.js'

const COORD = 'coord'
const probe = (o: Partial<{ running: boolean; age: unknown; known: string[]; throws: boolean }> = {}): FrontDeskReportProbe => ({
  isKnown: (a) => {
    if (o.throws) throw new Error('registry down')
    return (o.known ?? [COORD, 'desk', 'didi']).includes(a)
  },
  isRunning: () => o.running ?? true,
  oldestPendingSec: () => (o.age ?? 0) as number,
})
const route = (sender: string, to: string, p: FrontDeskReportProbe, configured: string | null = 'desk') =>
  frontDeskReportRecipient(COORD, configured, sender, to, p)

describe('frontDeskReportRecipient', () => {
  it('a running desk that takes its queue keeps the report', () => {
    expect(route('didi', 'desk', probe())).toEqual({ to: 'desk', rerouted: false, why: 'desk-ok' })
    expect(route('didi', 'desk', probe({ age: FRONT_DESK_STALL_SEC - 1 }))).toEqual({ to: 'desk', rerouted: false, why: 'desk-ok' })
  })

  it('a desk that is not running: the report goes to the coordinator', () => {
    expect(route('didi', 'desk', probe({ running: false }))).toEqual({ to: COORD, rerouted: true, why: 'desk-not-running' })
  })

  it('a running desk whose oldest pending row is FRONT_DESK_STALL_SEC old: the coordinator, with the measured age', () => {
    expect(route('didi', 'desk', probe({ age: FRONT_DESK_STALL_SEC }))).toEqual({
      to: COORD, rerouted: true, why: 'desk-stalled', oldestPendingSec: FRONT_DESK_STALL_SEC,
    })
  })

  it('a message to anyone but the configured desk is not touched', () => {
    expect(route('didi', 'ford', probe({ running: false }))).toEqual({ to: 'ford', rerouted: false, why: 'not-to-desk' })
    expect(route('didi', COORD, probe({ running: false }))).toEqual({ to: COORD, rerouted: false, why: 'not-to-desk' })
  })

  it('no usable desk configured: nothing to reroute', () => {
    for (const c of [null, '', 'de sk', COORD]) {
      expect(route('didi', 'desk', probe({ running: false }), c).rerouted).toBe(false)
    }
  })

  it('only a fleet agent reports: the coordinator, the desk itself and a non-agent reach the desk as sent', () => {
    for (const s of [COORD, 'desk', 'owner']) {
      expect(route(s, 'desk', probe({ running: false }))).toEqual({ to: 'desk', rerouted: false, why: 'sender-not-agent' })
    }
  })

  it('a failed probe is not evidence the desk is down: the report stays', () => {
    expect(route('didi', 'desk', probe({ throws: true }))).toEqual({ to: 'desk', rerouted: false, why: 'probe-failed' })
    expect(route('didi', 'desk', probe({ age: NaN }))).toEqual({ to: 'desk', rerouted: false, why: 'probe-failed' })
    expect(route('didi', 'desk', probe({ age: 'x' }))).toEqual({ to: 'desk', rerouted: false, why: 'probe-failed' })
  })

  it('the header is one JSON line after the tag and names the requested desk and the reason', () => {
    const h = frontDeskDownHeader({ to: COORD, rerouted: true, why: 'desk-stalled', oldestPendingSec: 2400 }, 'desk')
    expect(h.startsWith(`${FRONT_DESK_DOWN_TAG} `)).toBe(true)
    expect(h).not.toContain('\n')
    expect(JSON.parse(h.slice(FRONT_DESK_DOWN_TAG.length + 1))).toEqual({ v: 1, requested: 'desk', why: 'desk-stalled', oldest_pending_sec: 2400 })
    const n = frontDeskDownHeader({ to: COORD, rerouted: true, why: 'desk-not-running' }, 'desk')
    expect(JSON.parse(n.slice(FRONT_DESK_DOWN_TAG.length + 1)).oldest_pending_sec).toBeNull()
  })
})
