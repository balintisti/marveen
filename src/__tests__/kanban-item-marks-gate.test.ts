// TOBB-TETELES KARTYA CSAK TETELENKENTI JELOLESSEL MEHET DONE-BA -- kartya bb9f4673.
//
// didi 57211 (2026-11-09): kilenc SEC/LOW kotegkartya kesz lett, mikozben 47 tetelbol
// 23 nem/reszben/eldonthetetlen; a 60795c0c a 10 tetelebol 2-nek az igazolasaval zarult.
// marveen dontese: a tobb-teteles kartya done-ja csak akkor, ha MINDEN tetel jelolve:
// JAVITVA <commit> / HAMIS <indok> / ATKERULT <kartya-id>. Az esetek: a pozitiv
// kontroll (a 734a53b6 alakja, 1/5 jelolve -> 409), a negativ (egy tetel, cim nelkuli
// szamozott leiras -> 200), az olvasas szabalya (0. oszlop, sajat belyeg, ekezet, lista,
// tartomany, a harom jeloles bizonyiteka), mindket done-ut, az override, es a PUT, ami
// egy hivasban nevez at es zar.
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, addKanbanComment, getKanbanCard, getKanbanComments, moveKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import { itemMarkState, declaredItemCount } from '../kanban-verdict.js'

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

const BATCH_TITLE = 'SEC/LOW köteg (48365fbf 4. kör): 5 tétel'
const PROOF = 'KESZ-IGAZOLAS: ELES | a futo kep f2ea84df09'

function cardInTesting(id: string, title: string, description = '') {
  createKanbanCard({ id, title, description, status: 'planned' })
  moveKanbanCard(id, 'testing', 0, 'friday')
}

const state = (id: string) => itemMarkState(getKanbanCard(id)?.title, getKanbanComments(id), id, (c) => !!getKanbanCard(c))

describe('melyik kartya tobb-teteles: a cim "<N> tetel", N >= 2', () => {
  it.each([
    [BATCH_TITLE, 5],
    ['Alacsony leletek a 9bc6a506a0 diff-körből (4 tétel, egy kártyán)', 4],
    ['SWEEP/LOW: workflow-lépések, 3 tétel: a random kiosztás', 3],
    ['Koteg: 6 teteles lista', 6],
  ])('"%s" -> %i', (title, n) => {
    expect(declaredItemCount(title)).toBe(n)
  })

  it.each([
    'SEC/LOW köteg (48365fbf, files-email): 1 tétel, modell-megerősített',
    'MERVE 09-24: 1/14 TETEL = 1 AG NYITOTT',
    'hat alagensnek 13-24 tetele van',
    'A checklist-tetel KEMENY torlese',
    '5 tetelszam',
    '',
  ])('nem jelent be listat: "%s"', (title) => {
    expect(declaredItemCount(title)).toBeNull()
  })
})

