import { describe, expect, it } from 'vitest'
import {
  countRanTests,
  countTests,
  evaluateSuiteSize,
  floorFor,
  TOLERANCE_CAP,
  isFilteredRun,
  zeroTestFiles,
  SUITE_BASELINE_FILES,
  SUITE_BASELINE_TESTS,
  baselineStaleMessage,
} from './setup/suite-size-guard.js'

// AZ OR SAJAT TESZTJEI (kartya 30e04d76).
//
// Egy or, aminek nincs tesztje, ugyanaz az alak, ami ellen keszult: allitas
// meres nelkul. A dontesi resze ezert kulon fuggvenyekben all, es itt van
// megmerve -- a riporter maga csak osszekoti oket.
//
// A vegponttol vegpontig valo bizonyitek kulon keszult, VALODI futasokkal
// (a kartyan): valtozatlan keszlet -> hallgat; 12 fajl eltuntetve -> megszolal,
// mikozben az or NELKUL ugyanaz a futas `Tests 3759 passed (3759)`-t es rc=0-t
// adott; collect-hiba -> megnevezi a fajlt; reszhalmaz-futas -> hallgat.

describe('floorFor -- also korlat, nem pontos egyezes', () => {
  it('NULLA TURES: az also korlat MAGA az alapvonal, merettol fuggetlenul', () => {
    // A plafon 0, tehat a `Math.max(5, 2%)` also ag hatastalan. Ez didi ket
    // meresenek a kovetkezmenye: nincs legitim lefele mozgas (200 commit), es a
    // skip/todo sem mozgatja a szamot -- vagyis a turesnek nincs mit fednie.
    for (const b of [100, 400, 3901, 100_000]) {
      expect(floorFor(b), `alapvonal=${b}`).toBe(b)
    }
  })

  it('PLAFON: a tureshatar NEM no tovabb a keszlettel (didi lelete)', () => {
    // Plafon nelkul a tureshatar egyutt nott volna azzal, amit ellenoriz. A mai
    // keszletnel 78, egy ~4850-esnel mar 97 -- vagyis EPP az az eset menne at,
    // amelyik ezt a kartyat szulte. Egy or, ami annal engedekenyebb, minel
    // nagyobb a vedendo felulet, rossz iranyba skalazodik.
    expect(floorFor(3899)).toBe(3899 - TOLERANCE_CAP)
    expect(floorFor(4850)).toBe(4850 - TOLERANCE_CAP)
    expect(floorFor(100_000)).toBe(100_000 - TOLERANCE_CAP)
  })

  it('a kartyat szulo 97-es eset BARMEKKORA keszletnel bukik', () => {
    expect(evaluateSuiteSize(300, 4850 - 97, 300, 4850).ok).toBe(false)
    expect(evaluateSuiteSize(300, 100_000 - 97, 300, 100_000).ok).toBe(false)
  })
})

