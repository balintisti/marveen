// 2dd78397 (an extension of 5759e678): two gaps around ARCHIVED cards. Ported from upstream
// 1b0878897 onto our fork (card baabe0ba). Adapted to our response shapes: our move answers
// `{ ok, changed }`, and our PUT already said `archived` + `warning` before the port (66454b7d), so
// the PUT cases pin that existing shape and the comment/move cases pin the new field.
//
// (1) A write that landed on an archived card (a comment, a move, a PUT) answered exactly like one
//     on a live card, so the writer never learned that the card had left the board. The chosen
//     shape is the one that breaks less: the write still happens (a 409 would break every existing
//     caller that closes or comments after archiving), and the successful response says it,
//     additively (`archived: true`). On a live card the response is unchanged: no field at all.
// (2) GET /api/kanban/<id> answered 405, and the list GET leaves archived cards out, so one
//     archived card (with its description) could not be read by id at all.
import { describe, it, expect, beforeEach } from 'vitest'
import { Readable } from 'node:stream'
import { initDatabase, getDb, archiveKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import type { RouteContext } from '../web/routes/types.js'

function fakeCtx(path: string, method: string, body?: unknown) {
  const out: { status: number; body: any; headers: Record<string, string> } = { status: 0, body: null, headers: {} }
  const res: any = {
    writeHead(status: number, headers?: Record<string, string>) {
      out.status = status
      if (headers) for (const [k, v] of Object.entries(headers)) out.headers[k.toLowerCase()] = String(v)
      return res
    },
    end(chunk?: string) { if (chunk) { try { out.body = JSON.parse(chunk) } catch { out.body = chunk } } },
  }
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req: any = Readable.from(payload ? [Buffer.from(payload)] : [])
  req.headers = {}
  const url = new URL(`http://localhost:3420${path}`)
  return { ctx: { req, res, path: url.pathname, method, url } as RouteContext, out }
}

async function call(path: string, method: string, body?: unknown) {
  const { ctx, out } = fakeCtx(path, method, body)
  expect(await tryHandleKanban(ctx)).toBe(true)
  return out
}

const LIVE = 'LIVE0001'
const GONE = 'ARCH0001'

function seed() {
  const now = Math.floor(Date.now() / 1000)
  const ins = getDb().prepare(
    'INSERT INTO kanban_cards (id, title, description, status, priority, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  ins.run(LIVE, 'Live card', 'the live brief', 'planned', 'low', 0, now, now)
  ins.run(GONE, 'Archived card', 'the archived brief', 'done', 'low', 0, now, now)
  expect(archiveKanbanCard(GONE)).toBe(true)
}

const readCard = (id: string): any => getDb().prepare('SELECT * FROM kanban_cards WHERE id = ?').get(id)

describe('a write on an ARCHIVED card says so; on a live card the answer is unchanged', () => {
  beforeEach(() => { initDatabase(':memory:'); seed() })

  it('comment: archived:true on the archived card, and the comment is still stored', async () => {
    const out = await call(`/api/kanban/${GONE}/comments`, 'POST', { author: 'teszt', content: 'late note' })
    expect(out.status).toBe(200)
    expect(out.body.archived).toBe(true)
    expect(out.body.id).toBeTypeOf('number')
    const stored = getDb().prepare('SELECT content FROM kanban_comments WHERE card_id = ?').all(GONE) as { content: string }[]
    expect(stored.map((r) => r.content)).toContain('late note')
  })

  it('NEGATIVE: comment on a live card: no archived field at all', async () => {
    const out = await call(`/api/kanban/${LIVE}/comments`, 'POST', { author: 'teszt', content: 'note' })
    expect(out.status).toBe(200)
    expect(out.body).not.toHaveProperty('archived')
    expect(out.body.id).toBeTypeOf('number')
  })

  it('move: {ok, changed, archived:true} on the archived card, and the status still changes', async () => {
    const out = await call(`/api/kanban/${GONE}/move`, 'POST', { status: 'waiting', actor: 'teszt' })
    expect(out.status).toBe(200)
    expect(out.body).toEqual({ ok: true, changed: true, archived: true })
    expect(readCard(GONE).status).toBe('waiting')
  })

  it('move: a no-op move on the archived card says archived too', async () => {
    const out = await call(`/api/kanban/${GONE}/move`, 'POST', { status: 'done', actor: 'teszt' })
    expect(out.body).toEqual({ ok: true, changed: false, archived: true })
  })

  it('NEGATIVE: move on a live card: exactly {ok, changed}, no archived field', async () => {
    const out = await call(`/api/kanban/${LIVE}/move`, 'POST', { status: 'waiting', actor: 'teszt' })
    expect(out.body).toEqual({ ok: true, changed: true })
  })

  it('PUT: archived:true (plus our warning) on the archived card, and the field is still written', async () => {
    const out = await call(`/api/kanban/${GONE}`, 'PUT', { assignee: 'dexter', actor: 'teszt' })
    expect(out.status).toBe(200)
    expect(out.body.ok).toBe(true)
    expect(out.body.archived).toBe(true)
    expect(out.body.warning).toContain('ARCHIVALT')
    expect(readCard(GONE).assignee).toBe('dexter')
  })

  it('NEGATIVE: PUT on a live card: no archived field, no warning', async () => {
    const out = await call(`/api/kanban/${LIVE}`, 'PUT', { assignee: 'dexter', actor: 'teszt' })
    // `version` is the card's new row version (the PUT answers it on every write, 5b404c44d).
    expect(out.body).toEqual({ ok: true, changed: true, version: readCard(LIVE).version })
  })
})

describe('GET /api/kanban/<id> reads one card, archived ones included', () => {
  beforeEach(() => { initDatabase(':memory:'); seed() })

  it('an archived card comes back with its description and its archived_at', async () => {
    const out = await call(`/api/kanban/${GONE}`, 'GET')
    expect(out.status).toBe(200)
    expect(out.body.id).toBe(GONE)
    expect(out.body.description).toBe('the archived brief')
    expect(out.body.archived_at).toBeTypeOf('number')
  })

  it('a live card comes back too, with archived_at null', async () => {
    const out = await call(`/api/kanban/${LIVE}`, 'GET')
    expect(out.body.description).toBe('the live brief')
    expect(out.body.archived_at).toBeNull()
  })

  it('an invented id is a 404 that names it', async () => {
    const out = await call('/api/kanban/NO-SUCH-CARD', 'GET')
    expect(out.status).toBe(404)
    expect(JSON.stringify(out.body)).toContain('NO-SUCH-CARD')
  })

  // The GET branch sits after the fixed single-segment endpoints; placed before them it would read
  // "archived" as a card id and answer 404 -- a status the older "not 405" check would let through.
  for (const path of ['/api/kanban/archived', '/api/kanban/labels', '/api/kanban/assignees']) {
    it(`GET ${path} is still served by its own handler (200, a list)`, async () => {
      const out = await call(path, 'GET')
      expect(out.status).toBe(200)
      expect(Array.isArray(out.body) || Array.isArray(out.body?.cards) || typeof out.body === 'object').toBe(true)
      expect(out.body?.error).toBeUndefined()
    })
  }
})
