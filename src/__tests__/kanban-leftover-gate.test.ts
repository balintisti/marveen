// A KARTYA NEM ZARHATO LE NYITOTT MARADEK FOLOTT -- kartya 0a787690, Isti 5654.
//
// Merve 2026-10-07 08:56: harom done kartyan proza "MARADEK-JELZES" komment allt,
// a lezaras atment, a maradek az archivumba kerult. A masodik ZART token
// (`MARADEK: <mi> | <hol>`, 0. oszlop) ugyanabban a parserben: a lezaras csak
// akkor megy, ha UGYANAZ a szerzo kesobb `MARADEK: NINCS | <hova kerult>`-t ir,
// vagy van override_reason. Szabaly tobb sorra: EGY NINCS zarja a szerzo MINDEN
// korabbi maradekat (a VERDIKT "szerzonkent az utolso" szemantikaja), de a hely
// (a `|` utan) kotelezo.
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import {
  initDatabase, createKanbanCard, addKanbanComment, getKanbanCard, getKanbanComments,
  getKanbanCardFieldEvents, moveKanbanCard, getDb, sweepArchivedKanbanCards,
} from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import { openLeftovers, openVerdicts, closeRefusal } from '../web/kanban-verdict-gate.js'

beforeEach(() => {
  initDatabase(':memory:')
})

async function call(method: 'POST' | 'PUT', path: string, body?: unknown) {
  const payloadIn = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Object.assign(Readable.from(payloadIn), { method, headers: {} }) as unknown as http.IncomingMessage
  let status = 200
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string) { if (data) chunk = data },
  } as unknown as http.ServerResponse
  const handled = await tryHandleKanban({
    req, res, path, method, url: new URL('http://x' + path),
  } as never)
  expect(handled, `a route nem kezelte: ${method} ${path}`).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

function cardInTesting(id: string) {
  createKanbanCard({ id, title: 'Kartya', status: 'planned' })
  moveKanbanCard(id, 'testing', 0, 'friday')
}

const LEFTOVER = 'MARADEK: a mobil ag tesztje | uj kartya kell'
const NONE = 'MARADEK: NINCS | a 3527b675 kartyara kerult'
const move = (id: string, extra: object = {}) =>
  call('POST', `/api/kanban/${id}/move`, { status: 'done', actor: 'jarvis', ...extra })

