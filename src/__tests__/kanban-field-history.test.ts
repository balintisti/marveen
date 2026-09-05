// EGY KARTYA-CIM ATIRASA NYOMTALAN VOLT -- kartya 4e27d5ad.
//
// A `kanban_card_events` tabla STATUSZ-ATMENETET rogzit es semmi mast (megmerve
// 2026-09-04, marveen: az oszlopai betűre id/card_id/from_status/to_status/
// actor/created_at). Egy `PUT /api/kanban/<id>`, ami a CIMET irja at, tehat
// nyomtalan -- es a cim az EGYETLEN mezo, amit a lista-nezet mutat, tehat a
// leggyakrabban idezett mezo az egyetlen, aminek nincs tortenete.
//
// KET FUGGETLEN RES, ES A MASODIKAT A KARTYA NEM NEVEZTE MEG (friday merte
// 2026-09-05 az ELES tablan, csak-olvaso tranzakcioban, a kapu tuzelesevel a
// meres ELOTT ES UTAN):
//
//   G1  a `status` MAGA is atirhato PUT-tal, esemeny nelkul -- 7 elo kartya
//       utolso rogzitett esemenye ELLENTMOND a mai statuszanak (4 db
//       testing -> done). Vagyis a vegpont a SAJAT targyat mondja alul.
//       KONTROLL: 1263 kartyan a ketto EGYEZIK, tehat a mero tud egyezest is
//       mondani -- a 7 nem a mero muterméke.
//   G2  minden mas mezo (cim, leiras, gazda, ...) valtozasa nyomtalan.
//
// A MUTACIOK, AMIKET EZEK A TESZTEK PIROSRA VISZNEK -- es szandekosan az
// ELVETETT TERV-ALTERNATIVAKAT allitjak elo, nem csak a hiany-allapotot:
//   * a tortenetet `overwritten`-bol irni `valtozott` helyett  -> a null -> ertek
//     valtozas (egy gazdatlan kartya felvetele) NEM kerulne be
//   * a `status`-t a field-tablaba irni a status-tabla helyett -> a meglevo
//     `/events` fogyaszto tovabbra sem latna a PUT-os statuszvaltast
//   * a `/events`-et valtozatlanul hagyni es a tortenetet kulon vegpontra tenni
//     -> a `/events` olvasoja teljesnek latszo, hianyos valaszt kapna
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import {
  initDatabase, createKanbanCard, updateKanbanCard, moveKanbanCard,
  getKanbanCardEvents, getKanbanCardFieldEvents, getKanbanCardHistory,
} from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

beforeEach(() => {
  initDatabase(':memory:')
})

async function call(method: 'GET' | 'PUT', path: string, body?: unknown) {
  // Buffer, nem string: a `readBody` `Buffer.concat`-ot hiv, es egy string-chunk
  // ERR_INVALID_ARG_TYPE-pal all meg -- a valos szerver mindig Buffert ad.
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

describe('G2 -- a nem-statusz mezok valtozasa nyomot hagy', () => {
  it('egy cim-atiras rogziti a REGI es az UJ erteket, a gazdaval egyutt', () => {
    createKanbanCard({ id: 'card-t', title: 'A regi cim', status: 'planned' })

    const r = updateKanbanCard('card-t', { title: 'Az uj cim' }, 'friday')
    expect(r.outcome).toBe('updated')

    const ev = getKanbanCardFieldEvents('card-t')
    expect(ev).toHaveLength(1)
    expect(ev[0].field).toBe('title')
    expect(ev[0].from_value).toBe('A regi cim')
    expect(ev[0].to_value).toBe('Az uj cim')
    expect(ev[0].actor).toBe('friday')
  })

  it('A NULL -> ERTEK valtozast IS rogziti -- ezen bukna el egy `overwritten`-alapu tortenet', () => {
    // Ez a teszt a TERV-DONTEST meri, nem a hianyt: az `updateKanbanCard`
    // `overwritten` listaja SZANDEKOSAN kihagyja azt a mezot, aminek a korabbi
    // erteke ures volt (nem tudja megkulonboztetni a szandekos uritest attol,
    // amit senki nem toltott ki). Egy figyelmeztetesnek ez helyes; egy
    // TORTENETNEK epp a leggyakoribb esemenyt dobna el.
    createKanbanCard({ id: 'card-n', title: 'Gazdatlan', status: 'planned' })
    expect(updateKanbanCard('card-n', { assignee: 'friday' }, 'friday').overwritten).toHaveLength(0)

    const ev = getKanbanCardFieldEvents('card-n')
    expect(ev).toHaveLength(1)
    expect(ev[0].field).toBe('assignee')
    expect(ev[0].from_value).toBeNull()
    expect(ev[0].to_value).toBe('friday')
  })

  it('actor nelkul NULL-t ir, nem bukik el -- a mai hivok nem tornek el', () => {
    createKanbanCard({ id: 'card-x', title: 'Regi', status: 'planned' })
    updateKanbanCard('card-x', { title: 'Uj' })
    expect(getKanbanCardFieldEvents('card-x')[0].actor).toBeNull()
  })

  it('egy PUT ket mezore KET sort ir, mindkettot a sajat elotte-utana ertekevel', () => {
    createKanbanCard({ id: 'card-2', title: 'Regi', status: 'planned', priority: 'low' })
    updateKanbanCard('card-2', { title: 'Uj', priority: 'high' }, 'marveen')

    const ev = getKanbanCardFieldEvents('card-2')
    expect(ev.map((e) => e.field).sort()).toEqual(['priority', 'title'])
    expect(ev.find((e) => e.field === 'priority')).toMatchObject({ from_value: 'low', to_value: 'high' })
    expect(ev.find((e) => e.field === 'title')).toMatchObject({ from_value: 'Regi', to_value: 'Uj' })
  })

  it('a `sort_order` KIMARAD -- kimondott dontes, nem hiany', () => {
    createKanbanCard({ id: 'card-s', title: 'Cim', status: 'planned' })
    const r = updateKanbanCard('card-s', { sort_order: 42 }, 'friday')
    expect(r.outcome).toBe('updated')            // a kartya VALTOZOTT
    expect(getKanbanCardFieldEvents('card-s')).toHaveLength(0)  // de nem ir tortenetet
  })

  it('egy `unchanged` PUT SEMMILYEN sort nem ir -- nincs fantom-tortenet', () => {
    createKanbanCard({ id: 'card-u', title: 'Cim', status: 'planned' })
    expect(updateKanbanCard('card-u', { title: 'Cim' }, 'friday').outcome).toBe('unchanged')
    expect(getKanbanCardFieldEvents('card-u')).toHaveLength(0)
    expect(getKanbanCardEvents('card-u')).toHaveLength(0)
  })
})

describe('G1 -- a PUT-tal valtoztatott statusz a MEGLEVO esemeny-tablaba kerul', () => {
  it('statusz-valtas PUT-on ugyanolyan sort ir, mint egy move', () => {
    createKanbanCard({ id: 'card-p', title: 'Cim', status: 'planned' })
    updateKanbanCard('card-p', { status: 'done' }, 'friday')

    // A MEGLEVO tablaba, a MEGLEVO alakban -- kulonben a mai `/events` olvaso
    // (es a `card-flow-cli`, ami a to_status-t olvassa MINDEN sorbol) tovabbra
    // sem latna ezt az atmenetet.
    const ev = getKanbanCardEvents('card-p')
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ from_status: 'planned', to_status: 'done', actor: 'friday' })
    // es NEM a mezo-tablaba
    expect(getKanbanCardFieldEvents('card-p')).toHaveLength(0)
  })

  it('KONTROLL: a `move` valtozatlanul mukodik, es a ketto EGY sorozatot ad', () => {
    createKanbanCard({ id: 'card-m', title: 'Cim', status: 'planned' })
    moveKanbanCard('card-m', 'in_progress', 0, 'marveen')
    updateKanbanCard('card-m', { status: 'testing' }, 'friday')

    expect(getKanbanCardEvents('card-m').map((e) => e.to_status)).toEqual(['in_progress', 'testing'])
  })
})

