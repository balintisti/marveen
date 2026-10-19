// Card a85a9acd (a): measureRestartLoss feeds the restart notice both its loss line and the
// wake decision, from ONE read of the rows.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { initDatabase, createAgentMessage, markMessageDelivered, getDb } from '../db.js'
import { measureRestartLoss } from '../web/context-guard-runner.js'
import { restartNoticeWakes, restartNoticeIsLogOnly } from '../context-guard.js'

const T = 1_800_000_000_000
const sec = T / 1000

describe('measureRestartLoss', () => {
  it('an empty window: the line says there is nothing to resend, and nothing needs action', () => {
    const r = measureRestartLoss('x', () => [], T)
    expect(r.lossLine).toContain('NINCS mit ujrakuldeni')
    expect(r.lossNeedsAction).toBe(false)
    expect(restartNoticeWakes(r.lossNeedsAction, null)).toBe(false)
  })

  it('a failed row in the window: the line asks to resend, and the notice wakes', () => {
    const r = measureRestartLoss('x', () => [{ id: 9, status: 'failed', created_at: sec - 120, from_agent: 'didi', head: 'k', delivered_at: null }], T)
    expect(r.lossLine).toContain('EZEKET kuldd ujra')
    expect(r.lossNeedsAction).toBe(true)
    expect(restartNoticeWakes(r.lossNeedsAction, null)).toBe(true)
  })

  it('a delivered sender row in the window: wakes', () => {
    const r = measureRestartLoss('x', () => [{ id: 4, status: 'delivered', created_at: sec - 500, delivered_at: sec - 120, from_agent: 'didi', head: 'kerdes' }], T)
    expect(r.lossNeedsAction).toBe(true)
  })

  it('an unreadable window is NOT a quiet one: the line says so and the notice wakes', () => {
    const r = measureRestartLoss('x', () => { throw new Error('db locked') }, T)
    expect(r.lossLine).toContain('NEM TUDTAM MEGMERNI')
    expect(r.lossNeedsAction).toBeNull()
    expect(restartNoticeWakes(r.lossNeedsAction, null)).toBe(true)
  })

  it('the line and the decision read the SAME rows: one read per call', () => {
    const read = vi.fn(() => [])
    measureRestartLoss('x', read, T)
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith('x')
  })
})

describe('measureRestartLoss over the real queue: quiet rows (card a85a9acd)', () => {
  beforeAll(() => { initDatabase(':memory:') })

  it('a delivered and a failed QUIET row neither need action nor wake the notice', () => {
    const t = 'quiet-restart-' + Date.now()
    const failed = createAgentMessage('system', t, 'csendes elbukott', null, null, { wake: false })
    getDb().prepare("UPDATE agent_messages SET status = 'failed' WHERE id = ?").run(failed.id)
    const delivered = createAgentMessage('system', t, 'csendes beinjektalva', null, null, { wake: false })
    expect(markMessageDelivered(delivered.id)).toBe(true)
    const r = measureRestartLoss(t)
    expect(r.lossNeedsAction).toBe(false)
    expect(restartNoticeWakes(r.lossNeedsAction, null)).toBe(false)
    expect(r.lossLine).toContain('NINCS mit ujrakuldeni')
  })

  it('POSITIVE CONTROL: the same two rows, waking, DO need action and wake the notice', () => {
    const t = 'waking-restart-' + Date.now()
    const failed = createAgentMessage('didi', t, 'elbukott')
    getDb().prepare("UPDATE agent_messages SET status = 'failed' WHERE id = ?").run(failed.id)
    const delivered = createAgentMessage('didi', t, 'beinjektalva')
    expect(markMessageDelivered(delivered.id)).toBe(true)
    const r = measureRestartLoss(t)
    expect(r.lossNeedsAction).toBe(true)
    expect(restartNoticeWakes(r.lossNeedsAction, null)).toBe(true)
  })
})

describe('restartNoticeIsLogOnly (card eca5e042)', () => {
  const idle = 'saturated pane, unrecoverable without restart'
  const killed = 'hard threshold (99% >= 97%) -- KILLS running background work: 2 (2 in the pane)'

  it('empty measured window, fresh handoff, nothing killed: log-only', () => {
    expect(restartNoticeIsLogOnly(false, null, idle)).toBe(true)
    expect(restartNoticeIsLogOnly(false, undefined, idle)).toBe(true)
  })

  it('killed background work keeps the message, even with an empty window', () => {
    expect(restartNoticeIsLogOnly(false, null, killed)).toBe(false)
  })

  it('a stale or unmeasurable handoff keeps the message', () => {
    expect(restartNoticeIsLogOnly(false, 25, idle)).toBe(false)
    expect(restartNoticeIsLogOnly(false, 'unknown', idle)).toBe(false)
  })

  it('something to resend keeps the message', () => {
    expect(restartNoticeIsLogOnly(true, null, idle)).toBe(false)
  })

  it('an unmeasurable window is NOT log-only: a guard that cannot tell must not go quiet', () => {
    expect(restartNoticeIsLogOnly(null, null, idle)).toBe(false)
  })

  it('work that survives the restart is not "killed": log-only', () => {
    const survives = 'saturated -- detached from the pane, expected to SURVIVE the restart (check with ps before re-running): 1'
    expect(restartNoticeIsLogOnly(false, null, survives)).toBe(true)
  })
})
