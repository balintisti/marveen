// Card 074149c2, stage 1: the hold on the REAL (in-memory) queue. The switch, the front-desk
// setting, the process table and the agent registry are the mocked edges; every row, every close
// and every late message is a real row. Two db functions are wrapped so a test can make them fail,
// the rest of db.js is the real module.
//
// Times: the rules compare epoch seconds, and db.js stamps rows with the real clock. The fixtures
// therefore put the restart two minutes into the PAST and the deliveries five minutes before it,
// so anything the test does "now" is later than every delivery. The moment the hold and the
// resolver believe it is, is passed in.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  mode: 'off' as string | (() => string),
  desk: '',
  running: new Map<string, boolean>(),
  known: new Set<string>(),
  evidenceThrows: false,
  recordThrows: false,
  takenBeforeRecord: false,
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('../logger.js', () => ({
  logger: { debug: () => {}, error: () => {}, info: (...a: unknown[]) => h.info(...a), warn: (...a: unknown[]) => h.warn(...a) },
}))
vi.mock('../settings-store.js', async (orig) => {
  const actual = await orig<typeof import('../settings-store.js')>()
  return {
    ...actual,
    getEffectiveSettingValue: (key: string) => {
      if (key === 'RESTART_NOTICE_SWALLOW_MODE') return typeof h.mode === 'function' ? h.mode() : h.mode
      if (key === 'FRONT_DESK_AGENT_ID') return h.desk
      return actual.getEffectiveSettingValue(key)
    },
  }
})
vi.mock('../web/agent-process.js', () => ({ isAgentRunning: (a: string) => h.running.get(a) ?? false }))
vi.mock('../web/agent-config.js', () => ({ isKnownAgent: (a: string) => h.known.has(a) }))
vi.mock('../db.js', async (orig) => {
  const actual = await orig<typeof import('../db.js')>()
  return {
    ...actual,
    getRestartTraceEvidence: (...a: Parameters<typeof actual.getRestartTraceEvidence>) => {
      if (h.evidenceThrows) throw new Error('evidence read failed')
      return actual.getRestartTraceEvidence(...a)
    },
    recordRestartNoticeHold: (...a: Parameters<typeof actual.recordRestartNoticeHold>) => {
      if (h.recordThrows) throw new Error('ledger write failed')
      // Another process delivers the notice between the step's own check and its write.
      if (h.takenBeforeRecord) actual.getDb().prepare("UPDATE agent_messages SET status = 'delivered' WHERE id = ?").run(a[0].noticeId)
      return actual.recordRestartNoticeHold(...a)
    },
  }
})

// Through the mocked module on purpose: it spreads the real one, so this is the same instance (and
// the same open database) the hold module works on.
const {
  initDatabase, getDb, createAgentMessage, markMessageDone, getAgentMessage, getPendingMessages,
  createKanbanCard, addKanbanComment,
  getRestartHeldRowSources, getRestartTraceEvidence, recordRestartNoticeHold, getHeldRestartNotices, settleRestartNoticeHold,
} = await import('../db.js')
const { MAIN_AGENT_ID } = await import('../config.js')
const { getSettingDefinition } = await import('../config-registry.js')
const { frontDeskHeader, parseFrontDeskHeader, FRONT_DESK_TAG } = await import('../front-desk.js')
const {
  RESTART_NOTICE_HOLD_MS, RESTART_NOTICE_ORIGIN, RESTART_NOTICE_HELD, RESTART_NOTICE_SWALLOWED, RESTART_NOTICE_DELIVERED_LATE,
  TRACE_UNMEASURED_LINE, HOLD_RELEASED_LINE, holdVerdict, namesId, restartPaneTail, readRestartPaneTail, paneTailLine,
} = await import('../restart-notice-trace.js')
const { detectsThinkingBlockError, midTurnApiErrorAtTail } = await import('../pane-state.js')
const {
  holdRoutineRestartNotice, resolveRestartNoticeHolds, restartNoticeSwallowMode, RESTART_NOTICE_RESOLVE_MS,
} = await import('../web/restart-notice-hold.js')
type RoutineRestartNotice = import('../web/restart-notice-hold.js').RoutineRestartNotice
type RestartNoticeHold = import('../db.js').RestartNoticeHold

const NOW_S = Math.floor(Date.now() / 1000)
const RESTART_S = NOW_S - 120
const DELIVERED_S = RESTART_S - 300
const WINDOW: [number, number] = [RESTART_S - 1800, RESTART_S]
const DEADLINE_MS = RESTART_S * 1000 + RESTART_NOTICE_HOLD_MS
/** "Now" for the hold step: five seconds after the restart. */
const AT_RESTART = RESTART_S * 1000 + 5_000
const SNAPSHOT = '/store/context-guard-last-pane-x.txt'
const HANDOFF_REQUEST = '[CONTEXT-GUARD] A munkakontextusod ~91%-on van -- kritikus. NE folytasd a feladatot. EGYETLEN dolgod ebben a körben: írj HANDOFF.md-t'
const CARD = 'c074149c'

// The pane the guard captured right before the restart (didi 57938, finding 1). The shapes are the
// ones pane-state-mid-turn-api-error.test.ts measured on live panes; `the pane fixtures` below
// runs every one of them through the recognisers, so a fixture cannot drift into another class.
const SEP = '─'.repeat(80)
const BOX = `${'─'.repeat(70)} Agent ─\n❯ \n${SEP}`
const FOOT = '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ↓ to manage'
/** A turn that ended in a reply: what a routine handoff restart leaves on the screen. */
const CLEAN_PANE = `\n⏺ A HANDOFF.md megírva, megállok.\n\n✻ Worked for 2m 10s · done 19:12\n\n${BOX}\n${FOOT}`
/** The turn died on the code-less error; the turn summary sits between it and the box. */
const ERROR_PANE = `\n  Kész a javítás, indítom a tesztet.\n\n⏺ API Error: Connection lost mid-response. The response above may be \n  incomplete.\n\n✻ Worked for 4m 36s · done 22:42\n\n${BOX}\n${FOOT}`
/** The same class under a tool call, with a numeric code. */
const RESULT_ERROR_PANE = `\n⏺ Bash(npm test)\n  ⎿  API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}\n\n${BOX}\n${FOOT}`
/** The persistent thinking-block error with a later line under it: not the LAST block any more,
 *  so only the live-tail recogniser sees it. */
