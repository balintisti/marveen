import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, getKanbanCard, updateKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

// Kartya af9f6cd4. Egy URES torzsu PUT 200-at adott es MEGEMELTE az `updated_at`-et,
// anelkul hogy barmi valtozott volna. Merve a valodi tablan egy probakartyaval:
//     ELOTTE  updated_at=1787511630
//     PUT {}  -> 200 {"ok":true}
//     UTANA   updated_at=1787511632   (a VALTOZOTT MEZOK halmaza: csak az updated_at)
//
// MIERT SZAMIT: a kartya ettol FRISSNEK latszik anelkul, hogy tortent volna vele
// barmi -- es 2026-08-23-an ket kulonbozo meres epult a tablarol EPP erre a mezore.
//
// ES A GYAKORIBB UT NEM AZ URES TORZS: a szerkeszto modal MINDEN mentesnel a
// TELJES objektumot kuldi, tehat egy megnyitas-bezaras is "frissitett". Ezert nem
// eleg az ures torzset elutasitani -- a VALTOZATLAN mezokre is hallgatni kell.

beforeEach(() => { initDatabase(':memory:') })

async function put(id: string, body: unknown): Promise<{ status: number; payload: any }> {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'PUT', headers: {},
  }) as unknown as http.IncomingMessage
  let status = 200
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string) { if (data) chunk = data },
  } as unknown as http.ServerResponse
  const url = new URL(`http://x/api/kanban/${id}`)
  const handled = await tryHandleKanban({ req, res, path: url.pathname, method: 'PUT', url } as never)
  expect(handled).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

const kartya = (id: string) => {
  createKanbanCard({ id, title: 'proba', status: 'planned', assignee: 'friday', priority: 'normal' })
  return getKanbanCard(id)!
}

describe('PUT /api/kanban/<id> -- a nem-valtozas nem frissites', () => {
  it('URES torzs -> 400, es MEGNEVEZI, mi hianyzik', async () => {
    kartya('aaaa1111')
    const { status, payload } = await put('aaaa1111', {})
    expect(status).toBe(400)
    expect(payload.error).toMatch(/assignee/)   // a kijarat: mit kellett volna kuldeni
  })

  it('URES torzs NEM emeli az updated_at-et', async () => {
    const elotte = kartya('bbbb2222').updated_at
    await put('bbbb2222', {})
    expect(getKanbanCard('bbbb2222')!.updated_at).toBe(elotte)
  })

  it('VALTOZATLAN mezok -> 200, de `changed:false` ES az updated_at MARAD', async () => {
    // Ez a gyakoribb ut: a modal a teljes objektumot visszakuldi valtoztatas nelkul.
    const c = kartya('cccc3333')
    const { status, payload } = await put('cccc3333', {
      title: c.title, status: c.status, assignee: c.assignee, priority: c.priority,
    })
    expect(status).toBe(200)
    expect(payload.changed).toBe(false)
    expect(getKanbanCard('cccc3333')!.updated_at).toBe(c.updated_at)
  })

  it('POZITIV KONTROLL: VALODI valtozas tovabbra is ir ES emel', async () => {
    // Enelkul minden fenti allitas attol is igaz lenne, hogy a PUT mar semmit nem csinal.
    const c = kartya('dddd4444')
    const { status, payload } = await put('dddd4444', { assignee: 'marveen' })
    expect(status).toBe(200)
    expect(payload.changed).toBe(true)
    const utana = getKanbanCard('dddd4444')!
    expect(utana.assignee).toBe('marveen')
    expect(utana.updated_at).toBeGreaterThanOrEqual(c.updated_at)
  })

  it('ISMERETLEN kulcs onmagaban nem valtozas', async () => {
    // Egy ismeretlen mezo nem irodik ki az UPDATE-ben sem -- ha valtozasnak
    // szamitana, egy elgepelt kulcs is "frissitene" a kartyat.
    const c = kartya('eeee5555')
    const { payload } = await put('eeee5555', { nincs_ilyen_mezo: 'x' })
    expect(payload.changed).toBe(false)
    expect(getKanbanCard('eeee5555')!.updated_at).toBe(c.updated_at)
  })

  it('a NEM LETEZO kartya tovabbra is 404 -- a harom kimenet kulon marad', async () => {
    const { status } = await put('nincsilyen', { assignee: 'x' })
    expect(status).toBe(404)
  })

  it('a fuggveny HAROM kimenete kulonvalik', () => {
    kartya('ffff6666')
    expect(updateKanbanCard('nincsilyen', { assignee: 'x' }).outcome).toBe('not-found')
    expect(updateKanbanCard('ffff6666', { assignee: 'friday' }).outcome).toBe('unchanged')
    expect(updateKanbanCard('ffff6666', { assignee: 'didi' }).outcome).toBe('updated')
  })
})
