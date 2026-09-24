/**
 * Card a8dff303. `due_date` on POST and PUT is normalised narrowly or refused
 * with 400 -- see src/web/kanban-due-date.ts for the rule and why.
 *
 * The assertion that matters most is not the read-back: a read-back looked
 * right the whole time the defect was live. It is that the REAL offering
 * predicate, `isDeferred` from src/idle-agent.ts, says "deferred" for what the
 * write path stored. That is the reader the floor exists for.
 *
 * mandark's black-box spec (a8dff303 comment 1, 17 cases against the live
 * dashboard) is mirrored case by case below; his test re-runs after deploy.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, getKanbanCard, listKanbanCards } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import { isDeferred } from '../idle-agent.js'
import {
  normalizeDueDate, zoneMidnightSeconds, zoneDay, DUE_DATE_ZONE,
} from '../web/kanban-due-date.js'

/** 2026-09-26 00:00 Europe/Budapest -- the value marveen wrote by hand, measured by mandark. */
const SEP26 = 1790373600
/** A "now" safely before SEP26, so a working floor must read as deferred. */
const NOW = SEP26 - 86_400 * 3

const ACCEPT: Array<[unknown, number | null]> = [
  [SEP26, SEP26],
  [String(SEP26), SEP26],
  ['2026-09-26', SEP26],
  [null, null],
]
const REJECT: unknown[] = [
  'holnap', '', '0', 0, -1, '2026-02-31', '2026-09-26T10:00:00+02:00',
  SEP26 * 1000, SEP26 + 0.5, true, {}, [], '2026-9-26', ' 2026-09-26', '-5',
]

describe('normalizeDueDate -- the accepted shapes and nothing else', () => {
  it.each(ACCEPT)('accepts %j -> %j', (raw, want) => {
    expect(normalizeDueDate(raw)).toEqual({ ok: true, value: want })
  })

  it.each(REJECT)('rejects %j, and the error names the accepted shapes', (raw) => {
    const r = normalizeDueDate(raw)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('due_date')
      expect(r.error).toContain('YYYY-MM-DD')
      expect(r.error).toContain('NEM valtozott')
    }
  })

  it('the day is taken in DUE_DATE_ZONE, and that zone is Europe/Budapest', () => {
    expect(DUE_DATE_ZONE).toBe('Europe/Budapest')
    // winter (+1) and summer (+2), and both clock-change days
    expect(new Date(zoneMidnightSeconds(2026, 1, 15) * 1000).toISOString()).toBe('2026-01-14T23:00:00.000Z')
    expect(new Date(zoneMidnightSeconds(2026, 7, 15) * 1000).toISOString()).toBe('2026-07-14T22:00:00.000Z')
    for (const [y, m, d] of [[2026, 3, 29], [2026, 10, 25], [2026, 9, 26]] as const) {
      const s = zoneMidnightSeconds(y, m, d)
      expect(zoneDay(s), `${y}-${m}-${d}`).toBe(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
      expect(zoneDay(s - 1), 'one second earlier is the previous day').not.toBe(zoneDay(s))
    }
  })

  it('CONTROL: the real predicate can say both answers', () => {
    expect(isDeferred(SEP26, NOW)).toBe(true)
    expect(isDeferred(NOW - 10, NOW)).toBe(false)
    // and the defect, as measured: the string form reads as NOT deferred
    expect(isDeferred('2026-09-26' as unknown as number, NOW)).toBe(false)
  })
})

async function call(method: 'POST' | 'PUT' | 'GET', path: string, body?: unknown) {
  const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
    method, headers: {},
  }) as unknown as http.IncomingMessage
  let chunk = ''
  let status = 200
  const res = {
    writeHead(c: number) { status = c; return res }, setHeader() { return res },
    end(d?: string) { if (d) chunk = d },
  } as unknown as http.ServerResponse
  await tryHandleKanban({ req, res, path, method, url: new URL(`http://x${path}`) } as never)
  return { status, body: chunk ? JSON.parse(chunk) : {} }
}

const base = { title: 'hatarido-proba', project: 'marveen', status: 'planned', priority: 'normal' }