const THINKING_PANE = `\n⏺ Bash(x)\n  ⎿  API Error: 400 {"error":{"message":"messages.1.content.0: thinking blocks cannot be modified"}}\n\n⏺ Megpróbálom újra.\n\n${BOX}\n${FOOT}`
/** An error the session got over: it is in the scrollback, far above a later, finished reply. */
const OLD_ERROR_PANE = `\n⏺ API Error: Connection lost mid-response. The response above may be \n  incomplete.\n\n❯ folytasd\n\n⏺ Folytatom: a teszt lefutott, 12 passed.\n${'\n  egy sor a kimenetből'.repeat(24)}\n\n⏺ A HANDOFF.md megírva, megállok.\n\n${BOX}\n${FOOT}`
/** A capture without the input box: nothing can be said about what it ends in. */
const NO_BOX_PANE = '\n⏺ A HANDOFF.md megírva, megállok.\n'
/** The error wrapped over more lines than the old recogniser walks (marveen 58301, finding 1). */
const WRAPPED_ERROR_PANE = `\n⏺ API Error: 529${'\n  {"type":"error","error":{"type":"overloaded_error"}}'.repeat(8)}\n\n${BOX}\n${FOOT}`
/** A turn that is still running. */
const SPINNER_PANE = `\n⏺ Bash(sleep 60)\n  ⎿  Running…\n\n✽ Cogitating… (12s · esc to interrupt)\n\n${BOX}\n${FOOT}`
/** What a capture taken AFTER the restart shows: the new session, nothing above its box. */
const FRESH_SESSION_PANE = `\n\n${BOX}\n${FOOT}`
/** A finished reply, and input the session never took. */
const TYPED_PANE = `\n⏺ A HANDOFF.md megírva, megállok.\n\n${'─'.repeat(70)} Agent ─\n❯ még egy kérés\n${SEP}\n${FOOT}`

beforeAll(() => {
  initDatabase(':memory:')
  // A fresh table counts from 1, and "1" is in every text: the ids the traces look for must be
  // numbers no fixture text contains by accident.
  const seed = createAgentMessage('seed', 'seed', 'seed').id
  getDb().prepare('UPDATE agent_messages SET id = 10020000 WHERE id = ?').run(seed)
  createKanbanCard({ id: CARD, title: 'stage 1 fixtures' })
})
beforeEach(() => {
  h.mode = 'off'
  h.desk = ''
  h.running.clear(); h.known.clear()
  h.evidenceThrows = false; h.recordThrows = false; h.takenBeforeRecord = false
  h.info.mockReset(); h.warn.mockReset()
  // No hold of an earlier test may be waiting: a tick settles every held row it finds.
  getDb().prepare("UPDATE restart_notice_holds SET state = 'delivered', detail = 'left over from another test' WHERE state = 'held'").run()
})

let seq = 0
const agentName = (): string => `agent-${++seq}`

/** A row that was injected into the session the restart destroyed. */
function delivered(from: string, to: string, content: string, deliveredAt: number = DELIVERED_S): number {
  const id = createAgentMessage(from, to, content).id
  getDb().prepare("UPDATE agent_messages SET status = 'delivered', created_at = ?, delivered_at = ? WHERE id = ?").run(DELIVERED_S - 2, deliveredAt, id)
  return id
}

function noticeBody(agent: string, ids: readonly number[], reason: string): string {
  return `[CONTEXT-GUARD] Ujrainditottam a(z) "${agent}" agentet -- ok: ${reason} (kontextus ~91%). A regi sessionbe kuldott uzenetek elveszhetnek egy restartnal.`
    + ` KEZBESITVE a regi sessionbe az ablakban: ${ids.join(', ')}. Pane-snapshot a restart elotti allapotrol: ${SNAPSHOT}`
}

/** The notice row, written the way the runner writes it. */
function writeNotice(agent: string, ids: readonly number[], reason: string, to: string, rerouted: boolean): number {
  const header = rerouted
    ? frontDeskHeader({ type: 'context-guard-restart', subjects: [agent], windowSec: WINDOW, reason, delivered: ids, pending: [], failed: [], snapshot: SNAPSHOT }) + '\n'
    : ''
  return createAgentMessage(agent, to, header + noticeBody(agent, ids, reason), RESTART_NOTICE_ORIGIN, undefined, { wake: true }).id
}

interface RestartOpts { over?: Partial<RoutineRestartNotice>; to?: string; rerouted?: boolean; nowMs?: number }

/** One restart: the notice row is written, then the hold step runs on it. */
function restart(agent: string, ids: readonly number[], opts: RestartOpts = {}) {
  const reason = opts.over?.reason ?? 'handoff written'
  const noticeId = writeNotice(agent, ids, reason, opts.to ?? MAIN_AGENT_ID, opts.rerouted ?? false)
  const outcome = holdRoutineRestartNotice({
    agent,
    noticeId,
    reason,
    handoffStaleMinutes: null,
    lossWindow: { windowSec: WINDOW, delivered: ids, pending: [], failed: [] },
    snapshotPath: SNAPSHOT,
    finalPane: CLEAN_PANE,
    ...opts.over,
  }, opts.nowMs ?? AT_RESTART)
  return { noticeId, outcome }
}

const holdsOf = (agent: string): RestartNoticeHold[] =>
  getDb().prepare('SELECT * FROM restart_notice_holds WHERE agent = ? ORDER BY id').all(agent) as RestartNoticeHold[]
/** Everything written in the agent's name except the notice itself. */
const sentAfter = (agent: string, noticeId: number) =>
  getDb().prepare('SELECT id, to_agent, content, status, origin_note, wake FROM agent_messages WHERE from_agent = ? AND id > ? ORDER BY id').all(agent, noticeId) as
    { id: number; to_agent: string; content: string; status: string; origin_note: string | null; wake: number }[]

function frontDesk(): string {
  const id = `desk-${++seq}`
  h.desk = id
  h.known.add(id); h.running.set(id, true)
  return id
}

describe('the switch', () => {
  it('is registered, off by default, and needs no restart', () => {
    expect(getSettingDefinition('RESTART_NOTICE_SWALLOW_MODE')).toMatchObject({ type: 'string', default: 'off', requiresRestart: false, secret: false })
  })
  it('follows the setting on every read; anything but the two words is off', () => {
    for (const [raw, want] of [['live', 'live'], ['dry-run', 'dry-run'], ['off', 'off'], ['', 'off'], ['yes', 'off']] as const) {
      h.mode = raw
      expect(restartNoticeSwallowMode()).toBe(want)
    }
  })
  it('a setting that cannot be read is off', () => {
    h.mode = () => { throw new Error('settings table locked') }
    expect(restartNoticeSwallowMode()).toBe('off')
  })
  it('the resolver asks once a minute', () => {
    expect(RESTART_NOTICE_RESOLVE_MS).toBe(60_000)
  })
})