describe('evaluateSuiteSize -- a (B) alapvonal-ag', () => {
  it('hallgat a pontos alapvonalon', () => {
    expect(evaluateSuiteSize(286, 3879, 286, 3879).ok).toBe(true)
  })

  it('hallgat, ha NOTT a keszlet -- a novekedes nem esemeny', () => {
    // Ez a legfontosabb nem-tuzeles: egy or, ami az uj tesztektol bukik,
    // megtanitja, hogy a jelzese zaj.
    expect(evaluateSuiteSize(300, 4200, 286, 3879).ok).toBe(true)
  })

  it('hallgat PONTOSAN az alapvonalon', () => {
    expect(evaluateSuiteSize(286, 3879 - TOLERANCE_CAP, 286, 3879).ok).toBe(true)
  })

  it('MEGSZOLAL EGYETLEN eltunt tesztre is', () => {
    const r = evaluateSuiteSize(286, 3879 - TOLERANCE_CAP - 1, 286, 3879)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('OSSZEZSUGORODOTT')
  })

  it('megfogta volna a 2026-08-23-i esetet (97 teszt kiesett)', () => {
    // A valodi megfigyeles: 3875 -> 3778. Ez az egyetlen eset, amit tenylegesen
    // lattunk, tehat az or minimumkovetelmenye, hogy ezt megfogja.
    const r = evaluateSuiteSize(285, 3778, 285, 3875)
    expect(r.ok).toBe(false)
  })

  it('a 40 tesztes kieses MAR NEM megy at (a plafon 10-re szorult)', () => {
    // Ez a teszt korabban az ELLENKEZOJET allitotta, 50-es plafonnal. A szam nem
    // ovatossagbol mozdult: didi 200 commitot nezett at, es teszt-fajlt TOROLO
    // commit NULLA volt.
    expect(evaluateSuiteSize(285, 3875 - 40, 285, 3875).ok).toBe(false)
  })

  it('A RES BEZARULT: az (A) ag vaksaga (torolt fajl) mostantol a (B) agon fennakad', () => {
    // Ez a kartya vegallapota. Az (A) ag egy TOROLT fajlt nem lat (didi merte:
    // 287 -> 284, egyszer sem szolalt meg semmi), mert az meg sem jelenik a
    // listaban. Amig volt tures, egy kis torles a KET AG KOZE esett. Nulla
    // turessel mar EGYETLEN teszt eltunese is fennakad a (B) agon.
    expect(evaluateSuiteSize(285, 3875 - 1, 285, 3875).ok).toBe(false)
    expect(evaluateSuiteSize(284, 3875, 285, 3875).ok).toBe(false)
  })

  it('az uzenet megmondja, mit nezzen meg eloszor az olvaso', () => {
    const m = evaluateSuiteSize(200, 2000, 286, 3879).message ?? ''
    expect(m).toContain('Test Files')
    expect(m).toContain('alapvonalat frissitsd')
  })

  it('MEGNEVEZI A PARANCSOT, nem csak a kezzel szerkesztendo fajlt', () => {
    // MERVE 2026-09-02: a 22 osztalyozhato prod-tree-guard megkerulesbol 17 EGYETLEN
    // fajlra ment -- erre. A `scripts/update-suite-baseline.mjs` MAR LETEZETT, es
    // sehol nem hivatkozott ra semmi, amit egy agens olvas: CLAUDE.md 0, skillek 0,
    // es ez az uzenet sem. Kontroll: a `card-comment.sh` 3x szerepel a CLAUDE.md-ben,
    // tehat a kereso lat. A szerzo maga HAROMSZOR irta at kezzel ezt a fajlt aznap,
    // mert az uzenet a FAJLT nevezte meg es a parancsot nem.
    //
    // `letezes vs. eleres`: a szerszam megvolt, helyes volt, elerheto volt -- es a
    // dontes pillanataban semmi nem mondta meg, hogy letezik.
    const m = evaluateSuiteSize(200, 2000, 286, 3879).message ?? ''
    expect(m).toContain('scripts/update-suite-baseline.mjs')
    // ES AZT IS, MIERT jobb: kezi atiras nem tud megtagadni egy csonka gyujtest.
    // Egy puszta parancsnev, indok nelkul, opcionalisnak olvasodik.
    expect(m).toMatch(/MEGTAGADJA/)
  })
})

describe('zeroTestFiles -- az (A) pontos ag', () => {
  it('megnevezi a nulla tesztet ado fajlt', () => {
    // MERVE 2026-08-23: egy collect-idoben elszallo fajl pontosan igy jut el a
    // riporterhez -- benne marad a listaban, `tasks: []`-szel. Ezert nem eleg a
    // fajlok szamat nezni: az nem esik.
    const files = [
      { name: 'a.test.ts', tasks: [{ type: 'test' }] },
      { name: 'boom.test.ts', tasks: [] },
    ] as never
    expect(zeroTestFiles(files)).toEqual(['boom.test.ts'])
  })

  it('hallgat, ha minden fajl adott tesztet', () => {
    const files = [{ name: 'a.test.ts', tasks: [{ type: 'test' }] }] as never
    expect(zeroTestFiles(files)).toEqual([])
  })

  it('a beagyazott describe-ban levo teszt is szamit', () => {
    const files = [
      { name: 'a.test.ts', tasks: [{ type: 'suite', tasks: [{ type: 'test' }] }] },
    ] as never
    expect(zeroTestFiles(files)).toEqual([])
  })
})

