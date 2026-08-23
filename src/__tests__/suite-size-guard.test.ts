import { describe, expect, it } from 'vitest'
import {
  countTests,
  evaluateSuiteSize,
  floorFor,
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
  it('nagy keszletnel 2 szazalek', () => {
    expect(floorFor(3879)).toBe(3879 - 78)
  })

  it('kis szamnal legalabb 5, kulonben egyetlen torles is riasztana', () => {
    // 100 * 2% = 2, ami tul szoros: harom torolt teszt mar bukast adna, es egy
    // or, ami a szokasos munkara sir, az, amit kikapcsolnak.
    expect(floorFor(100)).toBe(95)
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

  it('hallgat a tureshataron belul', () => {
    expect(evaluateSuiteSize(286, 3879 - 78, 286, 3879).ok).toBe(true)
  })

  it('MEGSZOLAL egy teszttel a korlat alatt', () => {
    const r = evaluateSuiteSize(286, 3879 - 79, 286, 3879)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('OSSZEZSUGORODOTT')
  })

  it('megfogta volna a 2026-08-23-i esetet (97 teszt kiesett)', () => {
    // A valodi megfigyeles: 3875 -> 3778. Ez az egyetlen eset, amit tenylegesen
    // lattunk, tehat az or minimumkovetelmenye, hogy ezt megfogja.
    const r = evaluateSuiteSize(285, 3778, 285, 3875)
    expect(r.ok).toBe(false)
  })

  it('ES KIMONDVA: egy KISEBB kieses a (B) agon ATMENNE', () => {
    // Nem szepitjuk: 40 teszt kiesese a tureshataron belul van. Ezert letezik az
    // (A) ag, ami merettol fuggetlen. A ket ag egyutt ad fedezetet.
    expect(evaluateSuiteSize(285, 3875 - 40, 285, 3875).ok).toBe(true)
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
