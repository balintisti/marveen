import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bootstrapBanner } from '../web.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// A BELEPESI LINK (kartya 6c8937d2).
//
// A LELET: nem egy naplo irt rossz cimet, hanem KET UZENET allt KET FAJLBAN.
//     dashboard.log        "http://localhost:3420"     36x, token NELKUL
//     dashboard.error.log  "127.0.0.1:3420/?token="    18x
// Vagyis a konnyen elerheto cim az volt, amivel NEM lehet belepni, a mukodo
// link pedig egy HIBA-naploban allt -- amit pont akkor nem nyit ki senki,
// amikor minden mukodik.
//
// ES A MASODIK FELE: a `localStorage` ORIGIN-onkent kulon. A `localhost:3420`
// es a `127.0.0.1:3420` a bongeszonek KET KULON tarolo. Ugyanaz a gep, ugyanaz
// a port, ugyanaz a folyamat -- es a kulcs megsem kozos. Aki a 127.0.0.1-es
// linkkel lepett be, majd kesobb `localhost`-ot gepel, kulcs nelkuli oldalra
// erkezik, ES KOZBEN NEM ROMLOTT EL SEMMI.

describe('bootstrapBanner -- mindket origin, mert a bongeszo ketto', () => {
  it('loopback bind eseten MINDKET cimet kiirja', () => {
    const b = bootstrapBanner(3420, '127.0.0.1', 'T0K3N')
    expect(b).toContain('http://localhost:3420/?token=T0K3N')
    expect(b).toContain('http://127.0.0.1:3420/?token=T0K3N')
  })

  it('meg is MONDJA, miert ketto -- kulonben velelen ismetlesnek latszik', () => {
    expect(bootstrapBanner(3420, '127.0.0.1', 'x')).toMatch(/KET KULON tarolo/)
  })

  it('NEM loopback bind eseten CSAK a valodi hostot irja ki', () => {
    // Ha a WEB_HOST mas, a `localhost` olyan cim lenne, amin a szolgaltatas nem
    // is figyel. Egy magabiztos, de hamis sor rosszabb, mint egy sor.
    const b = bootstrapBanner(3420, '10.0.0.5', 'x')
    expect(b).toContain('http://10.0.0.5:3420/?token=x')
    expect(b).not.toContain('localhost')
    expect(b).not.toContain('127.0.0.1')
  })

  it('a ::1 is loopback', () => {
    expect(bootstrapBanner(3420, '::1', 'x')).toContain('localhost')
  })

  it('a TOKEN benne van -- ez a lenyeg, ezert letezik a sor', () => {
    // A regi normal-naploi sor (`Web dashboard: http://localhost:3420`) EPP a
    // tokent nem tartalmazta, es epp ezert volt hasznalhatatlan belepesre.
    expect(bootstrapBanner(3420, '127.0.0.1', 'SECRET')).toContain('token=SECRET')
  })
})

describe('a BEKOTES -- a link a NORMAL naploba menjen', () => {
  const SRC = readFileSync(join(ROOT, 'src', 'web.ts'), 'utf-8')

  it('a banner STDOUT-ra megy, nem stderr-re', () => {
    // launchd: StandardOutPath -> dashboard.log | StandardErrorPath -> dashboard.error.log
    // A stderr-es valtozat 18-szor a HIBA-naploba tette a mukodo linket.
    expect(SRC).toContain('process.stdout.write(bootstrapBanner(')
    expect(SRC).not.toMatch(/process\.stderr\.write\(\s*`?\\nDashboard access URL/)
  })

  it('a token TOVABBRA SEM megy a pino-folyamba', () => {
    // Ez az EREDETI kikotes, es valtozatlanul all: a strukturalt naplot
    // szallitjak es parszoljak, tehat oda nem kerulhet hitelesito adat.
    // A `logger.*` hivasok kozul egyik sem kaphatja meg a tokent.
    const loggerCalls = SRC.match(/logger\.(info|warn|error|debug)\([^\n]*/g) ?? []
    for (const call of loggerCalls) {
      expect(call, `pino-hivas tokennel: ${call}`).not.toContain('DASHBOARD_TOKEN')
    }
  })
})
