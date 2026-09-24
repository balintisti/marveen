import { describe, it, expect, beforeAll } from 'vitest'
import {
  initDatabase,
  createAgentMessage,
  markMessageDelivered,
  getRestartLossCandidates,
  RESTART_LOSS_SQL_HORIZON_S,
  getDb,
} from '../db.js'
import { buildRestartLossLine, RESTART_LOSS_WINDOW_MS } from '../context-guard.js'

beforeAll(() => { initDatabase(':memory:') })

// Card 18c382df. The line's rule is tested on fixtures in restart-loss-line.test.ts; THIS file
// pins the other half of the path: that the query hands the line the `delivered` rows and the
// two fields the rule reads (`delivered_at`, `from_agent`). Without it, a query that still
// returned only pending+failed would leave every fixture test green and the notice unchanged.
describe('getRestartLossCandidates hands the restart line what a restart takes', () => {
  const target = 'rlc-' + Date.now()

  it('returns pending, failed and delivered with delivered_at and from_agent -- not done, not another agent', () => {
    const pending = createAgentMessage('didi', target, 'sorban all')
    const delivered = createAgentMessage('marveen', target, 'beinjektalva')
    expect(markMessageDelivered(delivered.id)).toBe(true)
    const failed = createAgentMessage('jarvis', target, 'elbukott')
    getDb().prepare("UPDATE agent_messages SET status = 'failed' WHERE id = ?").run(failed.id)
    const done = createAgentMessage('mandark', target, 'feldolgozva')
    expect(markMessageDelivered(done.id)).toBe(true)
    getDb().prepare("UPDATE agent_messages SET status = 'done', completed_at = delivered_at WHERE id = ?").run(done.id)
    // KONTROLL: ugyanaz az allapot egy MASIK cimzettnek nem johet vissza
    const other = createAgentMessage('marveen', target + '-other', 'mase')
    expect(markMessageDelivered(other.id)).toBe(true)

    const rows = getRestartLossCandidates(target)
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get(pending.id)?.status).toBe('pending')
    expect(byId.get(failed.id)?.status).toBe('failed')
    expect(byId.get(delivered.id)?.status).toBe('delivered')
    expect(byId.get(delivered.id)?.delivered_at).toEqual(expect.any(Number))
    expect(byId.get(delivered.id)?.from_agent).toBe('marveen')
    // the body prefix travels (the line's one moot class is recognised by it), and ONLY a prefix
    expect(byId.get(delivered.id)?.head).toBe('beinjektalva')
    expect(byId.has(done.id)).toBe(false)
    expect(byId.has(other.id)).toBe(false)
  })

  // jarvis, intersection check: unbounded, the query returned the agent's whole delivered history.
  it('delivered rows older than the coarse SQL horizon are not read; newer ones are', () => {
    const t3 = target + '-horizon'
    const now = Date.now()
    const old = createAgentMessage('didi', t3, 'regi')
    const edge = createAgentMessage('didi', t3, 'a hatar belul')
    const fresh = createAgentMessage('didi', t3, 'friss')
    for (const m of [old, edge, fresh]) expect(markMessageDelivered(m.id)).toBe(true)
    const set = getDb().prepare('UPDATE agent_messages SET delivered_at = ? WHERE id = ?')
    const nowS = Math.floor(now / 1000)
    set.run(nowS - RESTART_LOSS_SQL_HORIZON_S - 60, old.id)
    set.run(nowS - RESTART_LOSS_SQL_HORIZON_S + 60, edge.id)
    const ids = new Set(getRestartLossCandidates(t3, now).map((r) => r.id))
    expect(ids.has(old.id)).toBe(false)
    expect(ids.has(edge.id)).toBe(true)
    expect(ids.has(fresh.id)).toBe(true)
    // and the horizon is COARSE: far wider than the line's own 30-minute window
    expect(RESTART_LOSS_SQL_HORIZON_S * 1000).toBeGreaterThanOrEqual(24 * RESTART_LOSS_WINDOW_MS)
  })

  it('end to end: a message delivered just before the restart is NAMED in the line', () => {
    const t2 = target + '-e2e'
    const m = createAgentMessage('didi', t2, 'kerdes: mehet?')
    expect(markMessageDelivered(m.id)).toBe(true)
    const line = buildRestartLossLine(getRestartLossCandidates(t2), Date.now() + 1000)
    expect(line).toContain(`${m.id}<-didi`)
    expect(line).not.toContain('NINCS mit ujrakuldeni')
  })
})
