// A TURN THAT DIED ON AN API ERROR GETS ONE TARGETED "CONTINUE" -- card 843a9ab6.
//
// Measured 2026-10-16: nine times in a day across six agents the pane ended in
// `⏺ API Error: Connection lost mid-response ...` at an empty prompt. The guard saw plain idle, woke
// after 12-15+ minutes with a generic wake, never with 0 own cards, and the wake did not move the
// agent; a targeted message does. Design (marveen, card comments 36878 / 36879): two consecutive
// ticks, ONE message per streak, a repeat inside 10 minutes goes to the coordinator, no resume while
// the background-wait indicator shows.
// Card 46e6bfb0 (marveen 53925): when the transcript can be read, PROGRESS decides, not the 10 minutes:
// the coordinator is told only on the API_ERROR_PARK_AFTER-th error in a row with no successful
// response since the resume; any response zeroes the count. Unmeasured progress keeps the time rule.
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
  API_ERROR_RESUME_FACTS,
  buildFleetAlert,
  API_ERROR_REPEAT_MS,
  API_ERROR_PARK_AFTER,
  NO_IDLE_STATE,
  withPaneApiErrorNote,
  API_ERROR_CONFIRM_MIN_MS,
  API_ERROR_RECHECK_MS,
  type IdleAgentInput,
  type IdleAgentState,
  type IdleAgentThresholds,
} from '../idle-agent.js'