describe('a /events vegpont EGY tombot ad, `kind` diszkriminatorral', () => {
  it('mindket fajta sort visszaadja, es a statusz-sor alakja VALTOZATLAN', async () => {
    createKanbanCard({ id: 'bbbb2222', title: 'A regi cim', status: 'planned' })
    moveKanbanCard('bbbb2222', 'in_progress', 0, 'marveen')
    updateKanbanCard('bbbb2222', { title: 'Az uj cim' }, 'friday')

    const { status, payload } = await call('GET', '/api/kanban/bbbb2222/events')
    expect(status).toBe(200)
    const rows = payload as Array<Record<string, unknown>>

    // A DOKUMENTALT JELENTES TULELI: a flotta CLAUDE.md-je ezt a vegpontot ugy
    // irja le, hogy "mikor LEPETT BE az oszlopba, actor-ral egyutt". Egy
    // to_status-ra szuro olvaso tovabbra is PONTOSAN a statusz-sorokat kapja.
    const statusRows = rows.filter((r) => r.to_status !== undefined)
    expect(statusRows).toHaveLength(1)
    expect(statusRows[0]).toMatchObject({ kind: 'status', from_status: 'planned', to_status: 'in_progress', actor: 'marveen' })

    const fieldRows = rows.filter((r) => r.kind === 'field')
    expect(fieldRows).toHaveLength(1)
    expect(fieldRows[0]).toMatchObject({ field: 'title', from_value: 'A regi cim', to_value: 'Az uj cim', actor: 'friday' })
  })

  it('a PUT torzsebol vett `actor` VEGIGER a tortenetig -- ez a "ki" fele', async () => {
    createKanbanCard({ id: 'cccc3333', title: 'Regi', status: 'planned' })

    const put = await call('PUT', '/api/kanban/cccc3333', { title: 'Uj', actor: 'dashboard' })
    expect(put.status).toBe(200)
    expect((put.payload as { changed?: boolean }).changed).toBe(true)

    const { payload } = await call('GET', '/api/kanban/cccc3333/events')
    const rows = payload as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'field', field: 'title', to_value: 'Uj', actor: 'dashboard' })
  })

  it('az `actor` NEM valik mezove: egyedul kuldve a kartya VALTOZATLAN', async () => {
    createKanbanCard({ id: 'dddd4444', title: 'Regi', status: 'planned' })
    const put = await call('PUT', '/api/kanban/dddd4444', { actor: 'dashboard' })
    expect(put.status).toBe(200)
    expect((put.payload as { changed?: boolean }).changed).toBe(false)
    expect(getKanbanCardHistory('dddd4444')).toHaveLength(0)
  })

  it('KONTROLL: erintetlen kartya -> ures tomb, nem hiba', async () => {
    createKanbanCard({ id: 'eeee5555', title: 'Erintetlen', status: 'planned' })
    const { status, payload } = await call('GET', '/api/kanban/eeee5555/events')
    expect(status).toBe(200)
    expect(payload).toEqual([])
  })
})