describe('az olvasas: 0. oszlop, sajat belyeg, ekezet, lista, tartomany', () => {
  it('a harom jeloles a bizonyitekaval mind zar', () => {
    createKanbanCard({ id: 'aaaa1111', title: 'A tetelt vivo kartya', status: 'planned' })
    cardInTesting('k1', 'Koteg: 3 tetel')
    addKanbanComment('k1', 'dexter', 'TETEL 1: JAVITVA 5b15d97916 (notificationTarget.ts)\nTETEL 2: HAMIS a kod nem erheto el kivulrol')
    addKanbanComment('k1', 'didi', 'TETEL 3: ATKERULT aaaa1111')
    expect(state('k1')).toEqual({ declared: 3, missing: [], invalid: [] })
  })

  it('lista es tartomany egy sorban; a hianyzo tetelek novekvo sorrendben', () => {
    cardInTesting('k2', 'Koteg: 7 tetel')
    addKanbanComment('k2', 'dexter', 'TETEL 1, 3: JAVITVA abc1234\nTETEL 5-6: HAMIS nem valodi lelet')
    expect(state('k2')!.missing).toEqual([2, 4, 7])
  })

  it('ekezetes alak ugyanaz, a szerzo sajat belyege levesz, a masike nem', () => {
    cardInTesting('k3', 'Koteg: 3 tetel')
    addKanbanComment('k3', 'dexter', 'TÉTEL 1: JAVÍTVA abc1234')
    addKanbanComment('k3', 'didi', '[didi, 2026-11-12 04:00 CET, date] TETEL 2: HAMIS ismetles')
    addKanbanComment('k3', 'marveen', '[didi, 2026-11-12 04:00 CET, date] TETEL 3: HAMIS ismetles')
    expect(state('k3')!.missing).toEqual([3])
  })

  it('az idezett, behuzott, kisbetus es mondat kozepi sor nem jeloles, es nem is hiba', () => {
    cardInTesting('k4', 'Koteg: 2 tetel')
    addKanbanComment('k4', 'dexter', '> TETEL 1: JAVITVA abc1234\n  TETEL 1: JAVITVA abc1234\ntetel 1: JAVITVA abc1234\nA TETEL 2: HAMIS indok')
    expect(state('k4')).toEqual({ declared: 2, missing: [1, 2], invalid: [] })
  })

  it('a bizonyitek nelkuli jeloles nem szamit, es az ok megnevezve', () => {
    createKanbanCard({ id: 'bbbb2222', title: 'Masik', status: 'planned' })
    cardInTesting('cccc3333', 'Koteg: 6 tetel')
    addKanbanComment('cccc3333', 'dexter', [
      'TETEL 1: JAVITVA kesz van', // nincs sha
      'TETEL 2: HAMIS', // nincs indok
      'TETEL 3: ATKERULT dddd4444', // nem letezo kartya
      'TETEL 4: ATKERULT cccc3333', // a sajat kartya nem viszi a sajat tetelet
      'TETEL 5: NYITOTT meg dolgozom rajta', // ismeretlen jeloles
      'TETEL 7: JAVITVA abc1234', // nincs ilyen tetel
      'TETEL 6: ATKERULT bbbb2222 (a letezo)',
    ].join('\n'))
    const s = state('cccc3333')!
    expect(s.missing).toEqual([1, 2, 3, 4, 5])
    expect(s.invalid.map((i) => i.why)).toEqual([
      'a JAVITVA utan nincs commit-sha (7-40 hexa)',
      'a HAMIS utan nincs indok',
      'az ATKERULT utan nincs letezo, masik kartya azonositoja',
      'az ATKERULT utan nincs letezo, masik kartya azonositoja',
      'ismeretlen jeloles "NYITOTT" (JAVITVA | HAMIS | ATKERULT)',
      '"7" nincs a cim 1..6 tetele kozott',
    ])
  })

  it('a rossz tetelszam-alak nem jeloles', () => {
    cardInTesting('k6', 'Koteg: 4 tetel')
    addKanbanComment('k6', 'dexter', 'TETEL 3a: JAVITVA abc1234\nTETEL 4-2: HAMIS forditott\nTETEL 0: HAMIS nulla')
    const s = state('k6')!
    expect(s.missing).toEqual([1, 2, 3, 4])
    expect(s.invalid).toHaveLength(3)
  })
})

