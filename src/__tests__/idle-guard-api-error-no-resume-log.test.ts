// AN API ERROR ON THE PANE AND NO RESUME: THE LOG SAYS WHY -- card 1f990d74.
//
// Measured by sirius over 4.95 days (card 04e6e1ac, comment 58232): 1288 turns cut by an API error,
// 234 left the agent standing 7+ minutes, and 119 of those got no resume for no reason anyone could
// name, because the per-tick decision is a debug line and never reaches store/dashboard.log.
//
// The requirement is an OUTPUT: for every tick where the pane shows the error and no resume goes
// out, one info line that names the reason without reading code. And NO decision moves.
//
// Part 1 is the pure decision: the seven conjuncts of "the streak is seen" now come from one table,
// so the table is held against the expression it replaced, over every combination of values, and
// against what the decision DOES with them. Part 2 runs the watcher's own tick() with the real pane
// classifier and the real persistence; only tmux, the logger and the message queue are mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import {
  decideIdleAlert,
  apiErrorBlockers,
  explainNoApiErrorResume,
  API_ERROR_CONFIRM_TICKS,
  NO_IDLE_STATE,
  type IdleAgentInput,
  type IdleAgentState,
  type IdleAgentThresholds,
} from '../idle-agent.js'

const TH: IdleAgentThresholds = {
  sustainedMs: 12 * 60_000,
  realertMs: 30 * 60_000,
  wakeGraceMs: 15 * 60_000,
  wakeCooldownMs: 30 * 60_000,
}
const MIN = 60_000
const TICK = 3 * MIN
const T0 = Date.UTC(2026, 10, 11, 10, 0, 0)

const base: IdleAgentInput = {
  agent: 'x', running: true, paneIdle: true, pendingMessages: 0,
  ownWorkCount: 0, workCheckKind: 'assigned_open_cards', paneApiError: true,
}

/** The expression decideIdleAlertCore held before the table (983052ed2, idle-agent.ts:607-609), term by term. */
const OLD_TERMS: Record<string, (i: IdleAgentInput) => boolean> = {
  running: (i) => i.running,
  paneApiError: (i) => i.paneApiError === true,
  paneIdle: (i) => i.paneIdle === true,
  runningSubagents: (i) => (i.runningSubagents ?? 0) <= 0,
  paneUsageLimited: (i) => i.paneUsageLimited !== true,
  pendingMessages: (i) => i.pendingMessages === 0,
  standstillActive: (i) => i.standstillActive !== true,
}
const oldSeen = (i: IdleAgentInput): boolean =>
  i.running && i.paneApiError === true && i.paneIdle === true && (i.runningSubagents ?? 0) <= 0 &&
  i.paneUsageLimited !== true && i.pendingMessages === 0 && i.standstillActive !== true

/** Every value each of the seven fields can take, absent included. */
function everyInput(): IdleAgentInput[] {
  const out: IdleAgentInput[] = []
  for (const running of [true, false])
    for (const paneApiError of [true, false, undefined])
      for (const paneIdle of [true, false, null])
        for (const runningSubagents of [undefined, 0, 1, 3])
          for (const paneUsageLimited of [undefined, false, true])
            for (const pendingMessages of [0, 1, 4])
              for (const standstillActive of [undefined, false, true])
                out.push({ ...base, running, paneApiError, paneIdle, runningSubagents, paneUsageLimited, pendingMessages, standstillActive })
  return out
}

/** Drive the pure decision like the watcher does: a resume that went out is stamped. */
function runTicks(seq: Array<Partial<IdleAgentInput>>, state: IdleAgentState = NO_IDLE_STATE, t0 = T0) {
  const out: ReturnType<typeof decideIdleAlert>[] = []
  let s = state
  seq.forEach((over, i) => {
    const now = t0 + i * TICK
    const r = decideIdleAlert({ ...base, ...over }, s, TH, now)
    s = r.next
    if (r.decision.alert && r.decision.reason === 'resume-api-error') {
      s = { ...s, lastApiErrorResumeAt: now, apiErrorHandledSince: s.apiErrorSinceMs, apiErrorResumesNoProgress: (s.apiErrorResumesNoProgress ?? 0) + 1 }
    }
    out.push(r)
  })
  return { ticks: out, state: s }
}
const ERR = {}
const CLEAN = { paneApiError: false }

