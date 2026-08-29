import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import SuiteSizeGuard from './setup/suite-size-guard.js'

// A RIPORTER BEKOTESE -- ez az, amit a meglevo keszlet NEM merte (kartya 30e04d76).
//
// A `suite-size-guard.test.ts` alaposan fedi a DONTEST: 34 allitas a
// `zeroTestFiles`, `evaluateSuiteSize`, `countTests`, `floorFor`, `isFilteredRun`
// tiszta fuggvenyekre. Amit egyikuk sem allit: hogy a RIPORTER hivja-e oket.
// Merve 2026-08-24: a fajl nulla helyen emliti a `SuiteSizeGuard`-ot, az
// `onFinished`-et es a `process.exitCode`-ot.
//
// Ez pontosan a `jelenlet-vagy-megfeleltetes` alak, es ennel az ornel a legdragabb:
// ha valaki kiveszi a `zeroTestFiles` hivast az `onFinished`-bol, vagy elhagyja a
// `process.exitCode = 1` sort, MINDEN teszt zold marad -- es az or, aminek epp az a
// dolga, hogy egy nema kiesest megfogjon, maga nemul el. Ugyanaz a hiba, egy
// szinttel feljebb.
//
// KET GLOBALIS ALLAPOTOT KELL VISSZAADNI, es ez nem kozmetika:
//   process.exitCode -- ha egy teszt 1-en hagyja, a vitest-folyamat NEM NULLAVAL lep
//                       ki, hiaba zold minden teszt. A keszlet sajat magat buktatna.
//   process.argv     -- a (B) ag `isFilteredRun`-nal korai visszaterest ad. Enelkul
//                       ez a fajl mast merne celzott futasban, mint a teljesben.

type TaskLike = { type: 'test'; name: string; result?: { state: string } }
type FileLike = { name: string; tasks: TaskLike[] }

const test1 = (name: string): TaskLike => ({ type: 'test', name, result: { state: 'pass' } })
const file = (name: string, n: number): FileLike =>
  ({ name, tasks: Array.from({ length: n }, (_, i) => test1(`${name}#${i}`)) })

