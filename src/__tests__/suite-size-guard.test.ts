import { describe, expect, it } from 'vitest'
import {
  countTests,
  evaluateSuiteSize,
  floorFor,
  TOLERANCE_CAP,
  isFilteredRun,
  zeroTestFiles,
  SUITE_BASELINE_FILES,
  SUITE_BASELINE_TESTS,
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
  it('kis szamnal legalabb 5, kulonben egyetlen torles is riasztana', () => {
    // 100 * 2% = 2, ami tul szoros: harom torolt teszt mar bukast adna, es egy
    // or, ami a szokasos munkara sir, az, amit kikapcsolnak.
    expect(floorFor(100)).toBe(95)
  })

  it('a 2 szazalek csak egy KESKENY savban dont (250 es 500 teszt kozott)', () => {
    // A ket korlat kozott a szazalek csak akkor szamit, ha 5 < 2% < 10 -- vagyis
    // ~250 es ~500 teszt kozott. Ezen kivul mindig az egyik korlat nyer, es ezt
    // jobb kimondani, mint egy kozepes szammal illusztralni, ami barmelyik
    // hatar mozdulasakor csendben elavul.
    expect(floorFor(400)).toBe(400 - 8)
    expect(floorFor(100)).toBe(100 - 5)      // ala: a minimum 5 nyer
    expect(floorFor(3901)).toBe(3901 - 10)   // fole: a plafon 10 nyer
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

  it('a kartyat szulo 97-es eset egy 4850-es keszletnel IS bukna', () => {
    // Ez a plafon egesz letjogosultsaga, szamban kimondva.
    expect(evaluateSuiteSize(300, 4850 - 97, 300, 4850).ok).toBe(false)
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

  it('hallgat PONTOSAN a tureshataron', () => {
    // A hatar a plafon, nem a szazalek -- ezert a konstansbol szamolunk, nem
    // beirt szambol. Egy beirt 78 csendben elavult volna a plafon bevezetesevel,
    // es epp ez a teszt hazudott volna elsonek.
    expect(evaluateSuiteSize(286, 3879 - TOLERANCE_CAP, 286, 3879).ok).toBe(true)
  })

  it('MEGSZOLAL egy teszttel a hataron TUL', () => {
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

  it('ES A MARADEK RES, KIMONDVA: 10 teszt alatti torles meg mindig atmegy', () => {
    // Nem szepitjuk. Az (A) ag ezt sem latja, mert egy TOROLT fajl meg sem
    // jelenik a listaban (didi merte: 287 -> 284, egyszer sem szolalt meg semmi).
    // A res tehat nem szunt meg, csak 50-rol 10-re zsugorodott -- es 0-ra akkor
    // mehet, ha az alapvonal frissitese egy parancs lesz (c0f10926).
    expect(evaluateSuiteSize(285, 3875 - 9, 285, 3875).ok).toBe(true)
    expect(evaluateSuiteSize(285, 3875 - 11, 285, 3875).ok).toBe(false)
  })

  it('az uzenet megmondja, mit nezzen meg eloszor az olvaso', () => {
    const m = evaluateSuiteSize(200, 2000, 286, 3879).message ?? ''
    expect(m).toContain('Test Files')
    expect(m).toContain('alapvonalat frissitsd')
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
