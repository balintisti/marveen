// Contract tests: the whole-card PUT is refused (409) when the body was based on a card version
// that has moved on, instead of silently overwriting the change. Ported from upstream 5b404c44d
// (card baabe0ba) and adapted to our fork: our updateKanbanCard returns `{ outcome, overwritten,
// version }` (not the upstream boolean / writeKanbanCard result), our PUT answers `changed` and the
// `overwritten` warning, and we have no claim columns.
//
// The failure this closes: a client GETs a card, keeps it, and PUTs the whole object back (the
// dashboard does that on every assignee and parent edit). By then the body carries the OLD
// description, and the write reverted whatever anyone had added to it meanwhile -- with a 200.
//
// The backward-compatibility half matters as much: our agents' scripts send partial PUTs WITHOUT a
// version, and those must keep working exactly as before.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import type http from 'node:http'
import Database from 'better-sqlite3'
import {
  initDatabase, getDb, createKanbanCard, getKanbanCard, updateKanbanCard,
  addKanbanComment, archiveKanbanCard, KANBAN_WRITABLE_FIELDS,
} from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

async function call(
  method: string, path: string, body: unknown, headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, any> }> {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method, headers }) as unknown as http.IncomingMessage
  let status = 200
  let sent = ''
  const res = {
    writeHead: vi.fn((s: number) => { status = s }),
    end: vi.fn((chunk?: unknown) => { if (chunk != null) sent += String(chunk) }),
    setHeader: vi.fn(),
  } as unknown as http.ServerResponse
  const handled = await tryHandleKanban({
    req, res, path, method, url: new URL(`http://localhost${path}`),
  } as never)
  expect(handled).toBe(true)
  return { status, body: sent ? JSON.parse(sent) : {} }
}

const put = (id: string, fields: unknown, headers?: Record<string, string>) => call('PUT', `/api/kanban/${id}`, fields, headers)
const move = (id: string, status: string) => call('POST', `/api/kanban/${id}/move`, { status, sort_order: 0, actor: 'orin' })

beforeEach(() => {
  vi.restoreAllMocks()
  initDatabase(':memory:')
})

describe('kanban card version', () => {
  it('a new card starts at version 0, and a real field change moves it', () => {
    createKanbanCard({ id: 'v1', title: 'Card' })
    expect(getKanbanCard('v1')?.version).toBe(0)
    updateKanbanCard('v1', { description: 'first' })
    expect(getKanbanCard('v1')?.version).toBe(1)
  })

  it('a write that changes nothing does not move it', () => {
    createKanbanCard({ id: 'v2', title: 'Card' })
    updateKanbanCard('v2', { title: 'Card' })
    expect(getKanbanCard('v2')?.version).toBe(0)
  })

  it('a script writing the table directly moves it too (the trigger, not the TypeScript path)', () => {
    createKanbanCard({ id: 'v3', title: 'Card' })
    getDb().prepare('UPDATE kanban_cards SET description = ? WHERE id = ?').run('from a script', 'v3')
    expect(getKanbanCard('v3')?.version).toBe(1)
  })

  it('/move moves it: a status change is a change a stale whole-card PUT would revert', async () => {
    createKanbanCard({ id: 'v4', title: 'Card', assignee: 'dex' })
    expect((await move('v4', 'waiting')).status).toBe(200)
    expect(getKanbanCard('v4')?.version).toBe(1)
  })

  it('archiving moves it (archived_at is written back by a whole-card PUT)', () => {
    createKanbanCard({ id: 'v6', title: 'Card' })
    expect(archiveKanbanCard('v6')).toBe(true)
    expect(getKanbanCard('v6')?.version).toBe(1)
  })

  it('comments, dispatch stamps and updated_at do not move it -- a PUT cannot overwrite those', () => {
    createKanbanCard({ id: 'v5', title: 'Card' })
    addKanbanComment('v5', 'dex', 'a comment')
    getDb().prepare('UPDATE kanban_cards SET dispatched_at = ?, updated_at = ? WHERE id = ?').run(1, 2, 'v5')
    expect(getKanbanCard('v5')?.version).toBe(0)
  })

  it('the trigger watches exactly KANBAN_WRITABLE_FIELDS', () => {
    const row = getDb().prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'kanban_cards_version_bump'")
      .get() as { sql: string } | undefined
    expect(row).toBeDefined()
    const of = /AFTER UPDATE OF (.+?) ON kanban_cards/.exec(row!.sql)?.[1].split(',').map((s) => s.trim())
    expect(of).toEqual([...KANBAN_WRITABLE_FIELDS])
    // Every watched column is compared, not only listed: a column in the OF list but missing from
    // WHEN would fire the trigger and never bump.
    for (const c of KANBAN_WRITABLE_FIELDS) expect(row!.sql).toContain(`NEW.${c} IS NOT OLD.${c}`)
  })

  it('a title the title gate rewrites in its own UPDATE still yields a version the caller can chain on', () => {
    createKanbanCard({ id: 'v7', title: 'Card' })
    const r = updateKanbanCard('v7', { title: 'x'.repeat(400) })
    expect(r.outcome).toBe('updated')
    // read back from the row, whatever number of bumps the triggers made
    expect(r.version).toBe(getKanbanCard('v7')?.version)
    expect(r.version).toBeGreaterThanOrEqual(1)
  })
})

