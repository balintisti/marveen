// LAST WRITE WINS, AND THE READ-BACK DOES NOT CATCH IT (card ddf11b94).
//
// Two agents editing one card is the ordinary case on this board, and the loser
// never learns: the response is `{ok:true}` and a read-back returns the text the
// caller just wrote. The fleet's own rule -- "the 200 is not proof, the
// read-back is" -- fails here specifically, because the read-back confirms YOUR
// write while saying nothing about the one it replaced.
//
// jarvis wrote the specification (comments 6005 / 6010 / 6019) and set the
// acceptance criteria used below. Two of them are negative, and they carry the
// weight: a version that signals on every write would be worse than today's
// silence, because after a few rounds everyone steps over it -- and then a
// WORKING signal gets ignored. Same law as the CONCURRENTLY false alarm.
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, getKanbanCard, updateKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

beforeEach(() => {
  initDatabase(':memory:')
  createKanbanCard({ id: 'c1', title: 'eredeti cim', project: 'marveen' })
})

async function put(id: string, body: unknown, headers: Record<string, string> = {}) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'PUT', headers,
  }) as unknown as http.IncomingMessage
  let status = 200
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(d?: string) { if (d) chunk = d },
  } as unknown as http.ServerResponse
  const path = `/api/kanban/${id}`
  const handled = await tryHandleKanban({
    req, res, path, method: 'PUT', url: new URL(`http://x${path}`),
  } as never)
  expect(handled).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

describe('PUT /api/kanban/:id -- jarvis acceptance criteria (spec 6005 §3)', () => {
  it('POSITIVE: two writes to the SAME field -- the second response says what it replaced', async () => {
    await put('c1', { title: 'A verzioja' })
    const second = await put('c1', { title: 'B verzioja' })
    expect(second.status).toBe(200)
    expect(second.payload.ok).toBe(true)
    expect(second.payload.overwritten).toEqual([{ field: 'title', from: 'A verzioja', to: 'B verzioja' }])
    // Recognisable from the RESPONSE ALONE, with no second request -- that is the
    // requirement, not the mechanism.
    expect(second.payload.warning).toMatch(/MAS erteket irt felul/)
    expect(second.payload.warning).toMatch(/A verzioja/)
    // And the write still happened: this warns, it does not block.
    expect(getKanbanCard('c1')?.title).toBe('B verzioja')
  })

  it('NEGATIVE: two writes to DIFFERENT fields -- NO signal', async () => {
    // Today both writes survive, so this is correct behaviour. A signal here
    // would be a false positive, and a few rounds of those retire the guard.
    await put('c1', { title: 'A cime' })
    const second = await put('c1', { assignee: 'friday' })
    expect(second.payload).toEqual({ ok: true })
    expect(second.payload.overwritten).toBeUndefined()
  })

  it('NEGATIVE 2: writing the SAME value back -- NO signal', async () => {
    await put('c1', { title: 'ugyanaz' })
    const second = await put('c1', { title: 'ugyanaz' })
    expect(second.payload).toEqual({ ok: true })
  })

  it('filling a BLANK field is not an overwrite', async () => {
    // `assignee` starts null. Setting it is an ordinary edit, not a replacement.
    const r = await put('c1', { assignee: 'friday' })
    expect(r.payload).toEqual({ ok: true })
    // ... but replacing that same assignee IS one.
    const second = await put('c1', { assignee: 'didi' })
    expect(second.payload.overwritten).toEqual([{ field: 'assignee', from: 'friday', to: 'didi' }])
  })

  it('the whole-form PUT that the dashboard sends only reports the fields that really changed', async () => {
    // web/app.js sends every field of the edit form, not just the edited one.
    // A presence-based rule would flag all of them; only real replacements count.
    await put('c1', { title: 'kozos cim', assignee: 'friday', priority: 'high' })
    const second = await put('c1', { title: 'kozos cim', assignee: 'friday', priority: 'urgent' })
    expect(second.payload.overwritten).toEqual([{ field: 'priority', from: 'high', to: 'urgent' }])
  })

  it('reports EVERY replaced field, not just the first', async () => {
    await put('c1', { title: 'A', assignee: 'friday' })
    const second = await put('c1', { title: 'B', assignee: 'didi' })
    expect(second.payload.overwritten.map((o: { field: string }) => o.field).sort()).toEqual(['assignee', 'title'])
  })
})

describe('the swallowed precondition -- the second, heavier defect (spec 6005 §2)', () => {
  it('`If-Match` is NOT 200 any more, and the message says why', async () => {
    const r = await put('c1', { title: 'x' }, { 'if-match': '"barmi"' })
    expect(r.status).toBe(400)
    expect(r.payload.error).toMatch(/If-Match/)
    // The card must be untouched: a refused request writes nothing.
    expect(getKanbanCard('c1')?.title).toBe('eredeti cim')
  })

  it('`expected_updated_at` is NOT 200 any more', async () => {
    const r = await put('c1', { title: 'x', expected_updated_at: 123 })
    expect(r.status).toBe(400)
    expect(getKanbanCard('c1')?.title).toBe('eredeti cim')
  })

  it('PRECONDITION CONTROL: the same request WITHOUT the header is still 200', async () => {
    // Without this the rule could be "PUT is broken" rather than "preconditions
    // are refused" -- and the two look identical from a single failing call.
    const r = await put('c1', { title: 'x' })
    expect(r.status).toBe(200)
    expect(getKanbanCard('c1')?.title).toBe('x')
  })
})

describe('updateKanbanCard -- the shared computation (spec 6019)', () => {
  it('returns the same array the response renders, so a future field log cannot drift', async () => {
    updateKanbanCard('c1', { title: 'elso' })
    const r = updateKanbanCard('c1', { title: 'masodik' })
    expect(r.changed).toBe(true)
    expect(r.overwritten).toEqual([{ field: 'title', from: 'elso', to: 'masodik' }])
  })

  it('a missing card changes nothing and reports nothing', () => {
    const r = updateKanbanCard('nincs-ilyen', { title: 'x' })
    expect(r).toEqual({ changed: false, overwritten: [] })
  })
})
