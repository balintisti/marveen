// Cards a7ded8fb + da11b4a4: the pull notice states the re-query's own population (two numbers),
// and an all-`low` ownerless list no longer wakes an agent.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  orphanPullList, deferredOrphanList, pullListWakes, buildPullNotice, laneFilteredPullList,
} from '../idle-agent.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

const NOW = Date.UTC(2026, 8, 20, 15, 2, 0)
const SEC = Math.floor(NOW / 1000)
type Card = {
  id: string; title: string; status: string; assignee: string | null; priority: string
  project: string | null; archived_at: number | null; due_date: number | null
}
const card = (id: string, over: Partial<Card> = {}): Card => ({
  id, title: `t-${id}`, status: 'planned', assignee: null, priority: 'normal',
  project: 'marveen', archived_at: null, due_date: null, ...over,
})

// deeper's 2026-09-20 board in miniature: ownerless planned cards, some with a future due_date,
// plus every kind of card that must stay out of both numbers.
const BOARD: Card[] = [
  card('aaaaaaa1'), card('aaaaaaa2', { priority: 'low' }), card('aaaaaaa3', { due_date: SEC - 3600 }),
  card('ddddddd1', { due_date: SEC + 86400 }), card('ddddddd2', { due_date: SEC + 3600 }),
  card('xxxxxxx1', { assignee: 'didi' }), card('xxxxxxx2', { status: 'testing' }),
  card('xxxxxxx3', { archived_at: SEC }), card('xxxxxxx4', { project: 'delta-crm' }),
  card('xxxxxxx5', { project: 'delta-crm', due_date: SEC + 3600 }),
]

/** Runs the notice's own re-query command over BOARD, with the curl replaced by the board. */
function runReQuery(msg: string): number {
  const lines = msg.split('\n')
  const py = lines.find((l) => l.includes('python3 -c'))!
  const code = py.slice(py.indexOf('"') + 1, py.lastIndexOf('"'))
  return Number(execFileSync('python3', ['-c', code], { input: JSON.stringify(BOARD) }).toString().trim())
}

describe('a7ded8fb: the pull notice and its re-query count the same population', () => {
  const lanes = ['marveen']
  const pull = laneFilteredPullList(orphanPullList(BOARD, NOW), lanes)
  const parked = laneFilteredPullList(deferredOrphanList(BOARD, NOW), lanes).length

  it('the two lists split the ownerless planned cards with no overlap', () => {
    expect(pull.map((c) => c.id).sort()).toEqual(['aaaaaaa1', 'aaaaaaa2', 'aaaaaaa3'])
    expect(parked).toBe(2)
    expect(deferredOrphanList(BOARD, NOW).map((c) => c.id).sort()).toEqual(['ddddddd1', 'ddddddd2', 'xxxxxxx5'])
  })

  it('names both numbers, and the printed re-query returns exactly their sum', () => {
    const msg = buildPullNotice('friday', 12, pull, NOW, lanes, parked)
    expect(msg).toContain('5 GAZDATLAN `planned` kartya all, ebbol 2 jovobeli `due_date`-tel')
    expect(msg).toContain('tehat 3 felveheto most')
    expect(runReQuery(msg)).toBe(5)
    // the stale rule compares against THAT number, so a correct notice is no longer called stale
    expect(msg).toContain('Ha ez NAGYOBBAT ad, mint a fenti 5, a lista ELAVULT')
  })

  it('CONTROL: without the parked count the re-query exceeds the notice, and the rule says why', () => {
    const msg = buildPullNotice('friday', 12, pull, NOW, lanes)
    expect(runReQuery(msg)).toBeGreaterThan(pull.length)
    expect(msg).not.toContain('a lista ELAVULT')
    expect(msg).toContain('padlozott kartya')
  })

  it('da11b4a4: does not tell the agent to re-route a card that is not in its lane', () => {
    const msg = buildPullNotice('friday', 12, pull, NOW, lanes, parked)
    expect(msg).not.toMatch(/sorold at egy soros indoklassal/)
    expect(msg).toContain('NE sorold at senkire')
  })
})

