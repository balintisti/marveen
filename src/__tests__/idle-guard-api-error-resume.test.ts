// A TURN THAT DIED ON AN API ERROR GETS ONE TARGETED "CONTINUE" -- card 843a9ab6.
//
// Measured 2026-10-16: nine times in a day across six agents the pane ended in
// `⏺ API Error: Connection lost mid-response ...` at an empty prompt. The guard saw plain idle, woke
// after 12-15+ minutes with a generic wake, never with 0 own cards, and the wake did not move the
// agent; a targeted message does. Design (marveen, card comments 36878 / 36879): two consecutive
// ticks, ONE message per streak, a repeat inside 10 minutes goes to the coordinator, no resume while
// the background-wait indicator shows.
//
// Part 1 is the pure decision. Part 2 runs the watcher's own tick() with the REAL pane classifier,
// the REAL detector and the REAL idle_guard_state persistence (in-memory sqlite); only tmux, the
// logger and the message queue are mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import {
  decideIdleAlert,
  buildApiErrorResumeMessage,
  buildFleetAlert,
  API_ERROR_REPEAT_MS,
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

const base: IdleAgentInput = {
  agent: 'x', running: true, paneIdle: true, pendingMessages: 0,
  ownWorkCount: 0, workCheckKind: 'assigned_open_cards', paneApiError: true,
}

/** Drive the pure decision like the watcher does, stamping a resume only when asked to. */
function runTicks(
  seq: Array<Partial<IdleAgentInput>>,
  t0: number,
  state: IdleAgentState = NO_IDLE_STATE,
  stampResumes = true,
): { reasons: string[]; state: IdleAgentState; decisions: ReturnType<typeof decideIdleAlert>['decision'][] } {
  const reasons: string[] = []
  const decisions: ReturnType<typeof decideIdleAlert>['decision'][] = []
  let s = state
  seq.forEach((over, i) => {
    const now = t0 + i * TICK
    const r = decideIdleAlert({ ...base, ...over }, s, TH, now)
    s = r.next
    if (r.decision.alert && r.decision.reason === 'resume-api-error' && stampResumes) {
      s = { ...s, lastApiErrorResumeAt: now, apiErrorHandledSince: s.apiErrorSinceMs }
    }
    reasons.push(r.decision.reason)
    decisions.push(r.decision)
  })
  return { reasons, state: s, decisions }
}
const ERR = {}
const CLEAN = { paneApiError: false }
const T0 = Date.UTC(2026, 9, 16, 10, 0, 0)

