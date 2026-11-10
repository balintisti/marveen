// Card 074149c2, stage 1: the rules of "this restart notice needs no reader", as tables. Nothing
// here touches a database or a timer; the wiring is in restart-notice-hold.test.ts and the real
// handoff-request texts are run against isHandoffRequest in restart-notice-runner.test.ts.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CONTEXT_GUARD,
  RESTART_LOSS_WINDOW_MS,
  decideGuard,
  type ContextGuardConfig,
  type GuardInputs,
  type GuardState,
} from '../context-guard.js'
import { getSettingDefinition } from '../config-registry.js'
import { COMPLETION_REPORT_PREFIX } from '../db.js'
import { detectsThinkingBlockError, midTurnApiErrorAtTail } from '../pane-state.js'
import {
  RESTART_NOTICE_HOLD_MS,
  RESTART_NOTICE_ORIGIN,
  RESTART_NOTICE_SWALLOW_SETTING,
  holdVerdict,
  isHandoffRequest,
  namesId,
  parseRestartNoticeSwallowMode,
  restartIsRoutine,
  restartPaneTail,
  restartWindowCloseDirective,
  rowTrace,
  untracedLine,
  type HeldRow,
  type TraceEvidence,
} from '../restart-notice-trace.js'

const ID = 10012798
const T = 1_700_000_000

function row(over: Partial<HeldRow> = {}): HeldRow {
  return { id: ID, from: 'marveen', deliveredAt: T, handoffRequest: false, ...over }
}
function ev(over: Partial<TraceEvidence> = {}): TraceEvidence {
  return { states: new Map(), messages: [], comments: [], ...over }
}

describe('parseRestartNoticeSwallowMode: only the two exact words turn anything on', () => {
  it.each([
    ['live', 'live'], ['dry-run', 'dry-run'], [' LIVE ', 'live'], ['Dry-Run', 'dry-run'],
    ['off', 'off'], ['', 'off'], [undefined, 'off'], [null, 'off'], ['on', 'off'], ['true', 'off'],
    ['1', 'off'], ['dryrun', 'off'], ['dry run', 'off'], ['live!', 'off'], [true, 'off'], [1, 'off'],
  ])('%j -> %s', (raw, mode) => {
    expect(parseRestartNoticeSwallowMode(raw)).toBe(mode)
  })

  it('the setting ships OFF, under the key the code reads, and a change needs no restart', () => {
    const def = getSettingDefinition(RESTART_NOTICE_SWALLOW_SETTING)
    expect(def).toMatchObject({ key: 'RESTART_NOTICE_SWALLOW_MODE', type: 'string', default: 'off', secret: false, requiresRestart: false })
    expect(parseRestartNoticeSwallowMode(def!.default)).toBe('off')
    // The description is what the settings page shows: it has to name the three values.
    for (const word of ['off', 'dry-run', 'live']) expect(def!.description).toContain(word)
  })
})

