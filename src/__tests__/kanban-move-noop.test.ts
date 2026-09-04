import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, getKanbanCard, getKanbanCardEvents } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

// Kartya aca11ba5. A `/move` `{"ok":true}`-t adott egy kartyara, ami MAR abban az allapotban
// volt: esemeny nem irodott, semmi nem valtozott, es a hivo nem tudta megkulonboztetni a valodi
// atmenettol. A testver `PUT /kanban/<id>` ugyanerre a nem-valtozasra MAR `{"ok":true,
// "changed":false}`-t adott -- egy eroforras, ket vegpont, ket kulonbozo oszinteseg.
//
// A MERT AR (2026-09-04): dexter hat lezart kartyat jelentett a koordinatornak. HAROM volt --
// didi es mandark a masik harmat mar lezarta, dexter mozgatasai NO-OPOK voltak, es a valasz
// semmit nem adott, amin ez latszott volna. Hibas jelentes egy HELYESNEK LATSZO valaszbol.
//
// ES AMIERT NEM ELEG A VISSZAOLVASAS: mandark ugyanezt ellenorizte magan, es a kilence tulelte --
// de SORRENDBOL, nem modszerbol. Az o ellenorzese visszaolvasas volt, ami azt bizonyitja, hogy a
// kartya KESZ, nem azt, hogy O tette azza. Ha dexter sopor elobb, mandark ugyanigy tevedett volna.
//
//     visszaolvasas ...  a kartya ABBAN az allapotban VAN
//     /events sor .....  EN tettem azza
//     {ok:true} .......  egyik sem
//
// Az informacio MAR LETEZETT: az esemeny-sor pontosan akkor irodik, amikor a mozgatas valodi.
// Csak nem jutott el a hivoig.

beforeEach(() => { initDatabase(':memory:') })

async function move(id: string, body: unknown): Promise<{ status: number; payload: any }> {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'POST', headers: {},
  }) as unknown as http.IncomingMessage
  let status = 200
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string) { if (data) chunk = data },
  } as unknown as http.ServerResponse
  const url = new URL(`http://x/api/kanban/${encodeURIComponent(id)}/move`)
  await tryHandleKanban({ req, res, path: url.pathname, method: 'POST', url } as never)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

describe('POST /kanban/<id>/move -- a valasz megmondja, tortent-e valami', () => {
  it('VALODI atmenet -> changed:true, es esemeny irodik', async () => {
    createKanbanCard({ id: 'c1', title: 'x' })
    const r = await move('c1', { status: 'in_progress', actor: 'friday' })
    expect(r.status).toBe(200)
    expect(r.payload).toEqual({ ok: true, changed: true })
    expect(getKanbanCardEvents('c1')).toHaveLength(1)
  })

  it('NO-OP (mar abban az allapotban) -> changed:false, es NINCS uj esemeny', async () => {
    createKanbanCard({ id: 'c2', title: 'x' })
    await move('c2', { status: 'done', actor: 'friday' })
    const again = await move('c2', { status: 'done', actor: 'friday' })
    expect(again.status).toBe(200)
    expect(again.payload).toEqual({ ok: true, changed: false })
    // EGY esemeny, nem ketto: a masodik hivas nem tortent meg.
    expect(getKanbanCardEvents('c2')).toHaveLength(1)
  })

  it('a NO-OP nem emeli az `updated_at`-et -- a kartya nem latszhat frissnek ok nelkul', async () => {
    // Ez a testver PUT dontese (af9f6cd4), es ugyanaz az indok: a tetlen-or es minden
    // frissesseg-szuro EZT a mezot olvassa. Egy no-op, ami frissit, csendben hazudik nekik.
    createKanbanCard({ id: 'c3', title: 'x' })
    await move('c3', { status: 'waiting', actor: 'friday' })
    const before = getKanbanCard('c3')!.updated_at
    await new Promise((r) => setTimeout(r, 1100))   // az updated_at masodperc-felbontasu
    const again = await move('c3', { status: 'waiting', actor: 'friday' })
    expect(again.payload.changed).toBe(false)
    expect(getKanbanCard('c3')!.updated_at).toBe(before)
  })

  it('a tiszta ATRENDEZES valtozas (changed:true), de NEM allapot-atmenet (nincs esemeny)', async () => {
    // A ket kerdes kulonbozik, es a valasz mindkettore kell: a sort_order irasa valodi
    // valtozas, de nem az, amirol az esemeny-naplo szol.
    createKanbanCard({ id: 'c4', title: 'x' })
    const r = await move('c4', { status: 'planned', sort_order: 7, actor: 'friday' })
    expect(r.payload).toEqual({ ok: true, changed: true })
    expect(getKanbanCardEvents('c4')).toHaveLength(0)
  })

  it('nem letezo kartya -> 404, valtozatlanul', async () => {
    const r = await move('nincs-ilyen', { status: 'done', actor: 'friday' })
    expect(r.status).toBe(404)
  })
})
