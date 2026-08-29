// GET /api/kanban answers with the live cards only. That filter is deliberate
// and stays -- what was missing is that the response said nothing about it, so
// the list could be used to decide whether a card EXISTS. It was: on 2026-08-23
// an agent read an empty result as "no such card" while the card was archived
// and answering 200 from GET /api/kanban/<id>.
//
// Measured 2026-08-28 on the live board: 1157 live, 54 archived. The existing
// guard (?archived=1 -> 400) only fires for someone who already knows to ask;
// this header speaks to the caller who does not, provided they read headers.
// Card 1785bb14.
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, archiveKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

beforeEach(() => {
  initDatabase(':memory:')
})

/** Drives the real route handler and keeps the response HEADERS, which is the
 *  whole subject here -- a fake res that swallows them would pass on a header
 *  that is never sent. */
async function get(path: string): Promise<{ status: number; headers: Record<string, string>; payload: any }> {
  const req = Object.assign(Readable.from([]), { method: 'GET', headers: {} }) as unknown as http.IncomingMessage
  let status = 0
  let headers: Record<string, string> = {}
  let chunk = ''
  const res = {
    writeHead(code: number, h?: Record<string, string>) { status = code; headers = h ?? {}; return res },
    setHeader() { return res },
    end(data?: string | Buffer) { if (data) chunk = data.toString() },
  } as unknown as http.ServerResponse

  const handled = await tryHandleKanban({
    req, res, path: path.split('?')[0], method: 'GET', url: new URL(`http://x${path}`),
  } as never)
  expect(handled).toBe(true)
  return { status, headers, payload: chunk ? JSON.parse(chunk) : null }
}

describe('GET /api/kanban says how many cards it is NOT showing', () => {
  it('reports the archived count that the list leaves out', async () => {
    createKanbanCard({ id: 'live0001', title: 'elo', status: 'planned' })
    createKanbanCard({ id: 'arch0001', title: 'archivalt', status: 'done' })
    createKanbanCard({ id: 'arch0002', title: 'archivalt ketto', status: 'done' })
    expect(archiveKanbanCard('arch0001')).toBe(true)
    expect(archiveKanbanCard('arch0002')).toBe(true)

    const r = await get('/api/kanban')
    expect(r.status).toBe(200)
    // The list really is short by those two -- otherwise the header would be
    // describing something that did not happen.
    expect(r.payload.map((c: any) => c.id)).toEqual(['live0001'])
    expect(r.headers['X-Archived-Hidden']).toBe('2')
  })

  // ZERO IS SENT, NOT OMITTED. A header that appears only when non-zero cannot
  // be told apart from a build that never sends it -- the same silence one
  // level up, which is what this card is about.
  it('sends the header as 0 when nothing is hidden', async () => {
    createKanbanCard({ id: 'live0002', title: 'elo', status: 'planned' })
    const r = await get('/api/kanban')
    expect(r.headers['X-Archived-Hidden']).toBe('0')
  })

  // NEGATIVE CONTROL for the number itself: it must track the archive, not just
  // be present. A hardcoded '2' would pass the first test.
  it('the number follows the archive, not the request', async () => {
    createKanbanCard({ id: 'live0003', title: 'elo', status: 'planned' })
    createKanbanCard({ id: 'arch0003', title: 'archivalt', status: 'done' })
    expect((await get('/api/kanban')).headers['X-Archived-Hidden']).toBe('0')
    archiveKanbanCard('arch0003')
    expect((await get('/api/kanban')).headers['X-Archived-Hidden']).toBe('1')
  })

  it('the archive listing carries 0 -- nothing is hidden from it', async () => {
    createKanbanCard({ id: 'arch0004', title: 'archivalt', status: 'done' })
    archiveKanbanCard('arch0004')
    const r = await get('/api/kanban/archived')
    expect(r.status).toBe(200)
    expect(r.payload.cards.map((c: any) => c.id)).toEqual(['arch0004'])
    expect(r.headers['X-Archived-Hidden']).toBe('0')
  })

  // The header is ADDITIVE: the body and the existing headers are untouched, so
  // the 24 call sites that never look at it cannot break. Asserted rather than
  // assumed, per the card's closing condition (c).
  it('does not change the body or the existing headers', async () => {
    createKanbanCard({ id: 'live0004', title: 'elo', status: 'planned' })
    const r = await get('/api/kanban')
    expect(Array.isArray(r.payload)).toBe(true)
    expect(r.payload[0].id).toBe('live0004')
    expect(r.headers['Content-Type']).toBe('application/json; charset=utf-8')
    expect(r.headers['Cache-Control']).toBe('private, no-store')
  })
})