describe('restartIsRoutine: handoff written, fresh, nothing killed', () => {
  const CFG: ContextGuardConfig = { ...DEFAULT_CONTEXT_GUARD, enabled: true }
  const NOW = 1_000_000_000
  const awaiting: GuardState = {
    phase: 'await-handoff',
    handoffMtimeAtRequest: 100,
    deadlineMs: NOW + 10 * 60_000,
    cooldownUntilMs: 0,
    saturatedStreak: 0,
    staleRefreshCount: 0,
    handoffStaleMinutes: null,
  }
  function inputs(over: Partial<GuardInputs> = {}): GuardInputs {
    return {
      nowMs: NOW, pct: 0.8, running: true, paneIdle: true, paneBusy: false, sessionReady: false,
      handoffMtime: null, paneSaturated: false, dailyHandoffDue: false, contextTokens: null, idleMs: null,
      ...over,
    }
  }

  it('the guard\'s REAL routine restart decision is routine (a reworded reason would turn the feature off, here it fails)', () => {
    // Last activity at the handoff's own mtime: the handoff covers the whole session.
    const d = decideGuard(awaiting, inputs({ handoffMtime: 200, idleMs: NOW - 200 }), CFG)
    expect(d.action).toBe('restart')
    expect(d.nextState.handoffStaleMinutes).toBeNull()
    expect(restartIsRoutine(d.reason, d.nextState.handoffStaleMinutes)).toBe(true)
  })

  it('the same REAL restart with a handoff whose freshness could not be measured is not', () => {
    const d = decideGuard(awaiting, inputs({ handoffMtime: 200 }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toBe('handoff written')
    expect(d.nextState.handoffStaleMinutes).toBe('unknown')
    expect(restartIsRoutine(d.reason, d.nextState.handoffStaleMinutes)).toBe(false)
  })

  it('the guard\'s REAL forced restart (handoff deadline passed) is not', () => {
    const d = decideGuard({ ...awaiting, deadlineMs: NOW - 1 }, inputs(), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toContain('force restart')
    expect(restartIsRoutine(d.reason, d.nextState.handoffStaleMinutes)).toBe(false)
  })

  it.each([
    ['handoff written', null, true],
    ['handoff written', undefined, true],
    ['handoff written -- held 20m until the background work finished', null, true],
    // A stale or unmeasurable handoff is a notice for a reader, whatever the reason says.
    ['handoff written', 6, false],
    ['handoff written', 0, false],
    ['handoff written', 'unknown', false],
    ['handoff written but STALE (~6m of work after it)', null, false],
    ['handoff written -- KILLS running background work: 2 (2 in the pane (shells / monitors / sub-agents))', null, false],
    ['handoff written -- held 45m for background work, the 45m bound is reached -- KILLS running background work: 2', null, false],
    ['handoff timeout -- force restart', null, false],
    ['hard threshold during await-handoff', null, false],
    ['pane saturated during await-handoff', null, false],
    ['manual restart: handoff written', null, false],
    ['', null, false],
  ] as const)('%j with staleness %j -> %s', (reason, stale, want) => {
    expect(restartIsRoutine(reason, stale)).toBe(want)
  })
})

describe('isHandoffRequest: the guard\'s own request, from "system" only', () => {
  it('a text that starts like a handoff request but was written by an agent is not one', () => {
    expect(isHandoffRequest('system', '[CONTEXT-GUARD] A munkakontextusod ~91%-on van -- kritikus.')).toBe(true)
    expect(isHandoffRequest('marveen', '[CONTEXT-GUARD] A munkakontextusod ~91%-on van -- kritikus.')).toBe(false)
  })
  it('the head must be at the START of the text', () => {
    expect(isHandoffRequest('system', 'FYI: [CONTEXT-GUARD] A munkakontextusod ~91%-on van')).toBe(false)
  })
  it('another guard text from "system" is not a handoff request', () => {
    expect(isHandoffRequest('system', '[CONTEXT-GUARD] Friss kontextussal indultál')).toBe(false)
    expect(isHandoffRequest('system', '[CONTEXT-GUARD] Ujrainditottam a(z) "didi" agentet')).toBe(false)
    expect(isHandoffRequest('system', '')).toBe(false)
  })
})

describe('namesId: the id, bounded on both sides', () => {
  it.each([
    [`[RESTART-ABLAK] ${ID} felvéve`, true],
    [`${ID}`, true],
    [`msg ${ID}.`, true],
    [`(${ID})`, true],
    [`id=${ID},`, true],
    [`#${ID}`, true],
    [`msg_id:${ID}]`, true],
    [`${ID}\n`, true],
    [`1${ID}`, false],
    [`${ID}5`, false],
    [`a${ID}`, false],
    [`${ID}f`, false],
    [`commit 9c${ID}ab`, false],
    [`${ID - 1} es ${ID + 1}`, false],
    ['', false],
  ])('%j -> %s', (text, want) => {
    expect(namesId(text, ID)).toBe(want)
  })
})

describe('rowTrace: something that carries the id, later than the delivery', () => {
  it('the handoff request is its own trace (the caller only holds on a routine restart)', () => {
    expect(rowTrace(row({ from: 'system', handoffRequest: true }), ev())).toBe('handoff-request')
  })

  it('nothing at all: no trace', () => {
    expect(rowTrace(row(), ev())).toBeNull()
  })

  it('closed after the delivery: a trace', () => {
    expect(rowTrace(row(), ev({ states: new Map([[ID, { status: 'done', completed_at: T + 1 }]]) }))).toBe('closed')
  })
  it.each([
    ['still delivered', { status: 'delivered', completed_at: null }],
    ['delivered with a stray completion time', { status: 'delivered', completed_at: T + 60 }],
    ['failed, by its state alone', { status: 'failed', completed_at: T + 60 }],
    ['done in the SAME second as the delivery', { status: 'done', completed_at: T }],
    ['done BEFORE the delivery', { status: 'done', completed_at: T - 1 }],
    ['done without a completion time', { status: 'done', completed_at: null }],
  ])('%s: not a trace', (_name, st) => {
    expect(rowTrace(row(), ev({ states: new Map([[ID, st]]) }))).toBeNull()
  })
  // didi 57938, note 3: the PUT route's default receipt to the sender is a message in the agent's
  // name that carries the id. The sender has been told, so the row has its reader. (That the route
  // writes this text, and that the real evidence reader hands it to this rule, is measured on the
  // real route in completion-notification.test.ts.)
  it('failed AND the receipt that told its sender: a trace, by the message', () => {
    const failed = new Map([[ID, { status: 'failed', completed_at: T + 60 }]])
    const receipt = { created_at: T + 60, content: `${COMPLETION_REPORT_PREFIX} msg_id:${ID} status:failed\n\nnem az enyém`, origin_note: null }
    expect(rowTrace(row(), ev({ states: failed, messages: [receipt] }))).toBe('message-names-id')
    expect(rowTrace(row(), ev({ states: failed }))).toBeNull()
  })
  it('the state of ANOTHER row is not this row\'s trace', () => {
    expect(rowTrace(row(), ev({ states: new Map([[ID + 1, { status: 'done', completed_at: T + 1 }]]) }))).toBeNull()
  })

  it('the agent names the id in a message after the delivery: a trace', () => {
    const m = { created_at: T + 1, content: `[RESTART-ABLAK] ${ID} felvéve`, origin_note: null }
    expect(rowTrace(row(), ev({ messages: [m] }))).toBe('message-names-id')
    expect(rowTrace(row(), ev({ messages: [{ ...m, origin_note: 'agent-msg.sh' }] }))).toBe('message-names-id')
  })
  it.each([
    ['in the same second', { created_at: T, content: `re ${ID}`, origin_note: null }],
    ['before the delivery', { created_at: T - 5, content: `re ${ID}`, origin_note: null }],
    ['without the id', { created_at: T + 5, content: 'felvettem, megy', origin_note: null }],
    ['with the id inside a longer number', { created_at: T + 5, content: `re 1${ID}`, origin_note: null }],
    // The guard writes in the agent's NAME: its restart notice lists the very ids it reports on.
    ['the guard\'s restart notice', { created_at: T + 5, content: `delivered: ${ID}`, origin_note: RESTART_NOTICE_ORIGIN }],
    ['any other guard-written row', { created_at: T + 5, content: `re ${ID}`, origin_note: 'context-guard restart-window receipt' }],
  ])('a message %s: not a trace', (_name, m) => {
    expect(rowTrace(row(), ev({ messages: [m] }))).toBeNull()
  })

  it('the agent names the id in a card comment after the delivery: a trace', () => {
    expect(rowTrace(row(), ev({ comments: [{ created_at: T + 1, content: `msg ${ID}: felvettem`, automated: 0 }] }))).toBe('comment-names-id')
  })
  it.each([
    ['automated', { created_at: T + 5, content: `msg ${ID}`, automated: 1 }],
    ['in the same second', { created_at: T, content: `msg ${ID}`, automated: 0 }],
    ['without the id', { created_at: T + 5, content: 'felvettem', automated: 0 }],
  ])('a comment %s: not a trace', (_name, c) => {
    expect(rowTrace(row(), ev({ comments: [c] }))).toBeNull()
  })

  it('order of precedence when several exist: closed, then message, then comment', () => {
    const all = ev({
      states: new Map([[ID, { status: 'done', completed_at: T + 1 }]]),
      messages: [{ created_at: T + 1, content: `${ID}`, origin_note: null }],
      comments: [{ created_at: T + 1, content: `${ID}`, automated: 0 }],
    })
    expect(rowTrace(row(), all)).toBe('closed')
    expect(rowTrace(row(), { ...all, states: new Map() })).toBe('message-names-id')
  })
})

describe('holdVerdict', () => {
  const DEADLINE = T * 1000 + RESTART_NOTICE_HOLD_MS
  const A = row({ id: 101 })
  const B = row({ id: 102, from: 'didi' })
  const H = row({ id: 103, from: 'system', handoffRequest: true })
  const closed = (id: number) => [id, { status: 'done', completed_at: T + 9 }] as const

  it('every row traced: swallow, before and after the deadline', () => {
    const e = ev({ states: new Map([closed(101), closed(102)]) })
    for (const now of [DEADLINE - 1, DEADLINE, DEADLINE + 3_600_000]) {
      expect(holdVerdict([A, B, H], e, now, DEADLINE)).toEqual({
        verdict: 'swallow',
        traced: [{ id: 101, by: 'closed' }, { id: 102, by: 'closed' }, { id: 103, by: 'handoff-request' }],
        untraced: [],
      })
    }
  })

  it('only the handoff request in the window: swallow', () => {
    expect(holdVerdict([H], ev(), T * 1000, DEADLINE).verdict).toBe('swallow')
  })

  it('ONE untraced row among traced ones: hold until the deadline, deliver from the deadline on, and it is named', () => {
    const e = ev({ states: new Map([closed(101)]) })
    expect(holdVerdict([A, B, H], e, DEADLINE - 1, DEADLINE)).toEqual({
      verdict: 'hold',
      traced: [{ id: 101, by: 'closed' }, { id: 103, by: 'handoff-request' }],
      untraced: [102],
    })
    expect(holdVerdict([A, B, H], e, DEADLINE, DEADLINE).verdict).toBe('deliver')
    expect(holdVerdict([A, B, H], e, DEADLINE + 1, DEADLINE).untraced).toEqual([102])
  })

  it('a hold over NO rows is a caller bug, and a bug delivers', () => {
    expect(holdVerdict([], ev(), T * 1000, DEADLINE)).toEqual({ verdict: 'deliver', traced: [], untraced: [] })
  })
})

// didi 57938, finding 1: the pane the restart destroyed. The wiring (what a pane that is not clean
// does to the notice) is in restart-notice-hold.test.ts.
describe('restartPaneTail: clean only when the pane was read and neither recogniser fires', () => {
  const SEP = '─'.repeat(80)
  const BOX = `${'─'.repeat(70)} Agent ─\n❯ \n${SEP}`
  const FOOT = '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ↓ to manage'
  const REPLY = `\n⏺ Kész, minden zöld.\n\n${BOX}\n${FOOT}`
  const TAIL_ERROR = `\n⏺ API Error: Connection lost mid-response. The response above may be \n  incomplete.\n\n${BOX}\n${FOOT}`
  const THINKING_THEN_REPLY = `\n⏺ Bash(x)\n  ⎿  API Error: 400 {"error":{"message":"messages.1.content.0: thinking blocks cannot be modified"}}\n\n⏺ Megpróbálom újra.\n\n${BOX}\n${FOOT}`

  it.each([
    ['a reply, then the box', REPLY],
    ['an empty screen above the box', `${BOX}\n${FOOT}`],
    ['an error the session got over, a reply after it', TAIL_ERROR.replace(`\n${BOX}`, `\n⏺ Folytatom: a teszt lefutott, 12 passed.\n\n${BOX}`)],
  ])('%s: clean', (_name, pane) => {
    expect(restartPaneTail(pane)).toBe('clean')
  })

  it('api-error by EACH recogniser on its own', () => {
    expect([midTurnApiErrorAtTail(TAIL_ERROR), detectsThinkingBlockError(TAIL_ERROR)]).toEqual([true, false])
    expect(restartPaneTail(TAIL_ERROR)).toBe('api-error')
    expect([midTurnApiErrorAtTail(THINKING_THEN_REPLY), detectsThinkingBlockError(THINKING_THEN_REPLY)]).toEqual([false, true])
    expect(restartPaneTail(THINKING_THEN_REPLY)).toBe('api-error')
  })

  it.each([
    ['null (the capture failed)', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace only', ' \n\t\n'],
    ['a reply with no input box under it', '\n⏺ Kész, minden zöld.\n'],
    ['an error with no input box under it', '⏺ API Error: Connection lost mid-response.'],
    ['one separator only (the capture was cut inside the box)', `\n⏺ Kész, minden zöld.\n\n${SEP}\n❯ `],
    ['not a string at all', 7 as unknown as string],
  ])('%s: unreadable, never clean', (_name, pane) => {
    expect(restartPaneTail(pane)).toBe('unreadable')
  })
})

describe('the texts', () => {
  it('untracedLine names every untraced row with its sender and says how long it waited', () => {
    const rows = [row({ id: 101 }), row({ id: 102, from: 'didi' }), row({ id: 103, from: 'system', handoffRequest: true })]
    const line = untracedLine(rows, [101, 102], 15)
    expect(line).toContain('NYOM NELKUL 15 perc utan: 2 (101<-marveen, 102<-didi)')
    expect(line).not.toContain('103')
  })

  it('the live resume directive: close, no acknowledgement, and the two numbers are the ones the check runs on', () => {
    const text = restartWindowCloseDirective('didi')
    expect(text.startsWith('RESTART-ABLAK: ')).toBe(true)
    expect(text.endsWith(' ')).toBe(true)
    expect(text).toContain(`~${RESTART_LOSS_WINDOW_MS / 60_000} percében`)
    expect(text).toContain(`${RESTART_NOTICE_HOLD_MS / 60_000} perccel`)
    expect(text).toContain('GET /api/messages?agent=didi, delivered_at szerint szűrve')
    expect(text).toContain('nyugta-üzenetet NE küldj')
    expect(text).toContain('PUT /api/messages/<id> {"status":"done","result":"[RESTART-ABLAK] felvéve a friss sessionben","notify":false}')
    expect(text).toContain('megnevezi az üzenet azonosítóját')
    // The old directive asked for a receipt message to the sender. That sentence must be gone.
    expect(text).not.toContain('küldj rövid nyugtát')
  })
})