describe('the conjuncts of "the API-error streak is seen" -- one table, no decision moved', () => {
  const inputs = everyInput()

  it('covers the whole space: 1944 inputs, 8 of them seen', () => {
    expect(inputs).toHaveLength(2 * 3 * 3 * 4 * 3 * 3 * 3)
    expect(inputs.filter(oldSeen)).toHaveLength(8)        // absent or 0 sub-agents x absent or false limit x absent or false standstill
  })

  it('is seen exactly when the expression it replaced was, and names exactly the terms that were false', () => {
    for (const i of inputs) {
      const want = Object.keys(OLD_TERMS).filter((name) => !OLD_TERMS[name](i))
      expect(apiErrorBlockers(i), JSON.stringify(i)).toEqual(want)
      expect(apiErrorBlockers(i).length === 0, JSON.stringify(i)).toBe(oldSeen(i))
    }
  })

  it('the DECISION follows it: two consecutive ticks of the same input resume exactly when it is seen', () => {
    for (const i of inputs) {
      const { ticks } = runTicks([i, i])
      expect(ticks[1].decision.reason === 'resume-api-error', JSON.stringify(i)).toBe(oldSeen(i))
      expect(ticks[0].decision.reason === 'api-error-confirming', JSON.stringify(i)).toBe(oldSeen(i))
    }
  })

  it('where the streak cannot be seen anyway, the error flag itself moves nothing: same decision, same next state', () => {
    // What lets the watcher report the error from a pane it could not classify (paneIdle null).
    let pairs = 0
    for (const i of inputs) {
      if (i.paneApiError !== true || OLD_TERMS.paneIdle(i)) continue
      for (const state of [NO_IDLE_STATE, runTicks([ERR, ERR]).state, runTicks([ERR]).state]) {
        const withFlag = decideIdleAlert(i, state, TH, T0 + 9 * TICK)
        const without = decideIdleAlert({ ...i, paneApiError: false }, state, TH, T0 + 9 * TICK)
        expect(withFlag.decision, JSON.stringify(i)).toEqual(without.decision)
        expect(withFlag.next, JSON.stringify(i)).toEqual(without.next)
        expect(without.apiErrorNoResume).toBeNull()
        expect(withFlag.apiErrorNoResume?.blockedBy).toContain('paneIdle')
        pairs++
      }
    }
    expect(pairs).toBe(3 * 2 * 2 * 4 * 3 * 3 * 3)
  })

  it('every tick with the error on the pane and no resume has its reason, and the reason is never "unexplained"', () => {
    let lines = 0
    for (const i of inputs) {
      for (const t of runTicks([i, i, i, i]).ticks) {
        const owed = i.paneApiError === true && t.decision.reason !== 'resume-api-error'
        expect(t.apiErrorNoResume !== null, JSON.stringify(i)).toBe(owed)
        if (!t.apiErrorNoResume) continue
        lines++
        expect(t.apiErrorNoResume.why, JSON.stringify(i)).not.toBe('unexplained')
        expect(t.apiErrorNoResume.why === 'blocked', JSON.stringify(i)).toBe(!oldSeen(i))
        expect(t.apiErrorNoResume.decision).toBe(t.decision.reason)
      }
    }
    expect(lines).toBeGreaterThan(2000)                    // the loop looked at something
  })
})