describe('decideIdleAlert -- resume-api-error', () => {
  it('first tick only confirms, the second consecutive tick sends (with 0 own cards)', () => {
    const { reasons, decisions } = runTicks([ERR, ERR], T0)
    expect(reasons).toEqual(['api-error-confirming', 'resume-api-error'])
    const d = decisions[1]
    expect(d.alert && d.reason === 'resume-api-error' && d.errorSinceMs).toBe(T0)
  })

  it('also with assigned cards, and for an on-call (kind none) agent', () => {
    expect(runTicks([ERR, ERR], T0).reasons[1]).toBe('resume-api-error')
    expect(runTicks([{ ownWorkCount: 5 }, { ownWorkCount: 5 }], T0).reasons[1]).toBe('resume-api-error')
    expect(runTicks([{ workCheckKind: 'none' }, { workCheckKind: 'none' }], T0).reasons[1]).toBe('resume-api-error')
  })

  it('the two ticks must be CONSECUTIVE: a clean tick in between restarts the confirmation', () => {
    const { reasons } = runTicks([ERR, CLEAN, ERR], T0)
    expect(reasons[2]).toBe('api-error-confirming')
    expect(runTicks([ERR, CLEAN, ERR, ERR], T0).reasons[3]).toBe('resume-api-error')
  })

  it('one answer per streak: after the stamped resume the same streak sends nothing more', () => {
    const { reasons } = runTicks([ERR, ERR, ERR, ERR, ERR], T0)
    expect(reasons.filter((r) => r === 'resume-api-error')).toHaveLength(1)
    expect(reasons.slice(2)).not.toContain('api-error-repeat')
  })

  it('a FAILED enqueue (no stamp) is decided again next tick, and carries no clock', () => {
    const { reasons, state } = runTicks([ERR, ERR, ERR], T0, NO_IDLE_STATE, false)
    expect(reasons).toEqual(['api-error-confirming', 'resume-api-error', 'resume-api-error'])
    expect(state.lastApiErrorResumeAt).toBeUndefined()
  })

  it('a repeat inside 10 minutes of the last resume: ONE coordinator alert, no further resume', () => {
    const first = runTicks([ERR, ERR], T0)                       // resume stamped at T0+3min
    const lastResume = first.state.lastApiErrorResumeAt as number
    expect(lastResume).toBe(T0 + TICK)
    const t1 = T0 + 2 * TICK                                    // the agent moved, then died again
    const second = runTicks([CLEAN, ERR, ERR, ERR, ERR], t1, first.state)
    expect(second.reasons.slice(1, 3)).toEqual(['api-error-confirming', 'api-error-repeat'])
    const alertIdx = second.reasons.indexOf('api-error-repeat')
    expect(alertIdx).toBe(2)
    const d = second.decisions[alertIdx]
    expect(d.alert && d.reason).toBe('api-error-repeat')
    expect(second.reasons.filter((r) => r === 'api-error-repeat')).toHaveLength(1)
    expect(second.reasons).not.toContain('resume-api-error')
    // the resume was within API_ERROR_REPEAT_MS of the alert's confirming tick
    expect(t1 + 2 * TICK - lastResume).toBeLessThan(API_ERROR_REPEAT_MS)
  })

  it('after 10 minutes the same agent is resumed again', () => {
    const first = runTicks([ERR, ERR], T0)
    const t1 = (first.state.lastApiErrorResumeAt as number) + API_ERROR_REPEAT_MS + TICK
    const second = runTicks([CLEAN, ERR, ERR], t1, first.state)
    expect(second.reasons.slice(1)).toEqual(['api-error-confirming', 'resume-api-error'])
  })

  it('background-wait indicator: NO resume however long the error stands', () => {
    const { reasons } = runTicks(Array(30).fill({ runningSubagents: 1 }), T0)
    expect(reasons).not.toContain('resume-api-error')
    expect(reasons).not.toContain('api-error-confirming')
  })

  it('TRANSITION: indicator gone, error still on the pane -> confirmation starts from that moment, then resume', () => {
    const held = Array(10).fill({ runningSubagents: 1 })
    const { reasons } = runTicks([...held, ERR, ERR, ERR], T0)
    expect(reasons.slice(0, 10)).not.toContain('resume-api-error')
    expect(reasons[10]).toBe('api-error-confirming')
    expect(reasons[11]).toBe('resume-api-error')
  })

  it('a single tick before the indicator appears does not count towards the later confirmation', () => {
    const { reasons } = runTicks([ERR, { runningSubagents: 1 }, ERR], T0)
    expect(reasons[2]).toBe('api-error-confirming')
  })

  it.each([
    ['a waking letter on its way', { pendingMessages: 1 }],
    ['a declared standstill', { standstillActive: true }],
    ['a busy pane', { paneIdle: false }],
    ['the plan limit reached', { paneUsageLimited: true }],
    ['a stopped agent', { running: false }],
    ['an unreadable pane', { paneIdle: null }],
  ])('%s: never a resume', (_n, over) => {
    expect(runTicks(Array(6).fill(over), T0).reasons).not.toContain('resume-api-error')
  })

  it('CONTROL: without the detector flag the same agent takes the old path (not-sustained, then the old stages)', () => {
    const { reasons } = runTicks([CLEAN, CLEAN], T0)
    expect(reasons).not.toContain('api-error-confirming')
    expect(reasons).not.toContain('resume-api-error')
  })
})

describe('the message and the alert text', () => {
  it('names the error time in Europe/Budapest (CEST in October: UTC+2)', () => {
    expect(buildApiErrorResumeMessage(Date.UTC(2026, 9, 16, 10, 5, 0)))
      .toBe('a turnod API-hibával megszakadt 12:05-kor, folytasd onnan, ahol tartottál')
  })
  it('winter time is UTC+1', () => {
    expect(buildApiErrorResumeMessage(Date.UTC(2026, 11, 16, 10, 5, 0)))
      .toBe('a turnod API-hibával megszakadt 11:05-kor, folytasd onnan, ahol tartottál')
  })
  it('the repeat alert names the agent and the minutes, alone and grouped', () => {
    const one = buildFleetAlert([{ kind: 'api-error-repeat', agent: 'didi', minutes: 6 }])
    expect(one).toContain('"didi"')
    expect(one).toContain('6 perccel')
    const two = buildFleetAlert([
      { kind: 'api-error-repeat', agent: 'didi', minutes: 6 },
      { kind: 'api-error-repeat', agent: 'dexter', minutes: 3 },
    ])
    expect(two).toContain('didi')
    expect(two).toContain('dexter')
  })
})

