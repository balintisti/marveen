// A KARTYA CSAK IGAZOLASSAL MEHET DONE-BA -- kartya 3c7be3c4.
//
// Isti (Telegram 5697, 2026-10-07): done CSAK "KESZ-IGAZOLAS: <fajta>" kommenttel.
// 2026-10-17-en a 29f0cd5c igazolas nelkul ment done-ba (move 200), mert a kapu
// csak a nyitott verdiktet nezte. Az esetek: pozitiv kontroll (nincs sor -> 409,
// a hiba megnevezi az ot fajtat), negativ (van sor -> 200), az olvasas szabalya
// (0. oszlop, sajat belyeg, ekezet, ismeretlen fajta, idezet), az override nem
// helyettesiti, mindket done-ut (move, PUT), a done-kent letrehozas, es hogy az
// archivalas nem kapja meg ezt a feltetelt.
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, addKanbanComment, getKanbanCard, getKanbanComments, moveKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import { hasDoneProof } from '../web/kanban-verdict-gate.js'

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

const proofOn = (id: string, author: string, content: string) => {
  addKanbanComment(id, author, content)
  return hasDoneProof(getKanbanComments(id))
}

describe('az olvasas: 0. oszlop, az ot fajta, ekezet nelkul, kis-nagybetu marad', () => {
  it.each(['ELES', 'ATADVA', 'DONTES', 'DOKUMENTUM', 'TARGYTALAN'])('a %s fajta igazolas', (kind) => {
    cardInTesting('k')
    expect(proofOn('k', 'friday', `Kesz.\nKESZ-IGAZOLAS: ${kind} | merve: a futo build tartalmazza`)).toBe(true)
  })

  it('pozitiv kontroll: igazolas-sor nelkul nincs igazolas', () => {
    cardInTesting('n')
    expect(proofOn('n', 'friday', 'Kesz, a teszt zold.\nVERDIKT: NINCS NYITOTT TETEL')).toBe(false)
  })

  it('az ekezetes alak ugyanaz: "KÉSZ-IGAZOLÁS: TÁRGYTALAN" (egyszer szerepel a tablan)', () => {
    cardInTesting('a')
    expect(proofOn('a', 'marveen', 'KÉSZ-IGAZOLÁS: TÁRGYTALAN (marveen dontese)')).toBe(true)
  })

  it('a szerzo sajat belyege levesz, a masike nem', () => {
    cardInTesting('s1')
    expect(proofOn('s1', 'didi', '[didi, 2026-10-20 11:20 CEST, date] KESZ-IGAZOLAS: ELES | f2ea84df0')).toBe(true)
    cardInTesting('s2')
    expect(proofOn('s2', 'marveen', '[didi, 2026-10-20 11:20 CEST, date] KESZ-IGAZOLAS: ELES | f2ea84df0')).toBe(false)
  })

  it('az idezett, a behuzott es a mondat kozepi sor nem igazolas', () => {
    cardInTesting('q')
    expect(proofOn('q', 'marveen', '> KESZ-IGAZOLAS: ELES\n    KESZ-IGAZOLAS: ELES\nHelyesbites az elozo KESZ-IGAZOLAS: ELES sorhoz')).toBe(false)
  })

  it('ismeretlen fajta, hianyzo fajta, kisbetu es osszeragadt szo nem igazolas', () => {
    cardInTesting('u')
    expect(proofOn('u', 'friday', 'KESZ-IGAZOLAS: fajl (grep -n)\nKESZ-IGAZOLAS:\nkesz-igazolas: ELES\nKESZ-IGAZOLAS: ELESBEN')).toBe(false)
  })
})

describe('a kapu: mindket done-ut, az override es a letrehozas', () => {
  it('pozitiv kontroll: move done-ba igazolas nelkul -> 409, a kartya marad, a hiba megnevezi az ot fajtat', async () => {
    cardInTesting('m1')
    const r = await call('POST', '/api/kanban/m1/move', { status: 'done', actor: 'friday' })
    expect(r.status).toBe(409)
    expect(r.payload.missing_proof).toBe(true)
    expect(r.payload.error).toContain('KESZ-IGAZOLAS: <ELES|ATADVA|DONTES|DOKUMENTUM|TARGYTALAN>')
    expect(getKanbanCard('m1')?.status).toBe('testing')
  })

  it('igazolassal a move atmegy', async () => {
    cardInTesting('m2')
    addKanbanComment('m2', 'friday', 'KESZ-IGAZOLAS: ELES | a futo build fe17ef694')
    const r = await call('POST', '/api/kanban/m2/move', { status: 'done', actor: 'friday' })
    expect(r.status).toBe(200)
    expect(getKanbanCard('m2')?.status).toBe('done')
  })

  it('az override_reason nem helyettesiti az igazolast', async () => {
    cardInTesting('m3')
    const r = await call('POST', '/api/kanban/m3/move', {
      status: 'done', actor: 'marveen', override_reason: 'Isti szolt, hogy kesz',
    })
    expect(r.status).toBe(409)
    expect(getKanbanCard('m3')?.status).toBe('testing')
  })

  it('a hianyzo igazolas mellett a nyitott verdiktet is megnevezi, egy valaszban', async () => {
    cardInTesting('m4')
    addKanbanComment('m4', 'didi', 'VERDIKT: NYITOTT TETEL | a mobil ag')
    const r = await call('POST', '/api/kanban/m4/move', { status: 'done', actor: 'friday' })
    expect(r.status).toBe(409)
    expect(r.payload.missing_proof).toBe(true)
    expect(r.payload.open_verdicts.map((v: { author: string }) => v.author)).toEqual(['didi'])
    expect(r.payload.error).toContain('didi')
  })

  it('a PUT status=done ugyanugy 409 igazolas nelkul, es atmegy vele', async () => {
    cardInTesting('u1')
    expect((await call('PUT', '/api/kanban/u1', { status: 'done', actor: 'friday' })).status).toBe(409)
    expect(getKanbanCard('u1')?.status).toBe('testing')
    addKanbanComment('u1', 'friday', 'KESZ-IGAZOLAS: DOKUMENTUM | rulebook/x.md @abc1234')
    expect((await call('PUT', '/api/kanban/u1', { status: 'done', actor: 'friday' })).status).toBe(200)
    expect(getKanbanCard('u1')?.status).toBe('done')
  })

  it('egy mar done kartya szerkesztese nem zaras: igazolas nelkul is atmegy', async () => {
    cardInTesting('u2')
    moveKanbanCard('u2', 'done', 0, 'marveen')
    const r = await call('PUT', '/api/kanban/u2', { status: 'done', title: 'Uj cim', actor: 'marveen' })
    expect(r.status).toBe(200)
  })

  it('done statusszal letrehozni nem lehet; mas statusszal igen', async () => {
    const r = await call('POST', '/api/kanban', { title: 'Kesz munka', status: 'done', actor: 'friday' })
    expect(r.status).toBe(409)
    expect(r.payload.missing_proof).toBe(true)
    expect(r.payload.error).toContain('mas statusszal')
    expect((await call('POST', '/api/kanban', { title: 'Kesz munka', status: 'planned', actor: 'friday' })).status).toBe(200)
  })

  it('az archivalas nem kap igazolas-feltetelt (nem allitja, hogy kesz)', async () => {
    cardInTesting('ar')
    const r = await call('POST', '/api/kanban/ar/archive', { actor: 'friday', reason: 'duplikatum' })
    expect(r.status).toBe(200)
  })
})
