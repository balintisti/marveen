// Card a85a9acd: which machine notices of the idle guard and the context guard are QUIET
// (wake=0), and the readers inside the idle guard that must ignore quiet rows.
//
// Pure rules first, then the real tick() against a real in-memory database, because the sender
// flag is only worth something if it reaches the row.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-notices-'))
  for (const d of ['root', 'x']) {
    fs.mkdirSync(path.join(tmp, d))
    fs.writeFileSync(path.join(tmp, d, 'workcheck.json'), '{"kind":"assigned_open_cards"}')
  }
  fs.mkdirSync(path.join(tmp, 'root', 'store'))
  return { tmp, readable: { value: false }, debug: [] as Array<{ obj: Record<string, unknown>; msg: string }> }
})

mkTmp.adopt(h.tmp)   // made in vi.hoisted above, where mkTmp does not exist yet

vi.mock('../config.js', async (orig) => ({
  ...(await orig<typeof import('../config.js')>()),
  PROJECT_ROOT: `${h.tmp}/root`,
}))
vi.mock('../logger.js', () => ({
  logger: {
    debug: (obj: Record<string, unknown>, msg: string) => { h.debug.push({ obj, msg }) },
    info: () => {}, warn: () => {}, error: () => {},
  },
}))
vi.mock('../web/agent-process.js', () => ({
  capturePane: () => (h.readable.value ? 'pane' : null),
  isAgentRunning: () => true,
}))
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
  detectsMidTurnApiError: () => false, // card 843a9ab6
}))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: () => {} }))

import { initDatabase, getDb, createAgentMessage } from '../db.js'
import {
  fleetAlertWakes, deliverFleetAlerts, messageGuardNoticeWakes, MESSAGE_GUARD_TAG,
  type FleetAlert,
} from '../idle-agent.js'
import { restartLossNeedsAction, restartNoticeWakes, RESTART_LOSS_WINDOW_MS } from '../context-guard.js'

const blind = (agent = 'a'): FleetAlert => ({ kind: 'pane-unreadable', agent, paneReason: 'capture-failed' })
const still = (agent = 'b'): FleetAlert => ({ kind: 'still-idle', agent, minutes: 40, workCount: 2 })
const noCheck = (agent = 'c'): FleetAlert => ({ kind: 'no-work-check', agent })
const enqFail = (agent = 'd'): FleetAlert => ({ kind: 'wake-enqueue-failed', agent, minutes: 40, workCount: 2 })

describe('(b) fleetAlertWakes: only the guard\'s report on its own blindness is quiet', () => {
  it('pane-unreadable alone, one or several agents: quiet', () => {
    expect(fleetAlertWakes([blind()])).toBe(false)
    expect(fleetAlertWakes([blind('a'), blind('b')])).toBe(false)
  })
  it('every other kind wakes, alone or beside a blind pane', () => {
    for (const a of [still(), noCheck(), enqFail()]) {
      expect(fleetAlertWakes([a]), a.kind).toBe(true)
      expect(fleetAlertWakes([blind(), a]), `blind + ${a.kind}`).toBe(true)
    }
  })
  it('no alerts at all wakes (the default is the loud side)', () => {
    expect(fleetAlertWakes([])).toBe(true)
  })
})

describe('(b) deliverFleetAlerts hands the coordinator the wake flag', () => {
  const calls = () => {
    const toCoordinator = vi.fn(); const toOwner = vi.fn()
    return { toCoordinator, toOwner, io: { toCoordinator, toOwner } }
  }
  it('a blind-pane-only sweep goes to the coordinator quiet', () => {
    const c = calls()
    deliverFleetAlerts([blind()], 'marveen', true, c.io)
    expect(c.toCoordinator).toHaveBeenCalledTimes(1)
    expect(c.toCoordinator.mock.calls[0][1]).toBe(false)
    expect(c.toCoordinator.mock.calls[0][0]).toContain('NEM OLVASHATO')
  })
  it('a mixed sweep wakes', () => {
    const c = calls()
    deliverFleetAlerts([blind(), noCheck()], 'marveen', true, c.io)
    expect(c.toCoordinator.mock.calls[0][1]).toBe(true)
  })
  it('the wake flag follows the rows the COORDINATOR gets, not the whole sweep', () => {
    // still-idle goes to the owner here (coordinator not running), so the coordinator's message
    // is blind-pane only
    const c = calls()
    deliverFleetAlerts([blind(), still()], 'marveen', false, c.io)
    expect(c.toOwner).toHaveBeenCalledTimes(1)
    expect(c.toCoordinator.mock.calls[0][1]).toBe(false)
  })
})