describe('storage: the ledger and its three readers', () => {
  it('getRestartHeldRowSources: sender, delivery time and the first 80 CHARACTERS; a missing id is absent; ids in order', () => {
    const a = agentName()
    const long = 'é'.repeat(79) + 'XYZ'
    const first = delivered('marveen', a, long)
    const second = delivered('system', a, HANDOFF_REQUEST, DELIVERED_S + 7)
    expect(getRestartHeldRowSources([second, 999, first])).toEqual([
      { id: first, from_agent: 'marveen', delivered_at: DELIVERED_S, head: 'é'.repeat(79) + 'X' },
      { id: second, from_agent: 'system', delivered_at: DELIVERED_S + 7, head: Array.from(HANDOFF_REQUEST).slice(0, 80).join('') },
    ])
    expect(getRestartHeldRowSources([])).toEqual([])
  })

  it('getRestartTraceEvidence: the agent\'s OWN later rows that contain the id as text, and the rows\' states', () => {
    const a = agentName()
    const other = agentName()
    const id = delivered('marveen', a, 'please check the build')
    getDb().prepare('INSERT INTO agent_messages (from_agent, to_agent, content, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(a, 'marveen', `too early ${id}`, 'done', DELIVERED_S)
    createAgentMessage(a, 'marveen', `[RESTART-ABLAK] ${id} felvéve`)
    createAgentMessage(a, 'marveen', `a longer number 1${id}`)
    createAgentMessage(a, 'marveen', 'no id in this one')
    createAgentMessage(other, 'marveen', `somebody else names ${id}`)
    addKanbanComment(CARD, a, `msg ${id}: felvettem`)
    addKanbanComment(CARD, a, `gépi sor ${id}`, { automated: true })
    addKanbanComment(CARD, other, `másé ${id}`)
    const rows = [{ id, deliveredAt: DELIVERED_S }]
    const ev = getRestartTraceEvidence(a, rows)
    expect(ev.states.get(id)).toEqual({ status: 'delivered', completed_at: null })
    expect(ev.messages.map((m) => m.content)).toEqual([`[RESTART-ABLAK] ${id} felvéve`, `a longer number 1${id}`])
    expect(ev.comments.map((c) => [c.content, c.automated])).toEqual([[`msg ${id}: felvettem`, 0], [`gépi sor ${id}`, 1]])
    expect(getRestartTraceEvidence(a, [])).toEqual({ states: new Map(), messages: [], comments: [] })
    // The reader is a prefilter: the row with the longer number came back, the rule still says no.
    const onlyLonger = { ...ev, messages: ev.messages.slice(1), comments: ev.comments.slice(1) }
    expect(holdVerdict([{ id, from: 'marveen', deliveredAt: DELIVERED_S, handoffRequest: false }], onlyLonger, AT_RESTART, DEADLINE_MS).verdict).toBe('hold')
  })

  it('recordRestartNoticeHold closes the notice and writes the ledger row together, or neither', () => {
    const a = agentName()
    const noticeId = writeNotice(a, [1], 'handoff written', MAIN_AGENT_ID, false)
    const hold = { agent: a, noticeId, mode: 'live', restartAt: RESTART_S, deadlineAt: RESTART_S + 900, payload: '{}', state: 'held' as const, detail: null }
    const id = recordRestartNoticeHold(hold, RESTART_NOTICE_HELD)
    expect(holdsOf(a)).toMatchObject([{ id, notice_id: noticeId, mode: 'live', state: 'held', restart_at: RESTART_S, deadline_at: RESTART_S + 900, resolved_at: null, detail: null }])
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'done', result: RESTART_NOTICE_HELD })
    expect(getHeldRestartNotices().map((x) => x.id)).toContain(id)

    const b = agentName()
    expect(() => recordRestartNoticeHold({ ...hold, agent: b, noticeId: 999_999 }, RESTART_NOTICE_HELD)).toThrow(/999999 does not exist/)
    expect(holdsOf(b)).toEqual([])

    // closeNoticeWith = null (dry-run): the ledger row only, and a row written as settled is not held.
    const c = agentName()
    const pending = writeNotice(c, [1], 'handoff written', MAIN_AGENT_ID, false)
    const settled = recordRestartNoticeHold({ ...hold, agent: c, noticeId: pending, mode: 'dry-run', state: 'swallowed', detail: '{}' }, null)
    expect(getAgentMessage(pending)).toMatchObject({ status: 'pending', result: null })
    expect(holdsOf(c)[0].resolved_at).not.toBeNull()
    expect(getHeldRestartNotices().map((x) => x.id)).not.toContain(settled)
  })

  it('recordRestartNoticeHold rewrites a PENDING notice with its ledger row, or writes neither', () => {
    const hold = { mode: 'live', restartAt: RESTART_S, deadlineAt: RESTART_S + 900, payload: '{}', state: 'delivered' as const, detail: '{}' }
    const a = agentName()
    const pending = writeNotice(a, [1], 'handoff written', MAIN_AGENT_ID, false)
    recordRestartNoticeHold({ ...hold, agent: a, noticeId: pending }, null, 'the new text')
    expect(getAgentMessage(pending)).toMatchObject({ status: 'pending', result: null, content: 'the new text' })
    expect(holdsOf(a)).toHaveLength(1)

    // Taken already (delivered, done, failed): the reader has the old text, so it stays the text.
    for (const status of ['delivered', 'done', 'failed']) {
      const b = agentName()
      const taken = writeNotice(b, [1], 'handoff written', MAIN_AGENT_ID, false)
      const before = getAgentMessage(taken)!.content
      getDb().prepare('UPDATE agent_messages SET status = ? WHERE id = ?').run(status, taken)
      expect(() => recordRestartNoticeHold({ ...hold, agent: b, noticeId: taken }, null, 'the new text')).toThrow(new RegExp(`${taken} is not pending any more`))
      expect(getAgentMessage(taken)!.content).toBe(before)
      expect(holdsOf(b)).toEqual([])
    }
    const c = agentName()
    expect(() => recordRestartNoticeHold({ ...hold, agent: c, noticeId: 999_998 }, null, 'the new text')).toThrow(/999998 is not pending any more/)
    expect(holdsOf(c)).toEqual([])
  })

  it('settleRestartNoticeHold moves a hold ONCE: the second caller changes nothing and sends nothing', () => {
    const a = agentName()
    const noticeId = writeNotice(a, [1], 'handoff written', MAIN_AGENT_ID, false)
    const id = recordRestartNoticeHold({ agent: a, noticeId, mode: 'live', restartAt: RESTART_S, deadlineAt: RESTART_S + 900, payload: '{}', state: 'held', detail: null }, RESTART_NOTICE_HELD)
    const deliver = { from: a, to: MAIN_AGENT_ID, content: 'late', originNote: RESTART_NOTICE_ORIGIN }
    const first = settleRestartNoticeHold(id, 'delivered', '{"why":"first"}', { noticeResult: RESTART_NOTICE_DELIVERED_LATE, deliver })
    expect(first.settled).toBe(true)
    expect(getAgentMessage(first.deliveredId!)).toMatchObject({ from_agent: a, to_agent: MAIN_AGENT_ID, content: 'late', status: 'pending', origin_note: RESTART_NOTICE_ORIGIN })
    expect(settleRestartNoticeHold(id, 'swallowed', '{"why":"second"}', { noticeResult: RESTART_NOTICE_SWALLOWED, deliver })).toEqual({ settled: false, deliveredId: null })
    expect(holdsOf(a)).toMatchObject([{ state: 'delivered', detail: '{"why":"first"}' }])
    expect(getAgentMessage(noticeId)?.result).toBe(RESTART_NOTICE_DELIVERED_LATE)
    expect(sentAfter(a, noticeId)).toHaveLength(1)
    expect(settleRestartNoticeHold(987_654, 'delivered', '{}')).toEqual({ settled: false, deliveredId: null })
  })
})

describe('off: nothing is touched', () => {
  it('a routine restart with an untraced row: the notice stays pending, no ledger row', () => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    const { noticeId, outcome } = restart(a, [id])
    expect(outcome).toBe('untouched')
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'pending', result: null })
    expect(holdsOf(a)).toEqual([])
    resolveRestartNoticeHolds(DEADLINE_MS + 60_000)
    expect(sentAfter(a, noticeId)).toEqual([])
  })
})

