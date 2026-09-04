/**
 * A TELITETTSEG-MEGTAGADAS ALLAPOT-VALTOZASONKENT NAPLOZ (kartya f3c6054e).
 *
 * MERVE: a `store/dashboard.log` 311 730 sorabol 16 975 ez az EGY sor -- 5,4% --, 465 aktiv
 * percben atlag 36,5/perc, csucson 326 sor EGYETLEN percben. Kontroll ugyanabban a naploban:
 * 'error' 983. Egy HELYES dontes 326-szor egy percben hibanak olvasodik, es a naplo 5,4%-a
 * ugyanazt a valtozatlan tenyt ismetli.
 *
 * A MEGTAGADAS NEM VALTOZIK -- csak a naplozas gyakorisaga.
 *
 * ES AMIERT A `warn` MEGMARAD AZ ALLAPOT-VALTASOKON: a fajl docblockja szerint ez a sor az
 * egyetlen jel, hogy egy sessiont KIVULROL kell ujrainditani. Ha az egesz `debug`-ra menne, egy
 * 100%-on beragadt session NEMA lenne -- ez az `afdd2bd7` mert esete, ahol egy javitas ERROR-rol
 * WARN-ra sorolt at egy bukast es minden severity-szuresu riasztast megvakitott. A 2. es a 4.
 * eset ezt szegezi le, es azok a fontosak, nem az elso.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const warn = vi.fn()
const debug = vi.fn()
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: (...a: unknown[]) => warn(...a), debug: (...a: unknown[]) => debug(...a), error: vi.fn() },
}))

const { noteSaturationRefusal, noteSaturationCleared, _resetSaturationEpisodesForTest } =
  await import('../web/agent-process.js')

beforeEach(() => { warn.mockClear(); debug.mockClear(); _resetSaturationEpisodesForTest() })

describe('dispatch: a telitettseg-megtagadas naplozasa', () => {
  it('az ELSO megtagadas `warn` -- a jelzes megmarad', () => {
    noteSaturationRefusal('s1')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(debug).not.toHaveBeenCalled()
  })

  it('az ISMETLODO megtagadas NEM `warn`, hanem `debug` -- ez a lelet', () => {
    for (let i = 0; i < 50; i++) noteSaturationRefusal('s1')
    expect(warn).toHaveBeenCalledTimes(1)     // 50 kiserlet, EGY warn
    expect(debug).toHaveBeenCalledTimes(49)
  })

  it('a KILEPES `warn`, es magaval viszi a szamlalot', () => {
    for (let i = 0; i < 7; i++) noteSaturationRefusal('s1')
    warn.mockClear()
    noteSaturationCleared('s1')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatchObject({ session: 's1', refusals: 7 })
  })

  it('KILEPES UTAN UJ EPIZOD ISMET `warn` -- a jelzes ujrafegyverzodik', () => {
    noteSaturationRefusal('s1')
    noteSaturationCleared('s1')
    warn.mockClear()
    noteSaturationRefusal('s1')
    expect(warn).toHaveBeenCalledTimes(1)     // nem nyelte el a korabbi epizod
  })

  it('KONTROLL: a kilepes NEM szol, ha nem volt epizod (nincs zaj a normal uton)', () => {
    noteSaturationCleared('s-tiszta')
    expect(warn).not.toHaveBeenCalled()
    expect(debug).not.toHaveBeenCalled()
  })

  it('sessiononkent KULON epizod', () => {
    noteSaturationRefusal('a'); noteSaturationRefusal('b')
    expect(warn).toHaveBeenCalledTimes(2)     // ket kulon session, ket jelzes
    noteSaturationRefusal('a')
    expect(warn).toHaveBeenCalledTimes(2)     // az 'a' ismetlese mar nem
  })
})

/**
 * A BEKOTES -- mert a fenti hat eset a HELPERT meri, es zold marad akkor is, ha a hivasi hely
 * visszateszi a nyers `logger.warn`-t. Ezt ma egyszer mar megmertem egy masik kartyan: a
 * fuggveny zold volt, a bekotest semmi nem allitotta, es a mutacio TULELTE.
 */
describe('bekotes: a hivasi hely tenyleg a helpert hasznalja', () => {
  const body = (() => {
    const src = readFileSync(new URL('../web/agent-process.ts', import.meta.url), 'utf8')
    const i = src.indexOf('export async function isSessionReadyForPrompt')
    return src.slice(i, src.indexOf('\nexport ', i + 10))
  })()

  it('mindket megtagadasi ag a helpert hivja', () => {
    expect(body.split('noteSaturationRefusal(session)').length - 1).toBe(2)
  })

  it('a NEM-telitett ag jelzi a kilepest', () => {
    expect(body).toContain('noteSaturationCleared(session)')
  })

  it('a NYERS logger.warn ELTUNT innen -- kulonben visszater az elarasztas', () => {
    expect(body).not.toContain("logger.warn({ session }, 'dispatch: refusing prompt")
  })
})

/**
 * A TESZT-VARRAT MARADJON TESZT-VARRAT -- marveen kikotese (k6), es a kifogas valodi volt.
 *
 * A harom export (`noteSaturationRefusal`, `noteSaturationCleared`, `_resetSaturationEpisodesForTest`)
 * azert van, hogy a VISELKEDESRE lehessen allitani. A kockazat, amit marveen megnevezett: egy
 * exportalt fuggveny IDOVEL produkcios hivot szerezhet, es akkor a "csak teszt" jelzo prozava valik.
 *
 * Ezert nem konvencio orzi (`_ForTest` utotag az OLVASONAK szol), hanem ez a kapu: **egyetlen
 * produkcios modul sem importalhatja oket.** Igy a felulet-kockazat MERT nulla, nem remelt nulla --
 * es ha valaki kesobb behuzza, HANGOSAN bukik, nem csendben.
 */
describe('a teszt-varrat nem szivarog produkcios kodba', () => {
  const SEAMS = ['noteSaturationRefusal', 'noteSaturationCleared', '_resetSaturationEpisodesForTest']
  const SRC = new URL('../', import.meta.url).pathname

  /** Minden .ts a `src/` alatt, a teszteket es magat a definialo fajlt KIVEVE. */
  function productionFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (name !== '__tests__' && name !== 'node_modules') productionFiles(full, out)
      } else if (name.endsWith('.ts') && !full.endsWith('web/agent-process.ts')) {
        out.push(full)
      }
    }
    return out
  }

  const files = productionFiles(SRC)

  it('POZITIV KONTROLL: a mero LAT -- van mit atnezni, es a teszt-fajl IGENIS importalja', () => {
    expect(files.length).toBeGreaterThan(50)          // kulonben a nulla ures halmazon allna
    // ES A REKURZIO IS: egy darabszam onmagaban ATMEGY akkor is, ha a bejaras csak a felso
    // szintet latja -- megmerve, a `src/` gyokere egymaga tobb mint 50 fajl. Egy ALKONYVTARBAN
    // levo fajlnak is benne kell lennie, kulonben a cenzus a fa nagy reszet nem nezi meg.
    expect(files.some(f => f.includes('/web/'))).toBe(true)
    const self = readFileSync(new URL(import.meta.url), 'utf8')
    for (const s of SEAMS) expect(self).toContain(s)  // a mero a sajat importunkat megtalalja
  })

  it('egyetlen produkcios modul sem importalja a varratokat', () => {
    const leaks: string[] = []
    for (const f of files) {
      const body = readFileSync(f, 'utf8')
      for (const s of SEAMS) if (body.includes(s)) leaks.push(`${f}: ${s}`)
    }
    expect(leaks).toEqual([])
  })
})
