// Card 074149c2, stage 2: WHO READS A MACHINE NOTICE. The rule is pure, so every branch is driven
// here with probes; the wiring (setting, tmux, queue, the three senders) is in
// front-desk-route.test.ts, front-desk-senders.test.ts and messages-post-front-desk.test.ts.
import { describe, it, expect } from 'vitest'
import {
  FRONT_DESK_QUEUE_LIMIT,
  fleetAlertsAreFrontDeskWork,
  frontDeskHeader,
  isReroutableWindowReceipt,
  machineNoticeRecipient,
  parseFrontDeskHeader,
  withFrontDeskHeader,
  type FrontDeskProbe,
} from '../front-desk.js'

const COORD = 'coord'
const probe = (over: Partial<FrontDeskProbe> = {}): FrontDeskProbe => ({
  isKnown: () => true,
  isRunning: () => true,
  pendingDepth: () => 0,
  ...over,
})

describe('machineNoticeRecipient', () => {
  it('CONFIGURED, running, known, short queue, not the subject -> the front desk', () => {
    expect(machineNoticeRecipient(COORD, 'desk', ['didi'], probe())).toEqual({ to: 'desk', rerouted: true, why: 'front-desk' })
  })

  it('FAIL-OPEN 1: not configured (empty, blank, null, undefined) -> the coordinator, no probe asked', () => {
    const boom = probe({ isKnown: () => { throw new Error('must not be asked') } })
    for (const v of ['', '   ', null, undefined]) {
      expect(machineNoticeRecipient(COORD, v, ['didi'], boom)).toEqual({ to: COORD, rerouted: false, why: 'not-configured' })
    }
  })

  it('FAIL-OPEN 2: the front desk is not running -> the coordinator', () => {
    expect(machineNoticeRecipient(COORD, 'desk', ['didi'], probe({ isRunning: () => false })))
      .toEqual({ to: COORD, rerouted: false, why: 'not-running' })
  })

  it('FAIL-OPEN 3: the front desk is itself the subject -> the coordinator (also as one of several)', () => {
    expect(machineNoticeRecipient(COORD, 'desk', ['desk'], probe())).toEqual({ to: COORD, rerouted: false, why: 'is-subject' })
    expect(machineNoticeRecipient(COORD, 'desk', ['didi', 'desk'], probe()).why).toBe('is-subject')
  })

  it(`FAIL-OPEN 4: ${FRONT_DESK_QUEUE_LIMIT}+ pending -> the coordinator; one fewer still goes to the front desk`, () => {
    expect(machineNoticeRecipient(COORD, 'desk', ['didi'], probe({ pendingDepth: () => FRONT_DESK_QUEUE_LIMIT })))
      .toEqual({ to: COORD, rerouted: false, why: 'queue-full' })
    expect(machineNoticeRecipient(COORD, 'desk', ['didi'], probe({ pendingDepth: () => FRONT_DESK_QUEUE_LIMIT + 4 })).why).toBe('queue-full')
    expect(machineNoticeRecipient(COORD, 'desk', ['didi'], probe({ pendingDepth: () => FRONT_DESK_QUEUE_LIMIT - 1 })).rerouted).toBe(true)
  })

  it('an id that is not a registered agent -> the coordinator', () => {
    expect(machineNoticeRecipient(COORD, 'desk', ['didi'], probe({ isKnown: () => false })).why).toBe('unknown-agent')
  })

  it('a malformed id is not repaired into another agent\'s id', () => {
    const asked: string[] = []
    const p = probe({ isKnown: (a) => { asked.push(a); return true } })
    expect(machineNoticeRecipient(COORD, 'de/sk', ['didi'], p)).toEqual({ to: COORD, rerouted: false, why: 'malformed-id' })
    expect(asked).toEqual([])
  })

  it('the coordinator named as its own front desk, or a notice ABOUT the coordinator -> the coordinator', () => {
    expect(machineNoticeRecipient(COORD, COORD, ['didi'], probe()).why).toBe('is-coordinator')
    expect(machineNoticeRecipient(COORD, 'desk', [COORD], probe()).why).toBe('coordinator-is-subject')
    expect(machineNoticeRecipient(COORD, 'desk', ['didi', COORD], probe()).rerouted).toBe(false)
  })

  it('no subject at all is a doubt -> the coordinator', () => {
    expect(machineNoticeRecipient(COORD, 'desk', [], probe()).why).toBe('no-subject')
  })

  it('a probe that throws, or a depth that is not a number, is a doubt -> the coordinator', () => {
    const boom = () => { throw new Error('tmux down') }
    expect(machineNoticeRecipient(COORD, 'desk', ['didi'], probe({ isKnown: boom })).why).toBe('probe-failed')
    expect(machineNoticeRecipient(COORD, 'desk', ['didi'], probe({ isRunning: boom })).why).toBe('probe-failed')
    expect(machineNoticeRecipient(COORD, 'desk', ['didi'], probe({ pendingDepth: boom })).why).toBe('probe-failed')
    expect(machineNoticeRecipient(COORD, 'desk', ['didi'], probe({ pendingDepth: () => Number.NaN })).why).toBe('probe-failed')
    expect(machineNoticeRecipient(COORD, 'desk', ['didi'], probe({ pendingDepth: () => undefined as unknown as number })).to).toBe(COORD)
  })
})

