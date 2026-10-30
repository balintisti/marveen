// Contract tests: POST /api/kanban/<id>/move accepts an optional `expected_status`
// (compare-and-set). Ported from upstream a33b81af5 (card baabe0ba) and adapted to our fork:
// our move answers `{ ok, changed }`, closes through the KESZ-IGAZOLAS done-gate, and returns an
// outcome string from moveKanbanCard instead of a boolean.
//
// Root cause: the move was an unconditional "last writer wins". Two agents moving the same card
// (e.g. a late-delivered dispatch that still believes the card is `planned`, arriving after
// another agent already closed it) both got 200, and neither learned about the other.
//
// With `expected_status` a mismatch changes nothing and answers 409 with the card's actual
// status. Without `expected_status` the route behaves exactly as before.
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import {
  initDatabase, createKanbanCard, getKanbanCard, getKanbanCardEvents, moveKanbanCard, addKanbanComment,
  getDb,
} from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

beforeEach(() => { initDatabase(':memory:') })

async function move(id: string, body: unknown): Promise<{ status: number; payload: any }> {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'POST', headers: {},
  }) as unknown as http.IncomingMessage
  let status = 200
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string) { if (data) chunk = data },
  } as unknown as http.ServerResponse
  const url = new URL(`http://x/api/kanban/${encodeURIComponent(id)}/move`)
  expect(await tryHandleKanban({ req, res, path: url.pathname, method: 'POST', url } as never)).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

// Closing needs a KESZ-IGAZOLAS line (card 3c7be3c4).
function closeCard(id: string): void {
  addKanbanComment(id, 'marveen', 'KESZ-IGAZOLAS: TARGYTALAN | teszt-kartya')
  moveKanbanCard(id, 'done', 0, 'dex')
}

describe('POST /api/kanban/<id>/move with expected_status', () => {
  it('(a) moves the card when expected_status matches, and writes one event row with the actor', async () => {
    createKanbanCard({ id: 'c-a', title: 'Matching', assignee: 'dex' })
    const r = await move('c-a', { status: 'in_progress', expected_status: 'planned', actor: 'dex' })
    expect(r.status).toBe(200)
    expect(r.payload).toEqual({ ok: true, changed: true, version: 1 })
    expect(getKanbanCard('c-a')?.status).toBe('in_progress')
    const events = getKanbanCardEvents('c-a').filter((e) => e.from_status !== null)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ from_status: 'planned', to_status: 'in_progress', actor: 'dex' })
  })

  it('(b) refuses with 409 and leaves a done card done when expected_status is stale', async () => {
    createKanbanCard({ id: 'c-b', title: 'Already closed', assignee: 'dex' })
    closeCard('c-b')
    expect(getKanbanCard('c-b')?.status).toBe('done')
    const updatedBefore = getKanbanCard('c-b')?.updated_at
    const eventsBefore = getKanbanCardEvents('c-b').length

    // A late-delivered dispatch: the caller believes the card is still planned.
    const r = await move('c-b', { status: 'in_progress', expected_status: 'planned', actor: 'orin' })

    expect(r.status).toBe(409)
    expect(r.payload).toEqual({ error: 'status_conflict', current_status: 'done', expected_status: 'planned' })
    expect(getKanbanCard('c-b')?.status).toBe('done')
    expect(getKanbanCard('c-b')?.updated_at).toBe(updatedBefore)
    expect(getKanbanCardEvents('c-b')).toHaveLength(eventsBefore)
  })

  it('(b2) a stale caller whose TARGET equals the current status still gets the 409 (not a quiet no-op)', async () => {
    createKanbanCard({ id: 'c-b2', title: 'Same target' })
    moveKanbanCard('c-b2', 'waiting', 0, 'dex')
    const r = await move('c-b2', { status: 'waiting', expected_status: 'planned', actor: 'orin' })
    expect(r.status).toBe(409)
    expect(r.payload.current_status).toBe('waiting')
  })

  it('(b3) the stale check answers before the close gate: a stale move to done is a 409', async () => {
    createKanbanCard({ id: 'c-b3', title: 'Stale close' })
    moveKanbanCard('c-b3', 'testing', 0, 'dex')
    // No KESZ-IGAZOLAS on the card: the gate would refuse the close, but the card is not where the
    // caller thinks it is, and that is the fact the answer must carry.
    const r = await move('c-b3', { status: 'done', expected_status: 'planned', actor: 'orin' })
    expect(r.status).toBe(409)
    expect(r.payload).toEqual({ error: 'status_conflict', current_status: 'testing', expected_status: 'planned' })
  })

  it('(c) without expected_status the move is unconditional, exactly as before', async () => {
    createKanbanCard({ id: 'c-c', title: 'Legacy caller', assignee: 'dex' })
    closeCard('c-c')
    const r = await move('c-c', { status: 'in_progress', sort_order: 0, actor: 'orin' })
    expect(r.status).toBe(200)
    expect(r.payload).toEqual({ ok: true, changed: true, version: 2 })
    expect(getKanbanCard('c-c')?.status).toBe('in_progress')
    // null counts as absent too
    const r2 = await move('c-c', { status: 'waiting', expected_status: null, actor: 'orin' })
    expect(r2.status).toBe(200)
    expect(getKanbanCard('c-c')?.status).toBe('waiting')
  })

  it('(d) an unknown id still answers the previous 404, with or without expected_status', async () => {
    const plain = await move('no-such-card', { status: 'done' })
    expect(plain.status).toBe(404)
    const guarded = await move('no-such-card', { status: 'done', expected_status: 'planned' })
    expect(guarded.status).toBe(404)
    expect(guarded.payload).toEqual(plain.payload)
  })

  it('rejects an expected_status that is not a known status with 400 and changes nothing', async () => {
    createKanbanCard({ id: 'c-e', title: 'Bad guard' })
    for (const bad of ['finished', 5, '', {}]) {
      const r = await move('c-e', { status: 'waiting', expected_status: bad })
      expect(r.status).toBe(400)
    }
    expect(getKanbanCard('c-e')?.status).toBe('planned')
  })

  it('a matching guard on a done close still passes through the close gate', async () => {
    createKanbanCard({ id: 'c-g', title: 'Gate still applies' })
    moveKanbanCard('c-g', 'testing', 0, 'dex')
    const refused = await move('c-g', { status: 'done', expected_status: 'testing', actor: 'dex' })
    expect(refused.status).not.toBe(200)
    expect(getKanbanCard('c-g')?.status).toBe('testing')
    addKanbanComment('c-g', 'marveen', 'KESZ-IGAZOLAS: TARGYTALAN | teszt-kartya')
    const ok = await move('c-g', { status: 'done', expected_status: 'testing', actor: 'dex' })
    expect(ok.status).toBe(200)
    expect(getKanbanCard('c-g')?.status).toBe('done')
  })
})