describe('explainNoApiErrorResume -- the reason, by name', () => {
  const note = (r: ReturnType<typeof decideIdleAlert>) => r.apiErrorNoResume

  it('says nothing when the pane does not show the error, and nothing on the tick that resumes', () => {
    const { ticks } = runTicks([CLEAN, ERR, ERR])
    expect(note(ticks[0])).toBeNull()
    expect(ticks[2].decision.reason).toBe('resume-api-error')
    expect(note(ticks[2])).toBeNull()
  })

  it('confirming: the first tick, with the counter before and after and how many it takes', () => {
    const { ticks } = runTicks([ERR])
    expect(note(ticks[0])).toEqual({
      why: 'confirming', blockedBy: [],
      running: true, paneApiError: true, paneIdle: true, runningSubagents: 0, paneUsageLimited: false, pendingMessages: 0, standstillActive: false,
      confirmTicksBefore: 0, confirmTicks: 1, confirmTicksNeeded: API_ERROR_CONFIRM_TICKS,
      decision: 'api-error-confirming', lastResumeAt: null,
    })
  })

  it.each<[string, Partial<IdleAgentInput>, Record<string, unknown>]>([
    ['running', { running: false }, { running: false }],
    ['paneIdle', { paneIdle: false }, { paneIdle: false }],
    ['paneIdle', { paneIdle: null }, { paneIdle: null }],
    ['runningSubagents', { runningSubagents: 2 }, { runningSubagents: 2 }],
    ['paneUsageLimited', { paneUsageLimited: true }, { paneUsageLimited: true }],
    ['pendingMessages', { pendingMessages: 3 }, { pendingMessages: 3 }],
    ['standstillActive', { standstillActive: true }, { standstillActive: true }],
  ])('blocked by %s: the field is named and its value is on the line', (name, over, value) => {
    const n = note(runTicks([over]).ticks[0])
    expect(n).toMatchObject({ why: 'blocked', blockedBy: [name], ...value, confirmTicks: 0 })
  })

  it('names every blocker when there are several, and what the tick decided instead', () => {
    const n = note(runTicks([{ pendingMessages: 1, standstillActive: true, runningSubagents: 1 }]).ticks[0])
    expect(n).toMatchObject({ why: 'blocked', blockedBy: ['runningSubagents', 'pendingMessages', 'standstillActive'], decision: 'subagents-running' })
  })

  it('a blocked tick ZEROES the confirmation, and the line shows the counter it threw away', () => {
    const { ticks } = runTicks([ERR, { pendingMessages: 1 }, ERR])
    expect(note(ticks[1])).toMatchObject({ why: 'blocked', blockedBy: ['pendingMessages'], confirmTicksBefore: 1, confirmTicks: 0 })
    expect(note(ticks[2])).toMatchObject({ why: 'confirming', confirmTicksBefore: 0, confirmTicks: 1 })
  })

  it('streak-already-answered: after the one resume the same streak gets no more, and the line says when it went', () => {
    const { ticks } = runTicks([ERR, ERR, ERR, ERR])
    for (const t of ticks.slice(2)) {
      expect(note(t)).toMatchObject({ why: 'streak-already-answered', blockedBy: [], lastResumeAt: T0 + TICK, decision: t.decision.reason })
      expect(t.decision.reason).not.toBe('resume-api-error')
    }
  })

  it('repeat-rule: progress not measured, the error is back inside 10 minutes of the resume', () => {
    const first = runTicks([ERR, ERR])
    const second = runTicks([CLEAN, ERR, ERR], first.state, T0 + 2 * TICK)
    expect(second.ticks[2].decision.reason).toBe('api-error-repeat')
    expect(note(second.ticks[2])).toMatchObject({ why: 'repeat-rule', decision: 'api-error-repeat', lastResumeAt: T0 + TICK, confirmTicks: 2 })
  })

  it('park-rule: the third error in a row with no response since the resumes', () => {
    const none = { apiErrorProgressSinceResume: false }
    let { state } = runTicks([ERR, ERR])
    ;({ state } = runTicks([CLEAN, none, none], state, T0 + 20 * MIN))
    const third = runTicks([CLEAN, none, none], state, T0 + 40 * MIN)
    expect(third.ticks[2].decision.reason).toBe('api-error-repeat')
    expect(note(third.ticks[2])).toMatchObject({ why: 'park-rule', decision: 'api-error-repeat' })
  })

  it('unexplained: seen, not answered, and yet neither confirming nor a resume -- said, not hidden', () => {
    const n = explainNoApiErrorResume(base, NO_IDLE_STATE, { alert: false, reason: 'not-sustained' }, NO_IDLE_STATE)
    expect(n).toMatchObject({ why: 'unexplained', blockedBy: [], decision: 'not-sustained' })
  })
})

