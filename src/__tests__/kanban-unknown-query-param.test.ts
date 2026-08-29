import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { initDatabase, createKanbanCard, archiveKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import { unknownQueryParams, unknownQueryParamError, observeUnknownQueryParams } from '../web/query-params.js'

// Card cf85d765. `GET /api/kanban?archived=1` answered 200 with the LIVE cards:
// zero archived rows, which reads exactly like a truthful "there are none"
// while being an answer about a different population. Not an error, not an
// empty result -- a CONFIDENT answer to a question nobody asked.
//
// MEASURED BEFORE THE FIX, because a 400 may only be added if nothing relies on
// the silence: across the repo, the live ~/.claude skills and scheduled tasks,
// and every agent CLAUDE.md, NOT ONE caller passes a query string to
// /api/kanban. Positive control for that search: the same pattern does find
// `/api/kanban/archived?` in web/app.js:16317, so the empty result is a real
// negative and not a broken grep.

beforeEach(() => {
  initDatabase(':memory:')
})

async function get(path: string): Promise<{ status: number; payload: any }> {
  const req = { method: 'GET', headers: {} } as unknown as http.IncomingMessage
  let status = 200
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string | Buffer) { if (data) chunk = Buffer.isBuffer(data) ? data.toString() : data },
  } as unknown as http.ServerResponse
  const url = new URL('http://x' + path)
  const handled = await tryHandleKanban({ req, res, path: url.pathname, method: 'GET', url } as never)
  expect(handled, `a route nem kezelte: ${path}`).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

describe('unknownQueryParams / unknownQueryParamError -- a segedek', () => {
  it('a nem engedelyezett neveket adja vissza, a kuldes sorrendjeben', () => {
    const u = new URL('http://x/a?b=1&q=2&a=3')
    expect(unknownQueryParams(u, ['q'])).toEqual(['b', 'a'])
  })

  it('egy nevet csak EGYSZER jelent, akkor is, ha tobbszor jott', () => {
    expect(unknownQueryParams(new URL('http://x/a?z=1&z=2'), [])).toEqual(['z'])
  })

  it('ures query eseten nincs mit jelenteni', () => {
    expect(unknownQueryParams(new URL('http://x/a'), [])).toEqual([])
  })

  it('a hibauzenet megnevezi a KIJARATOT, nem csak a hibat', () => {
    // Egy or, ami csak annyit mond, hogy "rossz", ott hagyja a hivot, ahol
    // talalta -- a kovetkezo lepese ujabb talalgatas lenne.
    const e = unknownQueryParamError(['archived'], [], 'Archivalt kartyak: GET /api/kanban/archived.')
    expect(e.error).toContain('archived')
    expect(e.error).toContain('/api/kanban/archived')
    expect(e.error).toContain('nem fogad query-parametert')
  })

  it('ahol VAN tamogatott parameter, ott felsorolja oket', () => {
    const e = unknownQueryParamError(['limitt'], ['q', 'limit'])
    expect(e.error).toContain('limitt')
    expect(e.error).toMatch(/Tamogatott parameterek: q, limit/)
  })
})

describe('GET /api/kanban -- a nema elnyeles megszunt', () => {
  it('?archived=1 mostantol 400, NEM az elo kartyak listaja', () => {
    // Ez a kartyat szulo pontos hivas. A regi valasz 200 + a teljes elo lista volt.
    return get('/api/kanban?archived=1').then(({ status, payload }) => {
      expect(status).toBe(400)
      expect(Array.isArray(payload)).toBe(false)
      expect(payload.error).toContain('archived')
    })
  })

  it('a kitalalt szo is 400 -- nem csak a "hihetо" nevek', async () => {
    const { status, payload } = await get('/api/kanban?hopponellenorizd=1')
    expect(status).toBe(400)
    expect(payload.error).toContain('hopponellenorizd')
  })

  it('POZITIV KONTROLL: parameter NELKUL valtozatlanul 200 + a lista', async () => {
    // Az or csak akkor er valamit, ha a helyes hivast nem bantja. Enelkul a
    // 400-as teszt attol is zold lenne, hogy a vegpont mindig elhasal.
    createKanbanCard({ id: 'aaaa1111', title: 'elo kartya', status: 'planned' })
    const { status, payload } = await get('/api/kanban')
    expect(status).toBe(200)
    expect(Array.isArray(payload)).toBe(true)
    expect(payload).toHaveLength(1)
  })
})

