// A comment may not be written against an idea that does not exist -- card 3f981b31.
//
// Measured by didi (2026-08-22) while checking the KANBAN half of the same
// shape: `POST /api/ideas/<id>/comments` answered 200 with a real comment id
// for ANY string, and stored a row that no screen shows and no endpoint
// deletes -- there is still no comment-delete route. The writer read their own
// id back out of the response and believed it had landed.
//
// The database does not object either: `idea_comments` has no foreign key and
// `PRAGMA foreign_keys` is set nowhere in this source. So the only thing that
// could have refused was the handler, and it did not ask.
//
// Every other write path in that file already asks, through the same `getIdea`
// helper -- which is why it survived review: the file reads as consistent until
// each branch is checked separately.

import { describe, it, expect, beforeEach } from 'vitest'
import type http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createIdea, getIdeaComments } from '../db.js'
import { tryHandleIdeas } from '../web/routes/ideas.js'

beforeEach(() => {
  initDatabase(':memory:')
})

function post(path: string, payload: unknown) {
  // `readBody` consumes the request with `req.on('data'|'end')`, so the double
  // has to be a real stream -- an async iterator alone is not enough, and the
  // failure ("req.on is not a function") reads like a broken handler rather
  // than a broken double.
  const req = Readable.from([
    Buffer.from(JSON.stringify(payload)),
  ]) as unknown as http.IncomingMessage
  Object.assign(req, { method: 'POST', headers: {} })

  const captured: { status: number; body: unknown } = { status: 0, body: null }
  const res = {
    writeHead(status: number) {
      captured.status = status
      return this
    },
    setHeader() {
      return this
    },
    end(payload?: string) {
      if (payload) captured.body = JSON.parse(payload)
    },
  } as unknown as http.ServerResponse

  return { req, res, captured, path }
}

async function postComment(ideaId: string) {
  const { req, res, captured, path } = post(`/api/ideas/${ideaId}/comments`, {
    author: 'dexter',
    content: 'a comment',
  })
  const handled = await tryHandleIdeas({
    req,
    res,
    path,
    method: 'POST',
    url: new URL(`http://localhost${path}`),
  } as never)
  return { handled, ...captured }
}

describe('idea comments require the idea to exist (3f981b31)', () => {
  it('refuses a comment on an idea that does not exist, and stores nothing', async () => {
    const result = await postComment('no-such-idea')

    expect(result.status).toBe(404)
    // The row is the point: a 404 that still wrote would be the same defect
    // wearing a different status code.
    expect(getIdeaComments('no-such-idea')).toEqual([])
  })

  it('CONTROL: a comment on a REAL idea is still accepted and stored', async () => {
    // Without this, "always refuse" passes the test above while breaking the
    // only path that ever worked.
    createIdea({
      id: 'idea-1',
      title: 'Real idea',
      description: null,
      category: 'other',
      status: 'new',
      source: 'dexter',
      kanban_id: null,
      impact: null,
      effort: null,
    })

    const result = await postComment('idea-1')

    expect(result.status).not.toBe(404)
    expect(getIdeaComments('idea-1')).toHaveLength(1)
  })
})
