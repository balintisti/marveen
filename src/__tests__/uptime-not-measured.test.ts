/**
 * A "NEM MERTEM" ES A "MERTEM, ES NULLA" KET KULONBOZO FEJLEC (kartya f3808792).
 *
 * A MERT ESET: a riasztas MA tuzelt, kozvetlenul egy eles merge elott, ezzel a szoveggel:
 *
 *     [uptime] NO UPTIME DATA AT ALL -- zero series returned. ... production may be down right
 *     now and this path cannot see it. (poller could not reach gcloud -- access token: gcloud
 *     timed out after 15000 ms)
 *
 * A "zero series returned" allitas arrol szol, amit az API VALASZOLT. Itt az API-t meg sem
 * kerdeztuk: a token-proba bukott, es a kod URES tombot adott a dontesnek, amibol `noSeries`
 * lett. A ket allapot ELLENTETES teendot ir elo -- "nincs uptime-ellenorzes, hozz letre egyet"
 * kontra "a poller vak, az eles rendszer AKAR ALLHAT IS".
 *
 * A FAJL EZT MAR TUDTA, CSAK ROSSZ HELYEN MONDTA: mindket hivasi hely UTOTAGKENT fuzte hozza az
 * okot, es a masodik hivo kommentje szo szerint kimondja a kulonbseget. De egy utotag nem utazik:
 * amit idezni fognak, es amire egy severity-szuro illeszt, az a FEJLEC.
 *
 * ES AMIT MEGMERTEM, MERT A KARTYA OKAT NEVEZ: a gcloud ezen a gepen NEM lassu.
 *     gcloud auth print-access-token .... 280 ms (median, 3 minta)
 *     gcloud config get-value project ... 263 ms
 *     a poller kerete .................. 15 000 ms  -> a mert ido 27,6-szorosa
 *     KONTROLL az idomerore: `sleep 2` -> 2146 ms, tehat tud nagy szamot mondani
 * Vagyis a "emeljuk a keretet, mert a gcloud lassu" iranynak NINCS mert alapja; a szetvalasztas
 * viszont a kivalto oktol FUGGETLENUL all. (Amit NEM mertem: mi lassitotta el AKKOR. A leheto
 * legvaloszinubb egy token-FRISSITES halozati kore, de ez hipotezis, nem meres.)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildUnreadableNotice, decideUptimeAlerts, NO_UPTIME_STATE, type UptimeCondition,
} from '../uptime-alert.js'

const NOW = Date.parse('2026-09-06T12:00:00Z')
const COND: UptimeCondition = { durationSeconds: 600, triggerCount: 1 }

/** A dontes, amit a watcher URES tombbel allit elo -- mindket bukasi uton ez keletkezik. */
const noSeriesDecision = () => decideUptimeAlerts([], COND, NO_UPTIME_STATE, NOW)

describe('a fejlec megkulonbozteti a NEM MERT-et a MERT NULLA-tol', () => {
  it('1. A LELET: elerhetetlen API -> NOT MEASURED, es NEM "zero series returned"', () => {
    const d = noSeriesDecision()
    const n = buildUnreadableNotice(d, 0, NOW, 'poller could not reach gcloud -- gcloud timed out after 15000 ms')!
    expect(n).toContain('NOT MEASURED')
    expect(n).not.toContain('zero series returned')
    // az OK a FEJLECBEN all, nem utotagkent
    expect(n).toContain('gcloud timed out after 15000 ms')
    expect(n.indexOf('gcloud timed out')).toBeLessThan(n.length / 2)
  })

  it('2. KONTROLL: elert API es tenyleg nulla sorozat -> a REGI fejlec', () => {
    // Enelkul az 1. eset zold volna egy olyan valtozason is, ami MINDIG "NOT MEASURED"-ot mond --
    // es az elveszitene azt az allapotot, amit a szoveg eredetileg jelolt.
    const d = noSeriesDecision()
    const n = buildUnreadableNotice(d, 0, NOW)!
    expect(n).toContain('zero series returned')
    expect(n).not.toContain('NOT MEASURED')
  })

  it('3. a ket fejlec KULONBOZIK -- ez maga a kartya', () => {
    const d = noSeriesDecision()
    const unreachable = buildUnreadableNotice(d, 0, NOW, 'boom')!
    const measured = buildUnreadableNotice(d, 0, NOW)!
    expect(unreachable).not.toBe(measured)
  })

  it('4. KONTROLL: az URES ok-sztring NEM valt fejlecet', () => {
    // Egy `''` vagy `null` nem "elerhetetlen" -- csak hianyzo indoklas. Ha az is atbillentene,
    // egy elfelejtett parameter nemán atirna egy VALODI mert nullat "nem mertem"-re.
    const d = noSeriesDecision()
    expect(buildUnreadableNotice(d, 0, NOW, '')!).toContain('zero series returned')
    expect(buildUnreadableNotice(d, 0, NOW, null)!).toContain('zero series returned')
  })
})

describe('bekotes: a hivasi helyek TENYLEG atadjak az okot', () => {
  it('5. mindket produkcios hivasi hely a NEGYEDIK argumentummal hiv', () => {
    // A fuggveny magaban INERT, ha a hivok nem adjak at. Ennek a fajlnak MERT tortenete van erre:
    // a `GCLOUD_STDIO` azert lett nevesitett export, mert bare literalkent a bekotest semmi nem
    // allitotta -- tizenot teszt maradt zold egy visszavont javitas mellett.
    const src = readFileSync(new URL('../web/uptime-alert-watcher.ts', import.meta.url), 'utf-8')
    const calls = src.split('buildUnreadableNotice(').slice(1)
    expect(calls).toHaveLength(2)                       // a populacio, kimondva
    // az elso hivas egysoros, a masodik tobbsoros -- mindkettonek hordoznia kell az okot
    expect(src).toContain('`poller could not reach gcloud -- ${why}`')
    expect(src).toContain('seriesProbe.ok ? null : `the timeSeries call FAILED')
  })
})