describe('GET /api/kanban/archived -- ugyanaz az or a SZOMSZED agon is', () => {
  // Ezt a ket esetet szandekosan egy fajlban tartom. A repo mar fizetett azert,
  // hogy egy or az egyik agon ott volt es a masikon nem (a komment-letezes
  // ellenorzese a cimke-agon allt, a komment-agon nem) -- egy javitas, ami a
  // testveret meghagyja, azt tanitja, hogy a szabaly populacio-fuggo.
  it('a TAMOGATOTT parameter tovabbra is atmegy', async () => {
    createKanbanCard({ id: 'bbbb2222', title: 'archivalando', status: 'done' })
    archiveKanbanCard('bbbb2222')
    const { status, payload } = await get('/api/kanban/archived?q=archivalando')
    expect(status).toBe(200)
    expect(payload.cards).toHaveLength(1)
  })

  it('az ELGEPELT parameter 400, es felsorolja a tamogatottakat', async () => {
    const { status, payload } = await get('/api/kanban/archived?limitt=5')
    expect(status).toBe(400)
    expect(payload.error).toContain('limitt')
    expect(payload.error).toMatch(/q, project, label, from, to, limit/)
  })

  it('POZITIV KONTROLL: parameter nelkul is 200', async () => {
    const { status, payload } = await get('/api/kanban/archived')
    expect(status).toBe(200)
    expect(Array.isArray(payload.cards)).toBe(true)
  })
})

describe('observeUnknownQueryParams -- elobb merni, aztan szigoritani', () => {
  // computress javaslata (2026-08-23), es egyenesen az EN kifogasomra valasz:
  // a szigoru or kiterjesztese 18 tovabbi vegpontra azon akadt el, hogy
  // mindegyikhez ki kell deriteni a TAMOGATOTT listat -- talalgatni pedig
  // veszelyes, mert egy TULBUZGO or a HELYES hivast utasitja el.
  // A megfigyelo mod ezt merésre valtja: egy nap naplo megmondja, mit hivnak.
  const gyujto = () => {
    const sorok: Array<{ o: Record<string, unknown>; msg: string }> = []
    return { sorok, log: (o: Record<string, unknown>, msg: string) => { sorok.push({ o, msg }) } }
  }

  it('NAPLOZ, de nem utasit el -- a visszateresi ertek csak informacio', () => {
    const g = gyujto()
    const u = observeUnknownQueryParams(new URL('http://x/api/valami?to=marveen&limit=5'), ['limit'], '/api/valami', g.log)
    expect(u).toEqual(['to'])
    expect(g.sorok).toHaveLength(1)
    expect(g.sorok[0].o.unknown).toEqual(['to'])
    expect(g.sorok[0].o.endpoint).toBe('/api/valami')
  })

  it('a naplo a TAMOGATOTT listat is viszi -- kulonben a bejegyzes nem ertelmezheto', () => {
    // Egy naplosor, ami csak azt mondja, hogy "ismeretlen", nem mondja meg,
    // MIHEZ KEPEST -- es egy nap mulva epp abbol kene a listat osszerakni.
    const g = gyujto()
    observeUnknownQueryParams(new URL('http://x/a?z=1'), ['q', 'limit'], '/a', g.log)
    expect(g.sorok[0].o.allowed).toEqual(['q', 'limit'])
  })

  it('CSENDBEN marad, ha minden parameter ismert -- kulonben a naplo hasznalhatatlan lenne', () => {
    const g = gyujto()
    const u = observeUnknownQueryParams(new URL('http://x/a?q=x&limit=5'), ['q', 'limit'], '/a', g.log)
    expect(u).toEqual([])
    expect(g.sorok).toHaveLength(0)
  })

  it('parameter nelkuli hivasra sem szol', () => {
    const g = gyujto()
    observeUnknownQueryParams(new URL('http://x/a'), ['q'], '/a', g.log)
    expect(g.sorok).toHaveLength(0)
  })
})

