// GET /api/kanban/<id>/comments?limit=N -- OPT-IN csonkolas, NEVESITETT hiannyal.
//
// MERVE 2026-09-19 az eles tablan: 900 elo kartya 19 057 038 karakternyi kommentet
// tart (~4,76 M token). Az eloszlas extrem ferde: a median kartya 9 154 karakter
// (~2,3 e token), de `a65623ef` egymaga 804 261 (~201 e token) -- vagyis EGY kartya
// kommentjeinek elolvasasa ma elviheti egy agens teljes kontextusablakat, es a lap
// ELO IS IRJA, hogy felvetelkor olvasd vegig oket.
//
// AMIT EZ A TESZT VED, ES AMIERT NEM ELEG "a limit N sort ad":
// egy NEMA csonkolas pontosan azt a hibat termelne, ami ellen keszult -- a hianyzo
// sorok NEM-LETEZESNEK olvasodnak. Ezert a teherhordo allitas nem a darabszam,
// hanem hogy (1) limit NELKUL a valasz BAJTRA a regi (csupasz tomb), tehat a
// csonkolas nem tortenhet meg veletlenul, es (2) limittel a valasz MAS ALAKU es
// megnevezi a sajat hianyat (`total`, `omitted`).
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, addKanbanComment } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

beforeEach(() => { initDatabase(':memory:') })

async function get(path: string): Promise<{ status: number; payload: any }> {
  const req = Object.assign(Readable.from([]), { method: 'GET', headers: {} }) as unknown as http.IncomingMessage
  let status = 0
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string | Buffer) { if (data) chunk = data.toString() },
  } as unknown as http.ServerResponse
  const handled = await tryHandleKanban({
    req, res, path: path.split('?')[0], method: 'GET', url: new URL(`http://x${path}`),
  } as never)
  expect(handled).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

let sorszam = 0
function seed(n: number): string {
  const cardId = `cmt${String(++sorszam).padStart(5, '0')}`
  createKanbanCard({ id: cardId, title: 'C', status: 'planned', assignee: 'a', priority: 'normal' })
  for (let i = 1; i <= n; i++) addKanbanComment(cardId, 'szerzo', `komment-${i}`)
  return cardId
}

describe('GET /api/kanban/<id>/comments -- limit', () => {
  it('limit NELKUL a valasz csupasz TOMB, mint eddig -- a csonkolas nem lehet veletlen', async () => {
    const id = seed(5)
    const r = await get(`/api/kanban/${id}/comments`)
    expect(r.status).toBe(200)
    expect(Array.isArray(r.payload)).toBe(true)
    expect(r.payload).toHaveLength(5)
  })

  it('limittel BORITEK jon, ami MEGNEVEZI a hianyt', async () => {
    const id = seed(10)
    const r = await get(`/api/kanban/${id}/comments?limit=3`)
    expect(Array.isArray(r.payload)).toBe(false)
    expect(r.payload.total).toBe(10)
    expect(r.payload.returned).toBe(3)
    expect(r.payload.omitted).toBe(7)
    expect(r.payload.comments).toHaveLength(3)
  })

  it('alapertelmezesben az UTOLSO N jon (a friss dontesek), idorendben', async () => {
    const id = seed(10)
    const r = await get(`/api/kanban/${id}/comments?limit=3`)
    expect(r.payload.comments.map((c: { content: string }) => c.content))
      .toEqual(['komment-8', 'komment-9', 'komment-10'])
    expect(r.payload.from).toBe('end')
    expect(r.payload.order).toBe('asc')
  })

  it('`from=start` az ELSO N-et adja -- MAS reszhalmaz, es a boritek kiirja', async () => {
    const id = seed(10)
    const r = await get(`/api/kanban/${id}/comments?limit=3&from=start`)
    expect(r.payload.comments.map((c: { content: string }) => c.content))
      .toEqual(['komment-1', 'komment-2', 'komment-3'])
    expect(r.payload.from).toBe('start')
  })

  // A TEHERHORDO ALLITAS: az `order` CSAK a sorrendet forditja, a KIVALASZTAST nem.
  // Ha osszecsusznanak, a `desc` csendben MAS reszhalmazt adna ugyanazzal a
  // darabszammal -- ket valasz, ami mindketto hihetonek latszik.
  it('`order=desc` UGYANAZT a reszhalmazt adja, forditva -- nem masikat', async () => {
    const id = seed(10)
    const asc = await get(`/api/kanban/${id}/comments?limit=3`)
    const desc = await get(`/api/kanban/${id}/comments?limit=3&order=desc`)
    const tart = (r: { payload: { comments: { content: string }[] } }) => r.payload.comments.map(c => c.content)
    expect(tart(desc)).toEqual([...tart(asc)].reverse())
    expect(new Set(tart(desc))).toEqual(new Set(tart(asc)))
  })

  it('a limitnel NAGYOBB keresre nincs csonkolas, es az `omitted` NULLA', async () => {
    const id = seed(2)
    const r = await get(`/api/kanban/${id}/comments?limit=50`)
    expect(r.payload.returned).toBe(2)
    expect(r.payload.omitted).toBe(0)
  })

  it('ertelmetlen limit 400, nem csendes teljes lista', async () => {
    const id = seed(3)
    for (const rossz of ['0', '-1', 'abc', '']) {
      const r = await get(`/api/kanban/${id}/comments?limit=${rossz}`)
      expect(r.status, `limit=${rossz}`).toBe(400)
    }
  })

  // KONTROLL: a 404-kapu TULELI a valtozast. A csupasz `[]` es a "nincs ilyen kartya"
  // szetvalasztasa ennek a vegpontnak sajat, dragan megszerzett tulajdonsaga.
  it('nem letezo kartya tovabbra is 404, limittel is', async () => {
    expect((await get('/api/kanban/nincsilyen/comments')).status).toBe(404)
    expect((await get('/api/kanban/nincsilyen/comments?limit=5')).status).toBe(404)
  })
})
