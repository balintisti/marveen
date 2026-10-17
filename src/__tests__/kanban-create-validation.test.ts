/**
 * Card fbf768fa. `POST /api/kanban` answered every bad field with the same bare
 * 500, and the field name went to `store/dashboard.log`. deeper lost a round to
 * it; friday reproduced it unchanged before changing anything (2127 cards before
 * and after the three probes, a valid body in the same round returning an id).
 *
 * Three layers here, and the middle one is the point:
 *   - the pure validator, per field and per direction
 *   - the ROUTE, driven in memory, so the 400 is proven to reach a caller rather
 *     than merely to be constructible
 *   - a DRIFT GUARD: the allowed values are written down twice until card
 *     fbf768fa's part (b) lands, so the spec reads the CHECK text out of db.ts
 *     and fails when the two copies disagree. It does not make them one source.
 *     It makes divergence loud, which is the half that was dangerous.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, listKanbanCards, getKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import { kanbanCreateError, KANBAN_STATUSES, KANBAN_PRIORITIES, KANBAN_TEXT_FIELDS } from '../web/kanban-create-validation.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DB_SRC = readFileSync(join(ROOT, 'src', 'db.ts'), 'utf-8')

describe('kanbanCreateError -- the field, and what it accepts', () => {
  it('accepts a body the database would accept', () => {
    expect(kanbanCreateError({ title: 'ok', status: 'planned', priority: 'normal' })).toBeUndefined()
  })

  it('accepts a bare title -- status and priority have schema defaults', () => {
    expect(kanbanCreateError({ title: 'ok' })).toBeUndefined()
  })

  it('names `title` when it is missing, empty or not a string', () => {
    for (const body of [{}, { title: '' }, { title: '   ' }, { title: 42 }, { title: null }]) {
      expect(kanbanCreateError(body), JSON.stringify(body)).toMatch(/`title`/)
    }
  })

  /** The measured case: `medium` is the natural guess and carries zero cards. */
  it('names `priority` AND lists the allowed values', () => {
    const msg = kanbanCreateError({ title: 'x', priority: 'medium' })
    expect(msg).toMatch(/`priority`/)
    expect(msg).toContain('medium')
    for (const v of KANBAN_PRIORITIES) expect(msg).toContain(v)
  })

  it('names `status` AND lists the allowed values', () => {
    const msg = kanbanCreateError({ title: 'x', status: 'backlog' })
    expect(msg).toMatch(/`status`/)
    expect(msg).toContain('backlog')
    for (const v of KANBAN_STATUSES) expect(msg).toContain(v)
  })

  it('every allowed value really is allowed (positive control, both sets)', () => {
    for (const s of KANBAN_STATUSES) expect(kanbanCreateError({ title: 'x', status: s }), s).toBeUndefined()
    for (const p of KANBAN_PRIORITIES) expect(kanbanCreateError({ title: 'x', priority: p }), p).toBeUndefined()
  })

  it('a non-object body is rejected by name, not by crashing', () => {
    for (const body of [null, 'nope', 7, ['a']]) {
      expect(kanbanCreateError(body), JSON.stringify(body)).toMatch(/JSON OBJEKTUM/)
    }
  })

  /** Rejecting a field the schema does not police would turn working calls into
   *  400s -- the more expensive direction for a fleet that all writes here. */
  it('does NOT invent rules the database does not enforce', () => {
    expect(kanbanCreateError({ title: 'x', project: '', assignee: null, nonsense: 1 })).toBeUndefined()
  })
})

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

describe('the ROUTE returns it -- a 400 that reaches the caller', () => {
  it('the three measured probes now get 400 and a named field', async () => {
    initDatabase(':memory:')
    const bad = await post({ title: 'probe', priority: 'medium' })
    expect(bad.status).toBe(400)
    expect(String(bad.body.error)).toMatch(/`priority`/)

    const noTitle = await post({ priority: 'normal' })
    expect(noTitle.status).toBe(400)
    expect(String(noTitle.body.error)).toMatch(/`title`/)

    const badStatus = await post({ title: 'probe', status: 'backlog' })
    expect(badStatus.status).toBe(400)
    expect(String(badStatus.body.error)).toMatch(/`status`/)
  })

  /** They were byte-identical before; the point of the card is that they no
   *  longer are. A fix that returned the same 400 text for every field would
   *  pass every assertion above. */
  it('the three answers are DISTINCT from each other', async () => {
    initDatabase(':memory:')
    const msgs = [
      (await post({ title: 'probe', priority: 'medium' })).body.error,
      (await post({ priority: 'normal' })).body.error,
      (await post({ title: 'probe', status: 'backlog' })).body.error,
    ]
    expect(new Set(msgs).size, 'a harom valasz ugyanaz maradt').toBe(3)
  })

  /** CONTROL: a valid body still creates a card and still returns its id. A
   *  validator that rejected everything would satisfy every test above. */
  it('a valid body is still created and still returns an id', async () => {
    initDatabase(':memory:')
    const ok = await post({ title: 'ervenyes', status: 'planned', priority: 'high', project: 'marveen' })
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)
    expect(String(ok.body.id)).toMatch(/^[0-9a-f]{8}$/)
  })

  /** The validator SKIPS null/undefined for these two fields, and that is only
   *  correct because `createKanbanCard` binds them with `??`, which treats null
   *  as absent and substitutes the schema default. If that ever becomes `||` or
   *  the bare value, null would hit NOT NULL and produce exactly the anonymous
   *  500 this card removed -- so the pair is pinned together, not assumed. */
  it('an explicit null status/priority is created with the schema defaults', async () => {
    initDatabase(':memory:')
    const r = await post({ title: 'nullokkal', status: null, priority: null, project: 'marveen' })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
  })

  /** The project warning is a different policy on the same endpoint and must
   *  survive: an empty project WARNS, it does not reject. */
  it('the project warning still travels, and is not turned into a rejection', async () => {
    initDatabase(':memory:')
    const r = await post({ title: 'projekt nelkul' })
    expect(r.status).toBe(200)
    expect(r.body.warning).toBeTruthy()
  })
})

