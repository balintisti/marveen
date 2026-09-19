// GET /api/kanban?fields=summary -- ugyanaz a POPULACIO, kevesebb OSZLOP.
//
// MERVE 2026-09-19 09:24 CEST az eles tablan: 2307 elo kartya, a teljes valasz
// 3 964 380 karakter (~991k token), ebbol a `description` egymaga 2 841 766 (72%).
// Minden agens, aki listazza a tablat, ezt fizeti minden listazaskor. A dashboard
// UI-nak kell a leiras (web/app.js 42 hivatkozas), az agenseknek nem.
//
// AMIT EZ A TESZT VED, ES AMIERT NEM ELEG A "nincs benne description":
// ennek a vegpontnak MAR VOLT egy olyan hibaja, ahol egy query-parameter MAS
// POPULACIOT adott vissza egy oszinte valasz arcaval (`?archived=1` -> 200 az
// ELO kartyakkal). Egy mezo-szuro pontosan ugyanigy el tudna csuszni, ezert az
// elso allitas nem a mezokrol szol, hanem arrol, hogy a KARTYA-HALMAZ AZONOS.
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, archiveKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

beforeEach(() => {
  initDatabase(':memory:')
})

async function get(path: string): Promise<{ status: number; headers: Record<string, string>; payload: any }> {
  const req = Object.assign(Readable.from([]), { method: 'GET', headers: {} }) as unknown as http.IncomingMessage
  let status = 0
  let headers: Record<string, string> = {}
  let chunk = ''
  const res = {
    writeHead(code: number, h?: Record<string, string>) { status = code; headers = h ?? {}; return res },
    setHeader() { return res },
    end(data?: string | Buffer) { if (data) chunk = data.toString() },
  } as unknown as http.ServerResponse
  const handled = await tryHandleKanban({
    req, res, path: path.split('?')[0], method: 'GET', url: new URL(`http://x${path}`),
  } as never)
  expect(handled).toBe(true)
  return { status, headers, payload: chunk ? JSON.parse(chunk) : null }
}

function seed() {
  createKanbanCard({
    id: 'slim0001', title: 'elso', status: 'planned', assignee: 'marveen',
    priority: 'high', project: 'marveen',
    description: 'EZ A HOSSZU LEIRAS, ami a valasz 72 szazalekat viszi az eles tablan.',
  })
  createKanbanCard({
    id: 'slim0002', title: 'masodik', status: 'testing', assignee: 'dexter',
    priority: 'normal', project: 'delta-crm', description: 'masik leiras',
  })
}

describe('GET /api/kanban?fields=summary', () => {
  it('UGYANAZT a kartya-halmazt adja, mint a teljes listazas', async () => {
    seed()
    createKanbanCard({ id: 'slim0003', title: 'archivalando', status: 'done' })
    expect(archiveKanbanCard('slim0003')).toBe(true)

    const teljes = await get('/api/kanban')
    const sovany = await get('/api/kanban?fields=summary')

    expect(teljes.status).toBe(200)
    expect(sovany.status).toBe(200)
    // NEM `length` osszevetes: ket azonos MERETU, de kulonbozo halmaz atmenne rajta.
    expect(sovany.payload.map((c: any) => c.id)).toEqual(teljes.payload.map((c: any) => c.id))
    // es a halmaz tenyleg NEM ures, kulonben a fenti allitas ket ures listat hasonlit
    expect(sovany.payload.length).toBe(2)
    // az archivalt tovabbra is KIMARAD, es a fejlec ugyanazt mondja mindket modban
    expect(sovany.headers['X-Archived-Hidden']).toBe('1')
    expect(teljes.headers['X-Archived-Hidden']).toBe('1')
  })

  it('elhagyja a `description` es `labels` mezot, a tobbit megtartja', async () => {
    seed()
    const r = await get('/api/kanban?fields=summary')
    const c = r.payload.find((x: any) => x.id === 'slim0001')

    expect('description' in c).toBe(false)
    expect('labels' in c).toBe(false)
    // A POZITIV fele ugyanolyan fontos: egy ures objektum is atmenne a ket
    // `false`-on. Ezek nelkul a sovany nezet hasznalhatatlan volna.
    expect(c.title).toBe('elso')
    expect(c.status).toBe('planned')
    expect(c.assignee).toBe('marveen')
    expect(c.priority).toBe('high')
    expect(c.project).toBe('marveen')
  })

  it('alapertelmezesben VALTOZATLAN: a leiras es a cimkek ott vannak', async () => {
    seed()
    const r = await get('/api/kanban')
    const c = r.payload.find((x: any) => x.id === 'slim0001')
    expect(c.description).toContain('72 szazalekat')
    expect(Array.isArray(c.labels)).toBe(true)
    expect(r.headers['X-Fields']).toBe('full')
  })

  it('az `X-Fields` fejlec MINDKET modban megy, nem csak a sovanyban', async () => {
    seed()
    // Egy fejlec, ami csak az egyik agon jelenik meg, megkulonboztethetetlen egy
    // regi buildtol, ami sosem kuldi -- ugyanaz a csend, mint az X-Archived-Hidden
    // esetében, es ugyanabban a fajlban mar egyszer megfogott minket.
    expect((await get('/api/kanban')).headers['X-Fields']).toBe('full')
    expect((await get('/api/kanban?fields=summary')).headers['X-Fields']).toBe('summary')
  })

  it('ISMERETLEN parameter tovabbra is 400, a kapu nem gyengult', async () => {
    seed()
    const r = await get('/api/kanban?archived=1')
    expect(r.status).toBe(400)
    // KONTROLL: a `fields` maga NEM esik bele, kulonben ez a 400 mindent tiltana
    expect((await get('/api/kanban?fields=summary')).status).toBe(200)
  })

  it('ismeretlen `fields` ERTEK a TELJES nezetet adja, nem ureset', async () => {
    seed()
    // Egy elgepelt `fields=sumary` ne csendben csonkoljon: a fail-open irany itt
    // a HELYES, mert a hiba kimenete egy DRAGABB, de TELJES valasz -- nem egy
    // olcso, hianyos, aminek a hianya ertekek hianyanak latszik.
    const r = await get('/api/kanban?fields=sumary')
    expect(r.status).toBe(200)
    expect(r.headers['X-Fields']).toBe('full')
    expect(r.payload.find((x: any) => x.id === 'slim0001').description).toContain('72 szazalekat')
  })
})