describe('moveKanbanCard expectedStatus (db layer)', () => {
  it("is a no-op returning 'status-conflict' when the current status differs", () => {
    createKanbanCard({ id: 'd-1', title: 't' })
    moveKanbanCard('d-1', 'waiting', 0, 'dex')
    expect(moveKanbanCard('d-1', 'in_progress', 0, 'orin', { expectedStatus: 'planned' })).toBe('status-conflict')
    expect(getKanbanCard('d-1')?.status).toBe('waiting')
  })

  it("moves and returns 'moved' when the current status matches", () => {
    createKanbanCard({ id: 'd-2', title: 't' })
    expect(moveKanbanCard('d-2', 'waiting', 3, 'orin', { expectedStatus: 'planned' })).toBe('moved')
    expect(getKanbanCard('d-2')).toMatchObject({ status: 'waiting', sort_order: 3 })
  })

  it('the guard is inside the UPDATE: a row changed between the read and the write is not overwritten', () => {
    createKanbanCard({ id: 'd-3', title: 't' })
    // Simulate another process winning the race: the statement itself must refuse, not just the
    // read before it. Done by changing the row from inside the first read via a prepare-wrapper.
    const db = getDb()
    const realPrepare = db.prepare.bind(db)
    let raced = false
    ;(db as any).prepare = (sql: string) => {
      const stmt = realPrepare(sql)
      if (!raced && sql.startsWith('SELECT status, sort_order, parent_id')) {
        const realGet = stmt.get.bind(stmt)
        ;(stmt as any).get = (...a: unknown[]) => {
          const row = realGet(...a)
          raced = true
          realPrepare("UPDATE kanban_cards SET status='testing' WHERE id='d-3'").run()
          return row
        }
      }
      return stmt
    }
    try {
      expect(moveKanbanCard('d-3', 'in_progress', 0, 'orin', { expectedStatus: 'planned' })).toBe('status-conflict')
    } finally {
      ;(db as any).prepare = realPrepare
    }
    expect(getKanbanCard('d-3')?.status).toBe('testing')
  })

  it("the guard answers before the no-op check: a stale caller whose target equals the current state still gets 'status-conflict'", () => {
    createKanbanCard({ id: 'd-5', title: 't' })
    moveKanbanCard('d-5', 'waiting', 0, 'dex')
    expect(moveKanbanCard('d-5', 'waiting', 0, 'orin', { expectedStatus: 'planned' })).toBe('status-conflict')
    // control: a matching guard on the same target is the ordinary no-op
    expect(moveKanbanCard('d-5', 'waiting', 0, 'orin', { expectedStatus: 'waiting' })).toBe('unchanged')
  })

  it('without options the move is unconditional', () => {
    createKanbanCard({ id: 'd-4', title: 't' })
    moveKanbanCard('d-4', 'waiting', 0, 'dex')
    expect(moveKanbanCard('d-4', 'in_progress', 0, 'orin')).toBe('moved')
  })
})
