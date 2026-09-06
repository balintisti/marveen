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

    // ARGUMENTUM-HATOKOR, nem fajl-hatokor (didi merte 2026-09-06, f3808792 komment 3): egy
    // fajl-hatokoru `toContain` NEMAN atengedi azt a refaktort, ami a literalt a helyen hagyja
    // (kommentben, konstansban) es a HIVASBOL veszi ki -- vagyis pontosan azt az iranyt, amiert
    // ez a pin letezik. Merve: az ok kivetele az 1. hivasbol 5/5 ZOLDET hagyott.
    const argsOf = (needle: string): string[][] =>
      src.split(needle).slice(1).map((tail) => {
        let depth = 1
        let i = 0
        for (; i < tail.length && depth > 0; i++) {
          if ('([{'.includes(tail[i]!)) depth++
          else if (')]}'.includes(tail[i]!)) depth--
        }
        const inner = tail.slice(0, i - 1)
        const args: string[] = []
        let d = 0
        let cur = ''
        for (const ch of inner) {
          if ('([{'.includes(ch)) d++
          else if (')]}'.includes(ch)) d--
          if (ch === ',' && d === 0) { args.push(cur.trim()); cur = '' } else cur += ch
        }
        if (cur.trim() !== '') args.push(cur.trim())
        return args
      })

    const calls = argsOf('buildUnreadableNotice(')
    expect(calls).toHaveLength(2)                       // a populacio, kimondva

    // STRUKTURA 1 -- ARITY: mindket hivas NEGY argumentumot ad at.
    // AMIT EGYEDUL O FOG, es ez didi matrixabol derult ki (2026-09-06): NEM az "ok kiesik a
    // hivasbol" eset -- azt NEGY assert fogja, tehat ott az arity nem teherhordo. Az egyetlen
    // csalad, ahol egyedul all: egy OTODIK argumentum (`..., reason, extra)`) -- ott a backtick,
    // a sortores es a kotes MIND ZOLD. Egy parameter hozzaadasa hetkoznapi refaktor, tehat ez
    // nem diszlet; csak nem azon a csaladon keresi meg a helyet, amit a nevehez irtunk.
    for (const args of calls) expect(args).toHaveLength(4)

    // STRUKTURA 2 -- A VAGAS EPSEGE, es ez didi merese nyoman kerult ide (f3808792, 2026-09-06).
    // Az `argsOf` zarojelet SZAMOL es nem tud sztringrol: egy paratlan zarojel a UZENET-SZOVEGBEN
    // korabban (vagy kesobb) vagja el az argumentumot. Merve: a vagas ilyenkor is NEGY argumentumot
    // ad, tehat az arity ZOLD marad -- a hibas vagas jele az, hogy a toredek PARATLAN szamu
    // backtickot hordoz. Ez az allitas PROZA-FUGGETLEN.
    // KORAI vagas (paratlan ZARO zarojel): a toredek paratlan szamu backtickot hordoz.
    for (const args of calls) expect(args[3]!.split('`').length % 2).toBe(1)
    // KESEI vagas (paratlan NYITO zarojel): a toredek ATFUT a hivason es SORTOREST nyel. Merve:
    // ott az arity 4 MARAD es a zarojelek is kiegyensulyozottak (3/3), tehat sem az arity, sem a
    // zarojel-parositas nem fogja -- ez a ket assert egyutt hatarolja a vagast MINDKET iranybol.
    // KIMONDOTT KORLAT: ma mindket hivas 4. argumentuma EGY soros. Egy szandekosan tobbsoros
    // negyedik argumentum ezt megbuktatna -- HANGOS, alak-valtozasra, nem prozara.
    for (const args of calls) expect(args[3]!).not.toContain('\n')

    // KOTES-AZONOSSAG: a 4. argumentum azt az AZONOSITOT hordozza, ami az OKOT viszi -- nem egy
    // konkret megfogalmazast. didi merte, hogy a regi, PROZARA horgonyzott alak egy sima
    // ATFOGALMAZASRA is pirosra ment, es az sokkal kozonsegesebb szerkesztes, mint egy hoist:
    // egy hamis riasztas, aminek a kezenfekvo "javitasa" az azonossag fellazitasa -- utana a
    // null-helyettesites es a hibas vagas NEMAN atmegy, mikozben az arity zolden orzottnek latszik.
    // KIMONDOTT KORLAT: a literal valtozoba emelese ezt TOVABBRA IS megbuktatja (a hangos irany).
    expect(calls[0]![3]).toContain('${why}')
    expect(calls[1]![3]).toContain('seriesProbe.reason')
  })
})