describe('(c) messageGuardNoticeWakes: the first notice about a message wakes, a repeat does not', () => {
  it('nothing on record: wakes', () => {
    expect(messageGuardNoticeWakes([{ id: 5 }], new Set())).toBe(true)
  })
  it('every covered id already on record: quiet', () => {
    expect(messageGuardNoticeWakes([{ id: 5 }, { id: 6 }], new Set([5, 6, 9]))).toBe(false)
  })
  it('one new id among repeated ones is news: wakes', () => {
    expect(messageGuardNoticeWakes([{ id: 5 }, { id: 6 }], new Set([5]))).toBe(true)
  })
  it('no rows wakes', () => {
    expect(messageGuardNoticeWakes([], new Set([1]))).toBe(true)
  })
})

describe('(a) restartLossNeedsAction / restartNoticeWakes', () => {
  const T = 1_800_000_000_000
  const sec = T / 1000
  const MIN = 60
  const rows = {
    none: [],
    pendingOnly: [{ id: 1, status: 'pending', created_at: sec - 5 * MIN }],
    failedInWindow: [{ id: 2, status: 'failed', created_at: sec - 5 * MIN }],
    failedOld: [{ id: 3, status: 'failed', created_at: sec - 600 * MIN }],
    deliveredSender: [{ id: 4, status: 'delivered', created_at: sec - 9 * MIN, delivered_at: sec - 3 * MIN, from_agent: 'didi', head: 'kerdes' }],
    deliveredMoot: [{ id: 5, status: 'delivered', created_at: sec - 9 * MIN, delivered_at: sec - 3 * MIN, from_agent: 'system', head: '[tetlen-or] 40 perce allsz ures' }],
    deliveredOutside: [{ id: 6, status: 'delivered', created_at: sec - 100 * MIN, delivered_at: sec - 90 * MIN, from_agent: 'didi', head: 'regi' }],
  }
  it('nothing to resend: no action', () => {
    for (const k of ['none', 'pendingOnly', 'failedOld', 'deliveredMoot', 'deliveredOutside'] as const) {
      expect(restartLossNeedsAction(rows[k], T), k).toBe(false)
    }
  })
  it('a failed row in the window, or a sender-written delivered row: action', () => {
    expect(restartLossNeedsAction(rows.failedInWindow, T)).toBe(true)
    expect(restartLossNeedsAction(rows.deliveredSender, T)).toBe(true)
  })
  it('the window is the constant the line uses', () => {
    const edgeIn = [{ id: 7, status: 'failed', created_at: (T - RESTART_LOSS_WINDOW_MS) / 1000 }]
    const edgeOut = [{ id: 8, status: 'failed', created_at: (T - RESTART_LOSS_WINDOW_MS) / 1000 - 1 }]
    expect(restartLossNeedsAction(edgeIn, T)).toBe(true)
    expect(restartLossNeedsAction(edgeOut, T)).toBe(false)
  })
  it('the notice wakes unless the window was measured empty AND the handoff is not flagged', () => {
    expect(restartNoticeWakes(false, null)).toBe(false)
    expect(restartNoticeWakes(true, null)).toBe(true)
    expect(restartNoticeWakes(null, null)).toBe(true)          // not measured: loud
    expect(restartNoticeWakes(false, 12)).toBe(true)           // stale HANDOFF.md: a decision
    expect(restartNoticeWakes(false, 'unknown')).toBe(true)
    expect(restartNoticeWakes(false, undefined)).toBe(false)
  })
})

// ---- the real tick against a real database ---------------------------------------------------

beforeAll(() => { initDatabase(':memory:') })

const secs = () => Math.floor(Date.now() / 1000)
const quietCol = (id: number) => (getDb().prepare('SELECT wake FROM agent_messages WHERE id = ?').get(id) as { wake: number }).wake
const rowsFrom = (pattern: string) =>
  getDb().prepare("SELECT id, to_agent, content, wake FROM agent_messages WHERE from_agent = 'system' AND content LIKE ? ORDER BY id")
    .all(pattern) as Array<{ id: number; to_agent: string; content: string; wake: number }>

