// A KARTYA NEM ZARHATO LE NYITOTT VERDIKT FOLOTT -- kartya 5a967042.
//
// Isti (Telegram 4449): "hogy csuszhat at? Nem szabad atcsusznia." Merve
// 2026-09-29: 323 lezarasbol ketto nyitott tetel folott tortent, mert az
// ellenorzes a zaro OLVASASAN mult, es a zaro a kartya UTOLSO verdiktjet
// olvasta, nem szerzonkent az utolsot.
//
// Az esetek a kartya teszt-listaja: pozitiv kontroll (NYITOTT -> 409), negativ
// (NINCS -> 200), ket szerzo (egyik NYITOTT -> 409), az idezett es a behuzott
// verdikt-sor nem szamit -- plusz az override utja, es mindharom zaro ut
// (move, PUT, archive), mert egy kapu, ami csak az egyiken all, nem kapu.
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import {
  initDatabase, createKanbanCard, addKanbanComment, getKanbanCard, getKanbanComments,
  getKanbanCardFieldEvents, moveKanbanCard, getDb, sweepArchivedKanbanCards,
} from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import { openVerdicts } from '../web/kanban-verdict-gate.js'

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
  moveKanbanCard(id, 'testing', 0, 'dexter')
}

const OPEN = 'VERDIKT: NYITOTT TETEL | a mobil ag meg nincs lefedve'
const CLOSED = 'VERDIKT: NINCS NYITOTT TETEL | a sajat ellenorzesemre'

describe('a parser: szerzonkent az utolso, 0. oszlop, token a pipe elott', () => {
  it('pozitiv kontroll: egy NYITOTT verdikt nyitott', () => {
    cardInTesting('p1')
    addKanbanComment('p1', 'didi', `Atnezes.\n${OPEN}`)
    expect(openVerdicts(getKanbanComments('p1')).map((v) => v.author)).toEqual(['didi'])
  })

  it('a NINCS NYITOTT TETEL nem nyitott -- a "tartalmazza-e a NYITOTT-at" olvasas itt bukna', () => {
    cardInTesting('p2')
    addKanbanComment('p2', 'didi', CLOSED)
    expect(openVerdicts(getKanbanComments('p2'))).toEqual([])
  })

  it('SZERZONKENT az utolso szamit, nem a kartyan: a masik szerzo kesobbi NINCS-e nem zarja le az elsot', () => {
    cardInTesting('p3')
    addKanbanComment('p3', 'computress', OPEN)
    addKanbanComment('p3', 'didi', CLOSED)
    expect(openVerdicts(getKanbanComments('p3')).map((v) => v.author)).toEqual(['computress'])
  })

  it('ugyanannak a szerzonek a kesobbi NINCS-e lezarja a sajat NYITOTT-jat', () => {
    cardInTesting('p4')
    addKanbanComment('p4', 'didi', OPEN)
    addKanbanComment('p4', 'didi', CLOSED)
    expect(openVerdicts(getKanbanComments('p4'))).toEqual([])
  })

  it('az idezett es a behuzott verdikt-sor NEM verdikt', () => {
    cardInTesting('p5')
    addKanbanComment('p5', 'marveen', `didi ezt irta:\n> ${OPEN}\n    ${OPEN}`)
    expect(openVerdicts(getKanbanComments('p5'))).toEqual([])
  })

  it('az ekezetes alak ugyanaz a token: "NYITOTT TÉTEL"', () => {
    cardInTesting('p6')
    addKanbanComment('p6', 'didi', 'VERDIKT: NYITOTT TÉTEL | ekezettel')
    expect(openVerdicts(getKanbanComments('p6'))).toHaveLength(1)
  })
})