describe('PUT /api/kanban/:id with the version it read', () => {
  it('the lost update: a whole-card PUT based on an old copy is refused, and the newer text survives', async () => {
    createKanbanCard({ id: 'c1', title: 'Card', assignee: 'dex' })
    const copy = { ...getKanbanCard('c1')! }
    // Someone else writes meanwhile.
    expect(updateKanbanCard('c1', { description: 'measurement record' }).outcome).toBe('updated')

    // The old copy comes back with an unrelated edit, as the dashboard sends it.
    const r = await put('c1', { ...copy, assignee: 'orin' })
    expect(r.status).toBe(409)
    expect(r.body.conflict).toBe('stale_version')
    expect(r.body.current_version).toBe(1)
    const after = getKanbanCard('c1')!
    expect(after.description).toBe('measurement record')
    expect(after.assignee).toBe('dex')
  })

  it('control: the same PUT without a version still overwrites (the old behaviour, unchanged)', async () => {
    createKanbanCard({ id: 'c2', title: 'Card', assignee: 'dex' })
    const { version: _drop, ...copy } = getKanbanCard('c2')!
    updateKanbanCard('c2', { description: 'measurement record' })
    const r = await put('c2', { ...copy, assignee: 'orin' })
    expect(r.status).toBe(200)
    expect(getKanbanCard('c2')?.description).toBeNull()
  })

  it('backward compatible: a partial PUT without a version works exactly as before, on a card with a history', async () => {
    createKanbanCard({ id: 'bc', title: 'Card' })
    updateKanbanCard('bc', { description: 'one' })
    updateKanbanCard('bc', { description: 'two' })
    const r = await put('bc', { assignee: 'dex', actor: 'friday' })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.changed).toBe(true)
    expect(getKanbanCard('bc')?.assignee).toBe('dex')
  })

  it('a whole-card echo carrying the CURRENT version is accepted (the version key is not an unknown field)', async () => {
    createKanbanCard({ id: 'ec', title: 'Card' })
    updateKanbanCard('ec', { description: 'text' })
    const r = await put('ec', { ...getKanbanCard('ec')!, assignee: 'dex' })
    expect(r.status).toBe(200)
    expect(getKanbanCard('ec')).toMatchObject({ assignee: 'dex', description: 'text' })
  })

  it('expected_version: a partial body is checked the same way', async () => {
    createKanbanCard({ id: 'c3', title: 'Card' })
    updateKanbanCard('c3', { description: 'newer' })
    const stale = await put('c3', { description: 'older', expected_version: 0 })
    expect(stale.status).toBe(409)
    expect(getKanbanCard('c3')?.description).toBe('newer')

    const fresh = await put('c3', { description: 'edited on top', expected_version: 1 })
    expect(fresh.status).toBe(200)
    expect(fresh.body.version).toBe(2)
    expect(getKanbanCard('c3')?.description).toBe('edited on top')
  })

  it('the returned version chains: a second write from the same view is not refused as stale against the first', async () => {
    createKanbanCard({ id: 'c4', title: 'Card' })
    const card = { ...getKanbanCard('c4')! }
    const first = await put('c4', { ...card, assignee: 'dex' })
    expect(first.status).toBe(200)
    card.version = first.body.version as number
    card.assignee = 'dex'
    const second = await put('c4', { ...card, priority: 'high' })
    expect(second.status).toBe(200)
    expect(getKanbanCard('c4')).toMatchObject({ assignee: 'dex', priority: 'high' })
  })

  it('the version is in the answer of a no-op PUT too', async () => {
    createKanbanCard({ id: 'c4b', title: 'Card' })
    updateKanbanCard('c4b', { description: 'x' })
    const r = await put('c4b', { description: 'x' })
    expect(r.body).toMatchObject({ ok: true, changed: false, version: 1 })
  })

  it('a stale version is refused even when the body changes nothing', async () => {
    createKanbanCard({ id: 'c5', title: 'Card' })
    updateKanbanCard('c5', { description: 'newer' })
    expect((await put('c5', { title: 'Card', expected_version: 0 })).status).toBe(409)
  })

  it('a stale copy is answered 409 before the close gate: nothing is closed, and the answer is the stale one', async () => {
    createKanbanCard({ id: 'c5b', title: 'Card' })
    updateKanbanCard('c5b', { description: 'newer' })
    const r = await put('c5b', { status: 'done', expected_version: 0 })
    expect(r.status).toBe(409)
    expect(r.body.conflict).toBe('stale_version')
    expect(getKanbanCard('c5b')?.status).toBe('planned')
  })

  it('a malformed version is a 400 and nothing is written, not an unchecked write', async () => {
    createKanbanCard({ id: 'c6', title: 'Card' })
    for (const bad of ['0', -1, 1.5, null, true]) {
      const r = await put('c6', { description: 'x', expected_version: bad })
      expect(r.status, String(bad)).toBe(400)
      expect((await put('c6', { description: 'x', version: bad })).status, String(bad)).toBe(400)
    }
    expect(getKanbanCard('c6')?.description).toBeNull()
  })

  it('version and expected_version that disagree are a 400', async () => {
    createKanbanCard({ id: 'c7', title: 'Card' })
    expect((await put('c7', { description: 'x', version: 0, expected_version: 1 })).status).toBe(400)
    expect(getKanbanCard('c7')?.description).toBeNull()
  })

  it('a missing card is a 404 with a version too, not a 409', async () => {
    expect((await put('nope', { description: 'x', expected_version: 0 })).status).toBe(404)
  })

  it('our existing refusals are untouched: empty body 400, If-Match 400, expected_updated_at 400', async () => {
    createKanbanCard({ id: 'c8', title: 'Card' })
    expect((await put('c8', {})).status).toBe(400)
    expect((await put('c8', null)).status).toBe(400)
    expect((await put('c8', { description: 'x' }, { 'if-match': '"1"' })).status).toBe(400)
    expect((await put('c8', { description: 'x', expected_updated_at: 1 })).status).toBe(400)
    expect(getKanbanCard('c8')?.description).toBeNull()
  })

  // Another process writing between updateKanbanCard's read and its UPDATE. The seam: the function
  // reads the row, then takes the clock, then writes -- so a clock that performs a write on its
  // first call is exactly that interleaving.
  function raceOnNextClockRead(id: string): void {
    const realNow = Date.now.bind(Date)
    vi.spyOn(Date, 'now').mockImplementationOnce(() => {
      getDb().prepare('UPDATE kanban_cards SET description = ? WHERE id = ?').run('written by another process', id)
      return realNow()
    })
  }

  it('race, with a version: a write landing between the read and the UPDATE is not overwritten', () => {
    createKanbanCard({ id: 'r1', title: 'Card' })
    raceOnNextClockRead('r1')
    expect(updateKanbanCard('r1', { assignee: 'dex' }, 'orin', 0)).toMatchObject({ outcome: 'stale', current_version: 1 })
    vi.restoreAllMocks()
    expect(getKanbanCard('r1')).toMatchObject({ description: 'written by another process', assignee: null })
  })

  // Route level (card 03d531bf, baabe0ba F5, didi): the route's own pre-check passes (the card is
  // at version 0 when read), then another writer lands before the UPDATE, so updateKanbanCard
  // answers 'stale'. The route must turn that into the same 409 as the pre-check -- without the
  // mapping the race answers 200 ok, the edit form closes and the typed text is lost.
  it('route: a write landing after the route pre-check answers 409 stale_version, not 200', async () => {
    createKanbanCard({ id: 'r4', title: 'Card' })
    raceOnNextClockRead('r4')
    const r = await put('r4', { assignee: 'dex', expected_version: 0, actor: 'orin' })
    vi.restoreAllMocks()
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ conflict: 'stale_version', current_version: 1 })
    expect(typeof r.body.error).toBe('string')
    // nothing of ours was written; the other writer's change stands
    expect(getKanbanCard('r4')).toMatchObject({ description: 'written by another process', assignee: null })
  })

  it('route control: the same request with no race is a 200 and moves the version once', async () => {
    createKanbanCard({ id: 'r5', title: 'Card' })
    const r = await put('r5', { assignee: 'dex', expected_version: 0, actor: 'orin' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, changed: true, version: 1 })
  })

  it('race, without a version: still the unconditional write it always was', () => {
    createKanbanCard({ id: 'r2', title: 'Card' })
    raceOnNextClockRead('r2')
    expect(updateKanbanCard('r2', { assignee: 'dex' }, 'orin').outcome).toBe('updated')
    vi.restoreAllMocks()
    expect(getKanbanCard('r2')?.assignee).toBe('dex')
  })

  it('db layer, no route: a stale version is reported even for a body that changes nothing; a current one is the ordinary no-op', () => {
    createKanbanCard({ id: 'r3', title: 'Card' })
    updateKanbanCard('r3', { description: 'newer' })
    expect(updateKanbanCard('r3', { title: 'Card' }, undefined, 0)).toMatchObject({ outcome: 'stale', current_version: 1 })
    expect(updateKanbanCard('r3', { title: 'Card' }, undefined, 1)).toMatchObject({ outcome: 'unchanged', version: 1 })
  })

  it('updateKanbanCard reports not-found for a missing card, with or without a version', () => {
    expect(updateKanbanCard('nope', { title: 'x' }).outcome).toBe('not-found')
    expect(updateKanbanCard('nope', { title: 'x' }, undefined, 0).outcome).toBe('not-found')
  })
})