describe('the header of a rerouted notice', () => {
  const notice = {
    type: 'context-guard-restart' as const,
    subjects: ['didi'],
    windowSec: [1000, 2800] as const,
    reason: 'handoff written but STALE (~12m) -- "quoted"\nsecond line',
    delivered: [10012700, 10012711],
    pending: [],
    failed: [7],
    snapshot: '/store/context-guard-last-pane-didi.txt',
  }

  it('is ONE line whatever the reason holds, and reads back field by field', () => {
    const h = frontDeskHeader(notice)
    expect(h.split('\n')).toHaveLength(1)
    expect(h.startsWith('[FRONT-DESK] {')).toBe(true)
    expect(parseFrontDeskHeader(h)).toEqual({
      v: 1,
      type: 'context-guard-restart',
      subjects: ['didi'],
      window_sec: [1000, 2800],
      reason: notice.reason,
      delivered: [10012700, 10012711],
      pending: [],
      failed: [7],
      snapshot: '/store/context-guard-last-pane-didi.txt',
    })
  })

  it('NOT MEASURED is null, a measured zero is an empty list', () => {
    const p = parseFrontDeskHeader(frontDeskHeader({ type: 'idle-no-work', subjects: ['x'], delivered: [] }))
    expect(p).toMatchObject({ window_sec: null, reason: null, delivered: [], pending: null, failed: null, snapshot: null })
  })

  it('rerouted: header line, then the text unchanged; not rerouted: EXACTLY the text', () => {
    const text = '[CONTEXT-GUARD] Ujrainditottam a(z) "didi" agentet\nmasodik sor'
    const on = withFrontDeskHeader({ to: 'desk', rerouted: true, why: 'front-desk' }, notice, text)
    expect(on).toBe(`${frontDeskHeader(notice)}\n${text}`)
    expect(parseFrontDeskHeader(on)?.type).toBe('context-guard-restart')
    expect(withFrontDeskHeader({ to: COORD, rerouted: false, why: 'not-running' }, notice, text)).toBe(text)
  })

  it('parse answers null for text without a header and for a broken header', () => {
    expect(parseFrontDeskHeader('[CONTEXT-GUARD] Ujrainditottam')).toBeNull()
    expect(parseFrontDeskHeader('[FRONT-DESK] {not json')).toBeNull()
    expect(parseFrontDeskHeader('[FRONT-DESK] [1,2]')).toBeNull()
  })
})

describe('isReroutableWindowReceipt', () => {
  it('a pick-up line, with or without status after it', () => {
    expect(isReroutableWindowReceipt('[RESTART-ABLAK] 10012848 felvéve a friss sessionben')).toBe(true)
    expect(isReroutableWindowReceipt('  [RESTART-ABLAK] 10012840 felvéve. Folytatom a cd9cdb85 kaput.')).toBe(true)
  })

  it('a line that asks something stays with the coordinator', () => {
    expect(isReroutableWindowReceipt('[RESTART-ABLAK] 10012840 felvéve. Melyik kártya menjen elöl?')).toBe(false)
    expect(isReroutableWindowReceipt('[RESTART-ABLAK] 10012840 felvéve.\nDECISION: push or hold')).toBe(false)
    expect(isReroutableWindowReceipt('[RESTART-ABLAK] 10012840 felvéve. decision: push or hold')).toBe(false)
  })

  it('anything that does not START with the tag is not a receipt', () => {
    expect(isReroutableWindowReceipt('Kész: a [RESTART-ABLAK] sorok lezárva')).toBe(false)
    expect(isReroutableWindowReceipt('[RESTART-WAKE] 10012840')).toBe(false)
    expect(isReroutableWindowReceipt('')).toBe(false)
  })
})

describe('fleetAlertsAreFrontDeskWork', () => {
  it('only a sweep of nothing but still-idle rows', () => {
    expect(fleetAlertsAreFrontDeskWork(['still-idle'])).toBe(true)
    expect(fleetAlertsAreFrontDeskWork(['still-idle', 'still-idle'])).toBe(true)
    expect(fleetAlertsAreFrontDeskWork([])).toBe(false)
    for (const k of ['pane-unreadable', 'no-work-check', 'wake-enqueue-failed', 'api-error-repeat']) {
      expect(fleetAlertsAreFrontDeskWork([k])).toBe(false)
      expect(fleetAlertsAreFrontDeskWork(['still-idle', k])).toBe(false)
    }
  })
})
