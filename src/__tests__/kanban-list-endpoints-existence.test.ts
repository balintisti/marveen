// "NINCS ILYEN KARTYA" ES "VAN, DE URES" NEM LEHET UGYANAZ A VALASZ (kartya bd795bc2).
//
// Mindketto 200 + [] volt, tehat kivulrol megkulonboztethetetlen -- es ez ROSSZ
// IRANYBA vitt egy diagnozist (computress, 2026-08-23): egy leletet kapott egy
// kartyara hivatkozva, az ures tombbol elsore azt hitte, hogy a kartya LETEZIK
// es egy komment VESZETT EL. Csak azert derult ki az igazsag, mert a
// kartya-listaban is megnezte.
//
// ES EZ NEM UJ FELISMERES A REPOBAN, HANEM UGYANAZ, MASIK IRANYBAN. A POST-ra
// ugyanez a kapu mar all (cee465c, `kanban-comment-existence.test.ts`): ott ket
// munkajelentes veszett el egy nem letezo id-n. Az abbol szuletett szabaly szo
// szerint ez: "a 200 nem azt jelenti, hogy megtortent; a VISSZAOLVASAS igen".
// Csakhogy a VISSZAOLVASAS EPP EZ A GET -- vagyis a POST-ra irt szabaly egy
// olyan ellenorzesre tamaszkodott, ami ugyanazt a ketertelmuseget hordozta.
//
// A `GET /api/kanban/<id>` (a kartya maga) MAR MA IS 404-et adott: a javitas
// OSSZEHANGOL, nem uj viselkedest vezet be.
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, addKanbanComment } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

beforeEach(() => {
  initDatabase(':memory:')
})

async function get(path: string): Promise<{ status: number; payload: unknown }> {
  const req = Object.assign(Readable.from([]), { method: 'GET', headers: {} }) as unknown as http.IncomingMessage
  let status = 0
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string) { if (data) chunk = data },
  } as unknown as http.ServerResponse
  const handled = await tryHandleKanban({
    req, res, path, method: 'GET', url: new URL('http://x' + path),
  } as never)
  expect(handled, `a route nem kezelte: ${path}`).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

describe('GET /api/kanban/<id>/comments -- a kartya letezese', () => {
  it('404 nem letezo kartyara, NEM ures tomb', async () => {
    const { status, payload } = await get('/api/kanban/nem-letezo-kartya/comments')
    expect(status).toBe(404)
    // A statuszkod maga nem eleg: a torzs NEVEZZE MEG, mi hianyzik.
    expect((payload as { error?: string })?.error).toMatch(/nem talalhat|nem található/i)
  })

  it('LETEZO, komment nelkuli kartya tovabbra is 200 + ures tomb', async () => {
    // EZ A KIKOTES MASIK FELE, es nelkule a javitas tul szeles lenne: az "ures"
    // egy VALODI, ervenyes valasz. Csak a NEM LETEZO kartya kap 404-et.
    createKanbanCard({ id: 'aaaa1111', title: 'ures kartya', status: 'planned' })
    const { status, payload } = await get('/api/kanban/aaaa1111/comments')
    expect(status).toBe(200)
    expect(payload).toEqual([])
  })

  it('letezo kartya kommentekkel: 200 + a kommentek', async () => {
    createKanbanCard({ id: 'bbbb2222', title: 'kartya', status: 'planned' })
    addKanbanComment('bbbb2222', 'friday', 'eredmeny')
    const { status, payload } = await get('/api/kanban/bbbb2222/comments')
    expect(status).toBe(200)
    expect(payload).toHaveLength(1)
  })

  it('A KET VALASZ MOSTANTOL MEGKULONBOZTETHETO -- ez a lelet magja', async () => {
    // A regi viselkedes mellett ez a ket sor AZONOS eredmenyt adott.
    createKanbanCard({ id: 'cccc3333', title: 'ures', status: 'planned' })
    const letezo = await get('/api/kanban/cccc3333/comments')
    const nemletezo = await get('/api/kanban/nincs-ilyen/comments')
    expect(letezo.status).not.toBe(nemletezo.status)
  })
})

describe('GET /api/kanban/<id>/events -- ugyanaz az alak, ugyanaz a kapu', () => {
  // A kartya a /comments-et nevezi meg. Megmerve ugyanabban a korben: ez a KETTO
  // az egyetlen ket vegpont, ami kartya-id alapjan listat ad -- es a /events
  // ugyanugy 200 + []-t adott nem letezo id-re. Egy javitas, ami a testverét
  // meghagyja, azt tanitja, hogy a szabaly vegpont-fuggo. Nem az.
  it('404 nem letezo kartyara', async () => {
    expect((await get('/api/kanban/nem-letezo/events')).status).toBe(404)
  })

  it('letezo kartya: 200', async () => {
    createKanbanCard({ id: 'dddd4444', title: 'kartya', status: 'planned' })
    expect((await get('/api/kanban/dddd4444/events')).status).toBe(200)
  })
})