describe('live: a routine restart whose rows all have their trace needs no reader', () => {
  beforeEach(() => { h.mode = 'live' })

  it('only the guard\'s own handoff request in the window: swallowed at the restart', () => {
    const a = agentName()
    const req = delivered('system', a, HANDOFF_REQUEST)
    const { noticeId, outcome } = restart(a, [req])
    expect(outcome).toBe('swallowed')
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'done', result: RESTART_NOTICE_SWALLOWED })
    expect(getPendingMessages(MAIN_AGENT_ID).map((m) => m.id)).not.toContain(noticeId)
    const [hold] = holdsOf(a)
    expect(hold).toMatchObject({ notice_id: noticeId, mode: 'live', state: 'swallowed', restart_at: RESTART_S })
    expect(hold.resolved_at).not.toBeNull()
    expect(JSON.parse(hold.detail!)).toEqual({ traced: [{ id: req, by: 'handoff-request' }], untraced: [], at: 'restart' })
    resolveRestartNoticeHolds(DEADLINE_MS + 60_000)
    expect(sentAfter(a, noticeId)).toEqual([])
  })

  it('a sender\'s row the OLD session already closed, next to the handoff request: swallowed at the restart', () => {
    const a = agentName()
    const req = delivered('system', a, HANDOFF_REQUEST)
    const id = delivered('marveen', a, 'please check the build')
    markMessageDone(id, 'megnéztem, zöld')
    expect(restart(a, [id, req]).outcome).toBe('swallowed')
  })

  it('the same text as the handoff request, written by an AGENT, is a row that needs its own trace', () => {
    const a = agentName()
    const forged = delivered('marveen', a, HANDOFF_REQUEST)
    expect(restart(a, [forged]).outcome).toBe('held')
  })

  it.each([
    ['closes the row', (a: string, id: number) => { markMessageDone(id, '[RESTART-ABLAK] felvéve a friss sessionben') }, 'closed'],
    ['names the id in a message', (a: string, id: number) => { createAgentMessage(a, 'marveen', `[RESTART-ABLAK] ${id} felvéve a friss sessionben`) }, 'message-names-id'],
    ['names the id in a card comment', (a: string, id: number) => { addKanbanComment(CARD, a, `msg ${id}: felvettem, a kártyán viszem`) }, 'comment-names-id'],
  ] as const)('an untraced row parks the notice; when the fresh session %s, the notice stays closed for good', (_name, act, by) => {
    const a = agentName()
    const req = delivered('system', a, HANDOFF_REQUEST)
    const id = delivered('marveen', a, 'please check the build')
    const { noticeId, outcome } = restart(a, [req, id])
    expect(outcome).toBe('held')
    // Parked: closed, so no router tick delivers it and nobody is woken.
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'done', result: RESTART_NOTICE_HELD })
    expect(getPendingMessages(MAIN_AGENT_ID).map((m) => m.id)).not.toContain(noticeId)
    expect(holdsOf(a)).toMatchObject([{ notice_id: noticeId, mode: 'live', state: 'held', restart_at: RESTART_S, deadline_at: RESTART_S + RESTART_NOTICE_HOLD_MS / 1000, resolved_at: null }])
    expect(JSON.parse(holdsOf(a)[0].payload)).toEqual({
      rows: [
        { id: req, from: 'system', deliveredAt: DELIVERED_S, handoffRequest: true },
        { id, from: 'marveen', deliveredAt: DELIVERED_S, handoffRequest: false },
      ],
      windowSec: WINDOW, reason: 'handoff written', delivered: [req, id], pending: [], failed: [], snapshot: SNAPSHOT,
    })

    // The parked notice lists the id of the row it waits for. It is not that row's trace.
    expect(namesId(getAgentMessage(noticeId)!.content, id)).toBe(true)
    resolveRestartNoticeHolds(DEADLINE_MS - 1)
    expect(holdsOf(a)[0].state).toBe('held')
    expect(sentAfter(a, noticeId)).toEqual([])

    act(a, id)
    const before = sentAfter(a, noticeId).length
    resolveRestartNoticeHolds(DEADLINE_MS - 1)
    const [hold] = holdsOf(a)
    expect(hold.state).toBe('swallowed')
    expect(JSON.parse(hold.detail!)).toEqual({ traced: [{ id: req, by: 'handoff-request' }, { id, by }], untraced: [], at: 'resolver' })
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'done', result: RESTART_NOTICE_SWALLOWED })
    // Later ticks, past the deadline too: settled is settled.
    resolveRestartNoticeHolds(DEADLINE_MS + 60_000)
    expect(sentAfter(a, noticeId)).toHaveLength(before)
    expect(holdsOf(a)).toHaveLength(1)
  })
})