describe('a kapu: mindket done-ut, az override, a cim', () => {
  it('pozitiv kontroll: a 734a53b6 mai alakja (5 tetel, 1 jelolve, van igazolas) -> 409, a kartya marad', async () => {
    cardInTesting('m1', BATCH_TITLE, '1) admin-tenant #1 ... 2) calendar-mail #2 ... 5) tasks #1 ...')
    addKanbanComment('m1', 'jarvis', 'TETEL 4: JAVITVA 5b15d97916')
    addKanbanComment('m1', 'friday', PROOF)
    const r = await call('POST', '/api/kanban/m1/move', { status: 'done', actor: 'friday' })
    expect(r.status).toBe(409)
    expect(r.payload.unmarked_items).toEqual([1, 2, 3, 5])
    expect(r.payload.declared_items).toBe(5)
    expect(r.payload.missing_proof).toBe(false)
    expect(r.payload.error).toContain('5 tetelt jelent be, es 4 nincs jelolve (1, 2, 3, 5)')
    expect(r.payload.error).toContain('TETEL <szam>: <JAVITVA|HAMIS|ATKERULT>')
    expect(getKanbanCard('m1')?.status).toBe('testing')
  })

  it('minden tetel jelolve + igazolas -> a move atmegy', async () => {
    cardInTesting('m2', BATCH_TITLE)
    addKanbanComment('m2', 'jarvis', 'TETEL 4: JAVITVA 5b15d97916\nTETEL 1-3, 5: HAMIS a modell-lelet kodolvasassal nem all meg')
    addKanbanComment('m2', 'friday', PROOF)
    const r = await call('POST', '/api/kanban/m2/move', { status: 'done', actor: 'friday' })
    expect(r.status).toBe(200)
    expect(getKanbanCard('m2')?.status).toBe('done')
  })

  it('negativ kontroll: egy-teteles cim es cim nelkuli szamozott leiras nem akad meg', async () => {
    cardInTesting('n1', 'SEC/LOW köteg (48365fbf, files-email): 1 tétel')
    cardInTesting('n2', 'Lepesek', 'TEENDO:\n1. a kapu\n2. a triazs\n3. a dokumentacio')
    for (const id of ['n1', 'n2']) {
      addKanbanComment(id, 'friday', PROOF)
      expect((await call('POST', `/api/kanban/${id}/move`, { status: 'done', actor: 'friday' })).status).toBe(200)
    }
  })

  it('az override_reason nem helyettesiti a jelolest', async () => {
    cardInTesting('m3', BATCH_TITLE)
    addKanbanComment('m3', 'friday', PROOF)
    const r = await call('POST', '/api/kanban/m3/move', {
      status: 'done', actor: 'marveen', override_reason: 'a tobbi tetel mashol el',
    })
    expect(r.status).toBe(409)
    expect(getKanbanCard('m3')?.status).toBe('testing')
  })

  it('egy valaszban: a jeloletlen tetel, a hianyzo igazolas, a nyitott verdikt es az ervenytelen jeloles', async () => {
    cardInTesting('m4', 'Koteg: 2 tetel')
    addKanbanComment('m4', 'didi', 'VERDIKT: NYITOTT TETEL | a 2. tetel')
    addKanbanComment('m4', 'dexter', 'TETEL 1: JAVITVA kesz')
    const r = await call('POST', '/api/kanban/m4/move', { status: 'done', actor: 'friday' })
    expect(r.status).toBe(409)
    expect(r.payload.unmarked_items).toEqual([1, 2])
    expect(r.payload.missing_proof).toBe(true)
    expect(r.payload.open_verdicts.map((v: { author: string }) => v.author)).toEqual(['didi'])
    expect(r.payload.invalid_item_marks).toHaveLength(1)
    expect(r.payload.error).toContain('KESZ-IGAZOLAS')
    expect(r.payload.error).toContain('didi')
    expect(r.payload.error).toContain('"TETEL 1: JAVITVA kesz" (a JAVITVA utan nincs commit-sha (7-40 hexa))')
  })

  it('jelolve, de igazolas nelkul: a KESZ-IGAZOLAS kapu valasza, valtozatlanul', async () => {
    cardInTesting('m5', 'Koteg: 2 tetel')
    addKanbanComment('m5', 'dexter', 'TETEL 1-2: JAVITVA abc1234')
    const r = await call('POST', '/api/kanban/m5/move', { status: 'done', actor: 'friday' })
    expect(r.status).toBe(409)
    expect(r.payload.missing_proof).toBe(true)
    expect(r.payload.unmarked_items).toBeUndefined()
  })

  it('a PUT status=done ugyanugy 409 jeloles nelkul, es atmegy vele', async () => {
    cardInTesting('u1', 'Koteg: 2 tetel')
    addKanbanComment('u1', 'friday', PROOF)
    expect((await call('PUT', '/api/kanban/u1', { status: 'done', actor: 'friday' })).status).toBe(409)
    expect(getKanbanCard('u1')?.status).toBe('testing')
    addKanbanComment('u1', 'dexter', 'TETEL 1-2: HAMIS ugyanaz a hiba, mint a 0952012b-n')
    expect((await call('PUT', '/api/kanban/u1', { status: 'done', actor: 'friday' })).status).toBe(200)
    expect(getKanbanCard('u1')?.status).toBe('done')
  })

  it('a PUT, ami egy hivasban nevez at es zar, az UJ cimen olvasodik', async () => {
    cardInTesting('u2', 'Egy hiba')
    addKanbanComment('u2', 'friday', PROOF)
    const r = await call('PUT', '/api/kanban/u2', { status: 'done', title: 'Koteg: 3 tetel', actor: 'friday' })
    expect(r.status).toBe(409)
    expect(r.payload.unmarked_items).toEqual([1, 2, 3])
    expect(getKanbanCard('u2')?.status).toBe('testing')
    cardInTesting('u3', 'Koteg: 3 tetel')
    addKanbanComment('u3', 'friday', PROOF)
    expect((await call('PUT', '/api/kanban/u3', { status: 'done', title: 'Egy hiba', actor: 'friday' })).status).toBe(200)
  })

  it('egy mar done kartya szerkesztese nem zaras: jeloles nelkul is atmegy', async () => {
    cardInTesting('u4', 'Koteg: 2 tetel')
    moveKanbanCard('u4', 'done', 0, 'marveen')
    expect((await call('PUT', '/api/kanban/u4', { status: 'done', description: 'x', actor: 'marveen' })).status).toBe(200)
  })

  it('az archivalas nem kap jeloles-feltetelt (nem allitja, hogy kesz)', async () => {
    cardInTesting('ar', 'Koteg: 2 tetel')
    expect((await call('POST', '/api/kanban/ar/archive', { actor: 'friday', reason: 'duplikatum' })).status).toBe(200)
  })
})