describe('DRIFT GUARD: the validator and the schema CHECK agree', () => {
  /**
   * The kanban_cards table bodies: the schema AND the migration that recreates
   * it, because the columns are written twice.
   *
   * SCOPED TO THE TABLE ON PURPOSE, and the first version of this was not. A
   * bare `status TEXT NOT NULL DEFAULT ... CHECK(status IN (...))` also matches
   * `scheduled_tasks`, whose status is ('active','paused') -- so the guard
   * failed on its first run against a DIFFERENT TABLE's constraint and blamed
   * the validator. The measurer's scope was wider than the question.
   */
  function kanbanTableBodies(): string[] {
    const bodies = DB_SRC.split(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?/)
      .filter((seg) => /^kanban_cards(_new)?\s*\(/.test(seg))
    expect(bodies.length, 'nem talaltam kanban_cards tabla-definiciot a db.ts-ben -- a mero vak')
      .toBeGreaterThan(0)
    return bodies
  }

  function checkLists(column: string): string[][] {
    const re = new RegExp(`CHECK\\(${column} IN \\(([^)]*)\\)\\)`)
    const found: string[][] = []
    for (const body of kanbanTableBodies()) {
      const m = body.match(re)
      if (m) found.push(m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort())
    }
    expect(found.length, `nincs CHECK a(z) ${column} oszlopra a kanban_cards-ban -- a mero vak`).toBeGreaterThan(0)
    return found
  }

  it('the extractor finds BOTH kanban_cards definitions (control)', () => {
    // If this ever reads 0, every assertion below passes vacuously.
    expect(kanbanTableBodies().length).toBe(2)
    expect(checkLists('status').length).toBe(2)
    expect(checkLists('priority').length).toBe(2)
  })

  /** NEGATIVE CONTROL, and it pins a bug this guard actually had: the extractor
   *  must not reach into another table's status column. `scheduled_tasks` is
   *  ('active','paused') and is the one it wrongly matched. */
  it('the extractor does NOT reach another table (negative control)', () => {
    expect(DB_SRC, 'a szomszed tabla eltunt -- a negativ kontroll ertelmet vesztette')
      .toContain("CHECK(status IN ('active','paused'))")
    for (const list of checkLists('status')) {
      expect(list).not.toContain('active')
      expect(list).not.toContain('paused')
    }
  })

  it('EVERY status CHECK in db.ts matches KANBAN_STATUSES', () => {
    for (const list of checkLists('status')) {
      expect(list).toEqual([...KANBAN_STATUSES].sort())
    }
  })

  it('EVERY priority CHECK in db.ts matches KANBAN_PRIORITIES', () => {
    for (const list of checkLists('priority')) {
      expect(list).toEqual([...KANBAN_PRIORITIES].sort())
    }
  })
})

/** Card dd7f1165 (sirius 2026-10-14): the TEXT columns and `parent_id` were taken
 *  unchecked. A non-string threw in the better-sqlite3 bind (anonymous 500) or was
 *  stored as text; a `parent_id` naming no card was stored, foreign_keys being off. */
describe('the TEXT fields and the parent are checked too (card dd7f1165)', () => {
  it('names each TEXT field when it is not a string', () => {
    for (const field of KANBAN_TEXT_FIELDS) {
      for (const bad of [5, true, { a: 1 }, ['x']]) {
        expect(kanbanCreateError({ title: 'x', [field]: bad }), `${field}=${JSON.stringify(bad)}`)
          .toMatch(new RegExp('`' + field + '`'))
      }
    }
  })

  it('a string, an empty string and null are still accepted (control)', () => {
    for (const field of KANBAN_TEXT_FIELDS) {
      for (const ok of ['szoveg', '', null, undefined]) {
        expect(kanbanCreateError({ title: 'x', [field]: ok }), `${field}=${JSON.stringify(ok)}`).toBeUndefined()
      }
    }
  })

  it('the route answers 400 naming the field, and creates nothing', async () => {
    initDatabase(':memory:')
    const r = await post({ title: 'tipus', assignee: { name: 'friday' }, project: 'marveen' })
    expect(r.status).toBe(400)
    expect(String(r.body.error)).toMatch(/`assignee`/)
    expect(listKanbanCards().length).toBe(0)
  })

  it('a parent that does not exist is refused, and no card is created', async () => {
    initDatabase(':memory:')
    const r = await post({ title: 'arva', parent_id: 'nincsilyen', project: 'marveen' })
    expect(r.status).toBe(400)
    expect(String(r.body.error)).toMatch(/nincsilyen/)
    expect(listKanbanCards().length).toBe(0)
  })

  it('a supplied id cannot be its own parent', async () => {
    initDatabase(':memory:')
    const r = await post({ id: 'onmaga', title: 'kor', parent_id: 'onmaga', project: 'marveen' })
    expect(r.status).toBe(400)
    expect(String(r.body.error)).toMatch(/saját szülője/)
    expect(getKanbanCard('onmaga')).toBeFalsy()
  })

  it('an existing parent is accepted and stored (control)', async () => {
    initDatabase(':memory:')
    const parent = await post({ title: 'szulo', project: 'marveen' })
    expect(parent.status).toBe(200)
    const child = await post({ title: 'gyerek', parent_id: parent.body.id, project: 'marveen' })
    expect(child.status).toBe(200)
    expect(getKanbanCard(String(child.body.id))?.parent_id).toBe(parent.body.id)
  })
})