// --- Part 2: the watcher's own tick() ------------------------------------------------------------
const hoisted = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  return { root: mkdtempSync(join(tmpdir(), 'idle-apierr-')) }
})
tmpDirs().adopt(hoisted.root)
const realDb = await vi.importActual<typeof import('../db.js')>('../db.js')
const panes = new Map<string, string | null>()
const messages: Array<{ from: string; to: string; content: string }> = []
let failNextEnqueueTo: string | null = null

vi.mock('../logger.js', () => ({ logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>()
  return { ...actual, PROJECT_ROOT: hoisted.root }
})
vi.mock('../web/agent-process.js', () => ({
  capturePane: (session: string) => (panes.has(session) ? panes.get(session) : null),
  isAgentRunning: () => true,
}))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: (a: string) => `agent-${a}` }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x'],
  agentDir: (a: string) => join(hoisted.root, 'agents', a),
  readAgentRemoteHost: () => null,
  readAgentProjects: () => null,
}))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: () => {} }))
vi.mock('../db.js', () => ({
  getPendingMessages: () => [],
  listKanbanCards: () => [],
  getLabelsForAllCards: () => new Map(),
  getLastOutboundMessageAt: () => null,
  getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }) }),
  createAgentMessage: (from: string, to: string, content: string) => {
    if (failNextEnqueueTo === to) { failNextEnqueueTo = null; throw new Error('queue down') }
    messages.push({ from, to, content })
    return { id: messages.length }
  },
  // The REAL persistence: whatever db.ts whitelists is what survives the "restart" below.
  saveIdleGuardState: (...a: Parameters<typeof realDb.saveIdleGuardState>) => realDb.saveIdleGuardState(...a),
  loadIdleGuardState: (...a: Parameters<typeof realDb.loadIdleGuardState>) => realDb.loadIdleGuardState(...a),
}))

let { tick } = await import('../web/idle-agent-watcher.js')
const { MAIN_AGENT_ID } = await import('../config.js')
const { detectPaneState } = await import('../pane-state.js')

const SEP = '─'.repeat(80)
const BOX = `${'─'.repeat(70)} Friday ─\n❯ \n${SEP}`
const FOOT = '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ↓ to manage'
const ERR_PANE = `  Kész a javítás.\n\n⏺ API Error: Connection lost mid-response. The response above may be \n  incomplete.\n\n${BOX}\n${FOOT}`
// verbatim shape of MANDARK_0855 (idle-guard-background-wait.test.ts): the indicator AND the error
const WAITING_ERR_PANE = `\n⏺ API Error: Connection lost mid-response. The response above may be \n  incomplete.\n\n✻ Waiting for 1 background agent to finish\n\n${BOX}\n${FOOT}\n\n  ⏺ main\n  ◯ general-purpose  Checking trial daysLeft calcul… 25m 53s · ↓ 202.2k tokens`
const BUSY_PANE = `✶ Fluttering… (41s · ↓ 2.1k tokens)\n\n${BOX}\n  ⏵⏵ bypass permissions on · esc to interrupt`
const COORDINATOR_BUSY = `· Wrangling… (17s · ↓ 768 tokens)\n\n${BOX}\n  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt`