describe('a parser: MARADEK sor, 0. oszlop, szerzonkent', () => {
  it('pozitiv kontroll: egy MARADEK sor nyitott, a komment-id-val es a szerzovel', () => {
    cardInTesting('p1')
    addKanbanComment('p1', 'friday', `Kesz.\n${LEFTOVER}`)
    const open = openLeftovers(getKanbanComments('p1'))
    expect(open).toEqual([expect.objectContaining({ author: 'friday', line: LEFTOVER })])
    expect(open[0].commentId).toBeGreaterThan(0)
  })

  it('ugyanannak a szerzonek a kesobbi NINCS | hely sora lezarja', () => {
    cardInTesting('p2')
    addKanbanComment('p2', 'friday', LEFTOVER)
    addKanbanComment('p2', 'friday', NONE)
    expect(openLeftovers(getKanbanComments('p2'))).toEqual([])
  })

  it('MASIK szerzo NINCS-e NEM zarja le', () => {
    cardInTesting('p3')
    addKanbanComment('p3', 'friday', LEFTOVER)
    addKanbanComment('p3', 'didi', NONE)
    expect(openLeftovers(getKanbanComments('p3')).map((l) => l.author)).toEqual(['friday'])
  })

  it('a NINCS KORABBI, mint a maradek: nem zar semmit', () => {
    cardInTesting('p4')
    addKanbanComment('p4', 'friday', NONE)
    addKanbanComment('p4', 'friday', LEFTOVER)
    expect(openLeftovers(getKanbanComments('p4'))).toHaveLength(1)
  })

  it('tobb MARADEK sor: mind nyitott, EGY sajat NINCS mindet zarja', () => {
    cardInTesting('p5')
    addKanbanComment('p5', 'friday', 'MARADEK: egy | x\nMARADEK: ketto | y')
    addKanbanComment('p5', 'friday', 'MARADEK: harom | z')
    expect(openLeftovers(getKanbanComments('p5'))).toHaveLength(3)
    addKanbanComment('p5', 'friday', NONE)
    expect(openLeftovers(getKanbanComments('p5'))).toEqual([])
  })

  it('NINCS hely nelkul NEM zar (a maradek nyom nelkul tunne el)', () => {
    cardInTesting('p6')
    addKanbanComment('p6', 'friday', LEFTOVER)
    addKanbanComment('p6', 'friday', 'MARADEK: NINCS')
    addKanbanComment('p6', 'friday', 'MARADEK: NINCS |   ')
    expect(openLeftovers(getKanbanComments('p6'))).toHaveLength(3)
  })

  it('az ekezetes/kisbetus NINCS ugyanaz a token, es a " -- " elvalaszto is jo', () => {
    cardInTesting('p7')
    addKanbanComment('p7', 'friday', LEFTOVER)
    addKanbanComment('p7', 'friday', 'MARADEK:  nincs -- a 3527b675-re kerult')
    expect(openLeftovers(getKanbanComments('p7'))).toEqual([])
  })

  it('PROZA nem token: "MARADEK-JELZES", sor kozepi "maradek:", behuzott es idezett sor', () => {
    cardInTesting('n1')
    addKanbanComment('n1', 'friday', [
      'MARADEK-JELZES: a mobil ag tesztje hianyzik',
      'A maradek: a mobil ag',
      'Lasd meg MARADEK: a mobil ag | itt',
      '    MARADEK: behuzott | x',
      '> MARADEK: idezett | x',
      'maradek: kisbetus | x',
      'MARADEK a mobil ag',
    ].join('\n'))
    expect(openLeftovers(getKanbanComments('n1'))).toEqual([])
  })

  it('a magyar helyesirasu NAGYBETUS "MARADÉK:" ugyanaz a token (didi 31731): nyit, es a hely a sorban marad ahogy irtak', () => {
    cardInTesting('a1')
    addKanbanComment('a1', 'friday', 'MARADÉK: e2e | dexter')
    expect(openLeftovers(getKanbanComments('a1'))).toEqual([
      expect.objectContaining({ author: 'friday', line: 'MARADÉK: e2e | dexter' }),
    ])
  })

  it('a "MARADÉK: NINCS | x" zarja a korabbi "MARADEK:" sort, es forditva is', () => {
    cardInTesting('a2')
    addKanbanComment('a2', 'friday', LEFTOVER)
    addKanbanComment('a2', 'friday', 'MARADÉK: NINCS | a 3527b675-re kerult')
    expect(openLeftovers(getKanbanComments('a2'))).toEqual([])

    cardInTesting('a3')
    addKanbanComment('a3', 'friday', 'MARADÉK: e2e | dexter')
    addKanbanComment('a3', 'friday', NONE)
    expect(openLeftovers(getKanbanComments('a3'))).toEqual([])
  })

  it('a "MARADÉK: NINCS" hely nelkul itt sem zar, es a bontott (E + kombinalo ekezet) alak is token', () => {
    cardInTesting('a4')
    addKanbanComment('a4', 'friday', 'MARADÉK: e2e | dexter')
    addKanbanComment('a4', 'friday', 'MARADÉK: NINCS')
    addKanbanComment('a4', 'friday', 'MARADE\u0301K: bontott | x')
    expect(openLeftovers(getKanbanComments('a4'))).toHaveLength(3)
  })

  it('a kisbetus/vegyes "Maradék: x | y" es a bold "**MARADEK:**" tovabbra sem token', () => {
    cardInTesting('a5')
    addKanbanComment('a5', 'friday', [
      'Maradék: x | y',
      'maradék: x | y',
      'MARADéK: x | y',
      '**MARADEK:** x | y',
      '**MARADÉK:** x | y',
    ].join('\n'))
    expect(openLeftovers(getKanbanComments('a5'))).toEqual([])
  })

  it('a ket token fuggetlen: a VERDIKT nem lat MARADEK-ot, a MARADEK nem lat VERDIKT-et', () => {
    cardInTesting('n2')
    addKanbanComment('n2', 'didi', 'VERDIKT: NYITOTT TETEL | valami')
    addKanbanComment('n2', 'friday', LEFTOVER)
    expect(openVerdicts(getKanbanComments('n2')).map((v) => v.author)).toEqual(['didi'])
    expect(openLeftovers(getKanbanComments('n2')).map((v) => v.author)).toEqual(['friday'])
  })
})