describe('GYUJTOTT kontra FUTOTT -- didi cimke-lelete', () => {
  // A LELET: az or uzenete azt allitotta, hogy ennyi teszt "lefutott". A `mode`-ot
  // viszont sem a countTests, sem a (B) ag nem nezi -- egy `describe.skip` egy
  // TELJES fajlon valtozatlanul hagyja a szamot, a zeroTestFiles ures marad,
  // tehat MINDKET ag hallgat. Egy fajl, aminek egyetlen tesztje sem futott,
  // atmegy, mikozben az uzenet azt mondja rola, hogy lefutott.
  //
  // MERVE a VALODI riporter-faban (sajat proba-riporterrel, 5 tesztes fajlon):
  //     osszes task 5 | skip 3 | todo 1 | tenylegesen futott 1
  const skipped = [
    { type: 'test', result: undefined },
    { type: 'test', result: { state: 'skip' } },
    { type: 'test', result: { state: 'pass' } },
    { type: 'test', result: { state: 'fail' } },
  ] as never

  it('a GYUJTOTT szam a kihagyottakat IS szamolja', () => {
    expect(countTests(skipped)).toBe(4)
  })

  it('a FUTOTT szam CSAK azokat, amiknek van eredmenye', () => {
    expect(countRanTests(skipped)).toBe(2)
  })

  it('describe.skip egy TELJES fajlon: gyujtott 2, futott 0', () => {
    const file = [{ type: 'suite', tasks: [
      { type: 'test', result: undefined },
      { type: 'test', result: undefined },
    ] }] as never
    expect(countTests(file)).toBe(2)
    expect(countRanTests(file)).toBe(0)
  })

  it('az uzenet CIMKEJE "gyujtott", nem "lefutott"', () => {
    const m = evaluateSuiteSize(200, 2000, 286, 3879).message ?? ''
    expect(m).toContain('gyujtott:')
    expect(m).not.toContain('lefutott:')
  })

  it('ha a ketto ELTER, az uzenet KIMONDJA -- de nem buktat tole', () => {
    const m = evaluateSuiteSize(200, 2000, 286, 3879, 1900).message ?? ''
    expect(m).toContain('ebbol FUTOTT: 1900')
    expect(m).toContain('100 teszt kihagyva')
  })

  it('ha nincs elteres, NEM ir felesleges sort', () => {
    expect(evaluateSuiteSize(200, 2000, 286, 3879, 2000).message ?? '').not.toContain('ebbol FUTOTT')
  })

  it('NEM KUSZOB: a kihagyas onmagaban nem buktat', () => {
    // Egy "skipelt <= X" hatar kezi kivetel-listat kivanna, es egy kezi
    // kivetel-lista TARTALMAT semmi nem meri -- ugyanaz a csapda, amit ez az or
    // maga javit. A kihagyas CIMKE marad, nem itelet.
    expect(evaluateSuiteSize(289, 3921, 289, 3921, 0).ok).toBe(true)
  })
})

describe('countTests', () => {
  it('melysegben szamol', () => {
    const tasks = [
      { type: 'test' },
      { type: 'suite', tasks: [{ type: 'test' }, { type: 'suite', tasks: [{ type: 'test' }] }] },
    ] as never
    expect(countTests(tasks)).toBe(3)
  })
})

describe('isFilteredRun -- a nem-tuzeles, ami nelkul az or KAROS lenne', () => {
  it('teljes futas: nincs szuro', () => {
    expect(isFilteredRun(['node', 'vitest', 'run'])).toBe(false)
  })

  it('celzott futas: fajlnev a szuro', () => {
    expect(isFilteredRun(['node', 'vitest', 'run', 'src/__tests__/x.test.ts'])).toBe(true)
  })

  it('a kapcsolok nem szurok', () => {
    expect(isFilteredRun(['node', 'vitest', 'run', '--coverage'])).toBe(false)
  })

  it('a kulonirt kapcsolo-ERTEK sem szuro', () => {
    // `--reporter default` -- a "default" szo nem fajlminta. Enelkul minden
    // ilyen futason nemara valna az or, csendben.
    expect(isFilteredRun(['node', 'vitest', 'run', '--reporter', 'default'])).toBe(false)
  })

  it('az egyenlojeles alak utan is felismeri a valodi szurot', () => {
    expect(isFilteredRun(['node', 'vitest', 'run', '--reporter=default', 'x.test.ts'])).toBe(true)
  })

  it('`run` nelkul (watch mod) nem szurtnek szamit', () => {
    expect(isFilteredRun(['node', 'vitest'])).toBe(false)
  })
})

describe('az alapvonal maga', () => {
  it('szam, es pozitiv -- egy elgepelt env nem nullazhatja csendben', () => {
    expect(SUITE_BASELINE_FILES).toBeGreaterThan(0)
    expect(SUITE_BASELINE_TESTS).toBeGreaterThan(0)
  })
})

