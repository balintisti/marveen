// A LETTER STUCK IN THE COORDINATOR'S QUEUE MUST NOT HIDE HIM STANDING -- card 9cc3410a.
//
// jarvis's finding on 1b997345: any pending letter cleared the verdict to 'waiting-on-router',
// and clear() RESETS the idle spell. So a coordinator whose queue had stopped moving could never
// reach his own still-idle -- the alert that 1b997345 sends to the owner. Now a letter older than
// pendingStaleMs is stuck, not on its way, for the coordinator only (marveen's scope).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { decideIdleAlert, type IdleAgentInput, type IdleAgentState, type IdleAgentThresholds } from '../idle-agent.js'

const MIN = 60_000
const T: IdleAgentThresholds = {
  sustainedMs: 12 * MIN, realertMs: 30 * MIN, wakeGraceMs: 15 * MIN, wakeCooldownMs: 30 * MIN,
  pendingStaleMs: 15 * MIN,
}
const base: IdleAgentInput = {
  agent: 'marveen', running: true, paneIdle: true, pendingMessages: 1, ownWorkCount: 3,
}
const fresh: IdleAgentState = { idleSinceMs: null, lastAlertAt: null, lastWakeAt: null }

describe('decideIdleAlert: a stale pending letter is not waiting-on-router (9cc3410a)', () => {
  const now = 10_000 * MIN

  it('younger than the threshold: still waiting-on-router, and the spell resets as before', () => {
    const r = decideIdleAlert({ ...base, oldestPendingAgeMs: 14 * MIN }, { ...fresh, idleSinceMs: now - 20 * MIN }, T, now)
    expect(r.decision).toEqual({ alert: false, reason: 'waiting-on-router' })
    expect(r.next.idleSinceMs).toBeNull()
  })

  it('at or over the threshold: judged on the pane, and the spell SURVIVES', () => {
    for (const age of [15 * MIN, 40 * MIN]) {
      const r = decideIdleAlert({ ...base, oldestPendingAgeMs: age }, { ...fresh, idleSinceMs: now - 20 * MIN }, T, now)
      expect(r.decision.reason, `age=${age / MIN}m`).not.toBe('waiting-on-router')
      expect(r.next.idleSinceMs, `age=${age / MIN}m`).toBe(now - 20 * MIN)
    }
  })

  it('age absent (not measured) or threshold absent: the old rule, unchanged', () => {
    const noAge = decideIdleAlert({ ...base }, fresh, T, now)
    const noThreshold = decideIdleAlert({ ...base, oldestPendingAgeMs: 99 * MIN }, fresh, { ...T, pendingStaleMs: undefined }, now)
    expect(noAge.decision).toEqual({ alert: false, reason: 'waiting-on-router' })
    expect(noThreshold.decision).toEqual({ alert: false, reason: 'waiting-on-router' })
  })

  it('a stuck queue no longer blocks the chain: sustained -> wake -> still-idle', () => {
    // The shape jarvis described, played forward on the guard's own rules: a letter that never
    // leaves, and a coordinator at an empty prompt.
    let state = fresh
    const reasons: string[] = []
    const start = 20_000 * MIN
    for (let t = start; t <= start + 60 * MIN; t += 3 * MIN) {
      const r = decideIdleAlert({ ...base, oldestPendingAgeMs: 20 * MIN + (t - start) }, state, T, t)
      reasons.push(r.decision.reason)
      state = r.next
    }
    expect(reasons).toContain('wake-agent')
    expect(reasons).toContain('idle-with-work')
    // CONTROL: the same run with a letter that is always fresh never leaves waiting-on-router
    state = fresh
    const control: string[] = []
    for (let t = start; t <= start + 60 * MIN; t += 3 * MIN) {
      const r = decideIdleAlert({ ...base, oldestPendingAgeMs: 1 * MIN }, state, T, t)
      control.push(r.decision.reason)
      state = r.next
    }
    expect(new Set(control)).toEqual(new Set(['waiting-on-router']))
  })
})

// --- the wiring, through the real tick() ------------------------------------------------------
const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-pending-'))
  for (const d of ['root', 'x']) {
    fs.mkdirSync(path.join(tmp, d))
    fs.writeFileSync(path.join(tmp, d, 'workcheck.json'), '{"kind":"assigned_open_cards"}')
  }
  return {
    tmp,
    pendingAgeMin: new Map<string, number>(),
    stuck: new Set<string>(),
    createAgentMessage: vi.fn(),
    sendAlert: vi.fn(),
    debug: vi.fn(),
  }
})

