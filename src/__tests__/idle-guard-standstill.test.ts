/**
 * A DECLARED, EXPIRING STANDSTILL (card 00f7455b).
 *
 * dexter's three stops on 2026-08-26 are the fixtures: a fleet stop ("there is work, it is
 * forbidden"), a budget stop of his own, and a budget stop agreed with the coordinator with a
 * known reset. All three must stay silent while they hold, and real idleness must still wake.
 * The other half is the way out: an expired, a broken or an over-long entry must NOT silence,
 * and the guard's messages must name it, or it sits in workcheck.json believed to work.
 */
import { describe, it, expect } from 'vitest'
import {
  decideIdleAlert,
  parseWorkCheck,
  standstillVerdict,
  standstillNote,
  STANDSTILL_MAX_AHEAD_MS,
  NO_IDLE_STATE,
  type IdleAgentInput,
  type IdleAgentThresholds,
  type WorkCheck,
} from '../idle-agent.js'

const TH: IdleAgentThresholds = {
  sustainedMs: 10 * 60_000,
  realertMs: 30 * 60_000,
  wakeGraceMs: 15 * 60_000,
  wakeCooldownMs: 30 * 60_000,
}

// 2026-08-26 12:47 CEST, the third stop
const NOW = Date.parse('2026-08-26T12:47:00+02:00')
const MIN = 60_000

const idleWithWork: IdleAgentInput = {
  agent: 'dexter',
  running: true,
  paneIdle: true,
  pendingMessages: 0,
  ownWorkCount: 3,
  workCheckKind: 'assigned_open_cards',
}

function check(standstill: unknown): WorkCheck {
  const c = parseWorkCheck(JSON.stringify({ kind: 'assigned_open_cards', standstill }))
  if (!c) throw new Error('declaration did not parse')
  return c
}

/** Run the guard for 40 minutes of idleness with the standstill as the watcher would judge it
 *  on each tick, and collect every alert it raises. */
function run(c: WorkCheck | null, input: IdleAgentInput, pidAlive: boolean | null = null) {
  let state = NO_IDLE_STATE
  const alerts: string[] = []
  const reasons: string[] = []
  for (let t = 0; t <= 40; t += 3) {
    const now = NOW + t * MIN
    const v = standstillVerdict(c, now, pidAlive)
    const r = decideIdleAlert({ ...input, standstillActive: v.state === 'active' }, state, TH, now)
    state = r.next
    reasons.push(r.decision.reason)
    if (r.decision.alert) alerts.push(r.decision.reason)
  }
  return { alerts, reasons }
}

describe('dexter\'s three stops stay silent while they hold', () => {
  it.each([
    ['fleet stop (forbidden, card named)', { reason: 'forbidden', until: '2026-08-26T18:00:00+02:00', card: '11ef4c0a' }],
    ['budget stop of his own', { reason: 'budget', until: '2026-08-27T08:00:00+02:00' }],
    ['budget stop with a known reset, in UTC', { reason: 'budget', until: '2026-08-27T06:00:00Z' }],
  ])('%s', (_name, standstill) => {
    const c = check(standstill)
    expect(c.standstillError).toBeUndefined()
    const { alerts, reasons } = run(c, idleWithWork)
    expect(alerts).toEqual([])
    expect(new Set(reasons)).toEqual(new Set(['standstill']))
  })

  it('the no-work notice is silenced too (a stop with an empty queue)', () => {
    const { alerts } = run(check({ reason: 'waiting', until: '2026-08-26T15:00:00+02:00' }), { ...idleWithWork, ownWorkCount: 0 })
    expect(alerts).toEqual([])
  })

  it('POSITIVE CONTROL: the same idleness with no standstill wakes', () => {
    expect(run(parseWorkCheck('{"kind":"assigned_open_cards"}'), idleWithWork).alerts).toContain('wake-agent')
  })
})

