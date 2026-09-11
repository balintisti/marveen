import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, getDb } from '../db.js'
import { tryHandleMessages } from '../web/routes/messages.js'
import { MAIN_AGENT_ID } from '../config.js'

// Kartya 4689f10b. A `from` HAROM kapun megy at ebben a fajlban (coordinator-forgery,
// federation-spoof, isKnownAgent); a slash-mentes `to` EDDIG EGYIKEN SEM -- a kod sajat
// kommentje mondta ki: "Local (slash-free) recipients are untouched".
//
// A KAR ALAKJA, es ezert nem kozmetikai: egy ELGEPELT agens-nev 200-at es `pending`-et kap.
// A lap sajat szabalya szerint a `pending` AZ AZ ALLAPOT, amire kifejezetten azt mondjuk,
// hogy NE kuldd ujra -- tehat a kuldo helyesen var egy uzenetre, ami sosem fog megerkezni,
// ~1 orat, az elhagyasi ablakig.
//
// MERVE 2026-09-03 a teljes tablan: 14 kulonbozo cimzettbol 7 valodi agens, a masik 7-bol
// 6 szandekos proba -- MIND `failed`. Ez a kapu tehat semmit nem zart volna el, amit valaha
// kezbesitettunk.

beforeEach(() => { initDatabase(':memory:') })

async function post(payload: unknown): Promise<{ status: number; body: any }> {
  const req = Readable.from([Buffer.from(JSON.stringify(payload))]) as unknown as http.IncomingMessage
  ;(req as { method?: string }).method = 'POST'
  ;(req as { headers?: unknown }).headers = {}
  let status = 200
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string | Buffer) { if (data) chunk = Buffer.isBuffer(data) ? data.toString() : data },
  } as unknown as http.ServerResponse
  const url = new URL('http://x/api/messages')
  const handled = await tryHandleMessages(
    { req, res, path: '/api/messages', method: 'POST', url } as never,
  )
  expect(handled, 'a route nem kezelte a POST-ot').toBe(true)
  return { status, body: chunk ? JSON.parse(chunk) : null }
}

function rowCount(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM agent_messages').get() as { n: number }).n
}

describe('POST /api/messages -- a LOKALIS cimzett ellenorzese (4689f10b)', () => {
  it('ISMERETLEN cimzett: 400, es NEM tarolodik', async () => {
    const before = rowCount()
    const r = await post({ from: MAIN_AGENT_ID, to: 'dexxter', content: 'elgepelt nev' })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('dexxter')
    expect(rowCount(), 'a sor NEM kerulhet be: epp az a kar, hogy pendingben ul').toBe(before)
  })

  // A HIBAUZENET SOROLJA FEL A HELYES NEVEKET. Egy csupasz "unknown recipient" ugyanolyan
  // nema, mint a hallgatas volt: a leggyakoribb ok egy ELIRAS, es azt a lista javitja.
  it('a hibauzenet MEGNEVEZI a lehetseges cimzetteket', async () => {
    const r = await post({ from: MAIN_AGENT_ID, to: 'nincs-ilyen-agens', content: 'x' })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('known:')
    expect(r.body.error).toContain(MAIN_AGENT_ID)
  })

  // POZITIV KONTROLL, es nem szorgalmi: egy kapu, ami MINDENT elutasit, ugyanugy atmenne az
  // elso ket teszten. Ez az, ami megkulonbozteti a mukodo kaput a torottol.
  it('ISMERT cimzett TOVABBRA IS atmegy, es tarolodik', async () => {
    const before = rowCount()
    const r = await post({ from: MAIN_AGENT_ID, to: MAIN_AGENT_ID, content: 'valodi cimzett' })
    expect(r.status, `a valodi cimzettet nem szabad elzarni: ${JSON.stringify(r.body)}`).toBe(200)
    expect(r.body.id).toBeGreaterThan(0)
    expect(rowCount()).toBe(before + 1)
  })

  // A KETTOSPONTOS ALAK MAR KAPUZOTT VOLT -- ez a regresszio, hogy az uj `else` ag ne vegye el.
  it('a `federation:x:y` alak TOVABBRA IS a sajat, pontosabb hibajat adja', async () => {
    const r = await post({ from: MAIN_AGENT_ID, to: 'federation:teodor:teodor', content: 'x' })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('slash')
  })

  it('hianyzo `to`: valtozatlanul a kotelezo-mezo hiba, nem az uj kapu', async () => {
    const r = await post({ from: MAIN_AGENT_ID, to: '   ', content: 'x' })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('required')
  })
})