// --- Part 2: the watcher's own tick() ------------------------------------------------------------
const hoisted = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const logged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = []
  const log = (level: string) => (fields: Record<string, unknown>, msg: string) => { logged.push({ level, fields, msg }) }
  return { root: mkdtempSync(join(tmpdir(), 'idle-noresume-')), logged, log }
})
const { logged } = hoisted
tmpDirs().adopt(hoisted.root)
const realDb = await vi.importActual<typeof import('../db.js')>('../db.js')
const panes = new Map<string, string | null>()
const messages: Array<{ from: string; to: string; content: string }> = []
let pendingForX: Array<{ id: number; created_at: number; wake?: number }> = []
let failNextEnqueueTo: string | null = null
// Queue rows the router has typed in: the watcher asks getAgentMessage whether the last resume was
// delivered (card 8b8864e4). Without this export the mocked module throws at that call, and the
// tick dies before the line this file is about.
const deliveredIds = new Set<number>()

vi.mock('../logger.js', () => ({
  logger: { debug: hoisted.log('debug'), info: hoisted.log('info'), warn: hoisted.log('warn'), error: hoisted.log('error') },
}))
vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>()
  return { ...actual, PROJECT_ROOT: hoisted.root }
})
vi.mock('../web/agent-process.js', () => ({
  capturePane: (session: string) => (panes.has(session) ? panes.get(session) : null),
  isAgentRunning: () => true, saturationRefusesDispatch: () => false,
}))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: (a: string) => `agent-${a}` }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x'],
  agentDir: (a: string) => join(hoisted.root, 'agents', a),
  readAgentRemoteHost: () => null,
  readAgentProjects: () => null,
  readAgentClaudePlan: () => null,
  readAgentClaudeConfigDir: () => null,
}))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: () => {} }))
vi.mock('../db.js', () => ({
  getPendingMessages: (agent: string) => (agent === 'x' ? pendingForX : []),
  listKanbanCards: () => [],
  getLabelsForAllCards: () => new Map(),
  getLastOutboundMessageAt: () => null,
  getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }) }),
  createAgentMessage: (from: string, to: string, content: string) => {
    if (failNextEnqueueTo === to) { failNextEnqueueTo = null; throw new Error('queue down') }
    messages.push({ from, to, content })
    return { id: messages.length }
  },
  getAgentMessage: (id: number) => (id >= 1 && id <= messages.length ? { id, delivered_at: deliveredIds.has(id) ? 1 : null } : undefined),
  saveIdleGuardState: (...a: Parameters<typeof realDb.saveIdleGuardState>) => realDb.saveIdleGuardState(...a),
  loadIdleGuardState: (...a: Parameters<typeof realDb.loadIdleGuardState>) => realDb.loadIdleGuardState(...a),
}))

let { tick } = await import('../web/idle-agent-watcher.js')
const { MAIN_AGENT_ID } = await import('../config.js')

const SEP = '─'.repeat(80)
const BOX = `${'─'.repeat(70)} Friday ─\n❯ \n${SEP}`
const FOOT = '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ↓ to manage'
const ERR_PANE = `  Kész a javítás.\n\n⏺ API Error: Connection lost mid-response. The response above may be \n  incomplete.\n\n${BOX}\n${FOOT}`
const WAITING_ERR_PANE = `\n⏺ API Error: Connection lost mid-response. The response above may be \n  incomplete.\n\n✻ Waiting for 1 background agent to finish\n\n${BOX}\n${FOOT}\n\n  ⏺ main\n  ◯ general-purpose  Checking trial daysLeft calcul… 25m 53s · ↓ 202.2k tokens`
/** No footer under the box: the classifier answers 'unknown', and the error is still the last block. */
const UNKNOWN_ERR_PANE = `  Kész a javítás.\n\n⏺ API Error: Connection lost mid-response. The response above may be \n  incomplete.\n\n${BOX}`
const HEALTHY_IDLE_PANE = `⏺ Rendben, folytatom.\n\n${BOX}\n${FOOT}`
const BUSY_PANE = `✶ Fluttering… (41s · ↓ 2.1k tokens)\n\n${BOX}\n  ⏵⏵ bypass permissions on · esc to interrupt`
const COORDINATOR_BUSY = `· Wrangling… (17s · ↓ 768 tokens)\n\n${BOX}\n  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt`