vi.mock('../config.js', async (orig) => ({
  ...(await orig<typeof import('../config.js')>()),
  PROJECT_ROOT: `${h.tmp}/root`,
}))
vi.mock('../logger.js', () => ({
  logger: { debug: (...a: unknown[]) => h.debug(...a), info: () => {}, warn: () => {}, error: () => {} },
}))
vi.mock('../web/agent-process.js', () => ({ capturePane: () => 'pane', isAgentRunning: () => true }))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: (a: string) => `agent-${a}` }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x'],
  agentDir: (a: string) => `${h.tmp}/${a}`,
  readAgentRemoteHost: () => null,
  readAgentProjects: () => null,
}))
vi.mock('../pane-state.js', () => ({ detectPaneState: () => 'idle', busyEvidence: () => 'none' }))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: (...a: unknown[]) => h.sendAlert(...a) }))
vi.mock('../db.js', () => ({
  // created_at in epoch SECONDS, like the real table -- a unit slip here is one of the mutants.
  getPendingMessages: (agent: string) => {
    const age = h.pendingAgeMin.get(agent)
    return age === undefined ? [] : [{ id: 1, to_agent: agent, created_at: Math.floor((Date.now() - age * 60_000) / 1000) }]
  },
  listKanbanCards: () => ['x', 'marveen'].map((a) => ({
    id: `card-${a}`, title: `t-${a}`, status: 'planned', assignee: a, priority: 'normal',
    archived_at: null, updated_at: Math.floor(Date.now() / 1000), due_date: null,
  })),
  getLabelsForAllCards: () => new Map(),
  getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }) }),
  createAgentMessage: (...a: unknown[]) => h.createAgentMessage(...a),
  saveIdleGuardState: () => {},
  loadIdleGuardState: (agent: string) => {
    if (!h.stuck.has(agent)) return null
    const now = Date.now()
    return { idleSinceMs: now - 60 * 60_000, lastAlertAt: null, lastWakeAt: now - 20 * 60_000, updatedAt: now }
  },
}))

const { MAIN_AGENT_ID } = await import('../config.js')

async function sweep(): Promise<void> {
  vi.resetModules()
  const { tick } = await import('../web/idle-agent-watcher.js')
  tick()
}
const reasonFor = (agent: string) =>
  h.debug.mock.calls.map((c) => c[0] as { agent?: string; reason?: string }).find((o) => o?.agent === agent)?.reason

describe('tick(): the coordinator with a stuck letter reaches the owner (9cc3410a)', () => {
  beforeEach(() => {
    h.pendingAgeMin.clear(); h.stuck.clear()
    h.createAgentMessage.mockReset(); h.sendAlert.mockReset(); h.debug.mockReset()
  })

  it('a 20-minute-old letter no longer hides him: his still-idle goes to the owner', async () => {
    h.stuck.add(MAIN_AGENT_ID)
    h.pendingAgeMin.set(MAIN_AGENT_ID, 20)
    await sweep()
    expect(reasonFor(MAIN_AGENT_ID)).toBe('idle-with-work')
    expect(h.sendAlert).toHaveBeenCalledTimes(1)
    expect(String(h.sendAlert.mock.calls[0][0])).toContain(MAIN_AGENT_ID)
  })

  it('CONTROL: a 5-minute-old letter is on its way -- waiting-on-router, nobody told', async () => {
    h.stuck.add(MAIN_AGENT_ID)
    h.pendingAgeMin.set(MAIN_AGENT_ID, 5)
    await sweep()
    expect(reasonFor(MAIN_AGENT_ID)).toBe('waiting-on-router')
    expect(h.sendAlert).not.toHaveBeenCalled()
  })

  it('SCOPE: a sub-agent with the same 20-minute-old letter stays waiting-on-router', async () => {
    h.stuck.add('x')
    h.pendingAgeMin.set('x', 20)
    await sweep()
    expect(reasonFor('x')).toBe('waiting-on-router')
    expect(h.createAgentMessage).not.toHaveBeenCalled()
    expect(h.sendAlert).not.toHaveBeenCalled()
  })
})