describe('live: a row nobody picked up is reported by name at the deadline', () => {
  beforeEach(() => { h.mode = 'live' })

  it('the late message is the parked notice plus the untraced rows, it wakes its reader, and it is sent once', () => {
    const a = agentName()
    const req = delivered('system', a, HANDOFF_REQUEST)
    const lost = delivered('didi', a, 'verdict: two findings, see the card')
    const seen = delivered('marveen', a, 'please check the build')
    const { noticeId, outcome } = restart(a, [req, lost, seen])
    expect(outcome).toBe('held')
    markMessageDone(seen, '[RESTART-ABLAK] felvéve a friss sessionben')
    const parked = getAgentMessage(noticeId)!.content

    resolveRestartNoticeHolds(DEADLINE_MS - 1)
    expect(sentAfter(a, noticeId)).toEqual([])

    resolveRestartNoticeHolds(DEADLINE_MS)
    const sent = sentAfter(a, noticeId)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to_agent: MAIN_AGENT_ID, status: 'pending', origin_note: RESTART_NOTICE_ORIGIN, wake: 1 })
    expect(sent[0].content).toBe(
      parked + ` NYOM NELKUL 15 perc utan: 1 (${lost}<-didi)`
      + ' -- ezeknek a soroknak a kezbesites ota nincs az azonositojukat hordozo nyoma'
      + ' (lezaras, az agens uzenete vagy kartya-kommentje). Az ablak tobbi soranak megvan.',
    )
    expect(getPendingMessages(MAIN_AGENT_ID).map((m) => m.id)).toContain(sent[0].id)
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'done', result: RESTART_NOTICE_DELIVERED_LATE })
    const [hold] = holdsOf(a)
    expect(hold.state).toBe('delivered')
    expect(JSON.parse(hold.detail!)).toEqual({ why: 'untraced-at-deadline', untraced: [lost], to: MAIN_AGENT_ID })

    resolveRestartNoticeHolds(DEADLINE_MS + 60_000)
    resolveRestartNoticeHolds(DEADLINE_MS + 120_000)
    expect(sentAfter(a, noticeId)).toHaveLength(1)
    // The late message lists the lost id too, in the agent's name: a trace arriving now changes nothing.
    expect(holdsOf(a)[0].state).toBe('delivered')
  })

  it('a front desk gets it with a header of its own that carries `untraced`; the body is not headed twice', () => {
    const desk = frontDesk()
    const a = agentName()
    const lost = delivered('didi', a, 'verdict: two findings, see the card')
    const { noticeId, outcome } = restart(a, [lost], { to: desk, rerouted: true })
    expect(outcome).toBe('held')
    resolveRestartNoticeHolds(DEADLINE_MS)
    const [sent] = sentAfter(a, noticeId)
    expect(sent.to_agent).toBe(desk)
    expect(parseFrontDeskHeader(sent.content)).toEqual({
      v: 1, type: 'context-guard-restart', subjects: [a], window_sec: WINDOW, reason: 'handoff written',
      delivered: [lost], pending: [], failed: [], snapshot: SNAPSHOT, untraced: [lost],
    })
    expect(sent.content.split(FRONT_DESK_TAG).length - 1).toBe(1)
    expect(sent.content.split('\n')).toHaveLength(2)
    expect(sent.content.split('\n')[1].startsWith(noticeBody(a, [lost], 'handoff written') + ' NYOM NELKUL 15 perc utan: 1 (')).toBe(true)
  })

  it('the front desk was there at the restart and is gone at the deadline: the coordinator gets the text, without a header', () => {
    const desk = frontDesk()
    const a = agentName()
    const lost = delivered('didi', a, 'verdict: two findings, see the card')
    const { noticeId } = restart(a, [lost], { to: desk, rerouted: true })
    h.running.set(desk, false)
    resolveRestartNoticeHolds(DEADLINE_MS)
    const [sent] = sentAfter(a, noticeId)
    expect(sent.to_agent).toBe(MAIN_AGENT_ID)
    expect(sent.content.startsWith(noticeBody(a, [lost], 'handoff written') + ' NYOM NELKUL')).toBe(true)
    expect(JSON.parse(holdsOf(a)[0].detail!).to).toBe(MAIN_AGENT_ID)
  })

  it('a late message that cannot be written leaves the hold held, and the next tick sends it; another hold is not stopped by it', () => {
    const a = agentName()
    const b = agentName()
    const lostA = delivered('didi', a, 'verdict for a')
    const lostB = delivered('didi', b, 'verdict for b')
    const ra = restart(a, [lostA])
    const rb = restart(b, [lostB])
    getDb().exec(`CREATE TRIGGER refuse_late BEFORE INSERT ON agent_messages WHEN NEW.from_agent = '${a}' BEGIN SELECT RAISE(ABORT, 'late message refused'); END`)
    try {
      resolveRestartNoticeHolds(DEADLINE_MS)
    } finally {
      getDb().exec('DROP TRIGGER refuse_late')
    }
    expect(holdsOf(a)).toMatchObject([{ state: 'held', resolved_at: null, detail: null }])
    expect(getAgentMessage(ra.noticeId)?.result).toBe(RESTART_NOTICE_HELD)
    expect(sentAfter(a, ra.noticeId)).toEqual([])
    expect(h.warn).toHaveBeenCalledWith(expect.objectContaining({ agent: a }), 'restart notice: resolving a hold failed -- it stays held and is tried again')
    expect(holdsOf(b)[0].state).toBe('delivered')
    expect(sentAfter(b, rb.noticeId)).toHaveLength(1)

    resolveRestartNoticeHolds(DEADLINE_MS + 60_000)
    expect(holdsOf(a)[0].state).toBe('delivered')
    expect(sentAfter(a, ra.noticeId)).toHaveLength(1)
    // 16 minutes after the restart by now, and the line says so.
    expect(sentAfter(a, ra.noticeId)[0].content).toContain(`NYOM NELKUL 16 perc utan: 1 (${lostA}<-didi)`)
  })

  it('the parked notice row is gone at the deadline: the message is rebuilt from the ledger and still names the row', () => {
    const a = agentName()
    const lost = delivered('didi', a, 'verdict')
    const { noticeId } = restart(a, [lost])
    getDb().prepare('DELETE FROM agent_messages WHERE id = ?').run(noticeId)
    resolveRestartNoticeHolds(DEADLINE_MS)
    const [sent] = sentAfter(a, noticeId)
    expect(sent.content).toContain(`[CONTEXT-GUARD] Ujrainditottam a(z) "${a}" agentet -- ok: handoff written.`)
    expect(sent.content).toContain(`NYOM NELKUL 15 perc utan: 1 (${lost}<-didi)`)
  })
})

