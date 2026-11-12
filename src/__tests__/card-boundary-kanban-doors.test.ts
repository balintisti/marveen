// Card 00262e3f: the two doors of the board that change a card's status call the card-boundary
// signal step, and only they do.
//
// The step itself (who is armed, what is written) is in card-boundary-runner.test.ts. What is
// pinned here is the call: a real status change, on POST /move AND on PUT (the whole-card door
// changes the status too), with the actor and the status before and after, BEFORE the answer goes
// out -- the hook that shows the signal runs when the caller's command returns, and a file written
// after the answer could be missed by it. And what must not call it: a repeat, a reorder, a
// refused move, a PUT that leaves the status alone.
//
// The real route on a real in-memory board; only the step is replaced by a recorder.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'

const step = vi.hoisted(() => ({
  calls: [] as { args: unknown[]; answered: boolean }[],
  answered: false,
}))
vi.mock('../web/context-guard-runner.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  signalCardBoundaryAtMove: (...args: unknown[]) => { step.calls.push({ args, answered: step.answered }) },
}))

const { initDatabase, createKanbanCard, getKanbanCard, addKanbanComment } = await import('../db.js')
const { tryHandleKanban } = await import('../web/routes/kanban.js')

beforeEach(() => {
  initDatabase(':memory:')
  step.calls = []
})

async function call(method: 'POST' | 'PUT', path: string, body: unknown): Promise<{ status: number; payload: any }> {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method, headers: {} }) as unknown as http.IncomingMessage
  let status = 200
  let chunk = ''
  step.answered = false
  const res = {
    writeHead(code: number) { status = code; step.answered = true; return res },
    setHeader() { return res },
    end(data?: string) { step.answered = true; if (data) chunk = data },
  } as unknown as http.ServerResponse
  const url = new URL(`http://x${path}`)
  expect(await tryHandleKanban({ req, res, path: url.pathname, method, url } as never)).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}
const move = (id: string, body: unknown) => call('POST', `/api/kanban/${id}/move`, body)
const put = (id: string, body: unknown) => call('PUT', `/api/kanban/${id}`, body)
const args = () => step.calls.map((c) => c.args)

describe('POST /api/kanban/<id>/move', () => {
  it('a real move: called once, with the actor, the card, and the status before and after', async () => {
    createKanbanCard({ id: 'c1', title: 'x' })
    await move('c1', { status: 'in_progress', actor: 'computress' })
    const r = await move('c1', { status: 'testing', actor: 'computress' })
    expect(r).toEqual({ status: 200, payload: { ok: true, changed: true, version: 2 } })
    expect(args()).toEqual([
      ['computress', 'c1', 'planned', 'in_progress'],
      ['computress', 'c1', 'in_progress', 'testing'],
    ])
  })

  it('BEFORE the answer goes out', async () => {
    createKanbanCard({ id: 'c1', title: 'x' })
    await move('c1', { status: 'testing', actor: 'computress' })
    expect(step.calls).toHaveLength(1)
    expect(step.calls[0].answered).toBe(false)
  })

  it('a move with no actor is passed on as it is: the step decides, not the door', async () => {
    createKanbanCard({ id: 'c1', title: 'x' })
    await move('c1', { status: 'testing' })
    expect(args()).toEqual([[undefined, 'c1', 'planned', 'testing']])
  })

  it('a repeat of the status the card already has: not called', async () => {
    createKanbanCard({ id: 'c1', title: 'x' })
    await move('c1', { status: 'testing', actor: 'computress' })
    step.calls = []
    const again = await move('c1', { status: 'testing', actor: 'computress' })
    expect(again.payload.changed).toBe(false)
    expect(args()).toEqual([])
  })

  it('a reorder inside the column: not called', async () => {
    createKanbanCard({ id: 'c1', title: 'x' })
    const r = await move('c1', { status: 'planned', sort_order: 7, actor: 'computress' })
    expect(r.payload.changed).toBe(true)
    expect(args()).toEqual([])
  })

  it('a refused move (a stale expected_status): not called', async () => {
    createKanbanCard({ id: 'c1', title: 'x' })
    const r = await move('c1', { status: 'testing', expected_status: 'in_progress', actor: 'computress' })
    expect(r.status).toBe(409)
    expect(getKanbanCard('c1')!.status).toBe('planned')
    expect(args()).toEqual([])
  })

  it('a card that does not exist: not called', async () => {
    const r = await move('nope', { status: 'testing', actor: 'computress' })
    expect(r.status).toBe(404)
    expect(args()).toEqual([])
  })
})

describe('PUT /api/kanban/<id> changes the status too', () => {
  it('a status change through the whole-card door: called once, before the answer', async () => {
    createKanbanCard({ id: 'c1', title: 'x' })
    await move('c1', { status: 'in_progress', actor: 'computress' })
    step.calls = []
    const r = await put('c1', { status: 'waiting', actor: 'computress' })
    expect(r.status).toBe(200)
    expect(r.payload.changed).not.toBe(false)
    expect(getKanbanCard('c1')!.status).toBe('waiting')
    expect(step.calls).toEqual([{ args: ['computress', 'c1', 'in_progress', 'waiting'], answered: false }])
  })

  it('a PUT that leaves the status alone: not called', async () => {
    createKanbanCard({ id: 'c1', title: 'x' })
    await move('c1', { status: 'in_progress', actor: 'computress' })
    step.calls = []
    const r = await put('c1', { title: 'another title', actor: 'computress' })
    expect(r.status).toBe(200)
    expect(getKanbanCard('c1')!.title).toBe('another title')
    expect(args()).toEqual([])
  })

  it('a PUT that echoes the status the card has, beside a real change: not called', async () => {
    createKanbanCard({ id: 'c1', title: 'x' })
    await move('c1', { status: 'in_progress', actor: 'computress' })
    step.calls = []
    await put('c1', { status: 'in_progress', priority: 'high', actor: 'computress' })
    expect(getKanbanCard('c1')!.priority).toBe('high')
    expect(args()).toEqual([])
  })

  it('a PUT that changes nothing: not called', async () => {
    createKanbanCard({ id: 'c1', title: 'x' })
    const r = await put('c1', { title: 'x', actor: 'computress' })
    expect(r.payload.changed).toBe(false)
    expect(args()).toEqual([])
  })

  it('a refused close (done without its KESZ-IGAZOLAS line): not called; with the line: called', async () => {
    createKanbanCard({ id: 'c1', title: 'x' })
    const refused = await put('c1', { status: 'done', actor: 'jarvis' })
    expect(refused.status).toBeGreaterThanOrEqual(400)
    expect(getKanbanCard('c1')!.status).toBe('planned')
    expect(args()).toEqual([])
    addKanbanComment('c1', 'marveen', 'KESZ-IGAZOLAS: TARGYTALAN | teszt-kartya')
    await put('c1', { status: 'done', actor: 'marveen' })
    expect(getKanbanCard('c1')!.status).toBe('done')
    expect(args()).toEqual([['marveen', 'c1', 'planned', 'done']])
  })
})
