import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, getKanbanCard, archiveKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

// Kartya 66454b7d, mert eset 2026-08-22 06:50 (`4a9480b2`): 03:21-kor archivaltak, 03:59-kor
// MAS atirta rajta a cimet, a felelost es a prioritast. Az atiras nem erintette az
// `archived_at`-et, tehat a kartya egyszerre volt archivalt ES `planned` -- az UJ FELELOS
// SOHA NEM LATTA VOLNA, mert o a listat nezi, az meg `archived_at IS NULL`-ra szur.
//
// A CSALAD LEGNEHEZEBB VALTOZATA: nem egy muvelet hallgat. MINDKET muvelet sikeres volt, es
// a res A KETTO KOZOTT keletkezett -- egyik sem tudott a masikrol.

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
  expect(handled).toBe(true)
  return { status, body: chunk ? JSON.parse(chunk) : null }
}

// A fixture ALAPBOL NEM ad assignee-t: egy nem-ures elozo ertek FELULIRASNAK szamit, es akkor a
// valasz az `overwritten` agon megy, ahol a mezonev szandekosan `archivedWarning`. Amelyik teszt
// a sima agat meri, ures mezot ir; amelyik a ketto egyuttallasat, az ad kezdoerteket.
function card(id: string, extra: Record<string, unknown> = {}): void {
  createKanbanCard({ id, title: 'proba', status: 'planned', ...extra })
}

describe('PUT /api/kanban/<id> -- archivalt kartya szerkesztese (66454b7d)', () => {
  it('AZ ESET: archivalt kartyan felelost irunk -> 200, DE a valasz kimondja es megnevezi az unarchive-ot', async () => {
    card('arch1111')
    archiveKanbanCard('arch1111')
    const r = await put('arch1111', { assignee: 'dexter' })
    expect(r.status).toBe(200)
    expect(r.body.archived).toBe(true)
    expect(r.body.warning).toContain('ARCHIVALT')
    expect(r.body.warning).toContain('/unarchive')
    // Az iras MEGTORTENT: nem tiltas, hanem lathatova tetel.
    expect(getKanbanCard('arch1111')!.assignee).toBe('dexter')
    // Es az archivaltsag NEM oldodott fel magatol -- azt nem dontjuk el a hivo helyett.
    expect(getKanbanCard('arch1111')!.archived_at).not.toBeNull()
  })

  // A LEGFONTOSABB KONTROLL: egy or, ami a HELYES allapotra is tuzel, par kor alatt zaj lesz.
  it('ELO kartyan NINCS figyelmeztetes', async () => {
    card('live2222')
    const r = await put('live2222', { assignee: 'dexter' })
    expect(r.status).toBe(200)
    expect(r.body.warning).toBeUndefined()
    expect(r.body.archived).toBeUndefined()
  })

  // SZANDEK-SZURES, ugyanaz, mint a szomszedos kapunal: aki MAGA kuldi az `archived_at`-et,
  // eppen az archivalasi allapotot kezeli -- annak nem szolunk.
  it('ha a hivo MAGA kuldi az `archived_at`-et, nincs figyelmeztetes', async () => {
    card('arch3333')
    archiveKanbanCard('arch3333')
    const r = await put('arch3333', { archived_at: null, assignee: 'dexter' })
    expect(r.status).toBe(200)
    // Az ARCHIV-figyelmeztetes hianyat allitjuk, NEM a felulirasét: az `archived_at` nullazasa
    // maga is egy nem-ures ertek felulirasa, tehat az `overwritten` ag HELYESEN tuzel. Epp
    // ezert van a ketto KULON mezoben -- ez a teszt ezt a szetvalasztast is meri.
    expect(r.body.archived).toBeUndefined()
    expect(r.body.archivedWarning).toBeUndefined()
    expect(getKanbanCard('arch3333')!.archived_at).toBeNull()
  })

  // A `unchanged` AG IS: egy no-op szerkesztes archivalt kartyan ugyanugy lathatatlan allapotot
  // hagy maga utan -- ha ott hallgatnank, a szerkeszto pont a leggyakoribb uton nem tudna meg.
  it('VALTOZATLAN mezokkel (`unchanged`) is szol', async () => {
    card('arch4444', { assignee: 'friday' })
    archiveKanbanCard('arch4444')
    const r = await put('arch4444', { assignee: 'friday' })
    expect(r.body.changed).toBe(false)
    expect(r.body.archived).toBe(true)
    expect(r.body.warning).toContain('ARCHIVALT')
  })

  // KET FIGYELMEZTETES EGY VALASZBAN, KULON MEZOBEN: a felulirasbol es az archivaltsagbol MAS
  // teendo kovetkezik, es egy osszevont szoveg az egyiket elnyelne.
  it('felulirassal EGYUTT: mindket figyelmeztetes megjelenik, kulon', async () => {
    card('arch5555', { assignee: 'mandark' })
    archiveKanbanCard('arch5555')
    const r = await put('arch5555', { assignee: 'dexter' })
    expect(r.body.overwritten?.length).toBeGreaterThan(0)
    expect(r.body.warning).toContain('felul')
    expect(r.body.archived).toBe(true)
    expect(r.body.archivedWarning).toContain('/unarchive')
  })
})