describe('SuiteSizeGuard -- a riporter tenyleg hivja az oroket', () => {
  // A tipus szandekosan a process.exitCode SAJAT tipusa, nem egy szukitese:
  // a Node-ban `string | number | null | undefined`, es egy szukebb tipus itt
  // csak a visszaallitast tudna elrontani.
  let exitCodeBefore: typeof process.exitCode
  let argvBefore: string[]
  let stderr: string

  beforeEach(() => {
    exitCodeBefore = process.exitCode
    argvBefore = process.argv
    stderr = ''
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      stderr += String(chunk)
      return true
    }) as typeof process.stderr.write)
    // Teljes futasnak latszo argv: enelkul a (B) ag `isFilteredRun` miatt kimarad,
    // es ez a fajl celzott futasban mast merne, mint a teljes keszletben.
    process.argv = ['node', 'vitest', 'run']
  })
  afterEach(() => {
    vi.restoreAllMocks()
    process.argv = argvBefore
    // A LEGFONTOSABB SOR EBBEN A FAJLBAN. Az or SIKERES lefutasa 1-re allitja a
    // process.exitCode-ot; ha itt nem allitjuk vissza, a teljes keszlet nem-nullaval
    // lep ki minden zold teszt mellett -- vagyis a bekotest mero teszt maga valna
    // nema hibava.
    process.exitCode = exitCodeBefore
  })

  it('(A) EGY nulla tesztes fajl -> a riporter ir stderr-re ES 1-re allitja a kilepesi kodot', () => {
    // Ez az EREDETI eset: egy fajl, ami collect-idoben elszallt, `tasks: []`-vel jut
    // el a riporterig -- bent marad a listaban, csak nem ad tesztet.
    //
    // AZ ALAPVONAL ENV-BOL JON, ES EZ NEM MASOLAS A LENTI TESZTBOL -- MERT NELKULE EZ AZ
    // ALLITAS HAMISAN ZOLD (didi merte, 2026-08-24). A beforditott alapvonallal (289/3929)
    // ez a ket szintetikus fajl ZSUGORODAS, tehat a (B) ag IS tuzel, es AZ allitja 1-re a
    // kilepesi kodot. Az `expect(process.exitCode).toBe(1)` igy akkor is teljesult, ha az
    // (A) ag sajat sorat kivettuk -- vagyis a teszt neve allitott valamit, amit nem mert.
    // Bizonyitva: az (A) ag exitCode-sorat torolve NEM ez a teszt bukott, hanem a lenti
    // "CELZOTT futasban..." -- az volt az EGYETLEN, ami tenylegesen fogta.
    //
    // ES AMI EBBEN A LEGTANULSAGOSABB: ugyanez a mechanizmus az "EGESZSEGES lista"
    // tesztnel HAMIS PIROSAT adott, es azt eszrevettem, mert a piros megallit. Itt HAMIS
    // ZOLDET ad, es epp azert nem tunt fel, mert a zoldet senki nem vizsgalja meg.
    // Ugyanaz az ok, ellentetes irany.
    // AZ ALAPVONAL A FIXTURE SAJAT MERETE, NEM egy tetszoleges 1/1 (javitva 2026-08-29).
    // A trunk kozben kapott egy HARMADIK agat, az "ALAPVONAL ELAVULT" jelzest, ami akkor
    // szolal meg, ha a sodrodas eleri egy ATLAGOS fajl mereteit: drift >= ceil(tests/files).
    // 1/1-es alapvonal mellett ez a kuszob 1, tehat BARMELY fixture atlepi -- vagyis nem a
    // KOVETELMENY avult el, hanem a FIXTURE. Az alapvonal ezert a fixture sajat merete:
    // itt 2 fajl / 5 teszt -> drift 0, tehat a kilepesi kod bizonyithatoan az (A) agtol jon.
    process.env['SUITE_BASELINE_FILES'] = '2'
    process.env['SUITE_BASELINE_TESTS'] = '5'
    try {
      new SuiteSizeGuard().onFinished([
        file('ep.test.ts', 5),
        { name: 'elszallt.test.ts', tasks: [] },
      ] as never)
      expect(stderr).toMatch(/VAN FAJL, AMI EGYETLEN TESZTET SEM ADOTT/)
      expect(stderr).toContain('elszallt.test.ts')
      expect(process.exitCode).toBe(1)
      // Es hogy a kilepesi kod TENYLEG az (A) agtol jon: a (B) ag uzenete NEM lehet ott.
      expect(stderr).not.toMatch(/ALAPVONAL/)
    } finally {
      delete process.env['SUITE_BASELINE_FILES']
      delete process.env['SUITE_BASELINE_TESTS']
    }
  })

  it('EGESZSEGES lista -> NEM ir semmit, es NEM nyul a kilepesi kodhoz', () => {
    // A par nelkul az elozo teszt csak annyit bizonyitana, hogy a riporter neha ir.
    //
    // AZ ALAPVONALAT ITT IS ENV-BOL ADJUK, ES EZT A TESZT MAGA TANITOTTA MEG: elsore
    // a BEFORDITOTT alapvonalhoz (289 fajl / 3929 teszt) mert, es a ket szintetikus
    // fajl ahhoz kepest ZSUGORODASNAK latszott -- a (B) ag jogosan szolalt meg, es a
    // teszt piros lett egy olyan allitason, aminek semmi koze a bekoteshez.
    // AZ ALAPVONAL A FIXTURE SAJAT MERETE, NEM egy tetszoleges 1/1 (javitva 2026-08-29).
    // A trunk kozben kapott egy HARMADIK agat, az "ALAPVONAL ELAVULT" jelzest, ami akkor
    // szolal meg, ha a sodrodas eleri egy ATLAGOS fajl mereteit: drift >= ceil(tests/files).
    // 1/1-es alapvonal mellett ez a kuszob 1, tehat BARMELY fixture atlepi -- vagyis nem a
    // KOVETELMENY avult el, hanem a FIXTURE. Az alapvonal ezert a fixture sajat merete:
    // itt 2 fajl / 7 teszt -> drift 0, egyik alapvonal-ag sem szolal meg.
    process.env['SUITE_BASELINE_FILES'] = '2'
    process.env['SUITE_BASELINE_TESTS'] = '7'
    try {
      process.exitCode = undefined
      new SuiteSizeGuard().onFinished([file('a.test.ts', 3), file('b.test.ts', 4)] as never)
      expect(stderr).toBe('')
      expect(process.exitCode).toBeUndefined()
    } finally {
      delete process.env['SUITE_BASELINE_FILES']
      delete process.env['SUITE_BASELINE_TESTS']
    }
  })

  it('(B) ZSUGORODO keszlet -> a riporter az alapvonal-agat is elsuti', () => {
    // Az alapvonalat env-bol adjuk at, hogy a teszt ne a beforditott szamtol fuggjon:
    // az minden baseline-frissiteskor valtozna, es akkor ez a teszt a FRISSITEST
    // buktatna, nem a bekotes elromlasat.
    process.env['SUITE_BASELINE_FILES'] = '2'
    process.env['SUITE_BASELINE_TESTS'] = '100'
    try {
      new SuiteSizeGuard().onFinished([file('a.test.ts', 1), file('b.test.ts', 1)] as never)
      expect(stderr).toMatch(/\S/)
      expect(process.exitCode).toBe(1)
    } finally {
      delete process.env['SUITE_BASELINE_FILES']
      delete process.env['SUITE_BASELINE_TESTS']
    }
  })

  it('CELZOTT futasban a (B) ag HALLGAT, de az (A) ag NEM', () => {
    // Ez a megkulonboztetes maga a lap kikotese: egy celzott futas TERMESZETESEN
    // kevesebb tesztet ad, es egy or, ami ezt bukasnak jelenti, a helyes hasznalatot
    // bunteti. Az (A) ag viszont reszhalmazon is ervenyes: egy collect-hiba akkor is
    // collect-hiba, ha egyetlen fajlt kertel.
    process.argv = ['node', 'vitest', 'run', 'src/__tests__/valami.test.ts']
    process.env['SUITE_BASELINE_FILES'] = '2'
    process.env['SUITE_BASELINE_TESTS'] = '100'
    try {
      process.exitCode = undefined
      new SuiteSizeGuard().onFinished([file('a.test.ts', 1)] as never)
      expect(stderr).toBe('')
      expect(process.exitCode).toBeUndefined()

      process.exitCode = undefined
      stderr = ''
      new SuiteSizeGuard().onFinished([{ name: 'elszallt.test.ts', tasks: [] }] as never)
      expect(stderr).toMatch(/EGYETLEN TESZTET SEM ADOTT/)
      expect(process.exitCode).toBe(1)
    } finally {
      delete process.env['SUITE_BASELINE_FILES']
      delete process.env['SUITE_BASELINE_TESTS']
    }
  })

  it('a dokumentalt kikapcsolo (SUITE_SIZE_GUARD=off) tenyleg kikapcsol', () => {
    // Nem azert van teszt alatta, mert jo, hogy letezik, hanem mert ha CSENDBEN
    // elromlik (pl. atnevezik a valtozot), az or kikapcsolhatatlan lesz -- es a
    // kovetkezo ember a fajlt fogja torolni helyette.
    process.env['SUITE_SIZE_GUARD'] = 'off'
    try {
      process.exitCode = undefined
      new SuiteSizeGuard().onFinished([{ name: 'elszallt.test.ts', tasks: [] }] as never)
      expect(stderr).toBe('')
      expect(process.exitCode).toBeUndefined()
    } finally {
      delete process.env['SUITE_SIZE_GUARD']
    }
  })

  it('files nelkul (a vitest ezt is atadhatja) NEM omlik ossze', () => {
    process.exitCode = undefined
    expect(() => new SuiteSizeGuard().onFinished(undefined)).not.toThrow()
    expect(process.exitCode).toBeUndefined()
  })
})