/** The background sentence of the resume (card bd1f7b2c), spelled out here so a change to it is seen. */
const backgroundNote = (n: number) =>
  `Közben ${n} háttérmunka fut (al-ágens, shell, monitor vagy leválasztott folyamat): a turnod ettől függetlenül állt meg, és ezek az üzenet idején még futottak.`

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
  th: IdleAgentThresholds = TH,
): { reasons: string[]; state: IdleAgentState; decisions: ReturnType<typeof decideIdleAlert>['decision'][] } {
  const reasons: string[] = []
  const decisions: ReturnType<typeof decideIdleAlert>['decision'][] = []
  let s = state
  seq.forEach((over, i) => {
    const now = t0 + i * TICK
    const r = decideIdleAlert({ ...base, ...over }, s, th, now)
    s = r.next
    if (r.decision.alert && r.decision.reason === 'resume-api-error' && stampResumes) {
      s = { ...s, lastApiErrorResumeAt: now, apiErrorHandledSince: s.apiErrorSinceMs, apiErrorResumesNoProgress: (s.apiErrorResumesNoProgress ?? 0) + 1 }
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

  // Card bd1f7b2c: background work no longer holds the resume back. The main turn is dead either way
  // (the error at the tail of an idle pane), and a message typed into a free prompt interrupts
  // nothing that runs in the background. Measured 2026-11-13: friday stood 26 minutes behind a
  // DETACHED gate (the watcher adds those to this count), computress with nothing on the footer.
  it('background work (a shell, a sub-agent, a detached gate: one count): confirmed, resumed once, the decision carries the count', () => {
    const { reasons, decisions } = runTicks(Array(30).fill({ runningSubagents: 2 }), T0)
    expect(reasons.slice(0, 2)).toEqual(['api-error-confirming', 'resume-api-error'])
    expect(decisions[1]).toMatchObject({ reason: 'resume-api-error', backgroundWork: 2 })
    expect(reasons.filter((r) => r === 'resume-api-error')).toHaveLength(1)              // one answer per streak
    expect(reasons.slice(2).every((r) => r === 'subagents-running')).toBe(true)          // answered: the hold applies as before
  })

  it('CONTROL: without background work the decision carries 0', () => {
    const { decisions } = runTicks([ERR, ERR], T0)
    expect(decisions[1]).toMatchObject({ reason: 'resume-api-error', backgroundWork: 0 })
  })

  it('past the hold / as a ghost row: still the one resume, and the hold ends as before', () => {
    const th: IdleAgentThresholds = { ...TH, subagentHoldMs: 30 * MIN, subagentSilentMs: 20 * MIN }
    const { reasons } = runTicks(Array(60).fill({ runningSubagents: 1, lastActionAtMs: null }), T0, NO_IDLE_STATE, true, th)
    expect(reasons.filter((r) => r === 'resume-api-error')).toHaveLength(1)
    expect(reasons.slice(2, 7)).toEqual(Array(5).fill('subagents-running'))          // POSITIVE CONTROL: the hold phase happened
    expect(reasons.slice(-5).every((r) => r !== 'subagents-running')).toBe(true)       // ... and the hold really ended
  })

  it('the indicator going away is not a new streak: one resume in all', () => {
    const held = Array(10).fill({ runningSubagents: 1 })
    const { reasons } = runTicks([...held, ERR, ERR, ERR], T0)
    expect(reasons[1]).toBe('resume-api-error')
    expect(reasons.filter((r) => r === 'resume-api-error')).toHaveLength(1)
  })

  it('a tick with background work counts towards the confirmation like any other', () => {
    const { reasons } = runTicks([ERR, { runningSubagents: 1 }, ERR], T0)
    expect(reasons.slice(0, 2)).toEqual(['api-error-confirming', 'resume-api-error'])
  })

  it.each([
    ['a waking letter on its way', { pendingMessages: 1 }],
    ['a busy pane', { paneIdle: false }],
    ['the plan limit reached', { paneUsageLimited: true }],
    ['a stopped agent', { running: false }],
    ['an unreadable pane', { paneIdle: null }],
  ])('%s: never a resume', (_n, over) => {
    expect(runTicks(Array(6).fill(over), T0).reasons).not.toContain('resume-api-error')
  })

  // Card 62b67531 (marveen 65821, option b): a declared standstill says "no new work", not "leave a
  // cut turn broken". It used to be a blocker here: mandark 2026-11-15, 46 ticks blocked, 0 resumes.
  it('a declared standstill does NOT stop the resume of a cut turn: confirmed, then resumed', () => {
    const { reasons } = runTicks([{ standstillActive: true }, { standstillActive: true }, { standstillActive: true }], T0)
    expect(reasons.slice(0, 2)).toEqual(['api-error-confirming', 'resume-api-error'])
    expect(reasons.filter((r) => r === 'resume-api-error')).toHaveLength(1)        // still one answer per streak
  })

  it(`a declared standstill keeps the loop limit: ${API_ERROR_PARK_AFTER} errors with no response -> the coordinator, not a third resume`, () => {
    const S = { standstillActive: true }
    const NO = { standstillActive: true, apiErrorProgressSinceResume: false }
    const a = runTicks([S, S], T0)
    const b = runTicks([{ ...S, paneApiError: false }, NO, NO], T0 + 2 * TICK, a.state)
    const c = runTicks([{ ...S, paneApiError: false }, NO, NO], T0 + 5 * TICK, b.state)
    expect([a.reasons[1], b.reasons[2], c.reasons[2]]).toEqual(['resume-api-error', 'resume-api-error', 'api-error-repeat'])
  })

  it('CONTROL: a declared standstill still silences a plain idle pane (no error): no wake, no notice', () => {
    const { reasons, decisions } = runTicks(Array(20).fill({ standstillActive: true, paneApiError: false, ownWorkCount: 2 }), T0)
    expect(decisions.some((d) => d.alert)).toBe(false)
    expect(new Set(reasons)).toEqual(new Set(['standstill']))
  })

  it('CONTROL: without the detector flag the same agent takes the old path (not-sustained, then the old stages)', () => {
    const { reasons } = runTicks([CLEAN, CLEAN], T0)
    expect(reasons).not.toContain('api-error-confirming')
    expect(reasons).not.toContain('resume-api-error')
  })
})

describe('decideIdleAlert -- progress, not time (card 46e6bfb0)', () => {
  const OK = { apiErrorProgressSinceResume: true }
  const NO = { apiErrorProgressSinceResume: false }

  it('error, resume, a successful response, error again inside 10 minutes: resumed, NOT escalated', () => {
    const first = runTicks([ERR, ERR], T0)
    const t1 = T0 + 2 * TICK
    const second = runTicks([CLEAN, OK, OK], t1, first.state)
    expect(t1 + 2 * TICK - (first.state.lastApiErrorResumeAt as number)).toBeLessThan(API_ERROR_REPEAT_MS)
    expect(second.reasons.slice(1)).toEqual(['api-error-confirming', 'resume-api-error'])
    expect(second.state.apiErrorResumesNoProgress).toBe(1)          // zeroed, then this resume
  })

  it(`${API_ERROR_PARK_AFTER} errors in a row with no response: resumed twice, the coordinator told on the third`, () => {
    expect(API_ERROR_PARK_AFTER).toBe(3)
    const a = runTicks([ERR, ERR], T0)
    const b = runTicks([CLEAN, NO, NO], T0 + 2 * TICK, a.state)      // inside 10 minutes: still a resume
    expect(b.reasons.slice(1)).toEqual(['api-error-confirming', 'resume-api-error'])
    expect(b.state.apiErrorResumesNoProgress).toBe(2)
    const c = runTicks([CLEAN, NO, NO, NO, NO], T0 + 5 * TICK, b.state)
    expect(c.reasons.slice(1, 3)).toEqual(['api-error-confirming', 'api-error-repeat'])
    const d = c.decisions[2]
    expect(d.alert && d.reason === 'api-error-repeat' && d.errorsWithoutProgress).toBe(3)
    expect(c.reasons).not.toContain('resume-api-error')
    expect(c.reasons.filter((r) => r === 'api-error-repeat')).toHaveLength(1)   // one alert per streak
  })

  it('time does not matter when progress is measured: the third failed error hours later still escalates', () => {
    const a = runTicks([ERR, ERR], T0)
    const b = runTicks([CLEAN, NO, NO], T0 + 2 * 60 * MIN, a.state)
    expect(b.reasons[2]).toBe('resume-api-error')
    const c = runTicks([CLEAN, NO, NO], T0 + 5 * 60 * MIN, b.state)
    expect(c.reasons[2]).toBe('api-error-repeat')
  })

  it('any successful response zeroes the count: after two failed resumes a response buys two more', () => {
    const a = runTicks([ERR, ERR], T0)
    const b = runTicks([CLEAN, NO, NO], T0 + 2 * TICK, a.state)
    const c = runTicks([CLEAN, OK, OK], T0 + 5 * TICK, b.state)
    expect(c.reasons[2]).toBe('resume-api-error')
    const d = runTicks([CLEAN, NO, NO], T0 + 8 * TICK, c.state)
    expect(d.reasons[2]).toBe('resume-api-error')
    const e = runTicks([CLEAN, NO, NO], T0 + 11 * TICK, d.state)
    expect(e.reasons[2]).toBe('api-error-repeat')
  })

  it('unmeasured progress (null) keeps the 10-minute rule, and its alert carries no error count', () => {
    const a = runTicks([ERR, ERR], T0)
    const b = runTicks([CLEAN, { apiErrorProgressSinceResume: null }, { apiErrorProgressSinceResume: null }], T0 + 2 * TICK, a.state)
    expect(b.reasons[2]).toBe('api-error-repeat')
    const d = b.decisions[2]
    expect(d.alert && d.reason === 'api-error-repeat' && d.errorsWithoutProgress).toBeNull()
  })

  it('an unmeasured gap breaks the chain (didi Tipp a): two failed resumes, a null one, then a failure -> resumed, not parked', () => {
    const NUL = { apiErrorProgressSinceResume: null }
    const a = runTicks([ERR, ERR], T0)
    const b = runTicks([CLEAN, NO, NO], T0 + 2 * TICK, a.state)
    expect(b.state.apiErrorResumesNoProgress).toBe(2)
    const c = runTicks([CLEAN, NUL, NUL], T0 + 2 * TICK + 20 * MIN, b.state)   // past 10 min: the time rule resumes
    expect(c.reasons[2]).toBe('resume-api-error')
    expect(c.state.apiErrorResumesNoProgress).toBe(1)               // the response it may have had is unknown: only this resume counts
    const d = runTicks([CLEAN, NO, NO], T0 + 2 * TICK + 23 * MIN, c.state)
    expect(d.reasons[2]).toBe('resume-api-error')
    const e = runTicks([CLEAN, NO, NO], T0 + 2 * TICK + 26 * MIN, d.state)
    expect(e.reasons[2]).toBe('api-error-repeat')
  })
})

// Card 8b8864e4 (marveen 57334, jarvis 2026-11-10): the resume was typed in, the resumed turn died the
// same way seconds later, and no tick ever saw a different pane -- so the streak never broke and the
// second loss was read as the first, already answered.
describe('decideIdleAlert -- a loss after the delivered resume (card 8b8864e4)', () => {
  const D = { apiErrorResumeDelivered: true, apiErrorProgressSinceResume: false }

  it('the resume was delivered and the pane still ends in the error: a new streak, confirmed, resumed', () => {
    expect(runTicks([ERR, ERR, D, D], T0).reasons)
      .toEqual(['api-error-confirming', 'resume-api-error', 'api-error-confirming', 'resume-api-error'])
  })

  it('CONTROL: the resume not (yet) delivered -- the same streak, nothing more', () => {
    const notYet = { apiErrorResumeDelivered: false, apiErrorProgressSinceResume: false }
    const { reasons } = runTicks([ERR, ERR, notYet, notYet, notYet], T0)
    expect(reasons.slice(2).filter((r) => r.startsWith('resume') || r.startsWith('api-error'))).toEqual([])
  })

  it(`no pumping: with no progress the ${API_ERROR_PARK_AFTER}rd loss tells the coordinator, and then the streak stays answered`, () => {
    const { reasons } = runTicks([ERR, ERR, D, D, D, D, D, D, D, D, D], T0)
    expect(reasons.slice(0, 6)).toEqual([
      'api-error-confirming', 'resume-api-error',
      'api-error-confirming', 'resume-api-error',
      'api-error-confirming', 'api-error-repeat',
    ])
    // The repeat alert answered that streak without a resume of its own: an older delivered resume
    // must not restart it, or the coordinator would be told every other tick.
    expect(reasons.slice(6).filter((r) => r.startsWith('resume') || r.startsWith('api-error'))).toEqual([])
  })
})

describe('decideIdleAlert -- the confirm floor (card 8b8864e4)', () => {
  const input = { ...base }
  it(`a second sighting under ${API_ERROR_CONFIRM_MIN_MS / 1000}s after the first does not confirm; one after it does`, () => {
    const first = decideIdleAlert(input, NO_IDLE_STATE, TH, T0)
    expect(first.decision.reason).toBe('api-error-confirming')
    const tooSoon = decideIdleAlert(input, first.next, TH, T0 + API_ERROR_CONFIRM_MIN_MS - 1)
    expect(tooSoon.decision.reason).toBe('api-error-confirming')
    const atFloor = decideIdleAlert(input, first.next, TH, T0 + API_ERROR_CONFIRM_MIN_MS)
    expect(atFloor.decision.reason).toBe('resume-api-error')
  })
  it('the recheck comes after the floor (the sweep it schedules can confirm)', () => {
    expect(API_ERROR_RECHECK_MS).toBeGreaterThanOrEqual(API_ERROR_CONFIRM_MIN_MS)
  })
})

describe('withPaneApiErrorNote (card 8b8864e4)', () => {
  it('names the API error above the no-work notice, and leaves a clean pane\'s notice as it was', () => {
    expect(withPaneApiErrorNote('NOTICE', true)).toMatch(/^FIGYELEM: a pane utolso blokkja API-HIBA[\s\S]*\n\nNOTICE$/)
    expect(withPaneApiErrorNote('NOTICE', false)).toBe('NOTICE')
  })
})

describe('the message and the alert text', () => {
  it('names the background work it saw (bd1f7b2c), and without any the text is the one it always was', () => {
    const t = Date.UTC(2026, 9, 16, 10, 5, 0)
    expect(buildApiErrorResumeMessage(t, 3)).toBe(`a turnod API-hibával megszakadt 12:05-kor. ${backgroundNote(3)} ${API_ERROR_RESUME_FACTS}`)
    expect(buildApiErrorResumeMessage(t, 0)).toBe(buildApiErrorResumeMessage(t))
    expect(buildApiErrorResumeMessage(t)).toBe(`a turnod API-hibával megszakadt 12:05-kor. ${API_ERROR_RESUME_FACTS}`)
  })

  it('names the error time in Europe/Budapest (CEST in October: UTC+2)', () => {
    expect(buildApiErrorResumeMessage(Date.UTC(2026, 9, 16, 10, 5, 0)))
      .toBe(`a turnod API-hibával megszakadt 12:05-kor. ${API_ERROR_RESUME_FACTS}`)
  })
  it('winter time is UTC+1', () => {
    expect(buildApiErrorResumeMessage(Date.UTC(2026, 11, 16, 10, 5, 0)))
      .toBe(`a turnod API-hibával megszakadt 11:05-kor. ${API_ERROR_RESUME_FACTS}`)
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
  it('the progress alert names the error count, alone and grouped (card 46e6bfb0)', () => {
    const one = buildFleetAlert([{ kind: 'api-error-repeat', agent: 'didi', minutes: 4, errorsWithoutProgress: 3 }])
    expect(one).toContain('3. alkalommal')
    expect(one).toContain('EGYETLEN sikeres valasza sem volt')
    expect(one).not.toContain('MASODSZOR')
    const two = buildFleetAlert([
      { kind: 'api-error-repeat', agent: 'didi', minutes: 4, errorsWithoutProgress: 3 },
      { kind: 'api-error-repeat', agent: 'dexter', minutes: 3 },
    ])
    expect(two).toContain('didi -- 3 hiba sikeres valasz nelkul')
    expect(two).toContain('dexter -- 3 perccel az elozo folytatas utan')
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
// Queue rows the router has typed in (card 8b8864e4): getAgentMessage reports delivered_at for these.
const deliveredIds = new Set<number>()
const remoteHosts = new Map<string, string>()

vi.mock('../logger.js', () => ({ logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }))
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
  readAgentRemoteHost: (a: string) => remoteHosts.get(a) ?? null,
  readAgentProjects: () => null,
  // configDirFor (card 46e6bfb0) -> agents/x/.claude-config once its projects dir exists
  readAgentClaudePlan: () => null,
  readAgentClaudeConfigDir: () => null,
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
  getAgentMessage: (id: number) => (id >= 1 && id <= messages.length ? { id, delivered_at: deliveredIds.has(id) ? 1 : null } : undefined),
  // The REAL persistence: whatever db.ts whitelists is what survives the "restart" below.
  saveIdleGuardState: (...a: Parameters<typeof realDb.saveIdleGuardState>) => realDb.saveIdleGuardState(...a),
  loadIdleGuardState: (...a: Parameters<typeof realDb.loadIdleGuardState>) => realDb.loadIdleGuardState(...a),
}))

let { tick } = await import('../web/idle-agent-watcher.js')
const { projectsDirFor, readLastModelResponseMs } = await import('../web/active-model.js')
const { MAIN_AGENT_ID } = await import('../config.js')
const { detectPaneState, runningBackgroundWork } = await import('../pane-state.js')

const SEP = '─'.repeat(80)
const BOX = `${'─'.repeat(70)} Friday ─\n❯ \n${SEP}`
const FOOT = '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ↓ to manage'
const ERR_PANE = `  Kész a javítás.\n\n⏺ API Error: Connection lost mid-response. The response above may be \n  incomplete.\n\n${BOX}\n${FOOT}`
// verbatim shape of MANDARK_0855 (idle-guard-background-wait.test.ts): the indicator AND the error
const WAITING_ERR_PANE = `\n⏺ API Error: Connection lost mid-response. The response above may be \n  incomplete.\n\n✻ Waiting for 1 background agent to finish\n\n${BOX}\n${FOOT}\n\n  ⏺ main\n  ◯ general-purpose  Checking trial daysLeft calcul… 25m 53s · ↓ 202.2k tokens`
// friday 2026-11-13 01:16 (bd1f7b2c): the error, the turn's end line, an empty prompt, one shell on the footer
const SHELL_ERR_PANE = `\n⏺ API Error: Connection lost mid-response. The response above may be \n  incomplete.\n\n✻ Worked for 12s · done 0:50 · 1 shell still running\n\n${BOX}\n  ⏵⏵ bypass permissions on · 1 shell · ↓ to manage`
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
  // x's own transcript, where the watcher reads progress (agents/x/.claude-config, card 46e6bfb0).
  const xDir = join(hoisted.root, 'agents', 'x')
  const transcriptDir = () => projectsDirFor(xDir, join(xDir, '.claude-config'))
  const transcript = (...lines: object[]) => {
    mkdirSync(transcriptDir(), { recursive: true })
    writeFileSync(join(transcriptDir(), 's.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  }
  const reply = (min: number) => ({ type: 'assistant', timestamp: new Date(NOW + min * 60_000).toISOString(), message: { model: 'claude-opus-5-5', stop_reason: 'end_turn' } })
  const apiErr = (min: number) => ({
    type: 'assistant', isApiErrorMessage: true, error: 'server_error', timestamp: new Date(NOW + min * 60_000).toISOString(),
    message: { model: '<synthetic>', stop_reason: 'stop_sequence', content: [{ type: 'text', text: 'API Error: Connection lost mid-response.' }] },
  })

  beforeEach(async () => {
    await reload()
    realDb.initDatabase(':memory:')
    rmSync(join(hoisted.root, 'store'), { recursive: true, force: true })
    rmSync(join(xDir, '.claude-config'), { recursive: true, force: true })
    mkdirSync(join(hoisted.root, 'store'), { recursive: true })
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    panes.clear(); messages.length = 0; failNextEnqueueTo = null; remoteHosts.clear(); deliveredIds.clear()
    workcheck(MAIN_AGENT_ID, 'none')
    workcheck('x', 'assigned_open_cards')          // no cards on the board: 0 own cards
    panes.set(`agent-${MAIN_AGENT_ID}`, COORDINATOR_BUSY)
  })
  afterEach(() => { vi.useRealTimers() })

  it('POSITIVE CONTROL: the fixture panes are what the guard reads as idle (so the detector, not the state, decides)', () => {
    expect(detectPaneState(ERR_PANE)).toBe('idle')
    expect(detectPaneState(WAITING_ERR_PANE)).toBe('idle')
    expect(detectPaneState(SHELL_ERR_PANE)).toBe('idle')
    expect(runningBackgroundWork(SHELL_ERR_PANE)).toBe(1)
    expect(runningBackgroundWork(WAITING_ERR_PANE)).toBeGreaterThan(0)
  })

  it('0 own cards: tick 1 sends nothing, tick 2 sends the targeted message (minutes, not the 12-15+ of the generic wake)', () => {
    at(0, ERR_PANE)
    expect(toX()).toHaveLength(0)
    at(3, ERR_PANE)
    expect(toX()).toHaveLength(1)
    expect(toX()[0].from).toBe('system')
    expect(toX()[0].content).toBe(`a turnod API-hibával megszakadt 12:00-kor. ${API_ERROR_RESUME_FACTS}`)
    for (let m = 6; m <= 60; m += 3) at(m, ERR_PANE)
    expect(toX().filter((x) => x.content.startsWith('a turnod'))).toHaveLength(1)   // one answer per streak
  })

  it('FIELD CASE friday (bd1f7b2c): the error, one shell, 0 pending -> resumed on the second tick, the message names the shell', () => {
    at(0, SHELL_ERR_PANE)
    expect(toX()).toHaveLength(0)
    at(3, SHELL_ERR_PANE)
    expect(toX()).toHaveLength(1)
    expect(toX()[0].content).toBe(`a turnod API-hibával megszakadt 12:00-kor. ${backgroundNote(1)} ${API_ERROR_RESUME_FACTS}`)
    for (let m = 6; m <= 60; m += 3) at(m, SHELL_ERR_PANE)
    expect(toX()).toHaveLength(1)                                                     // one answer per streak
  })

  it('background indicator (a live sub-agent): resumed once in an hour, the message names it', () => {
    for (let m = 0; m <= 60; m += 3) at(m, WAITING_ERR_PANE)
    expect(toX()).toHaveLength(1)
    expect(toX()[0].content).toContain('háttérmunka fut')
  })

  it('the indicator disappearing with the error still last is the same streak: no second message', () => {
    for (let m = 0; m <= 30; m += 3) at(m, WAITING_ERR_PANE)
    expect(toX()).toHaveLength(1)
    at(33, ERR_PANE)
    at(36, ERR_PANE)
    expect(toX()).toHaveLength(1)
  })

  it('STANDSTILL (card 62b67531): x declared a standstill in workcheck.json -> the cut turn is still resumed on the second tick', () => {
    const until = new Date(NOW + 2 * 60 * 60_000).toISOString()
    writeFileSync(join(hoisted.root, 'agents', 'x', 'workcheck.json'), JSON.stringify({ kind: 'assigned_open_cards', standstill: { reason: 'budget', until } }))
    at(0, ERR_PANE)
    expect(toX()).toHaveLength(0)
    at(3, ERR_PANE)
    expect(toX()).toHaveLength(1)
    expect(toX()[0].content).toBe(`a turnod API-hibával megszakadt 12:00-kor. ${API_ERROR_RESUME_FACTS}`)
  })

  it('STANDSTILL CONTROL: the same standstill, a healthy idle pane for an hour -> nothing to x, nothing to the coordinator', () => {
    const until = new Date(NOW + 2 * 60 * 60_000).toISOString()
    writeFileSync(join(hoisted.root, 'agents', 'x', 'workcheck.json'), JSON.stringify({ kind: 'assigned_open_cards', standstill: { reason: 'budget', until } }))
    for (let m = 0; m <= 60; m += 3) at(m, `⏺ Rendben, folytatom.\n\n${BOX}\n${FOOT}`)
    expect(toX()).toHaveLength(0)
    expect(toCoordinator()).toHaveLength(0)
  })

  it('a healthy idle pane after the error is gone is left to the old path', () => {
    at(0, ERR_PANE)
    at(3, `⏺ Rendben, folytatom.\n\n${BOX}\n${FOOT}`)
    at(6, ERR_PANE)
    expect(toX()).toHaveLength(0)                    // the streak restarted
  })

  it('RECHECK (card 8b8864e4): a first sighting schedules one extra sweep a minute later, and it writes the resume', () => {
    at(0, ERR_PANE)
    expect(toX()).toHaveLength(0)
    vi.advanceTimersByTime(API_ERROR_RECHECK_MS)
    expect(toX()).toHaveLength(1)
    expect(toX()[0].content).toBe(`a turnod API-hibával megszakadt 12:00-kor. ${API_ERROR_RESUME_FACTS}`)
    vi.advanceTimersByTime(30 * MIN)                // no further sweep of its own: nothing else is scheduled
    expect(toX()).toHaveLength(1)
  })

  it('RECHECK CONTROL: the turn is retrying by the recheck (a spinner) -> no resume', () => {
    at(0, ERR_PANE)
    panes.set('agent-x', BUSY_PANE)
    vi.advanceTimersByTime(API_ERROR_RECHECK_MS)
    expect(toX()).toHaveLength(0)
  })

  it('RECHECK, AGAIN (didi 59520 N14): once the extra sweep has run, the next first sighting schedules its own', () => {
    at(0, ERR_PANE)
    panes.set('agent-x', BUSY_PANE)
    vi.advanceTimersByTime(API_ERROR_RECHECK_MS)   // the first extra sweep: the turn is retrying, nothing to write
    expect(toX()).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    at(6, ERR_PANE)                                // a new loss, first sighting
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(API_ERROR_RECHECK_MS)
    expect(toX()).toHaveLength(1)
    expect(toX()[0].content).toContain('megszakadt 12:06-kor')
  })

  it('RECHECK, ONE AT A TIME (didi 59520 N13): a second sighting under the floor does not start a second timer', () => {
    at(0, ERR_PANE)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(20_000)
    tick()                                         // 20 s after the first: under the floor, still confirming
    expect(toX()).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(API_ERROR_RECHECK_MS - 20_000)   // the one timer, a minute after the FIRST sighting
    expect(toX()).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('DIGEST DOWN (didi 59520 N12): the repeat that falls back to a live message still names the API error', () => {
    const noWork = () => toCoordinator().filter((m) => m.content.includes('"x"'))
    for (let m = 0; m <= 12; m += 3) at(m, ERR_PANE)
    expect(noWork()).toHaveLength(1)               // the first notice of the spell, live
    mkdirSync(join(hoisted.root, 'store', 'idle-digest.jsonl'), { recursive: true })   // appendFileSync -> EISDIR
    at(12 + 4 * 60 + 1, ERR_PANE)                  // the repeat: no digest to write it into
    expect(noWork()).toHaveLength(2)
    expect(noWork()[1].content.startsWith('FIGYELEM: a pane utolso blokkja API-HIBA')).toBe(true)
  })

  it('HELD QUEUE (card 8b8864e4): while the context-guard holds x for a restart, no resume is written; once the hold lapses, the next tick writes it', async () => {
    const { setDeliveryHoldProbe } = await import('../web/delivery-hold.js')
    const heldUntil = NOW + 8 * MIN
    setDeliveryHoldProbe((agent, nowMs) => (agent === 'x' && nowMs < heldUntil ? { phase: 'await-handoff', untilMs: heldUntil } : null))
    try {
      at(0, ERR_PANE); at(3, ERR_PANE); at(6, ERR_PANE)
      expect(toX()).toHaveLength(0)
      expect(realDb.loadIdleGuardState('x', 60 * MIN, NOW + 6 * MIN)?.lastApiErrorResumeAt ?? null).toBeNull()
      at(9, ERR_PANE)
      expect(toX()).toHaveLength(1)
      expect(toX()[0].content).toContain('megszakadt 12:00-kor')
    } finally {
      setDeliveryHoldProbe(null)
    }
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

  it('READER: the newest real response counts, the synthetic error line does not; no response = 0, no dir = null', () => {
    expect(readLastModelResponseMs(xDir, join(xDir, '.claude-config'))).toBeNull()
    transcript(reply(1), apiErr(2))
    expect(readLastModelResponseMs(xDir, join(xDir, '.claude-config'))).toBe(NOW + 1 * MIN)
    transcript(apiErr(1), apiErr(2))
    expect(readLastModelResponseMs(xDir, join(xDir, '.claude-config'))).toBe(0)
  })

  it('PROGRESS (card 46e6bfb0): a response after the resume, then an error inside 10 minutes -> resumed again, coordinator not told', () => {
    transcript(reply(-5), apiErr(-1))
    at(0, ERR_PANE); at(3, ERR_PANE)                 // resume at +3
    transcript(reply(-5), apiErr(-1), reply(5), apiErr(8))
    at(6, BUSY_PANE)
    at(9, ERR_PANE); at(12, ERR_PANE)                // 9 min after the resume, with a response at +5
    expect(toX().filter((x) => x.content.startsWith('a turnod'))).toHaveLength(2)
    expect(toCoordinator()).toHaveLength(0)
  })

  it('PROGRESS: three errors with no response since the resumes -> resumed twice, the coordinator told on the third, also after a restart', async () => {
    transcript(reply(-5), apiErr(-1))                // the last real response is BEFORE every resume
    at(0, ERR_PANE); at(3, ERR_PANE)                 // resume 1 at +3
    transcript(reply(-5), apiErr(-1), apiErr(7))
    at(6, BUSY_PANE)
    at(9, ERR_PANE); at(12, ERR_PANE)                // resume 2 at +12 (inside 10 min: the old rule escalated here)
    expect(toX().filter((x) => x.content.startsWith('a turnod'))).toHaveLength(2)
    expect(toCoordinator()).toHaveLength(0)
    expect(realDb.loadIdleGuardState('x', 60 * MIN, NOW + 12 * MIN)?.apiErrorResumesNoProgress).toBe(2)
    await reload()                                   // the count is persisted, not in memory only
    transcript(reply(-5), apiErr(-1), apiErr(7), apiErr(16))
    at(15, BUSY_PANE)
    at(18, ERR_PANE); at(21, ERR_PANE)
    expect(toX().filter((x) => x.content.startsWith('a turnod'))).toHaveLength(2)
    expect(toCoordinator()).toHaveLength(1)
    expect(toCoordinator()[0].content).toContain('3. alkalommal')
    expect(toCoordinator()[0].content).toContain('"x"')
  })

  it('JARVIS 2026-11-10 (card 8b8864e4): the resumed turn dies again with NO busy tick between -> resumed again, then the coordinator', () => {
    const resumes = () => messages.filter((m) => m.to === 'x' && m.content.startsWith('a turnod'))
    transcript(reply(-5), apiErr(-1))
    at(0, ERR_PANE); at(3, ERR_PANE)                 // resume 1 at +3
    expect(resumes()).toHaveLength(1)
    deliveredIds.add(messages.indexOf(resumes()[0]) + 1)   // typed in; the resumed turn dies in seconds
    transcript(reply(-5), apiErr(-1), apiErr(4))
    at(6, ERR_PANE)                                  // the SAME pane as at +3: confirming the new loss
    expect(resumes()).toHaveLength(1)
    at(9, ERR_PANE)
    expect(resumes()).toHaveLength(2)                // the old code: still 1, and the no-work notice later
    deliveredIds.add(messages.indexOf(resumes()[1]) + 1)
    transcript(reply(-5), apiErr(-1), apiErr(4), apiErr(10))
    at(12, ERR_PANE); at(15, ERR_PANE)               // third loss, no response since: the coordinator
    expect(resumes()).toHaveLength(2)
    const alerts = () => messages.filter((m) => m.content.includes('3. alkalommal'))
    expect(alerts()).toHaveLength(1)
    for (let m = 18; m <= 60; m += 3) at(m, ERR_PANE)
    expect(resumes()).toHaveLength(2)
    expect(alerts()).toHaveLength(1)
    // Parked, still idle on the error, 0 own cards: the no-work notice comes, and it does not give
    // "nothing is assigned" as the whole story (marveen 57334: it named the wrong cause).
    const noWork = messages.filter((m) => m.content.includes('NINCS RA KIOSZTVA SEMMI'))
    expect(noWork).toHaveLength(1)
    expect(noWork[0].content.startsWith('FIGYELEM: a pane utolso blokkja API-HIBA')).toBe(true)
  })

  it('CONTROL: the same panes with the resume never delivered -> one resume, as before', () => {
    transcript(reply(-5), apiErr(-1))
    for (let m = 0; m <= 30; m += 3) at(m, ERR_PANE)
    expect(messages.filter((m) => m.to === 'x' && m.content.startsWith('a turnod'))).toHaveLength(1)
  })

  it('REMOTE agent (didi X9): a stale LOCAL transcript is not its progress -> the time rule decides', () => {
    remoteHosts.set('x', 'mini2.local')              // its real transcript lives on that host
    transcript(reply(-5), apiErr(-1))                // the local copy: no response after any resume
    at(0, ERR_PANE); at(3, ERR_PANE)                 // resume at +3
    at(6, BUSY_PANE)
    at(9, ERR_PANE); at(12, ERR_PANE)                // inside 10 min: the time rule escalates; "no progress" would resume
    expect(toX().filter((x) => x.content.startsWith('a turnod'))).toHaveLength(1)
    expect(toCoordinator()).toHaveLength(1)
    expect(toCoordinator()[0].content).toContain('MASODSZOR')
  })
})