describe('tick() -- the API-error resume, end to end', () => {
  const NOW = new Date('2026-10-16T10:00:00Z').getTime()
  const toX = () => messages.filter((m) => m.to === 'x')
  const toCoordinator = () => messages.filter((m) => m.to === MAIN_AGENT_ID)
  const at = (min: number, pane: string) => { vi.setSystemTime(NOW + min * 60_000); panes.set('agent-x', pane); tick() }
  const workcheck = (agent: string, kind: string) => {
    const dir = agent === MAIN_AGENT_ID ? hoisted.root : join(hoisted.root, 'agents', agent)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'workcheck.json'), JSON.stringify({ kind }))
  }
  const reload = async () => { vi.resetModules(); ;({ tick } = await import('../web/idle-agent-watcher.js')) }

  beforeEach(async () => {
    await reload()
    realDb.initDatabase(':memory:')
    rmSync(join(hoisted.root, 'store'), { recursive: true, force: true })
    mkdirSync(join(hoisted.root, 'store'), { recursive: true })
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    panes.clear(); messages.length = 0; failNextEnqueueTo = null
    workcheck(MAIN_AGENT_ID, 'none')
    workcheck('x', 'assigned_open_cards')          // no cards on the board: 0 own cards
    panes.set(`agent-${MAIN_AGENT_ID}`, COORDINATOR_BUSY)
  })
  afterEach(() => { vi.useRealTimers() })

  it('POSITIVE CONTROL: the fixture panes are what the guard reads as idle (so the detector, not the state, decides)', () => {
    expect(detectPaneState(ERR_PANE)).toBe('idle')
    expect(detectPaneState(WAITING_ERR_PANE)).toBe('idle')
  })

  it('0 own cards: tick 1 sends nothing, tick 2 sends the targeted message (minutes, not the 12-15+ of the generic wake)', () => {
    at(0, ERR_PANE)
    expect(toX()).toHaveLength(0)
    at(3, ERR_PANE)
    expect(toX()).toHaveLength(1)
    expect(toX()[0].from).toBe('system')
    expect(toX()[0].content).toBe('a turnod API-hibával megszakadt 12:00-kor, folytasd onnan, ahol tartottál')
    for (let m = 6; m <= 60; m += 3) at(m, ERR_PANE)
    expect(toX().filter((x) => x.content.startsWith('a turnod'))).toHaveLength(1)   // one answer per streak
  })

  it('background indicator: an hour of ticks, no message to the agent', () => {
    for (let m = 0; m <= 60; m += 3) at(m, WAITING_ERR_PANE)
    expect(toX()).toHaveLength(0)
  })

  it('TRANSITION: the indicator disappears with the error still last -> resume on the second tick after', () => {
    for (let m = 0; m <= 30; m += 3) at(m, WAITING_ERR_PANE)
    expect(toX()).toHaveLength(0)
    at(33, ERR_PANE)
    expect(toX()).toHaveLength(0)
    at(36, ERR_PANE)
    expect(toX()).toHaveLength(1)
    expect(toX()[0].content).toContain('megszakadt 12:33-kor')
  })

  it('a healthy idle pane after the error is gone is left to the old path', () => {
    at(0, ERR_PANE)
    at(3, `⏺ Rendben, folytatom.\n\n${BOX}\n${FOOT}`)
    at(6, ERR_PANE)
    expect(toX()).toHaveLength(0)                    // the streak restarted
  })

  it('a FAILED enqueue stamps nothing: no clock, and the next tick retries', () => {
    at(0, ERR_PANE)
    failNextEnqueueTo = 'x'
    at(3, ERR_PANE)
    expect(toX()).toHaveLength(0)
    expect(realDb.loadIdleGuardState('x', 60 * MIN, NOW + 3 * MIN)?.lastApiErrorResumeAt ?? null).toBeNull()
    at(6, ERR_PANE)
    expect(toX()).toHaveLength(1)
    expect(realDb.loadIdleGuardState('x', 60 * MIN, NOW + 6 * MIN)?.lastApiErrorResumeAt).toBe(NOW + 6 * MIN)
  })

  it('a repeat within 10 minutes: a FleetAlert to the coordinator, no second message to the agent', () => {
    at(0, ERR_PANE); at(3, ERR_PANE)                 // resume at +3
    at(6, BUSY_PANE)                                 // it moved ...
    at(9, ERR_PANE); at(12, ERR_PANE)                // ... and died again, confirmed at +12 (9 min after the resume)
    expect(toX()).toHaveLength(1)
    expect(toCoordinator()).toHaveLength(1)
    expect(toCoordinator()[0].content).toContain('MASODSZOR')
    expect(toCoordinator()[0].content).toContain('"x"')
    for (let m = 15; m <= 45; m += 3) at(m, ERR_PANE)
    expect(toX().filter((x) => x.content.startsWith('a turnod'))).toHaveLength(1)
    expect(toCoordinator().filter((x) => x.content.includes('MASODSZOR'))).toHaveLength(1)
  })

  it('after 10 minutes the agent is resumed again', () => {
    at(0, ERR_PANE); at(3, ERR_PANE)
    at(6, BUSY_PANE)
    at(18, ERR_PANE); at(21, ERR_PANE)               // 18 min after the resume
    expect(toX().filter((x) => x.content.startsWith('a turnod'))).toHaveLength(2)
    expect(toCoordinator().filter((x) => x.content.includes('MASODSZOR'))).toHaveLength(0)
  })

  it('the clock survives a restart (real idle_guard_state): the repeat is still caught after the reload', async () => {
    at(0, ERR_PANE); at(3, ERR_PANE)
    expect(realDb.loadIdleGuardState('x', 60 * MIN, NOW + 3 * MIN)?.lastApiErrorResumeAt).toBe(NOW + 3 * MIN)
    await reload()                                   // new process: the in-memory state is gone
    at(6, BUSY_PANE)
    at(9, ERR_PANE); at(12, ERR_PANE)
    expect(toX()).toHaveLength(1)
    expect(toCoordinator().filter((x) => x.content.includes('MASODSZOR'))).toHaveLength(1)
  })
})