describe('POST /api/kanban -- a bad due_date creates NO card', () => {
  beforeEach(() => { initDatabase(':memory:') })

  it.each(REJECT)('rejects %j with 400 and the card count is unchanged', async (raw) => {
    const before = listKanbanCards().length
    const r = await call('POST', '/api/kanban', { ...base, due_date: raw })
    expect(r.status).toBe(400)
    expect(String(r.body.error)).toContain('due_date')
    expect(listKanbanCards().length).toBe(before)
  })

  it("'YYYY-MM-DD' is stored as the integer the predicate reads as deferred", async () => {
    const r = await call('POST', '/api/kanban', { ...base, due_date: '2026-09-26' })
    expect(r.status).toBe(200)
    const stored = getKanbanCard(r.body.id as string)!.due_date
    expect(stored).toBe(SEP26)
    expect(typeof stored).toBe('number')
    expect(isDeferred(stored, NOW)).toBe(true)
  })

  it('a body with no due_date at all is still created with none', async () => {
    const r = await call('POST', '/api/kanban', base)
    expect(r.status).toBe(200)
    expect(getKanbanCard(r.body.id as string)!.due_date).toBeNull()
  })
})

describe('PUT /api/kanban/<id> -- refused means the WHOLE card is untouched', () => {
  let id = ''
  beforeEach(async () => {
    initDatabase(':memory:')
    id = (await call('POST', '/api/kanban', { ...base, due_date: SEP26 })).body.id as string
  })

  it.each(REJECT)('rejects %j with 400; due_date AND the other sent field keep their stored values', async (raw) => {
    const r = await call('PUT', `/api/kanban/${id}`, { priority: 'high', due_date: raw })
    expect(r.status).toBe(400)
    const card = getKanbanCard(id)!
    expect(card.due_date).toBe(SEP26)
    expect(card.priority).toBe('normal')
  })

  it("'YYYY-MM-DD' updates to that day's Budapest midnight, as an integer", async () => {
    const r = await call('PUT', `/api/kanban/${id}`, { due_date: '2026-10-03' })
    expect(r.status).toBe(200)
    const stored = getKanbanCard(id)!.due_date
    expect(stored).toBe(zoneMidnightSeconds(2026, 10, 3))
    expect(zoneDay(stored!)).toBe('2026-10-03')
  })

  it('a digit string is stored as the number', async () => {
    await call('PUT', `/api/kanban/${id}`, { due_date: String(SEP26 + 3600) })
    expect(getKanbanCard(id)!.due_date).toBe(SEP26 + 3600)
  })

  it('null clears the floor', async () => {
    const r = await call('PUT', `/api/kanban/${id}`, { due_date: null })
    expect(r.status).toBe(200)
    expect(getKanbanCard(id)!.due_date).toBeNull()
  })

  it("an ECHO of a stored legacy value passes and is left as stored (the inline edits' {...card})", async () => {
    // Plant a legacy text value the old write path allowed, straight into the row.
    const { getDb } = await import('../db.js')
    getDb().prepare('UPDATE kanban_cards SET due_date = ? WHERE id = ?').run('regi-ertek', id)
    const r = await call('PUT', `/api/kanban/${id}`, { ...getKanbanCard(id)!, assignee: 'dexter', actor: 'dashboard' })
    expect(r.status).toBe(200)
    const card = getKanbanCard(id)!
    expect(card.assignee).toBe('dexter')
    expect(card.due_date).toBe('regi-ertek' as unknown as number)
    // and a DIFFERENT bad value on the same card is still refused
    expect((await call('PUT', `/api/kanban/${id}`, { due_date: 'holnap' })).status).toBe(400)
  })

  it('a PUT without due_date does not touch it (the modal relies on this)', async () => {
    const r = await call('PUT', `/api/kanban/${id}`, { priority: 'low' })
    expect(r.status).toBe(200)
    expect(getKanbanCard(id)!.due_date).toBe(SEP26)
  })
})

describe('GET /api/kanban/due-date-rules -- the one place the modal learns the zone', () => {
  it('answers with the zone constant, not a card lookup of "due-date-rules"', async () => {
    initDatabase(':memory:')
    const r = await call('GET', '/api/kanban/due-date-rules')
    expect(r.status).toBe(200)
    expect(r.body.zone).toBe(DUE_DATE_ZONE)
    expect(String(r.body.accepted)).toContain('YYYY-MM-DD')
  })
})