describe('baselineStaleMessage -- az OR SAJAT elavulasa (kartya 7c86006a)', () => {
  // MERVE 2026-08-23. Az alapvonal `289 / 3929` volt, a keszlet `310 / 4166` --
  // 237 teszt elteres. A `TOLERANCE_CAP` 0, tehat a also korlat MAGA az
  // alapvonal (3929), es igy:
  //   237 teszt tunhetett volna el JELZES NELKUL
  //   az EREDETI incidens (97 elveszett teszt) sem szolaltatta volna meg
  // POZITIV KONTROLLAL merve: egy 11 tesztes fajl eltavolitasa utan a futas
  // VEGIG ZOLD volt, es az or nem szolalt meg.
  //
  // Az or tehat MUKODOTT es NEM VEDETT -- es pontosan ez az, amit egy zold
  // futas nem tud megmondani magarol.

  it('a friss alapvonal CSENDBEN marad', () => {
    expect(baselineStaleMessage(4160, 4160, 309)).toBeNull()
  })

  it('kis novekedes NEM jelzes -- kulonben minden uj teszt megszolaltatna', () => {
    // Egy jelzes, ami minden hozzaadaskor tuzel, egy heten belul zaj.
    expect(baselineStaleMessage(4165, 4160, 309)).toBeNull()
  })

  it('EGY ATLAGOS FAJLNYI sodrodas MAR jelzes -- ott mar egy egesz fajl kieshet eszrevetlenul', () => {
    // A kuszob SZARMAZTATOTT: ceil(4160/309) = 14 teszt/fajl.
    const uzenet = baselineStaleMessage(4160 + 14, 4160, 309)
    expect(uzenet).toBeTruthy()
    expect(uzenet).toContain('npm run test:baseline')
  })

  it('a MAI mert allapotot jelezte volna', () => {
    // A javitas elotti valos szamok.
    const uzenet = baselineStaleMessage(4166, 3929, 289)
    expect(uzenet).toBeTruthy()
    expect(uzenet).toContain('237')
  })

  it('megmondja, HANY teszt tunhet el jelzes nelkul -- a szam a lenyeg, nem a cimke', () => {
    const uzenet = baselineStaleMessage(4166, 3929, 289) as string
    expect(uzenet).toMatch(/ennyi teszt tunhet el JELZES NELKUL: 237/)
  })
})

describe('EZ ZSUGORODAS-OR, NEM LEFEDETTSEGI KAPU -- a korlat rogzitve (481efd24)', () => {
  // AMI ITT ALL, ES AMI SZANDEKOSAN NEM.
  //
  // A fejlec kimondja, hogy a produkcios kod merete sehol nem szerepel a
  // szamitasban. Ezt HAROM tesztet irtam ala, es MINDHAROM rossz volt -- a
  // bukas csak az egyiket mutatta meg:
  //
  //   (1) "uj produkcios fajl atmegy": ugyanazokkal az argumentumokkal hivta
  //       ketszer a fuggvenyt. Az `f(x) === f(x)` TAUTOLOGIA -- azt allitja,
  //       hogy a fuggveny determinisztikus, nem azt, hogy a nevezo hianyzik.
  //   (2) `evaluateSuiteSize.length === 4`: a `length` csak az ELSO
  //       alapertelmezett ertek ELOTTI parametereket szamolja, tehat 2. De a
  //       javitott szam sem ert volna semmit: egy KESOBB hozzaadott, szinten
  //       alapertelmezett nevezo-parameter sem valtoztatna rajta.
  //   (3) es ami maradt, a pozitiv kontroll, MAGABAN all -- lasd lent.
  //
  // A TANULSAG, AMI IDE TARTOZIK: a "nincs nevezo" nem VISELKEDES, hanem a
  // szignatura tulajdonsaga. Egy egysegteszt viselkedest mer. Amit egy teszt
  // nem tud allitani, azt ne ugy irjuk meg, hogy allitani LATSSZON -- az
  // rosszabb, mint a hianya, mert a kovetkezo olvaso fedezetnek nezi.
  // A tenyt ezert a fejlec mondja ki, meressel es pozitiv kontrollokkal, es a
  // 481efd24 kartya orzi. Itt csak az all, ami tenyleg merheto:

  it('POZITIV KONTROLL: az or EL -- egy eltunt teszt es egy eltunt FAJL is bukik', () => {
    // Ez az, ami a fejlecben allo "uj produkcios fajl -> ZOLD" merest ertelmesse
    // teszi. Enelkul a zold szin jelenthetne azt is, hogy az or halott.
    expect(evaluateSuiteSize(337, 4528, 337, 4529).ok).toBe(false)
    expect(evaluateSuiteSize(336, 4515, 337, 4529).ok).toBe(false)
    expect(evaluateSuiteSize(337, 4529, 337, 4529).ok).toBe(true)
  })
})
