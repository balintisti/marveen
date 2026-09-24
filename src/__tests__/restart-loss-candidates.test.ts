import { describe, it, expect, beforeAll } from 'vitest'
import {
  initDatabase,
  createAgentMessage,
  markMessageDelivered,
  getRestartLossCandidates,
  getDb,
} from '../db.js'
import { buildRestartLossLine } from '../context-guard.js'

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

  it('end to end: a message delivered just before the restart is NAMED in the line', () => {
    const t2 = target + '-e2e'
    const m = createAgentMessage('didi', t2, 'kerdes: mehet?')
    expect(markMessageDelivered(m.id)).toBe(true)
    const line = buildRestartLossLine(getRestartLossCandidates(t2), Date.now() + 1000)
    expect(line).toContain(`${m.id}<-didi`)
    expect(line).not.toContain('NINCS mit ujrakuldeni')
  })
})