describe('live: every doubt delivers', () => {
  beforeEach(() => { h.mode = 'live' })

  // Each of these has an untraced sender row, so with a routine restart the notice WOULD be parked
  // (the tests above are the positive control). Here it must stay exactly as the runner wrote it.
  it.each([
    ['a forced restart (handoff deadline passed)', { reason: 'handoff timeout -- force restart' }],
    ['a hard-threshold restart', { reason: 'hard threshold during await-handoff' }],
    ['a saturated pane', { reason: 'pane saturated during await-handoff' }],
    ['a restart that killed background work', { reason: 'handoff written -- KILLS running background work: 2 (2 in the pane (shells / monitors / sub-agents))' }],
    ['a stale handoff by the reason', { reason: 'handoff written but STALE (~6m of work after it)' }],
    ['a stale handoff by the measurement', { handoffStaleMinutes: 6 }],
    ['a handoff whose freshness could not be measured', { handoffStaleMinutes: 'unknown' as const }],
    ['a loss window that could not be measured', { lossWindow: null }],
  ])('%s: untouched', (_name, over) => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    const { noticeId, outcome } = restart(a, [id], { over })
    expect(outcome).toBe('untouched')
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'pending', result: null })
    expect(holdsOf(a)).toEqual([])
  })

  it('a failed row in the window (somebody has to resend it): untouched', () => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    const { noticeId, outcome } = restart(a, [id], { over: { lossWindow: { windowSec: WINDOW, delivered: [id], pending: [], failed: [id + 1000] } } })
    expect(outcome).toBe('untouched')
    expect(getAgentMessage(noticeId)?.status).toBe('pending')
    expect(holdsOf(a)).toEqual([])
  })

  it('nothing delivered in the window: untouched (that notice closes itself or is log-only, by the older rules)', () => {
    const a = agentName()
    const { noticeId, outcome } = restart(a, [])
    expect(outcome).toBe('untouched')
    expect(getAgentMessage(noticeId)?.status).toBe('pending')
    expect(holdsOf(a)).toEqual([])
  })

  it('a notice that was born closed is not parked a second time', () => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    const noticeId = writeNotice(a, [id], 'handoff written', MAIN_AGENT_ID, false)
    markMessageDone(noticeId, '[auto-closed] earlier rule')
    const outcome = holdRoutineRestartNotice({ agent: a, noticeId, reason: 'handoff written', handoffStaleMinutes: null, lossWindow: { windowSec: WINDOW, delivered: [id], pending: [], failed: [] }, snapshotPath: null, finalPane: CLEAN_PANE }, AT_RESTART)
    expect(outcome).toBe('untouched')
    expect(getAgentMessage(noticeId)?.result).toBe('[auto-closed] earlier rule')
    expect(holdsOf(a)).toEqual([])
  })

  it('a window row that no longer exists, or has no delivery time any more, cannot be followed: untouched', () => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    const gone = restart(a, [id, 999_999])
    expect(gone.outcome).toBe('untouched')
    expect(getAgentMessage(gone.noticeId)?.status).toBe('pending')
    const b = agentName()
    // A `delivered` row always has its time (the agent_messages_delivered_needs_ts trigger), so the
    // only row without one is a row that is no longer delivered: put back in the queue.
    const undated = delivered('marveen', b, 'please check the build')
    getDb().prepare("UPDATE agent_messages SET status = 'pending', delivered_at = NULL WHERE id = ?").run(undated)
    expect(getRestartHeldRowSources([undated])[0].delivered_at).toBeNull()
    const r = restart(b, [undated])
    expect(r.outcome).toBe('untouched')
    expect(getAgentMessage(r.noticeId)?.status).toBe('pending')
    expect([...holdsOf(a), ...holdsOf(b)]).toEqual([])
  })

  it('the deadline is already behind us when the hold step runs: untouched, the notice goes out now', () => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    const { noticeId, outcome } = restart(a, [id], { nowMs: DEADLINE_MS })
    expect(outcome).toBe('untouched')
    expect(getAgentMessage(noticeId)?.status).toBe('pending')
    expect(holdsOf(a)).toEqual([])
  })

  it('the traces cannot be read at the restart: untouched, and the log says so', () => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    h.evidenceThrows = true
    const { noticeId, outcome } = restart(a, [id])
    expect(outcome).toBe('untouched')
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'pending', result: null })
    expect(holdsOf(a)).toEqual([])
    expect(h.warn).toHaveBeenCalledWith(expect.objectContaining({ agent: a, noticeId }), 'restart notice: the hold step failed -- the notice is delivered as before')
  })

  it('the ledger row cannot be written: the notice is NOT closed', () => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    h.recordThrows = true
    const { noticeId, outcome } = restart(a, [id])
    expect(outcome).toBe('untouched')
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'pending', result: null })
    expect(holdsOf(a)).toEqual([])
  })

  it('the setting cannot be read: untouched', () => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    h.mode = () => { throw new Error('settings table locked') }
    expect(restart(a, [id]).outcome).toBe('untouched')
    expect(holdsOf(a)).toEqual([])
  })

  it('the traces cannot be read while a notice is parked: it is delivered at once and says why', () => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    const { noticeId } = restart(a, [id])
    const parked = getAgentMessage(noticeId)!.content
    h.evidenceThrows = true
    resolveRestartNoticeHolds(DEADLINE_MS - 600_000)
    const sent = sentAfter(a, noticeId)
    expect(sent).toHaveLength(1)
    expect(sent[0].content).toBe(parked + TRACE_UNMEASURED_LINE)
    expect(sent[0].wake).toBe(1)
    expect(JSON.parse(holdsOf(a)[0].detail!)).toEqual({ why: 'trace-unmeasured', untraced: null, to: MAIN_AGENT_ID })
    expect(getAgentMessage(noticeId)?.result).toBe(RESTART_NOTICE_DELIVERED_LATE)
  })

  // Not JSON, JSON of another shape, and JSON that is no object at all: none of them is a payload.
  it.each(['{not json', '{}', '{"rows":[]}', '{"windowSec":[1,2]}', '{"rows":[],"windowSec":[1]}', 'null', '7'])('a ledger row whose payload cannot be read (%s): delivered at once, and says so', (payload) => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    const { noticeId } = restart(a, [id])
    const parked = getAgentMessage(noticeId)!.content
    getDb().prepare('UPDATE restart_notice_holds SET payload = ? WHERE notice_id = ?').run(payload, noticeId)
    resolveRestartNoticeHolds(DEADLINE_MS - 600_000)
    const sent = sentAfter(a, noticeId)
    expect(sent).toHaveLength(1)
    expect(sent[0].content).toBe(parked + TRACE_UNMEASURED_LINE)
    expect(JSON.parse(holdsOf(a)[0].detail!)).toEqual({ why: 'payload-unreadable', untraced: null, to: MAIN_AGENT_ID })
    expect(h.warn).not.toHaveBeenCalled()
  })

  it.each(['off', 'dry-run', 'garbage'])('the switch leaves live for %j while a notice is parked: delivered at once, before the deadline', (to) => {
    const desk = frontDesk()
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    const { noticeId, outcome } = restart(a, [id], { to: desk, rerouted: true })
    expect(outcome).toBe('held')
    h.mode = to
    resolveRestartNoticeHolds(DEADLINE_MS - 600_000)
    const sent = sentAfter(a, noticeId)
    expect(sent).toHaveLength(1)
    expect(sent[0].to_agent).toBe(desk)
    // Not measured, so the header says null, not an empty list.
    expect(parseFrontDeskHeader(sent[0].content)).toMatchObject({ delivered: [id], untraced: null })
    expect(sent[0].content.endsWith(noticeBody(a, [id], 'handoff written') + HOLD_RELEASED_LINE)).toBe(true)
    expect(JSON.parse(holdsOf(a)[0].detail!)).toEqual({ why: 'switch-left-live', untraced: null, to: desk })
    h.mode = 'live'
    resolveRestartNoticeHolds(DEADLINE_MS + 60_000)
    expect(sentAfter(a, noticeId)).toHaveLength(1)
  })
})

// didi 57938, finding 1 (marveen 57937) and marveen 58301, findings 1 and 2: the third condition of
// a clean restart. Every pane here is paired with a window whose rows WOULD let the notice go
// unread; the two controls at the end are the same windows with a pane that ended in a reply.
// Columns: the pane, the tail, the walk's own word for it, the pane line the ledger keeps.
const NOT_CLEAN = [
  ['the code-less error as the last block', ERROR_PANE, 'api-error', 'last-block', '⏺ API Error: Connection lost mid-response. The response above may be'],
  ['an error with a code under a tool call', RESULT_ERROR_PANE, 'api-error', 'last-block', '⎿  API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}'],
  ['the thinking-block error with a later line under it', THINKING_PANE, 'api-error', 'thinking-block', null],
  ['an error wrapped over nine lines', WRAPPED_ERROR_PANE, 'api-error', 'last-block', '⏺ API Error: 529'],
  ['a turn that is still running', SPINNER_PANE, 'unknown', 'unrecognised-line', '✽ Cogitating… (12s · esc to interrupt)'],
  ['the pane of the NEW session (a capture taken after the restart)', FRESH_SESSION_PANE, 'unknown', 'nothing-above-box', null],
  ['a finished reply with text left in the input box', TYPED_PANE, 'unknown', 'box-not-empty', '❯ még egy kérés'],
  ['a capture without the input box', NO_BOX_PANE, 'unreadable', 'no-input-box', null],
  ['no capture at all', null, 'unreadable', 'no-capture', null],
  ['an empty capture', '', 'unreadable', 'no-input-box', null],
] as const

