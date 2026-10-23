import { describe, expect, it, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, addKanbanComment, getKanbanCard, moveKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import { proseLeftoverHints, proseLeftoverWarning, type VerdictComment } from '../kanban-verdict.js'

// Card 85f9f3ef: a prose leftover is a WARNING on the move to done. The positive
// controls are lines copied from real done cards (2026-10-23 census); the
// negatives are the false-positive families the census measured.
let n = 0
const c = (author: string, content: string): VerdictComment => ({ id: ++n, author, content, created_at: n })
const real = new Set(['f2a1b3c4'])
const exists = (id: string) => real.has(id)
const hints = (...cs: VerdictComment[]) => proseLeftoverHints(cs, 'abcdef01', exists)

describe('proseLeftoverHints', () => {
  it('flags a line that STARTS with an open-item phrase and names no card', () => {
    expect(hints(c('ford', 'Ford: contacts-companies #14 NEM nyúlok hozzá.\nNyitva marad.'))).toHaveLength(1)
    expect(hints(c('ford', 'Nem javítva (marad a gyűjtőn): #5 (ismétlődés-számláló), #7 (dueTime)'))).toHaveLength(1)
    expect(hints(c('didi', '**NYITVA MARAD**, es ma nem is volt eldontheto.'))).toHaveLength(1)
    expect(hints(c('friday', '- NYITVA MARAD (friday, 2026-09-30): a köteg élesben van'))).toHaveLength(1)
  })

  it('does not flag a comment that names a card that exists (the carrier)', () => {
    expect(hints(c('ford', 'Nyitva marad: a #14 tétel, hordozó: f2a1b3c4.'))).toHaveLength(0)
  })

  it('a commit hash is not a carrier (same 8-hex shape, no such card)', () => {
    expect(hints(c('ford', 'Nyitva marad, lásd a 1748e4ef commitot.'))).toHaveLength(1)
  })

  it('the card being closed does not carry its own leftover', () => {
    expect(hints(c('ford', 'Nyitva marad az abcdef01 kártyán.'))).toHaveLength(1)
  })

  it('does not flag the measured false-positive families', () => {
    expect(hints(c('trillian', 'TIER: LOW marad (csak teszt)'))).toHaveLength(0)
    expect(hints(c('mandark', 'VERDIKT: OK ... Nem main, nem push: marad testing.'))).toHaveLength(0)
    expect(hints(c('jarvis', 'KESZ-IGAZOLAS: ELES (nincs nyitott VERDIKT/MARADEK)'))).toHaveLength(0)
    expect(hints(c('dexter', 'aki az 1-et javitja, a maradek 24 hivasi helyen semmit nem valtoztat'))).toHaveLength(0)
    expect(hints(c('didi', 'Nincs nyitva marad tétel.'))).toHaveLength(0)
    expect(hints(c('ford', 'MARADEK: valami | f2a1b3c4'))).toHaveLength(0)
    expect(hints(c('ford', 'a hiba mar nem marad nyitva'))).toHaveLength(0)
  })

  it('ignores system comments and empty ones', () => {
    expect(hints(c('system', 'Nyitva marad.'), c('ford', ''))).toHaveLength(0)
  })

  it('reads an own measured-time stamp in front of the line', () => {
    expect(hints(c('jarvis', '[jarvis, 2026-10-23 08:11 CEST, date] Nyitva marad.'))).toHaveLength(1)
  })

  it('caps the hints and quotes the line and the comment id', () => {
    const many = Array.from({ length: 5 }, (_, i) => c('ford', `Nyitva marad ${i}`))
    const got = proseLeftoverHints(many, 'abcdef01', exists)
    expect(got).toHaveLength(3)
    expect(got[0]).toMatchObject({ author: 'ford', line: 'Nyitva marad 0' })
    expect(proseLeftoverWarning(got)).toContain(`komment ${got[0].commentId}, ford: "Nyitva marad 0"`)
  })
})

// The route: the warning rides on the move response, the closing still happens.
async function moveDone(id: string) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ status: 'done', actor: 'sirius' }))]), {
    method: 'POST', headers: {},
  }) as unknown as http.IncomingMessage
  let status = 200
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string) { if (data) chunk = data },
  } as unknown as http.ServerResponse
  const path = `/api/kanban/${id}/move`
  const handled = await tryHandleKanban({ req, res, path, method: 'POST', url: new URL('http://x' + path) } as never)
  expect(handled).toBe(true)
  return { status, payload: JSON.parse(chunk) }
}

describe('POST /api/kanban/:id/move to done carries the prose-leftover warning', () => {
  beforeEach(() => {
    initDatabase(':memory:')
  })
  const card = (id: string) => {
    createKanbanCard({ id, title: 'Kartya', status: 'planned' })
    moveKanbanCard(id, 'testing', 0, 'dexter')
  }

  it('a prose leftover without a carrier: 200, the card is done, the warning quotes the line', async () => {
    card('m1')
    addKanbanComment('m1', 'ford', 'Kesz.\nNyitva marad. Dexter dontse el.')
    const { status, payload } = await moveDone('m1')
    expect(status).toBe(200)
    expect(payload.changed).toBe(true)
    expect(payload.warning).toContain('Nyitva marad. Dexter dontse el.')
    expect(getKanbanCard('m1')?.status).toBe('done')
  })

  it('a carrier card named in the comment: no warning', async () => {
    card('m2')
    createKanbanCard({ id: 'cafe0001', title: 'Hordozo', status: 'planned' })
    addKanbanComment('m2', 'ford', 'Nyitva marad, hordozo: cafe0001')
    const { payload } = await moveDone('m2')
    expect(payload.warning).toBeUndefined()
    expect(getKanbanCard('m2')?.status).toBe('done')
  })

  it('a card with no such line: the response is exactly as before', async () => {
    card('m3')
    addKanbanComment('m3', 'ford', 'Minden kesz.')
    const { payload } = await moveDone('m3')
    expect(payload).toEqual({ ok: true, changed: true })
  })
})
