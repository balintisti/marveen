import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, getKanbanCard, createLabel, addLabelToCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import type { RouteContext } from '../web/routes/types.js'

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

// UPSTREAM'S CASES (#1023), kept at the merge 88c366f2. The two fixes reached the same
// file name from two sides: ours (5112c914, above) judges by INTENT -- a changed value
// of a field writable elsewhere is a 400, an echo is not -- and upstream's by KEY SET.
// Ours is the guard that stays (the cases above pin it), and upstream's four claims
// all still hold under it, with TWO adaptations, both named here:
//   - the request gets `headers: {}`: the PUT reads `If-Match` (ddf11b94), which
//     upstream's route never did, so a header-less fake request would throw;
//   - the whole-card echo sends the STORED labels ([]), not a made-up label: under
//     our rule a label that is not on the card is a changed value, i.e. an intent to
//     write labels through the wrong endpoint -- the headline case above.
//
// Plus the load-bearing compatibility claim: the dashboard's whole-`{...card}`
// PUT (assignee/parent edits, carrying id/seq/created_at/last_status_at/labels/
// blockers) still succeeds.
function putCtx(id: string, payload: unknown): { ctx: RouteContext; out: { status: number; body: any } } {
  const out: { status: number; body: any } = { status: 200, body: null }
  const res: any = {
    writeHead(status: number) { out.status = status; return res },
    setHeader() { return res },
    end(chunk?: string) { if (chunk) out.body = JSON.parse(chunk) },
  }
  const req: any = Readable.from([Buffer.from(JSON.stringify(payload))])
  req.headers = {}
  const url = new URL(`http://localhost:3420/api/kanban/${encodeURIComponent(id)}`)
  return { ctx: { req, res, path: url.pathname, method: 'PUT', url } as RouteContext, out }
}

describe('PUT /api/kanban/:id -- unknown fields are rejected, no-ops do not refresh (#1023)', () => {
  beforeEach(() => { initDatabase(':memory:') })

  it('rejects an unknown field with 400 and does NOT touch the card', async () => {
    createKanbanCard({ id: 'c1', title: 'Card one', status: 'planned' })
    const before = getKanbanCard('c1')!
    // simulate a later real write happening at a later second
    await new Promise((r) => setTimeout(r, 1100))
    const { ctx, out } = putCtx('c1', { status: 'done', description_append: 'result text' })
    expect(await tryHandleKanban(ctx)).toBe(true)
    expect(out.status).toBe(400)
    expect(out.body.error).toContain('description_append')
    // the whole write is refused: status did NOT change, updated_at did NOT move
    const after = getKanbanCard('c1')!
    expect(after.status).toBe('planned')
    expect(after.updated_at).toBe(before.updated_at)
  })

  it('a no-op PUT (unchanged known fields) does not bump updated_at', async () => {
    createKanbanCard({ id: 'c2', title: 'Card two', status: 'planned' })
    const before = getKanbanCard('c2')!
    await new Promise((r) => setTimeout(r, 1100))
    const { ctx, out } = putCtx('c2', { status: 'planned', title: 'Card two' })
    expect(await tryHandleKanban(ctx)).toBe(true)
    expect(out.status).toBe(200)
    expect(getKanbanCard('c2')!.updated_at).toBe(before.updated_at)
  })

  it('a real change still writes and bumps updated_at', async () => {
    createKanbanCard({ id: 'c3', title: 'Card three', status: 'planned' })
    const before = getKanbanCard('c3')!
    await new Promise((r) => setTimeout(r, 1100))
    const { ctx, out } = putCtx('c3', { status: 'in_progress' })
    expect(await tryHandleKanban(ctx)).toBe(true)
    expect(out.status).toBe(200)
    const after = getKanbanCard('c3')!
    expect(after.status).toBe('in_progress')
    expect(after.updated_at).toBeGreaterThan(before.updated_at)
  })

  it('accepts the dashboard whole-card PUT (read-only fields + embedded arrays)', async () => {
    createKanbanCard({ id: 'c4', title: 'Card four', status: 'planned', assignee: 'samu' })
    const card = getKanbanCard('c4')!
    // shape of web/app.js's { ...card, assignee } send: base columns + seq +
    // last_status_at + the GET-embedded labels/blockers arrays (echoed as stored).
    const { ctx, out } = putCtx('c4', {
      ...card,
      seq: 4,
      last_status_at: card.created_at,
      labels: [],
      blockers: [],
      assignee: 'zara',
    })
    expect(await tryHandleKanban(ctx)).toBe(true)
    expect(out.status, JSON.stringify(out.body)).toBe(200)
    expect(getKanbanCard('c4')!.assignee).toBe('zara')
  })

  it('a CHANGED blockers value is refused and names the blockers endpoint (merge 88c366f2)', async () => {
    createKanbanCard({ id: 'c5', title: 'Card five', status: 'planned' })
    createKanbanCard({ id: 'c6', title: 'Blocker', status: 'planned' })
    const { ctx, out } = putCtx('c5', { blockers: [{ id: 'c6' }], assignee: 'zara' })
    expect(await tryHandleKanban(ctx)).toBe(true)
    expect(out.status).toBe(400)
    expect(out.body.error).toContain('/blockers')
    expect(getKanbanCard('c5')!.assignee).toBeNull()
  })
})
