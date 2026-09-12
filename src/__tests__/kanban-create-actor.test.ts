/**
 * Card d624222e. `createKanbanCard` had no `actor` in its signature, so the actor
 * a caller sent in the POST body was spread in by the route and read by nothing.
 * A description written AT CREATION was therefore structurally anonymous.
 *
 * SIZE (mandark, confirmed from source): 2096 live cards, 820 with a description,
 * 222 of those with NO event at all, and 97 where the author is recoverable from
 * NOWHERE -- no event and no comment. The other 125 survive only because
 * `kanban_comments.author` is NOT NULL.
 *
 * These drive the REAL route, not the db function directly, because the claim
 * being pinned is end-to-end: the route does `createKanbanCard({ id, ...data })`,
 * so `actor` was ALREADY arriving and only the signature dropped it. A test that
 * called the db function with an explicit actor would pass even if the route
 * never forwarded one.
 */
import { describe, it, expect } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, getKanbanCardEvents, getKanbanCardHistory } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

async function post(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'POST', headers: {},
  }) as unknown as http.IncomingMessage
  let chunk = ''
  let status = 200
  const res = {
    writeHead(c: number) { status = c; return res }, setHeader() { return res },
    end(d?: string) { if (d) chunk = d },
  } as unknown as http.ServerResponse
  await tryHandleKanban({
    req, res, path: '/api/kanban', method: 'POST', url: new URL('http://x/api/kanban'),
  } as never)
  return { status, body: JSON.parse(chunk) }
}

describe('a created card carries its author -- through the real route', () => {
  /** THE CLOSING CONDITION mandark stated: a freshly created card's author must be
   *  readable back. This is that sentence as an assertion. */
  it('the actor sent at creation is readable back afterwards', async () => {
    initDatabase(':memory:')
    const r = await post({ title: 'szerzovel', project: 'marveen', actor: 'friday' })
    expect(r.status).toBe(200)
    const events = getKanbanCardEvents(String(r.body.id))
    expect(events).toHaveLength(1)
    expect(events[0].actor).toBe('friday')
  })

  it('the event says the card came INTO EXISTENCE at its status, not that it moved', async () => {
    initDatabase(':memory:')
    const r = await post({ title: 'allapottal', status: 'testing', actor: 'friday' })
    const [e] = getKanbanCardEvents(String(r.body.id))
    expect(e.from_status).toBeNull()
    expect(e.to_status).toBe('testing')
  })

  it('the default status is recorded when the caller sends none', async () => {
    initDatabase(':memory:')
    const r = await post({ title: 'alapertelmezett', actor: 'friday' })
    expect(getKanbanCardEvents(String(r.body.id))[0].to_status).toBe('planned')
  })

  /** An absent actor must not fail the write and must not skip the event: losing
   *  WHO is survivable, losing WHEN and IN WHAT STATUS as well is the 222. */
  it('no actor still creates the event, with a NULL actor', async () => {
    initDatabase(':memory:')
    const r = await post({ title: 'szerzo nelkul' })
    expect(r.status).toBe(200)
    const events = getKanbanCardEvents(String(r.body.id))
    expect(events).toHaveLength(1)
    expect(events[0].actor).toBeNull()
  })

  it('it reaches the history API as a status entry', async () => {
    initDatabase(':memory:')
    const r = await post({ title: 'tortenet', actor: 'friday' })
    const h = getKanbanCardHistory(String(r.body.id))
    expect(h).toHaveLength(1)
    expect(h[0].kind).toBe('status')
  })

  /** THE MEASURED CONSUMER EFFECT, pinned rather than left to be discovered:
   *  `dailyCardFlow` counts a closure per event with toStatus === 'done', so a card
   *  created DIRECTLY as done now emits one. That is a correction -- such a card is
   *  invisible to that metric today unless archived -- and the historical population
   *  is 7 cards. Nothing is backfilled. */
  it('a card created straight into done emits a done event (known flow-metric effect)', async () => {
    initDatabase(':memory:')
    const r = await post({ title: 'egybol done', status: 'done', actor: 'friday' })
    const [e] = getKanbanCardEvents(String(r.body.id))
    expect(e.to_status).toBe('done')
    expect(e.from_status).toBeNull()
  })

  /** CONTROL: creation is ONE event, so a later move adds a second rather than
   *  replacing it. Without this, an implementation that overwrote the creation row
   *  on every move would satisfy everything above. */
  it('a later move ADDS to the history, it does not replace creation', async () => {
    initDatabase(':memory:')
    const r = await post({ title: 'mozgatva', actor: 'friday' })
    const id = String(r.body.id)
    const move = Object.assign(Readable.from([Buffer.from(JSON.stringify({ status: 'in_progress', actor: 'didi' }))]), {
      method: 'POST', headers: {},
    }) as unknown as http.IncomingMessage
    let chunk = ''
    const res = { writeHead() { return res }, setHeader() { return res }, end(d?: string) { if (d) chunk = d } } as unknown as http.ServerResponse
    await tryHandleKanban({
      req: move, res, path: `/api/kanban/${id}/move`, method: 'POST',
      url: new URL(`http://x/api/kanban/${id}/move`),
    } as never)
    const events = getKanbanCardEvents(id)
    expect(events).toHaveLength(2)
    expect(events[0].actor).toBe('friday')      // creation
    expect(events[1].actor).toBe('didi')        // the move
    expect(events[1].from_status).toBe('planned')
  })
})
