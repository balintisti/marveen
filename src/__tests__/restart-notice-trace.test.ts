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
  readRestartPaneTail,
  paneTailLine,
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

// didi 57938, finding 1, and marveen 58301, finding 1: the pane the restart destroyed. The wiring
// (what a pane that is not clean does to the notice) is in restart-notice-hold.test.ts.
describe('restartPaneTail: clean ONLY for a pane that was read and ends in a finished reply', () => {
  const SEP = '─'.repeat(80)
  const BOX = `${'─'.repeat(70)} Agent ─\n❯ \n${SEP}`
  const FOOT = '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ↓ to manage'
  /** A capture that ends in `body`, a blank line, the input box and the footer. */
  const above = (body: string, box: string = BOX): string => `\n${body}\n\n${box}\n${FOOT}`
  const ERROR_HEAD = '⏺ API Error: Connection lost mid-response. The response above may be '
  const TAIL_ERROR = above(`${ERROR_HEAD}\n  incomplete.`)
  const THINKING_THEN_REPLY = above('⏺ Bash(x)\n  ⎿  API Error: 400 {"error":{"message":"messages.1.content.0: thinking blocks cannot be modified"}}\n\n⏺ Megpróbálom újra.')
  const WRAPPED = '\n  {"type":"error","error":{"type":"overloaded_error"}}'.repeat(8)

  it.each([
    ['a one-line reply', above('⏺ Kész, minden zöld.')],
    ['a reply over several lines with blank lines in it, then the turn summary', above('⏺ A HANDOFF.md megírva.\n  A következő lépés a teszt.\n\n  1. első\n  2. második\n\n✻ Worked for 2m 10s · done 19:12')],
    ['an error the session got over, a reply after it', above(`${ERROR_HEAD}\n  incomplete.\n\n⏺ Folytatom: a teszt lefutott, 12 passed.`)],
    ['a limit the session got over, a reply after it', above("⏺ You've hit your session limit · resets 5:50pm\n\n⏺ Folytatom: a napi korlát tesztje zöld.")],
    ['the turn the CLI closes itself when nothing was asked', above('⏺ No response requested.')],
  ])('%s: clean', (_name, pane) => {
    expect(readRestartPaneTail(pane)).toEqual({ tail: 'clean', why: null, line: null })
    expect(restartPaneTail(pane)).toBe('clean')
  })

  it('api-error by EACH of the two old recognisers on its own', () => {
    expect([midTurnApiErrorAtTail(TAIL_ERROR), detectsThinkingBlockError(TAIL_ERROR)]).toEqual([true, false])
    expect(readRestartPaneTail(TAIL_ERROR)).toEqual({ tail: 'api-error', why: 'last-block', line: ERROR_HEAD.trim() })
    expect([midTurnApiErrorAtTail(THINKING_THEN_REPLY), detectsThinkingBlockError(THINKING_THEN_REPLY)]).toEqual([false, true])
    expect(readRestartPaneTail(THINKING_THEN_REPLY)).toEqual({ tail: 'api-error', why: 'thinking-block', line: null })
  })

  // marveen 58301, finding 1: the old walk gives up after six lines and says "no error".
  it.each([
    ['an error wrapped over nine lines', above(`⏺ API Error: 529${WRAPPED}`), '⏺ API Error: 529'],
    ['the same under a tool call', above(`⏺ Bash(npm test)\n  ⎿  API Error: 529${WRAPPED}`), '⎿  API Error: 529'],
  ])('%s: the old recogniser says no, the tail is still api-error', (_name, pane, line) => {
    expect([midTurnApiErrorAtTail(pane), detectsThinkingBlockError(pane)]).toEqual([false, false])
    expect(readRestartPaneTail(pane)).toEqual({ tail: 'api-error', why: 'last-block', line })
  })

  const UNKNOWN: [string, string, string, string | null][] = [
    ['an error with another glyph line under it', above(`${ERROR_HEAD}\n  incomplete.\n\n● valami más`), 'unrecognised-line', '● valami más'],
    ['a reply whose start is above the capture', above('  ...a hosszú válasz vége.\n  még egy sor'), 'start-not-in-capture', null],
    ['a wrapped error whose start is above the capture', `${WRAPPED}\n\n${BOX}\n${FOOT}`, 'start-not-in-capture', null],
    ['a reply that talks about an API error', above('⏺ A futás közben API Error: 529 jött, újrapróbáltam.\n  Kész.'), 'error-mention', '⏺ A futás közben API Error: 529 jött, újrapróbáltam.'],
    ['an API error named in lines whose start is above the capture', above('  api error: overloaded\n  request_id: req_1'), 'start-not-in-capture', 'api error: overloaded'],
    ['text in the input box', above('⏺ Kész, minden zöld.', `${'─'.repeat(70)} Agent ─\n❯ folytasd a tesztet\n${SEP}`), 'box-not-empty', '❯ folytasd a tesztet'],
    ['two lines in the input box', above('⏺ Kész, minden zöld.', `${'─'.repeat(70)} Agent ─\n❯ első sor\n  második sor\n${SEP}`), 'box-not-empty', '❯ első sor'],
    ['nothing above the box (a session that has just started)', `\n\n${BOX}\n${FOOT}`, 'nothing-above-box', null],
    ['the box on the first line', `${BOX}\n${FOOT}`, 'nothing-above-box', null],
    ['a spinner: the turn is running', above('⏺ Bash(sleep 60)\n  ⎿  Running…\n\n✽ Cogitating… (12s · esc to interrupt)'), 'unrecognised-line', '✽ Cogitating… (12s · esc to interrupt)'],
    ['a reply, then the background-wait line', above('⏺ Elindítottam a két al-ágenst.\n\n✻ Waiting for 2 background agents to finish'), 'unrecognised-line', '✻ Waiting for 2 background agents to finish'],
    ['a tool call with its result', above('⏺ Read(src/db.ts)\n  ⎿  Read 120 lines'), 'unrecognised-line', '⎿  Read 120 lines'],
    ['a tool call with no result under it', above('⏺ Bash(npm test)'), 'not-a-reply', '⏺ Bash(npm test)'],
    ['an MCP tool call', above('⏺ plugin:telegram:telegram - reply (MCP)(chat_id: "1", text: "x")'), 'not-a-reply', '⏺ plugin:telegram:telegram - reply (MCP)(chat_id: "1", text: "x")'],
    ['a collapsed group of tool calls', above('⏺ Read 3 files (ctrl+o to expand)'), 'not-a-reply', '⏺ Read 3 files (ctrl+o to expand)'],
    ['the notice of a finished background command, not answered yet', above('⏺ Background command "Run the gate" completed (exit code 0)'), 'not-a-reply', '⏺ Background command "Run the gate" completed (exit code 0)'],
    ['a line that is not indented under the reply', above('⏺ Kész.\n\n> egy idézett sor'), 'unrecognised-line', '> egy idézett sor'],
    ['an earlier prompt as the last thing on the screen', above('⏺ Kész.\n\n❯ folytasd'), 'unrecognised-line', '❯ folytasd'],
    // Review 58529, finding 1: the CLI's own lines in the reply's place. Each of the three
    // recognisers has a line only it knows.
    ['a plan limit in the reply\'s place', above("⏺ You've hit your session limit · resets 5:50pm"), 'harness-notice', "⏺ You've hit your session limit · resets 5:50pm"],
    ['a context hard error in the reply\'s place', above('⏺ Context limit reached · /compact or /clear to continue'), 'harness-notice', '⏺ Context limit reached · /compact or /clear to continue'],
    ['a login that is gone (the line measured in the fleet\'s transcripts)', above('⏺ OAuth token revoked · Please run /login'), 'harness-notice', '⏺ OAuth token revoked · Please run /login'],
    ['a prompt the API refused for its length', above('⏺ Prompt is too long'), 'harness-notice', '⏺ Prompt is too long'],
    ['an empty credit balance', above('⏺ Credit balance is too low'), 'harness-notice', '⏺ Credit balance is too low'],
    ['a reply that names a limit on a later line', above('⏺ Megnéztem a panelt.\n  A didi sora: usage limit reached.'), 'harness-notice', 'A didi sora: usage limit reached.'],
    ['a limit named in lines whose start is above the capture', above('  ...és a végén ez állt:\n  Credit balance is too low'), 'start-not-in-capture', 'Credit balance is too low'],
  ]

  it.each(UNKNOWN)('%s: unknown, never clean', (_name, pane, why, line) => {
    expect(readRestartPaneTail(pane)).toEqual({ tail: 'unknown', why, line })
    expect(restartPaneTail(pane)).toBe('unknown')
  })

  it('every unknown fixture is one the two old recognisers would have let through as "no error"', () => {
    // This is what made them clean before the walk: the table above is the finding, case by case.
    expect(UNKNOWN.map(([, pane]) => [midTurnApiErrorAtTail(pane), detectsThinkingBlockError(pane)])).toEqual(UNKNOWN.map(() => [false, false]))
  })

  it('the kept line is cut at 160 characters', () => {
    const long = `● ${'x'.repeat(300)}`
    const got = readRestartPaneTail(above(`⏺ Kész.\n\n${long}`))
    expect(got).toMatchObject({ tail: 'unknown', why: 'unrecognised-line' })
    expect(got.line).toBe(long.slice(0, 160))
  })

  it.each([
    ['null (the capture failed)', null, 'no-capture'],
    ['undefined', undefined, 'no-capture'],
    ['not a string at all', 7 as unknown as string, 'no-capture'],
    ['an empty string', '', 'no-input-box'],
    ['whitespace only', ' \n\t\n', 'no-input-box'],
    ['a reply with no input box under it', '\n⏺ Kész, minden zöld.\n', 'no-input-box'],
    ['an error with no input box under it', '⏺ API Error: Connection lost mid-response.', 'no-input-box'],
    ['one separator only (the capture was cut inside the box)', `\n⏺ Kész, minden zöld.\n\n${SEP}\n❯ `, 'no-input-box'],
  ])('%s: unreadable, never clean', (_name, pane, why) => {
    expect(readRestartPaneTail(pane)).toEqual({ tail: 'unreadable', why, line: null })
    expect(restartPaneTail(pane)).toBe('unreadable')
  })
})

describe('the texts', () => {
  it('paneTailLine: one first line per tail, with the agent, and never a word of the pane itself', () => {
    const lines = (['api-error', 'unknown', 'unreadable'] as const).map((t) => paneTailLine('didi', t))
    for (const line of lines) {
      expect(line.startsWith('[CONTEXT-GUARD] PANELVEG: a(z) "didi" ')).toBe(true)
      expect(line).toContain('a sorok nyomatol fuggetlenul kezbesul')
      expect(line).not.toContain('\n')
    }
    expect(lines[0]).toContain('API-HIBAVAL vegzodott')
    expect(lines[1]).toContain('NEM ISMERHETO FEL befejezett valaszkent')
    expect(lines[2]).toContain('NEM TUDTAM OLVASNI')
    expect(new Set(lines).size).toBe(3)
    // An unreadable pane left no snapshot worth pointing at.
    expect(lines.map((l) => l.includes('A pane-snapshotot a kovetkezo ujrainditas felulirja.'))).toEqual([true, true, false])
  })

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