describe('the way out: what does NOT silence', () => {
  it('an expired entry wakes, and the note names it with its reason and card', () => {
    const c = check({ reason: 'forbidden', until: '2026-08-26T12:00:00+02:00', card: '11ef4c0a' })
    expect(run(c, idleWithWork).alerts).toContain('wake-agent')
    const note = standstillNote('dexter', standstillVerdict(c, NOW, null))
    expect(note).toMatch(/LEJART/)
    expect(note).toMatch(/reason: forbidden, card: 11ef4c0a/)
    expect(note).toMatch(/torolje a standstill mezot/)
  })

  it('a standstill that runs out mid-spell gives a full sustained window, then wakes', () => {
    // holds for the first 9 minutes, then the guard needs sustainedMs (10 min) of fresh idleness
    const c = check({ reason: 'budget', until: '2026-08-26T12:56:00+02:00' })
    const { reasons } = run(c, idleWithWork)
    expect(reasons.slice(0, 3)).toEqual(['standstill', 'standstill', 'standstill'])
    const firstWake = reasons.indexOf('wake-agent')
    expect(firstWake).toBeGreaterThan(3)
    // the stop ends on the t=9 tick; the wake comes no earlier than sustainedMs (10 min) later
    expect(firstWake * 3).toBeGreaterThanOrEqual(9 + 10)
  })

  it('background_job: holds while the process lives, wakes once it has exited', () => {
    const c = check({ reason: 'background_job', until: '2026-08-26T16:00:00+02:00', pid: 4242 })
    expect(run(c, idleWithWork, true).alerts).toEqual([])
    expect(run(c, idleWithWork, false).alerts).toContain('wake-agent')
    const note = standstillNote('jarvis', standstillVerdict(c, NOW, false))
    expect(note).toMatch(/pid 4242\) mar nem fut/)
  })

  it('an until past the 7-day ceiling is rejected, not clamped', () => {
    const until = new Date(NOW + STANDSTILL_MAX_AHEAD_MS + 60 * MIN).toISOString()
    const c = check({ reason: 'budget', until })
    expect(standstillVerdict(c, NOW, null).state).toBe('invalid')
    expect(run(c, idleWithWork).alerts).toContain('wake-agent')
    // exactly at the ceiling is still honoured
    const edge = check({ reason: 'budget', until: new Date(NOW + STANDSTILL_MAX_AHEAD_MS).toISOString() })
    expect(standstillVerdict(edge, NOW, null).state).toBe('active')
  })

  it('the ceiling is SEVEN days, pinned as a literal (didi 2026-10-14: a test computed from the constant moves with it)', () => {
    expect(standstillVerdict(check({ reason: 'budget', until: '2026-09-03T12:47:00+02:00' }), NOW, null).state).toBe('invalid')
    expect(standstillVerdict(check({ reason: 'budget', until: '2026-09-02T12:47:00+02:00' }), NOW, null).state).toBe('active')
  })

  it('an until equal to now has expired: the stop does not cover its own last minute', () => {
    const v = standstillVerdict(check({ reason: 'budget', until: '2026-08-26T12:47:00+02:00' }), NOW, null)
    expect(v).toMatchObject({ state: 'expired', why: 'time' })
  })

  it.each([
    ['unknown reason', { reason: 'vacation', until: '2026-08-26T18:00:00+02:00' }, /ismeretlen reason/],
    ['until without an offset', { reason: 'budget', until: '2026-08-26T18:00:00' }, /idozonas ISO-8601/],
    ['until not a string', { reason: 'budget', until: 1787760000000 }, /idozonas ISO-8601/],
    ['impossible date', { reason: 'budget', until: '2026-02-31T25:00:00+02:00' }, /nem ervenyes datum/],
    ['pid not a number', { reason: 'background_job', until: '2026-08-26T18:00:00+02:00', pid: '4242' }, /pid/],
    ['not an object', 'until tomorrow', /nem objektum/],
  ])('a broken entry (%s) does not silence, keeps the kind, and the note names the fault', (_n, standstill, fault) => {
    const c = check(standstill)
    expect(c.kind).toBe('assigned_open_cards')
    expect(c.standstill).toBeUndefined()
    expect(run(c, idleWithWork).alerts).toContain('wake-agent')
    const note = standstillNote('dexter', standstillVerdict(c, NOW, null))
    expect(note).toMatch(/HIBAS, ezert NEM nemit/)
    expect(note).toMatch(fault)
  })

  it('no standstill: no note, and the declaration parses exactly as before', () => {
    expect(parseWorkCheck('{"kind":"none"}')).toEqual({ kind: 'none' })
    expect(standstillNote('didi', standstillVerdict(parseWorkCheck('{"kind":"none"}'), NOW, null))).toBeNull()
  })
})
