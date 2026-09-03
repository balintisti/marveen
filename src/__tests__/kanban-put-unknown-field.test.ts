import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, getKanbanCard, createLabel, addLabelToCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

// Kartya 5112c914 (sajat meres 2026-08-24): `PUT {"labels":[...]}` -> {"ok":true}, es a
// visszaolvasas `labels: []`. A mezo IRHATO, csak nem ezen az uton -- es a rossz ut nem
// mondott nemet. Ugyanaz az alak, mint a lenyelt query-parameter (cf85d765).
//
// AMI A JAVITAST ALAKITOTTA, ES MERES VOLT, NEM IZLES: a dashboard KET inline szerkesztese a
// TELJES kartyat kuldi vissza (`{ ...card, assignee }`, `{ ...card, parent_id }`), es a kartya
// HAT nem-frissitheto mezot hordoz. Egy csupasz "ismeretlen kulcs -> 400" MINDEN inline
// szerkesztest eltort volna -- egy or, ami a HELYES allapotra tuzel.

beforeEach(() => { initDatabase(':memory:') })

async function put(id: string, payload: unknown): Promise<{ status: number; body: any }> {
  const req = Readable.from([Buffer.from(JSON.stringify(payload))]) as unknown as http.IncomingMessage
  ;(req as { method?: string }).method = 'PUT'
  ;(req as { headers?: unknown }).headers = {}
  let status = 200
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string | Buffer) { if (data) chunk = Buffer.isBuffer(data) ? data.toString() : data },
  } as unknown as http.ServerResponse
  const path = `/api/kanban/${id}`
  const handled = await tryHandleKanban(
    { req, res, path, method: 'PUT', url: new URL('http://x' + path) } as never,
  )
  expect(handled, 'a route nem kezelte a PUT-ot').toBe(true)
  return { status, body: chunk ? JSON.parse(chunk) : null }
}

function makeCard(): string {
  const id = 'aaaa1111'
  createKanbanCard({ id, title: 'proba', status: 'planned', assignee: 'friday' })
  return id
}

describe('PUT /api/kanban/<id> -- ismeretlen es mashol irhato mezo (5112c914)', () => {
  it('a HEADLINE eset: `labels` mas ertekkel -> 400, es MEGNEVEZI a helyes vegpontot', async () => {
    const id = makeCard()
    const r = await put(id, { labels: [{ id: 'x', name: 'varakozik:isti' }] })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('labels')
    expect(r.body.error).toContain('/labels')
  })

  it('a kartyan NEM LETEZO mezo (eliras) -> 400, es felsorolja a frissithetoket', async () => {
    const id = makeCard()
    const r = await put(id, { lables: ['x'] })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('lables')
    expect(r.body.error).toContain('assignee')
  })

  // A LEGFONTOSABB KONTROLL: a felulet inline szerkesztese a TELJES kartyat kuldi vissza.
  // Egy kapu, ami ezt eltori, rosszabb, mint a nema eldobas volt.
  it('a dashboard `{...card, assignee}` alakja TOVABBRA IS atmegy', async () => {
    const id = makeCard()
    const card = getKanbanCard(id)!
    const r = await put(id, { ...card, labels: [], assignee: 'dexter' })
    expect(r.status, `a felulet utja nem torhet el: ${JSON.stringify(r.body)}`).toBe(200)
    expect(getKanbanCard(id)!.assignee).toBe('dexter')
  })

  // ELAVULT OLVASAS (verseny), NEM SZANDEK: a szerver-tulajdonu mezok eltero erteke nem hiba.
  // Ezeket 400-zal elutasitani feltetetes irast valositana meg, amit a vegpont kimondottan
  // nem tamogat (`If-Match` -> 400 par sorral feljebb).
  it('ELAVULT `updated_at`/`seq` a visszhangban NEM tori el az irast', async () => {
    const id = makeCard()
    const card = getKanbanCard(id)!
    const r = await put(id, { ...card, updated_at: 1, seq: 999, assignee: 'didi' })
    expect(r.status).toBe(200)
    expect(getKanbanCard(id)!.assignee).toBe('didi')
  })

  // A CIMKE VISSZHANGJA a tarolt ertekkel AZONOS -> nem szandek, nem hiba.
  it('a `labels` VALTOZATLAN visszhangja atmegy', async () => {
    const id = makeCard()
    const label = createLabel({ id: 'lbl1', name: 'varakozik:isti', color: '#fff' })
    addLabelToCard(id, label.id)
    const stored = [{ id: label.id, name: label.name, color: label.color, created_at: label.created_at }]
    const r = await put(id, { labels: stored, assignee: 'jarvis' })
    expect(r.status, `a valtozatlan visszhang nem szandek: ${JSON.stringify(r.body)}`).toBe(200)
    expect(getKanbanCard(id)!.assignee).toBe('jarvis')
  })
})