describe('(b) through the real tick: the blind-pane report is quiet', () => {
  it('every pane unreadable -> ONE message to the coordinator, wake=0, and it says NEM OLVASHATO', async () => {
    h.readable.value = false
    const { tick } = await import('../web/idle-agent-watcher.js')
    tick()
    const sent = rowsFrom('[tetlen-or]%')
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every((r) => r.content.includes('NEM OLVASHATO'))).toBe(true)
    expect(sent.every((r) => r.wake === 0)).toBe(true)
  })
})

describe('(c) through the real tick: [uzenet-or] first notice wakes, a repeat does not', () => {
  beforeEach(() => { h.readable.value = true })

  function pendingAged(from: string, to: string, ageS: number, wake = true) {
    const m = createAgentMessage(from, to, 'old question', undefined, undefined, { wake })
    getDb().prepare('UPDATE agent_messages SET created_at = ? WHERE id = ?').run(secs() - ageS, m.id)
    return m.id
  }

  it('first notice: wake=1; a later notice about the SAME id (record present, suppression set cold): wake=0', async () => {
    const { tick } = await import('../web/idle-agent-watcher.js')
    tick()   // seeds the suppression set (nothing covered yet) so it cannot swallow what follows
    const first = pendingAged('rita', 'eve', 3 * 3600)
    tick()
    const n1 = rowsFrom(`${MESSAGE_GUARD_TAG}%`).filter((r) => r.to_agent === 'rita' && r.content.includes(`covered-ids: ${first} `))
    expect(n1).toHaveLength(1)
    expect(n1[0].wake).toBe(1)

    // the same message again: a second notice record exists for it, but the in-memory set does not
    // know (restart with a failed seed, a second instance). Simulate by writing the earlier
    // record directly and reporting a NEW message that this record does not cover plus the old one.
    const second = pendingAged('sam', 'eve', 3 * 3600)
    getDb().prepare("INSERT INTO agent_messages (from_agent,to_agent,content,status,created_at) VALUES ('system','sam',?, 'delivered', ?)")
      .run(`${MESSAGE_GUARD_TAG} earlier\n<!-- covered-ids: ${second} -->`, secs() - 600)
    tick()
    const n2 = rowsFrom(`${MESSAGE_GUARD_TAG}%`).filter((r) => r.to_agent === 'sam' && r.content.includes(`covered-ids: ${second} -->`))
    // the pre-written record is the first of these; the guard's own notice is the last
    const guard = n2[n2.length - 1]
    expect(guard.content).toContain('MEG MINDIG')
    expect(guard.wake).toBe(0)
  })

  it('a QUIET pending row is not reported to its sender at all', async () => {
    const { tick } = await import('../web/idle-agent-watcher.js')
    const id = pendingAged('quin', 'eve', 3 * 3600, false)
    tick()
    expect(rowsFrom(`${MESSAGE_GUARD_TAG}%`).filter((r) => r.to_agent === 'quin')).toEqual([])
    expect(quietCol(id)).toBe(0)
  })
})

describe('the idle guard does not treat a quiet row as mail on its way', () => {
  it('pendingMessages in the decision log counts waking rows only', async () => {
    h.readable.value = true
    const { tick } = await import('../web/idle-agent-watcher.js')
    for (const wake of [false, false, false]) createAgentMessage('system', 'x', 'quiet', undefined, undefined, { wake })
    h.debug.length = 0
    tick()
    const x = h.debug.find((d) => d.obj.agent === 'x' && String(d.msg).startsWith('idle guard: x ->'))
    expect(x?.obj.pendingMessages).toBe(0)
    expect(x?.msg).not.toContain('waiting-on-router')
    // POSITIVE CONTROL: one waking row and the same agent reads as waiting on the router
    createAgentMessage('system', 'x', 'waking')
    h.debug.length = 0
    tick()
    const x2 = h.debug.find((d) => d.obj.agent === 'x' && String(d.msg).startsWith('idle guard: x ->'))
    expect(x2?.obj.pendingMessages).toBe(1)
    expect(x2?.msg).toContain('waiting-on-router')
  })
})