describe('the pane fixtures are what their names say', () => {
  it('each recogniser separately, and the four answers of restartPaneTail', () => {
    expect([midTurnApiErrorAtTail(CLEAN_PANE), detectsThinkingBlockError(CLEAN_PANE)]).toEqual([false, false])
    expect([midTurnApiErrorAtTail(OLD_ERROR_PANE), detectsThinkingBlockError(OLD_ERROR_PANE)]).toEqual([false, false])
    expect([midTurnApiErrorAtTail(ERROR_PANE), detectsThinkingBlockError(ERROR_PANE)]).toEqual([true, false])
    expect([midTurnApiErrorAtTail(RESULT_ERROR_PANE), detectsThinkingBlockError(RESULT_ERROR_PANE)]).toEqual([true, false])
    // Only the second recogniser: without it this pane would read as clean.
    expect([midTurnApiErrorAtTail(THINKING_PANE), detectsThinkingBlockError(THINKING_PANE)]).toEqual([false, true])
    // Neither of the two: before marveen 58301 these four read as clean.
    for (const pane of [WRAPPED_ERROR_PANE, SPINNER_PANE, FRESH_SESSION_PANE, TYPED_PANE]) {
      expect([midTurnApiErrorAtTail(pane), detectsThinkingBlockError(pane)]).toEqual([false, false])
    }
    expect(midTurnApiErrorAtTail(NO_BOX_PANE)).toBeNull()
    expect([CLEAN_PANE, OLD_ERROR_PANE].map(restartPaneTail)).toEqual(['clean', 'clean'])
    expect(NOT_CLEAN.map(([, pane]) => readRestartPaneTail(pane))).toEqual(NOT_CLEAN.map(([, , tail, why, line]) => ({ tail, why, line })))
  })
})

describe('live: only a pane that was read and ends in a finished reply lets the notice go unread', () => {
  beforeEach(() => { h.mode = 'live' })

  it.each(NOT_CLEAN)('%s, and every row has its trace: delivered with the reason as its first line, the ledger says why', (_name, pane, tail, tailWhy, tailLine) => {
    const a = agentName()
    const why = `pane-tail-${tail}`
    const req = delivered('system', a, HANDOFF_REQUEST)
    const { noticeId, outcome } = restart(a, [req], { over: { finalPane: pane } })
    expect(outcome).toBe('untouched')
    // marveen 58301, finding 2: the reader is told that this one is not the routine notice.
    const stored = `${paneTailLine(a, tail)}\n${noticeBody(a, [req], 'handoff written')}`
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'pending', result: null, content: stored })
    expect(getPendingMessages(MAIN_AGENT_ID).map((m) => m.id)).toContain(noticeId)
    const holds = holdsOf(a)
    expect(holds).toMatchObject([{ notice_id: noticeId, mode: 'live', state: 'delivered', restart_at: RESTART_S, deadline_at: RESTART_S + RESTART_NOTICE_HOLD_MS / 1000 }])
    expect(holds[0].resolved_at).not.toBeNull()
    expect(JSON.parse(holds[0].detail!)).toEqual({ traced: [{ id: req, by: 'handoff-request' }], untraced: [], at: 'restart', why, tail_why: tailWhy, tail_line: tailLine })
    expect(JSON.parse(holds[0].payload)).toMatchObject({ delivered: [req], reason: 'handoff written', snapshot: SNAPSHOT })
    expect(h.info).toHaveBeenCalledWith(expect.objectContaining({ agent: a, noticeId, holdId: holds[0].id, mode: 'live', why, tailWhy }), expect.stringContaining('the notice is delivered as before'))
    expect(h.warn).not.toHaveBeenCalled()
    // Not a hold: no tick has anything to settle or to send, before the deadline or after it.
    expect(getHeldRestartNotices().map((x) => x.id)).not.toContain(holds[0].id)
    resolveRestartNoticeHolds(DEADLINE_MS - 1)
    resolveRestartNoticeHolds(DEADLINE_MS + 60_000)
    expect(sentAfter(a, noticeId)).toEqual([])
    expect(holdsOf(a)).toEqual(holds)
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'pending', result: null, content: stored })
  })

  it.each(NOT_CLEAN)('%s, and a row still waits for its trace: delivered NOW, not parked for the deadline', (_name, pane, tail, tailWhy, tailLine) => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    const { noticeId, outcome } = restart(a, [id], { over: { finalPane: pane } })
    expect(outcome).toBe('untouched')
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'pending', result: null, content: `${paneTailLine(a, tail)}\n${noticeBody(a, [id], 'handoff written')}` })
    const holds = holdsOf(a)
    expect(holds).toMatchObject([{ notice_id: noticeId, mode: 'live', state: 'delivered' }])
    expect(JSON.parse(holds[0].detail!)).toEqual({ traced: [], untraced: [id], at: 'restart', why: `pane-tail-${tail}`, tail_why: tailWhy, tail_line: tailLine })
    // The notice went out whole at the restart: the deadline adds no second message about the row.
    resolveRestartNoticeHolds(DEADLINE_MS)
    expect(sentAfter(a, noticeId)).toEqual([])
    expect(holdsOf(a)).toEqual(holds)
  })

  it('a front desk keeps it in its own queue: the header stays the first line and names the tail, the reason is the second', () => {
    const desk = frontDesk()
    const a = agentName()
    const req = delivered('system', a, HANDOFF_REQUEST)
    const { noticeId, outcome } = restart(a, [req], { to: desk, rerouted: true, over: { finalPane: SPINNER_PANE } })
    expect(outcome).toBe('untouched')
    expect(getPendingMessages(desk).map((m) => m.id)).toContain(noticeId)
    const [header, reason, ...body] = getAgentMessage(noticeId)!.content.split('\n')
    // Every key the runner wrote is still there, and one more.
    const written = parseFrontDeskHeader(frontDeskHeader({ type: 'context-guard-restart', subjects: [a], windowSec: WINDOW, reason: 'handoff written', delivered: [req], pending: [], failed: [], snapshot: SNAPSHOT }))
    expect(parseFrontDeskHeader(header)).toEqual({ ...written, pane_tail: 'unknown' })
    expect(reason).toBe(paneTailLine(a, 'unknown'))
    expect(body.join('\n')).toBe(noticeBody(a, [req], 'handoff written'))
  })

  it('the ledger row cannot be written: still delivered, as it was written, and the log says the step failed', () => {
    const a = agentName()
    const req = delivered('system', a, HANDOFF_REQUEST)
    h.recordThrows = true
    const { noticeId, outcome } = restart(a, [req], { over: { finalPane: ERROR_PANE } })
    expect(outcome).toBe('untouched')
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'pending', result: null, content: noticeBody(a, [req], 'handoff written') })
    expect(holdsOf(a)).toEqual([])
    expect(h.warn).toHaveBeenCalledWith(expect.objectContaining({ agent: a, noticeId }), 'restart notice: the hold step failed -- the notice is delivered as before')
  })

  it('somebody took the notice before the step wrote: its text is not touched, and no ledger row claims a text that was never sent', () => {
    const a = agentName()
    const req = delivered('system', a, HANDOFF_REQUEST)
    h.takenBeforeRecord = true
    const { noticeId, outcome } = restart(a, [req], { over: { finalPane: ERROR_PANE } })
    expect(outcome).toBe('untouched')
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'delivered', content: noticeBody(a, [req], 'handoff written') })
    expect(holdsOf(a)).toEqual([])
    expect(h.warn).toHaveBeenCalledWith(expect.objectContaining({ agent: a, noticeId }), 'restart notice: the hold step failed -- the notice is delivered as before')
  })

  it('dry-run counts it the same way and leaves the text alone: a delivered row with its reason, never a would-swallow', () => {
    h.mode = 'dry-run'
    const a = agentName()
    const req = delivered('system', a, HANDOFF_REQUEST)
    const { noticeId, outcome } = restart(a, [req], { over: { finalPane: SPINNER_PANE } })
    expect(outcome).toBe('untouched')
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'pending', result: null, content: noticeBody(a, [req], 'handoff written') })
    expect(holdsOf(a)).toMatchObject([{ mode: 'dry-run', state: 'delivered' }])
    // The share of each kind of tail is counted from these two fields.
    expect(JSON.parse(holdsOf(a)[0].detail!)).toMatchObject({ at: 'restart', why: 'pane-tail-unknown', tail_why: 'unrecognised-line', tail_line: '✽ Cogitating… (12s · esc to interrupt)' })
  })

  it('off: the pane is not even asked, no ledger row, the text is as written', () => {
    h.mode = 'off'
    const a = agentName()
    const req = delivered('system', a, HANDOFF_REQUEST)
    const { noticeId, outcome } = restart(a, [req], { over: { finalPane: ERROR_PANE } })
    expect(outcome).toBe('untouched')
    expect(holdsOf(a)).toEqual([])
    expect(getAgentMessage(noticeId)!.content).toBe(noticeBody(a, [req], 'handoff written'))
  })

  // CONTROL (marveen 57937): the routine restart that ended clean is swallowed as before, and an
  // error the session got over long before the restart does not make its pane an error pane.
  it.each([
    ['a pane that ended in a reply', CLEAN_PANE],
    ['an old API error in the scrollback, a finished reply after it', OLD_ERROR_PANE],
  ])('control, %s: swallowed at the restart, held when a row waits', (_name, pane) => {
    const a = agentName()
    const req = delivered('system', a, HANDOFF_REQUEST)
    const swallowed = restart(a, [req], { over: { finalPane: pane } })
    expect(swallowed.outcome).toBe('swallowed')
    expect(getAgentMessage(swallowed.noticeId)).toMatchObject({ status: 'done', result: RESTART_NOTICE_SWALLOWED, content: noticeBody(a, [req], 'handoff written') })
    expect(JSON.parse(holdsOf(a)[0].detail!)).toEqual({ traced: [{ id: req, by: 'handoff-request' }], untraced: [], at: 'restart' })
    const b = agentName()
    const id = delivered('marveen', b, 'please check the build')
    const held = restart(b, [id], { over: { finalPane: pane } })
    expect(held.outcome).toBe('held')
    expect(getAgentMessage(held.noticeId)).toMatchObject({ status: 'done', result: RESTART_NOTICE_HELD })
  })
})