describe('a lezaro utak', () => {
  it('POST /move done: nyitott MARADEK -> 409, a kartya marad, a hiba megnevezi a sort, a szerzot, a komment-id-t es a kiutat', async () => {
    cardInTesting('m1')
    const c = addKanbanComment('m1', 'friday', LEFTOVER)

    const r = await move('m1')

    expect(r.status).toBe(409)
    expect(r.payload.open_leftovers).toEqual([
      expect.objectContaining({ author: 'friday', line: LEFTOVER, commentId: c.id }),
    ])
    expect(r.payload.error).toContain(LEFTOVER)
    expect(r.payload.error).toContain('friday')
    expect(r.payload.error).toContain(`komment ${c.id}`)
    expect(r.payload.error).toContain('MARADEK: NINCS | <hova kerult>')
    expect(r.payload.error).toContain('override_reason')
    expect(getKanbanCard('m1')?.status).toBe('testing')
  })

  it('POST /move done: a "MARADÉK:" sor is 409, a hiba a sort ahogy irtak idezi; a "MARADÉK: NINCS | x" utan megy', async () => {
    cardInTesting('m0')
    addKanbanComment('m0', 'friday', 'MARADÉK: e2e | dexter')
    const r = await move('m0')
    expect(r.status).toBe(409)
    expect(r.payload.error).toContain('MARADÉK: e2e | dexter')
    addKanbanComment('m0', 'friday', 'MARADÉK: NINCS | a 3527b675 kartyara kerult')
    expect((await move('m0')).status).toBe(200)
  })

  it('a szerzo sajat NINCS-e utan a lezaras megy', async () => {
    cardInTesting('m2')
    addKanbanComment('m2', 'friday', LEFTOVER)
    addKanbanComment('m2', 'friday', NONE)

    const r = await move('m2')

    expect(r.status).toBe(200)
    expect(getKanbanCard('m2')?.status).toBe('done')
  })

  it('MASIK szerzo NINCS-e utan a lezaras tovabbra is 409', async () => {
    cardInTesting('m3')
    addKanbanComment('m3', 'friday', LEFTOVER)
    addKanbanComment('m3', 'jarvis', NONE)

    const r = await move('m3')

    expect(r.status).toBe(409)
    expect(getKanbanCard('m3')?.status).toBe('testing')
  })

  it('override_reason-nel a lezaras megy, es az indok + a nyitott sor a kartya tortenetebe kerul', async () => {
    cardInTesting('m4')
    addKanbanComment('m4', 'friday', LEFTOVER)

    const r = await move('m4', { actor: 'marveen', override_reason: 'Isti: kulon kartyan fut' })

    expect(r.status).toBe(200)
    expect(getKanbanCard('m4')?.status).toBe('done')
    const ev = getKanbanCardFieldEvents('m4').filter((e) => e.field === 'close_override')
    expect(ev).toHaveLength(1)
    expect(ev[0].to_value).toBe('Isti: kulon kartyan fut')
    expect(JSON.parse(ev[0].from_value ?? '[]')).toEqual([{ author: 'friday', line: LEFTOVER }])
  })

  it('egy ures indok NEM indok', async () => {
    cardInTesting('m5')
    addKanbanComment('m5', 'friday', LEFTOVER)
    expect((await move('m5', { override_reason: '  ' })).status).toBe(409)
  })

  it('KONTROLL: proza "MARADEK-JELZES" kommenttel a lezaras megy (nem detektor)', async () => {
    cardInTesting('m6')
    addKanbanComment('m6', 'friday', 'MARADEK-JELZES: a mobil ag tesztje hianyzik\nA maradek: lasd fent')
    expect((await move('m6')).status).toBe(200)
  })

  it('PUT status: done es POST /archive -- ugyanaz a kapu', async () => {
    cardInTesting('u1')
    addKanbanComment('u1', 'friday', LEFTOVER)
    expect((await call('PUT', '/api/kanban/u1', { status: 'done', actor: 'jarvis' })).status).toBe(409)
    expect(getKanbanCard('u1')?.status).toBe('testing')
    expect((await call('POST', '/api/kanban/u1/archive', { actor: 'jarvis' })).status).toBe(409)
    expect(getKanbanCard('u1')?.archived_at ?? null).toBeNull()
  })

  it('nem a done-ba mozgatas nem kapu', async () => {
    cardInTesting('u2')
    addKanbanComment('u2', 'friday', LEFTOVER)
    expect((await call('POST', '/api/kanban/u2/move', { status: 'in_progress', actor: 'friday' })).status).toBe(200)
  })

  it('VERDIKT + MARADEK egyutt: a 409 mindkettot megnevezi, a VERDIKT-ag valtozatlan', async () => {
    cardInTesting('b1')
    addKanbanComment('b1', 'didi', 'VERDIKT: NYITOTT TETEL | a mobil ag')
    addKanbanComment('b1', 'friday', LEFTOVER)
    const r = await move('b1')
    expect(r.status).toBe(409)
    expect(r.payload.open_verdicts).toHaveLength(1)
    expect(r.payload.open_leftovers).toHaveLength(1)
    // a MARADEK lezarasa a VERDIKT-et nem zarja
    addKanbanComment('b1', 'friday', NONE)
    const r2 = await move('b1')
    expect(r2.status).toBe(409)
    expect(r2.payload.open_leftovers).toEqual([])
    expect(r2.payload.error).not.toContain('MARADEK-sor')
  })

  it('csak VERDIKT: a hiba-torzs a regi ag, uj mezo ures', () => {
    const body = closeRefusal([{ author: 'didi', line: 'VERDIKT: NYITOTT TETEL | x', commentId: 1 }])
    expect(body.open_leftovers).toEqual([])
    expect(body.error).toContain('NYITOTT TETEL')
  })
})

describe('az oras archivalo is latja', () => {
  it('a nyitott MARADEK-es done kartya a TABLAN marad, a lezart archivalodik', () => {
    for (const id of ['k-open', 'k-clean']) {
      cardInTesting(id)
      moveKanbanCard(id, 'done', 0, 'marveen')
    }
    addKanbanComment('k-open', 'friday', LEFTOVER)
    getDb().prepare('UPDATE kanban_cards SET updated_at = 1000').run()

    expect(sweepArchivedKanbanCards()).toBe(1)
    expect(getKanbanCard('k-open')?.archived_at ?? null).toBeNull()
    expect(getKanbanCard('k-clean')?.archived_at).not.toBeNull()
  })
})