// didi's audit (2026-09-29 19:5x, via the API): the author-last verdict of 17
// OPEN cards in the older form -- ` -- ` instead of `|`, some with a severity
// in parentheses. The first version of the gate matched the token exactly and
// let all 17 through. marveen's decision: the token ends at `|` OR ` -- `.
const LIVE_OLD_FORM = [
  "VERDIKT: NYITOTT TETEL -- valtozatlanul TERMEK-dontes (szandekos-e a browse nelkuli read-by-id); a \"nincs a ta",
  "VERDIKT: NYITOTT TETEL (kozepes) -- a javitas HELYES es a logikaja VEDETT, de a BEKOTESE nem.",
  "VERDIKT: NYITOTT TETEL -- routing-dontes marveenre; a frontend fele a backend mezo szallitasara var.",
  "VERDIKT: NYITOTT TETEL -- a meres mandarke, az engedely megvan",
  "VERDIKT: NYITOTT TETEL -- a merge, a fenti szabaly szerint, a HELYES refrol.",
  "VERDIKT: NYITOTT TETEL -- kizarolag a (4) beragadt eset; a (2) es (3) megoldva a main-en, commitokkal nevesitv",
  "VERDIKT: NYITOTT TETEL (kozepes) -- a javitas HELYES, a hatoköre szuk. A testver-vegpont ugyanazt",
  "VERDIKT: NYITOTT TETEL (alacsony) -- a javitas ALL es a legkockazatosabb resze (a cache utani",
  "VERDIKT: NYITOTT TETEL -- a 21 piros osztalyozasa es a maradek ot FAIL->PASS visszavezetese; reszemrol a kozos",
  "VERDIKT: NYITOTT TETEL -- valtozatlanul a `4a4f118f` szallitasa, de a cimzett ISTI (a `30869dde`",
  "VERDIKT: NYITOTT TETEL -- a PROJECT ag gyujtese dexteré; a sema-komment UTANA az enyem (a 5. komment \"mindkett",
  "VERDIKT: NYITOTT TETEL -- a scope (3 vagy 4 fajl + spec) es a Sprint 6 kerdese marveenre var.",
  "VERDIKT: NYITOTT TETEL -- valtozatlanul a `f6642d34` KISZALLITASA. Az elofeltetel (a beolvasztas)",
  "VERDIKT: NYITOTT TETEL -- a kartya ket hibamodot fog ossze, es a szetvalasztasa (VAGY a",
  "VERDIKT: NYITOTT TETEL -- valtozatlanul a deploy utani megfigyeles, es most mar kimondva, hogy",
  "VERDIKT: NYITOTT TETEL -- dexteré a meres (nem-webes fogyasztok) es a dontes.",
  "VERDIKT: NYITOTT TETEL -- a ket nema ut javitasa, es elotte az orvossag alakjanak eldontese."
]

describe('a regebbi alak is nyitott (didi 23590, marveen dontese)', () => {
  it.each(LIVE_OLD_FORM)('elo sor: %s', (line) => {
    cardInTesting('old')
    addKanbanComment('old', 'valaki', line)
    expect(openVerdicts(getKanbanComments('old'))).toHaveLength(1)
  })

  it('KOTELEZO NEGATIV: a "NINCS NYITOTT TETEL -- ..." NEM nyitott', () => {
    cardInTesting('neg')
    addKanbanComment('neg', 'didi', 'VERDIKT: NINCS NYITOTT TETEL -- a sajat ellenorzesemre')
    expect(openVerdicts(getKanbanComments('neg'))).toEqual([])
  })

  it('egy tokent, ami csak ugyanazzal a szoval KEZDODIK, nem olvas nyitottnak', () => {
    cardInTesting('pre')
    addKanbanComment('pre', 'didi', 'VERDIKT: NYITOTT TETELEK NINCSENEK -- mind lezarva')
    expect(openVerdicts(getKanbanComments('pre'))).toEqual([])
  })

  it('a move done-ra a regi alaku nyitott verdikt folott is 409', async () => {
    cardInTesting('mv')
    addKanbanComment('mv', 'mandark', LIVE_OLD_FORM[0])
    const r = await call('POST', '/api/kanban/mv/move', { status: 'done', actor: 'jarvis' })
    expect(r.status).toBe(409)
  })
})

describe('az oras archivalo ugyanazt a kaput kerdezi (marveen dontese)', () => {
  function oldDone(id: string) {
    cardInTesting(id)
    moveKanbanCard(id, 'done', 0, 'marveen')
    // well past KANBAN_ARCHIVE_DONE_DAYS
    getDb().prepare('UPDATE kanban_cards SET updated_at = ? WHERE id = ?').run(1_000, id)
  }

  it('a nyitott verdiktu done kartya a TABLAN marad; a tobbit archivalja', () => {
    oldDone('open-done')
    addKanbanComment('open-done', 'didi', OPEN)
    getDb().prepare('UPDATE kanban_cards SET updated_at = ? WHERE id = ?').run(1_000, 'open-done')
    oldDone('clean-done')

    expect(sweepArchivedKanbanCards()).toBe(1)
    expect(getKanbanCard('open-done')?.archived_at ?? null).toBeNull()
    expect(getKanbanCard('clean-done')?.archived_at).not.toBeNull()
  })
})