describe('da11b4a4: a wake needs at least one card above low', () => {
  it('all low -> no wake; one normal -> wake; a missing priority counts as normal', () => {
    expect(pullListWakes([{ priority: 'low' }, { priority: 'low' }])).toBe(false)
    expect(pullListWakes([{ priority: 'low' }, { priority: 'normal' }])).toBe(true)
    expect(pullListWakes([{ priority: 'low' }, { priority: null }])).toBe(true)
    expect(pullListWakes([{ priority: 'urgent' }])).toBe(true)
    expect(pullListWakes([])).toBe(false)
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-floor-'))
  for (const d of ['root', 'x']) {
    fs.mkdirSync(path.join(tmp, d))
    fs.writeFileSync(path.join(tmp, d, 'workcheck.json'), '{"kind":"assigned_open_cards"}')
  }
  return { tmp, orphans: [] as { id: string; priority: string; due_date?: number | null }[], createAgentMessage: vi.fn() }
})
tmpDirs().adopt(h.tmp)

vi.mock('../config.js', async (orig) => ({
  ...(await orig<typeof import('../config.js')>()),
  PROJECT_ROOT: `${h.tmp}/root`,
}))
vi.mock('../logger.js', () => ({ logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('../web/agent-process.js', () => ({ capturePane: () => 'pane', isAgentRunning: () => true }))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: (a: string) => `agent-${a}` }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x'],
  agentDir: (a: string) => `${h.tmp}/${a}`,
  readAgentRemoteHost: () => null,
  readAgentProjects: () => null,
}))
vi.mock('../pane-state.js', () => ({
  detectPaneState: () => 'idle', busyEvidence: () => 'none',
  detectsUsageLimitReached: () => false, runningBackgroundWork: () => 0,
}))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: () => {} }))
vi.mock('../db.js', () => ({
  getPendingMessages: () => [],
  getLastOutboundMessageAt: () => null,
  listKanbanCards: () => h.orphans.map((o) => ({
    id: o.id, title: `t-${o.id}`, status: 'planned', assignee: null, priority: o.priority,
    archived_at: null, updated_at: Math.floor(Date.now() / 1000), due_date: o.due_date ?? null, project: null,
  })),
  getLabelsForAllCards: () => new Map(),
  getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }) }),
  createAgentMessage: (...a: unknown[]) => { h.createAgentMessage(...a); return { id: 1 } },
  saveIdleGuardState: () => {},
  // idle for an hour already, so the decision is due on this tick
  loadIdleGuardState: () => {
    const now = Date.now()
    return { idleSinceMs: now - 60 * 60_000, lastAlertAt: null, lastWakeAt: now - 20 * 60_000, updatedAt: now }
  },
}))

async function sweep(): Promise<void> {
  vi.resetModules()
  const { tick } = await import('../web/idle-agent-watcher.js')
  tick()
}
const pullNoticesToX = () =>
  h.createAgentMessage.mock.calls.filter((c) => c[1] === 'x' && String(c[2]).includes('GAZDATLAN'))

describe('tick(): the priority floor gates the pull wake (da11b4a4)', () => {
  beforeEach(() => { h.orphans = []; h.createAgentMessage.mockReset() })

  it('an all-low ownerless list does not wake the idle agent', async () => {
    h.orphans = [{ id: 'low00001', priority: 'low' }, { id: 'low00002', priority: 'low' }]
    await sweep()
    expect(pullNoticesToX()).toHaveLength(0)
  })

  it('CONTROL: one normal card wakes it, the low ones are still named, and the parked count is printed', async () => {
    h.orphans = [
      { id: 'low00001', priority: 'low' }, { id: 'nrm00001', priority: 'normal' },
      { id: 'prk00001', priority: 'high', due_date: Math.floor(Date.now() / 1000) + 86400 },
    ]
    await sweep()
    const sent = pullNoticesToX()
    expect(sent).toHaveLength(1)
    const msg = String(sent[0][2])
    expect(msg).toContain('low00001')
    expect(msg).toContain('ebbol 1 jovobeli')
    expect(msg).toContain('tehat 2 felveheto most')
  })
})