describe('tick() -- the line in the log', () => {
  const NOW = new Date('2026-11-11T10:00:00Z').getTime()
  const toX = () => messages.filter((m) => m.to === 'x')
  /** One tick; returns the no-resume lines THAT tick wrote. */
  const at = (min: number, pane: string) => {
    vi.setSystemTime(NOW + min * 60_000); panes.set('agent-x', pane)
    const from = logged.length
    tick()
    return logged.slice(from).filter((l) => l.msg.includes('no resume'))
  }
  const workcheck = (agent: string, kind: string) => {
    const dir = agent === MAIN_AGENT_ID ? hoisted.root : join(hoisted.root, 'agents', agent)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'workcheck.json'), JSON.stringify({ kind }))
  }

  beforeEach(async () => {
    vi.resetModules(); ({ tick } = await import('../web/idle-agent-watcher.js'))
    realDb.initDatabase(':memory:')
    rmSync(join(hoisted.root, 'store'), { recursive: true, force: true })
    mkdirSync(join(hoisted.root, 'store'), { recursive: true })
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    panes.clear(); messages.length = 0; logged.length = 0; pendingForX = []; failNextEnqueueTo = null; deliveredIds.clear()
    workcheck(MAIN_AGENT_ID, 'none')
    workcheck('x', 'assigned_open_cards')
    panes.set(`agent-${MAIN_AGENT_ID}`, COORDINATOR_BUSY)
  })
  afterEach(() => { vi.useRealTimers() })

  it('first tick: ONE info line, the agent, the reason, each conjunct and the counter', () => {
    const lines = at(0, ERR_PANE)
    expect(toX()).toHaveLength(0)
    expect(lines).toHaveLength(1)
    expect(lines[0].level).toBe('info')
    expect(lines[0].msg).toBe('idle guard: x -> API error on the pane, no resume: confirming')
    expect(lines[0].fields).toEqual({
      idleGuard: true, agent: 'x',
      why: 'confirming', blockedBy: [],
      running: true, paneApiError: true, paneIdle: true, runningSubagents: 0, paneUsageLimited: false, pendingMessages: 0, standstillActive: false,
      confirmTicksBefore: 0, confirmTicks: 1, confirmTicksNeeded: 2,
      decision: 'api-error-confirming', lastResumeAt: null,
    })
  })

  it('the tick that resumes writes no such line; the ticks after it say the streak was already answered', () => {
    at(0, ERR_PANE)
    expect(at(3, ERR_PANE)).toHaveLength(0)
    expect(toX()).toHaveLength(1)
    for (let m = 6; m <= 30; m += 3) {
      const lines = at(m, ERR_PANE)
      expect(lines).toHaveLength(1)
      expect(lines[0].fields).toMatchObject({ why: 'streak-already-answered', lastResumeAt: NOW + 3 * MIN })
      expect(lines[0].msg).toBe('idle guard: x -> API error on the pane, no resume: streak-already-answered')
    }
    expect(toX().filter((m) => m.content.startsWith('a turnod'))).toHaveLength(1)
  })

  // The seam with card 8b8864e4: once the resume was typed in, an error at the tail is a later loss,
  // a new streak. The line must say so, not "already answered" -- that was the reason that hid the
  // jarvis 2026-11-10 standstill. The CONTROL is the test above: the resume never delivered.
  it('after the resume is DELIVERED, the next tick names a new streak being confirmed, not the old one answered', () => {
    at(0, ERR_PANE)
    expect(at(3, ERR_PANE)).toHaveLength(0)
    const resumes = toX().filter((m) => m.content.startsWith('a turnod'))
    expect(resumes).toHaveLength(1)
    deliveredIds.add(messages.indexOf(resumes[0]) + 1)
    const lines = at(6, ERR_PANE)
    expect(lines).toHaveLength(1)
    expect(lines[0].fields).toMatchObject({ why: 'confirming', decision: 'api-error-confirming', lastResumeAt: NOW + 3 * MIN })
    expect(lines[0].msg).toBe('idle guard: x -> API error on the pane, no resume: confirming')
  })

  it('background work on the footer: blocked, named, with the count -- on every tick it lasts', () => {
    for (let m = 0; m <= 30; m += 3) {
      const lines = at(m, WAITING_ERR_PANE)
      expect(lines).toHaveLength(1)
      expect(lines[0].fields).toMatchObject({ why: 'blocked', blockedBy: ['runningSubagents'], runningSubagents: 1, confirmTicks: 0 })
      expect(lines[0].msg).toBe('idle guard: x -> API error on the pane, no resume: blocked by runningSubagents')
    }
    expect(toX()).toHaveLength(0)
  })

  it('a pane the classifier could not read, with the error on it: blocked by paneIdle, value null, and no resume', () => {
    for (let m = 0; m <= 12; m += 3) {
      const lines = at(m, UNKNOWN_ERR_PANE)
      expect(lines).toHaveLength(1)
      expect(lines[0].fields).toMatchObject({ why: 'blocked', blockedBy: ['paneIdle'], paneIdle: null, paneApiError: true })
    }
    expect(toX()).toHaveLength(0)
  })

  it('a pane that is typing or busy under the error: blocked by paneIdle, value false', () => {
    const typing = ERR_PANE.replace('❯ ', '❯ valami félbehagyott szöveg')
    const lines = at(0, typing)
    expect(lines).toHaveLength(1)
    expect(lines[0].fields).toMatchObject({ why: 'blocked', blockedBy: ['paneIdle'], paneIdle: false })
  })

  it('a waking letter in the queue: blocked by pendingMessages, and the confirmation it cost is on the line', () => {
    at(0, ERR_PANE)
    pendingForX = [{ id: 1, created_at: Math.floor(NOW / 1000) }]
    const lines = at(3, ERR_PANE)
    expect(toX()).toHaveLength(0)                          // this tick would have been the resume
    expect(lines).toHaveLength(1)
    expect(lines[0].fields).toMatchObject({ why: 'blocked', blockedBy: ['pendingMessages'], pendingMessages: 1, confirmTicksBefore: 1, confirmTicks: 0 })
    pendingForX = []
    expect(at(6, ERR_PANE)[0].fields).toMatchObject({ why: 'confirming', confirmTicks: 1 })
    expect(at(9, ERR_PANE)).toHaveLength(0)
    expect(toX()).toHaveLength(1)
  })

  it('a quiet notice in the queue blocks nothing (it is not on its way), so it is not named', () => {
    at(0, ERR_PANE)
    pendingForX = [{ id: 1, created_at: Math.floor(NOW / 1000), wake: 0 }]
    expect(at(3, ERR_PANE)).toHaveLength(0)
    expect(toX()).toHaveLength(1)
  })

  it('a resume that was decided and could not be enqueued: its own warn line, not this one', () => {
    at(0, ERR_PANE)
    failNextEnqueueTo = 'x'
    const from = logged.length
    expect(at(3, ERR_PANE)).toHaveLength(0)
    expect(toX()).toHaveLength(0)
    expect(logged.slice(from).filter((l) => l.level === 'warn').map((l) => l.msg)).toEqual(['idle guard: could not enqueue the API-error resume message'])
  })

  it('no error on the pane, no line: a healthy idle pane and a busy one', () => {
    for (let m = 0; m <= 30; m += 3) expect(at(m, HEALTHY_IDLE_PANE)).toHaveLength(0)
    for (let m = 33; m <= 60; m += 3) expect(at(m, BUSY_PANE)).toHaveLength(0)
  })

  it('at most one line per agent per tick, and none of them at debug', () => {
    for (let m = 0; m <= 60; m += 3) at(m, m % 2 ? WAITING_ERR_PANE : ERR_PANE)
    const lines = logged.filter((l) => l.msg.includes('no resume'))
    expect(lines.every((l) => l.level === 'info' && l.fields.agent === 'x')).toBe(true)
    expect(lines.length).toBeLessThanOrEqual(21)
    expect(lines.length).toBeGreaterThan(10)
  })
})