describe('a harom zaro ut', () => {
  it('POST /move done: NYITOTT -> 409, a kartya a helyen marad, es a valasz megnevezi, ki mit mondott', async () => {
    cardInTesting('m1')
    addKanbanComment('m1', 'didi', OPEN)

    const r = await call('POST', '/api/kanban/m1/move', { status: 'done', actor: 'jarvis' })

    expect(r.status).toBe(409)
    expect(r.payload.open_verdicts).toEqual([
      expect.objectContaining({ author: 'didi', line: OPEN }),
    ])
    expect(getKanbanCard('m1')?.status).toBe('testing')
  })

  it('KONTROLL: NINCS -> a lezaras megy', async () => {
    cardInTesting('m2')
    addKanbanComment('m2', 'didi', CLOSED)

    const r = await call('POST', '/api/kanban/m2/move', { status: 'done', actor: 'jarvis' })

    expect(r.status).toBe(200)
    expect(getKanbanCard('m2')?.status).toBe('done')
  })

  it('KONTROLL: nem a done-ba mozgatas nem kapu -- egy nyitott tetellel a kartya visszamehet in_progress-be', async () => {
    cardInTesting('m3')
    addKanbanComment('m3', 'didi', OPEN)

    const r = await call('POST', '/api/kanban/m3/move', { status: 'in_progress', actor: 'dexter' })

    expect(r.status).toBe(200)
  })

  it('kimondott indokkal a lezaras megy, es az indok a kartya tortenetebe kerul', async () => {
    cardInTesting('m4')
    addKanbanComment('m4', 'didi', OPEN)

    const r = await call('POST', '/api/kanban/m4/move', {
      status: 'done', actor: 'marveen', override_reason: 'Isti 4460: a mobil ag kulon kartyan fut',
    })

    expect(r.status).toBe(200)
    expect(getKanbanCard('m4')?.status).toBe('done')
    const ev = getKanbanCardFieldEvents('m4').filter((e) => e.field === 'close_override')
    expect(ev).toHaveLength(1)
    expect(ev[0].to_value).toBe('Isti 4460: a mobil ag kulon kartyan fut')
    expect(ev[0].actor).toBe('marveen')
    expect(JSON.parse(ev[0].from_value ?? '[]')).toEqual([{ author: 'didi', line: OPEN }])
  })

  it('egy ures vagy csak szokozos indok NEM indok', async () => {
    cardInTesting('m5')
    addKanbanComment('m5', 'didi', OPEN)

    const r = await call('POST', '/api/kanban/m5/move', { status: 'done', actor: 'x', override_reason: '   ' })

    expect(r.status).toBe(409)
    expect(getKanbanCard('m5')?.status).toBe('testing')
  })

  it('PUT status: done -- ugyanaz a kapu', async () => {
    cardInTesting('u1')
    addKanbanComment('u1', 'didi', OPEN)

    const r = await call('PUT', '/api/kanban/u1', { status: 'done', actor: 'jarvis' })

    expect(r.status).toBe(409)
    expect(getKanbanCard('u1')?.status).toBe('testing')
  })

  it('KONTROLL: egy MAR done kartya visszhangzott PUT-ja nem lezaras, nem kapu', async () => {
    cardInTesting('u2')
    moveKanbanCard('u2', 'done', 0, 'marveen')
    addKanbanComment('u2', 'didi', OPEN)

    const r = await call('PUT', '/api/kanban/u2', { status: 'done', title: 'Uj cim', actor: 'marveen' })

    expect(r.status).toBe(200)
  })

  it('POST /archive -- ugyanaz a kapu, es indokkal archival', async () => {
    cardInTesting('a1')
    addKanbanComment('a1', 'didi', OPEN)

    const refused = await call('POST', '/api/kanban/a1/archive', { actor: 'jarvis' })
    expect(refused.status).toBe(409)
    expect(getKanbanCard('a1')?.archived_at ?? null).toBeNull()

    const allowed = await call('POST', '/api/kanban/a1/archive', {
      actor: 'jarvis', override_reason: 'duplikatum, a 1234abcd viszi tovabb',
    })
    expect(allowed.status).toBe(200)
    expect(getKanbanCard('a1')?.archived_at).not.toBeNull()
  })
})
