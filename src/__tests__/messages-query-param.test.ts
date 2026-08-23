import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { initDatabase, createAgentMessage } from '../db.js'
import { tryHandleMessages } from '../web/routes/messages.js'

// Kartya cf85d765 folytatasa a SZOMSZED vegponton -- es itt a hiba MAR KART OKOZOTT.
//
// 2026-08-23 18:3x: computress egy valodi vizsgalatban `?to=marveen&limit=200`-at
// hivott, 200-as valaszt es 200 sort kapott, es abbol szamolt latenciat. A `to`
// azonban NEM szuro (a vegpont az `agent`-et olvassa), tehat a GLOBALIS utolso
// 200 jott vissza. A "harom uzenet vart 60 percnel tovabb" ezert helyes szam
// volt egy MASIK populaciora: a harom kozul egyik sem marveennek szolt
// (friday->didi, marveen->dexter, marveen->dexter).
//
// A POZITIV KONTROLL, ami eldontotte: `?to=marveen` es `?to=NINCS_ILYEN_AGENS`
// BETU SZERINT AZONOS id-listat adott. Enelkul ket egyformán hihetо magyarazat
// allt volna szemben (mas ablak kontra nem-szuro parameter).

beforeEach(() => { initDatabase(':memory:') })

async function get(q: string): Promise<{ status: number; payload: any }> {
  const req = { method: 'GET', headers: {} } as unknown as http.IncomingMessage
  let status = 200
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string | Buffer) { if (data) chunk = Buffer.isBuffer(data) ? data.toString() : data },
  } as unknown as http.ServerResponse
  const url = new URL('http://x/api/messages' + q)
  const handled = await tryHandleMessages({ req, res, path: url.pathname, method: 'GET', url } as never)
  expect(handled, `a route nem kezelte: ${q}`).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

describe('GET /api/messages -- a nem letezo szuro nem nyelodhet el', () => {
  it('a `?to=` 400-at ad, es MEGNEVEZI a helyes mezot', () => {
    // Ez a pontos hivas, ami a hamis merest szulte.
    return get('?to=marveen&limit=200').then(({ status, payload }) => {
      expect(status).toBe(400)
      expect(payload.error).toContain('to')
      expect(payload.error).toContain('agent=')
    })
  })

  it('a kitalalt parameter is 400', async () => {
    const { status } = await get('?hopponellenorizd=1')
    expect(status).toBe(400)
  })

  it('POZITIV KONTROLL: a TAMOGATOTT parameterek valtozatlanul mennek', async () => {
    // Enelkul a fenti ket teszt attol is zold lenne, hogy a vegpont mindent elutasit.
    createAgentMessage('friday', 'marveen', 'egy')
    for (const q of ['', '?agent=marveen', '?status=pending', '?limit=5', '?agent=marveen&limit=5&status=pending']) {
      const { status } = await get(q)
      expect(status, `ennek at kellene mennie: '${q}'`).toBe(200)
    }
  })

  it('az `agent=` TENYLEG szur -- a `to=` sosem tette', async () => {
    // A defektus lenyege nem a 400 hianya volt, hanem hogy a valasz MAS
    // populacio volt ugyanazzal a 200-zal. Ezert all itt a szures allitasa is.
    createAgentMessage('friday', 'marveen', 'marveennek')
    createAgentMessage('friday', 'didi', 'didinek')
    const { payload } = await get('?agent=didi')
    const sorok = Array.isArray(payload) ? payload : (payload.messages ?? [])
    expect(sorok.length).toBeGreaterThan(0)
    for (const m of sorok) expect([m.from_agent, m.to_agent]).toContain('didi')
  })
})