// marveen 57937: "olyan értesítő, aminek a TÁRGYA a koordinátor, soha ne nyelődjön el."
describe('a notice ABOUT the coordinator is never held and never swallowed', () => {
  // The control inside each case is the same restart of an ordinary agent, which IS swallowed or
  // held: only the subject differs.
  it.each([
    ['live', 'swallowed', 'held'],
    ['dry-run', 'would-swallow', 'would-hold'],
  ] as const)('%s: untouched and no ledger row, with every row traced and with a row waiting', (mode, wouldSwallow, wouldHold) => {
    h.mode = mode
    const desk = frontDesk()
    const before = holdsOf(MAIN_AGENT_ID).length
    const req = delivered('system', MAIN_AGENT_ID, HANDOFF_REQUEST)
    const traced = restart(MAIN_AGENT_ID, [req], { to: desk, rerouted: true })
    expect(traced.outcome).toBe('untouched')
    expect(getAgentMessage(traced.noticeId)).toMatchObject({ status: 'pending', result: null })
    expect(getPendingMessages(desk).map((m) => m.id)).toContain(traced.noticeId)
    const id = delivered('didi', MAIN_AGENT_ID, 'verdict: two findings, see the card')
    const waiting = restart(MAIN_AGENT_ID, [id], { to: desk, rerouted: true })
    expect(waiting.outcome).toBe('untouched')
    expect(getAgentMessage(waiting.noticeId)).toMatchObject({ status: 'pending', result: null })
    expect(holdsOf(MAIN_AGENT_ID)).toHaveLength(before)
    expect(before).toBe(0)
    resolveRestartNoticeHolds(DEADLINE_MS + 60_000)
    expect(sentAfter(MAIN_AGENT_ID, traced.noticeId).filter((m) => m.origin_note === RESTART_NOTICE_ORIGIN).map((m) => m.id)).toEqual([waiting.noticeId])

    const a = agentName()
    expect(restart(a, [delivered('system', a, HANDOFF_REQUEST)], { to: desk, rerouted: true }).outcome).toBe(wouldSwallow)
    const b = agentName()
    expect(restart(b, [delivered('didi', b, 'verdict: two findings, see the card')], { to: desk, rerouted: true }).outcome).toBe(wouldHold)
  })
})

describe('dry-run: the ledger says what live would do, the queue is as it was', () => {
  beforeEach(() => { h.mode = 'dry-run' })

  it('would swallow: the notice stays pending for its reader', () => {
    const a = agentName()
    const req = delivered('system', a, HANDOFF_REQUEST)
    const { noticeId, outcome } = restart(a, [req])
    expect(outcome).toBe('would-swallow')
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'pending', result: null })
    expect(getPendingMessages(MAIN_AGENT_ID).map((m) => m.id)).toContain(noticeId)
    expect(holdsOf(a)).toMatchObject([{ mode: 'dry-run', state: 'swallowed' }])
    expect(h.info).toHaveBeenCalledWith(expect.objectContaining({ agent: a, mode: 'dry-run' }), 'restart notice (dry-run): would swallow, the notice is delivered as before')
  })

  it.each([
    ['the row gets its trace', true, 'swallowed'],
    ['the row never gets one', false, 'delivered'],
  ] as const)('would hold, then %s: the ledger row settles as %s, nothing is sent and the notice is never closed', (_name, traced, state) => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    const { noticeId, outcome } = restart(a, [id])
    expect(outcome).toBe('would-hold')
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'pending', result: null })
    expect(holdsOf(a)).toMatchObject([{ mode: 'dry-run', state: 'held' }])
    resolveRestartNoticeHolds(DEADLINE_MS - 1)
    expect(holdsOf(a)[0].state).toBe('held')

    if (traced) markMessageDone(id, '[RESTART-ABLAK] felvéve a friss sessionben')
    // The switch going live later does not turn a dry-run hold into a live one.
    h.mode = 'live'
    resolveRestartNoticeHolds(DEADLINE_MS)
    const [hold] = holdsOf(a)
    expect(hold.state).toBe(state)
    expect(JSON.parse(hold.detail!)).toMatchObject({ untraced: traced ? [] : [id], at: 'resolver' })
    expect(sentAfter(a, noticeId)).toEqual([])
    expect(getAgentMessage(noticeId)).toMatchObject({ status: 'pending', result: null })
  })

  it('a dry-run hold whose traces cannot be read settles as delivered, and still sends nothing', () => {
    const a = agentName()
    const id = delivered('marveen', a, 'please check the build')
    const { noticeId } = restart(a, [id])
    h.evidenceThrows = true
    resolveRestartNoticeHolds(DEADLINE_MS - 1)
    expect(holdsOf(a)).toMatchObject([{ state: 'delivered', detail: '{"why":"trace-unmeasured"}' }])
    expect(sentAfter(a, noticeId)).toEqual([])
    expect(getAgentMessage(noticeId)?.status).toBe('pending')
  })
})
