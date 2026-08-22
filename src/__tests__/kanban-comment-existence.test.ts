// A comment posted to a card that does not exist used to return 200 with a real
// comment id -- and vanish. Measured 2026-08-22 (card 2060668a): two full work
// reports were written to a mistyped card id, and BOTH sides saw success.
//
// Why this is the dangerous shape, and why the repo's own send-check missed it:
// CLAUDE.md tells every agent to verify a write by checking the HTTP code AND
// the returned id. Here both were genuine -- 200 and a real row -- so the rule
// that exists to catch silent failures passed on a silent failure. There is no
// comment-delete endpoint either, so the write could not even be undone.
//
// The guard itself is one line, and the same line already stood on the
// card-labels POST in this file. The bug was not a missing idea; it was the
// idea applied to one branch and not to its neighbour.
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, getKanbanComments } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

beforeEach(() => {
  initDatabase(':memory:')
})

/** Drives the real route handler with a minimal request/response pair. */
async function postComment(cardId: string, body: unknown): Promise<{ status: number; payload: unknown }> {
  // A real Readable, not an async generator: readBody() uses the stream's
  // `on('data')` API, and a generator satisfies the type but not the contract.
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'POST', headers: {},
  }) as unknown as http.IncomingMessage
  let status = 0
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string) { if (data) chunk = data },
  } as unknown as http.ServerResponse

  const handled = await tryHandleKanban({
    req, res,
    path: `/api/kanban/${cardId}/comments`,
    method: 'POST',
    url: new URL(`http://x/api/kanban/${cardId}/comments`),
  } as never)
  expect(handled).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

describe('POST /api/kanban/<id>/comments -- the card must exist', () => {
  it('REFUSES a comment on an id that does not exist, instead of storing it invisibly', async () => {
    const { status } = await postComment('nem-letezo-kartya', { author: 'marveen', content: 'x' })
    expect(status).toBe(404)
    // The point is not only the status: nothing may be persisted, because a
    // stored-but-unreachable comment cannot be deleted afterwards.
    expect(getKanbanComments('nem-letezo-kartya')).toEqual([])
  })

  it('still accepts a comment on a card that DOES exist -- the guard must not reject real work', async () => {
    createKanbanCard({ id: 'aaaa1111', title: 'valodi kartya', status: 'planned' })
    const { status } = await postComment('aaaa1111', { author: 'marveen', content: 'eredmeny' })
    expect(status).toBe(200)
    expect(getKanbanComments('aaaa1111')).toHaveLength(1)
  })

  it('still rejects an empty author/content -- on a card that DOES exist', async () => {
    // The existence check now runs BEFORE the body is read, so a bad payload on a
    // missing card answers 404, not 400. That ordering is deliberate: the caller's
    // first problem is the wrong card id, and reporting the second problem first
    // would send them looking in the wrong place. The 400 path is asserted here on
    // a real card so it stays covered.
    createKanbanCard({ id: 'bbbb2222', title: 'valodi kartya', status: 'planned' })
    const { status } = await postComment('bbbb2222', { author: '', content: '' })
    expect(status).toBe(400)
  })
})
