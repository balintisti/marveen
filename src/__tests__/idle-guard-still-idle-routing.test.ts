// 'STILL-IDLE' GOES TO THE COORDINATOR, THE OWNER IS THE FALLBACK -- card 1b997345.
//
// Measured 2026-09-24: 45 'still-idle' Telegram messages reached the owner between 09:09 and 22:09,
// and he said so. Its remedy -- a card, a workcheck -- is the coordinator's. These tests drive the
// REAL tick(): an agent that was woken 20 minutes ago and is still at an empty prompt with a card on
// its name, so the decision reaches stage 2 by the guard's own rules. Only the edges are mocked:
// the pane, the process table, the database rows, and the two delivery functions.
//
// The three paths the card names are the three describes' first three tests:
//   - the coordinator gets it (and the owner nothing);
//   - the coordinator's enqueue fails -> the owner gets it;
//   - the coordinator is the one standing -> the owner gets it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Removed when this file finishes (card 66756e73): every temp dir in a test goes through here.
const mkTmp = tmpDirs()

const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'still-idle-route-'))
  for (const d of ['root', 'x']) {
    fs.mkdirSync(path.join(tmp, d))
    fs.writeFileSync(path.join(tmp, d, 'workcheck.json'), '{"kind":"assigned_open_cards"}')
  }
  return {
    tmp,
    running: new Map<string, boolean>(),
    stuck: new Set<string>(),
    createAgentMessage: vi.fn(),
    sendAlert: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }
})
mkTmp.adopt(h.tmp)   // made in vi.hoisted above, where mkTmp does not exist yet

vi.mock('../config.js', async (orig) => ({
  ...(await orig<typeof import('../config.js')>()),
  PROJECT_ROOT: `${h.tmp}/root`,
}))
vi.mock('../logger.js', () => ({
  logger: {
    debug: () => {}, error: () => {},
    info: (...a: unknown[]) => h.info(...a),
    warn: (...a: unknown[]) => h.warn(...a),
  },
}))
vi.mock('../web/agent-process.js', () => ({
  capturePane: () => 'pane',
  isAgentRunning: (a: string) => h.running.get(a) ?? true,
}))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: (a: string) => `agent-${a}` }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x'],
  agentDir: (a: string) => `${h.tmp}/${a}`,
  readAgentRemoteHost: () => null,
  readAgentProjects: () => null,
}))
vi.mock('../pane-state.js', () => ({ detectPaneState: () => 'idle', busyEvidence: () => 'none', detectsUsageLimitReached: () => false }))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: (...a: unknown[]) => h.sendAlert(...a) }))
vi.mock('../db.js', () => ({
  getPendingMessages: () => [],
  // One open card on each name, so both have work by their declared check.
  listKanbanCards: () => ['x', 'marveen'].map((a) => ({
    id: `card-${a}`, title: `t-${a}`, status: 'planned', assignee: a, priority: 'normal',
    archived_at: null, updated_at: Math.floor(Date.now() / 1000), due_date: null,
  })),
  getLabelsForAllCards: () => new Map(),
  getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }) }),
  createAgentMessage: (...a: unknown[]) => h.createAgentMessage(...a),
  saveIdleGuardState: () => {},
  // Woken 20 minutes ago (past the 15-minute grace), idle for an hour, never alerted: the
  // guard's own rules put this at stage 2. Agents not in `stuck` have no stored spell.
  loadIdleGuardState: (agent: string) => {
    if (!h.stuck.has(agent)) return null
    const now = Date.now()
    return { idleSinceMs: now - 60 * 60_000, lastAlertAt: null, lastWakeAt: now - 20 * 60_000, updatedAt: now }
  },
}))

const { MAIN_AGENT_ID } = await import('../config.js')

async function sweep(): Promise<void> {
  vi.resetModules()   // a fresh watchState per test; the mocks above stay registered
  const { tick } = await import('../web/idle-agent-watcher.js')
  tick()
}

const toCoordinator = () => h.createAgentMessage.mock.calls.filter((c) => c[0] === 'system' && c[1] === MAIN_AGENT_ID)
const logged = (fn: typeof h.warn, text: string) => fn.mock.calls.filter((c) => c[1] === text)
const HUMAN = 'idle guard: still idle AFTER a wake (stage 2) -- human alerted'
const COORD = 'idle guard: still idle AFTER a wake (stage 2) -- coordinator told'

describe('tick(): who hears that an agent is still idle after a wake (1b997345)', () => {
  beforeEach(() => {
    h.running.clear(); h.stuck.clear()
    h.createAgentMessage.mockReset(); h.sendAlert.mockReset(); h.warn.mockReset(); h.info.mockReset()
  })

  it('PATH 1: the coordinator gets it, the owner gets nothing', async () => {
    h.stuck.add('x')
    await sweep()
    const letters = toCoordinator()
    expect(letters).toHaveLength(1)
    expect(String(letters[0][2])).toContain('"x"')
    expect(String(letters[0][2])).toContain('FELEBRESZTETTEM')
    expect(h.sendAlert).not.toHaveBeenCalled()
    // the log line the card's one-hour measurement counts says what really happened
    expect(logged(h.warn, HUMAN)).toHaveLength(0)
    expect(logged(h.info, COORD)).toHaveLength(1)
  })

  it('PATH 2: the coordinator message cannot be enqueued -> the owner gets it', async () => {
    h.stuck.add('x')
    h.createAgentMessage.mockImplementation((from: string, to: string) => {
      if (from === 'system' && to === MAIN_AGENT_ID) throw new Error('queue down')
      return { id: 1 }
    })
    await sweep()
    expect(h.sendAlert).toHaveBeenCalledTimes(1)
    expect(String(h.sendAlert.mock.calls[0][0])).toContain('"x"')
    expect(logged(h.warn, 'idle guard: could not tell the coordinator -- falling back to the owner')).toHaveLength(1)
    expect(logged(h.warn, HUMAN)).toHaveLength(1)
    expect(logged(h.info, COORD)).toHaveLength(0)
  })

  it('PATH 3: the coordinator is the one standing -> the owner gets it, with the others', async () => {
    h.stuck.add(MAIN_AGENT_ID); h.stuck.add('x')
    await sweep()
    expect(h.sendAlert).toHaveBeenCalledTimes(1)
    const text = String(h.sendAlert.mock.calls[0][0])
    expect(text).toContain(MAIN_AGENT_ID)
    expect(text).toContain('x')
    // a letter to the coordinator about stuck agents is exactly what he is not answering
    expect(toCoordinator().filter((c) => String(c[2]).includes('EBRESZTES UTAN IS ALL') || String(c[2]).includes('FELEBRESZTETTEM'))).toHaveLength(0)
    expect(logged(h.warn, HUMAN)).toHaveLength(1)
  })

  it('the coordinator is not running -> the owner gets it (the letter would wait with the fleet)', async () => {
    h.stuck.add('x')
    h.running.set(MAIN_AGENT_ID, false)
    await sweep()
    expect(h.sendAlert).toHaveBeenCalledTimes(1)
    expect(String(h.sendAlert.mock.calls[0][0])).toContain('"x"')
    expect(toCoordinator()).toHaveLength(0)
  })

  it('CONTROL: nobody stuck -> no still-idle anywhere (the harness can say no)', async () => {
    await sweep()
    expect(h.sendAlert).not.toHaveBeenCalled()
    expect(logged(h.warn, HUMAN)).toHaveLength(0)
    expect(logged(h.info, COORD)).toHaveLength(0)
  })
})