// mandark A (card 03d531bf, baabe0ba F5): a status move inside an open card modal changes a
// versioned column. If /move does not hand the new version back, the modal's next whole-card PUT
// carries the OLD one and is refused as stale against the user's own move.
describe('POST /move answers the version the move produced', () => {
  it('a real move returns the new version, and a PUT carrying it is accepted', async () => {
    createKanbanCard({ id: 'm1', title: 'Card' })
    const m = await move('m1', 'in_progress')
    expect(m.status).toBe(200)
    expect(m.body.version).toBe(1)
    expect(m.body.version).toBe(getKanbanCard('m1')?.version)
    expect((await put('m1', { assignee: 'dex', expected_version: m.body.version })).status).toBe(200)
  })

  it('control: the version from BEFORE the move is refused (the false 409 the client used to hit)', async () => {
    createKanbanCard({ id: 'm2', title: 'Card' })
    await move('m2', 'in_progress')
    const r = await put('m2', { assignee: 'dex', expected_version: 0 })
    expect(r.status).toBe(409)
    expect(r.body.current_version).toBe(1)
  })

  it('a no-op move returns the current version too', async () => {
    createKanbanCard({ id: 'm3', title: 'Card' })
    await move('m3', 'waiting')
    const again = await move('m3', 'waiting')
    expect(again.body).toMatchObject({ ok: true, changed: false, version: 1 })
  })
})

describe('fleet import carries the version', () => {
  it('the INSERT lists version and takes a safe integer, 0 otherwise', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../web/fleet-transfer.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/parent_id, dispatched_at, version\)/)
    expect(src).toContain('Number.isSafeInteger(c.version) && c.version >= 0 ? c.version : 0')
  })
})

describe('migration', () => {
  it('an existing database gets the column, every old row at version 0', () => {
    const dir = mkTmp('kanban-version-')
    try {
      const file = join(dir, 'old.db')
      const old = new Database(file)
      old.exec(`CREATE TABLE kanban_cards (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','testing','waiting','done')),
        assignee TEXT, priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
        project TEXT, due_date INTEGER, sort_order REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER)`)
      old.prepare('INSERT INTO kanban_cards (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run('old1', 'Old card', 1, 1)
      old.close()

      initDatabase(file)
      expect(getKanbanCard('old1')?.version).toBe(0)
      updateKanbanCard('old1', { description: 'after upgrade' })
      expect(getKanbanCard('old1')?.version).toBe(1)
    } finally {
      initDatabase(':memory:')
    }
  })
})
