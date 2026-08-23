import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decide, renderBlock, replaceBlock } from '../../scripts/update-suite-baseline.mjs'

// AZ ALAPVONAL-FRISSITO TESZTJEI (kartya c0f10926).
//
// A legfontosabb allitas itt NEM az, hogy helyesen ir -- hanem hogy MIKOR NEM IR.
// Egy frissito, ami egy CSONKA futasbol ir szamot, csendben ervenyesnek rogziti
// pontosan azt a vesztest, amit az or fogni hivatott. Az rosszabb lenne a kezi
// allapotnal, mert ugy nezne ki, mintha megoldottuk volna.

describe('decide -- mikor NEM szabad alapvonalat irni', () => {
  it('BUKOTT suite utan NEM ir (ez a kartya legveszelyesebb resze)', () => {
    const r = decide(1, { files: 200, tests: 3000 })
    expect(r.write).toBe(false)
    expect(r.reason).toContain('NEM zold')
  })

  it('a megallas indoka MEGMONDJA, miert rosszabb az iras a semminel', () => {
    // Egy "nem irtam" uzenet, ami nem mondja meg, MIERT, ugyanolyan konnyen
    // valik zajja, mint egy hamis riasztas.
    expect(decide(1, { files: 1, tests: 1 }).reason).toContain('CSENDBEN')
  })

  it('megszakadt futas (null -> 1) utan sem ir', () => {
    expect(decide(1, null).write).toBe(false)
  })

  it('ertelmezhetetlen darabszam eseten NEM ir', () => {
    expect(decide(0, null).write).toBe(false)
    expect(decide(0, { files: 'x', tests: 3 } as never).write).toBe(false)
  })

  it('NULLA teszt nem alapvonal, hanem uzemzavar', () => {
    // Egy elgepelt include-minta nulla tesztet futtat, es rc=0-val ter vissza.
    // Ha ezt alapvonalkent beirnank, az or ONMAGAT kapcsolna ki.
    const r = decide(0, { files: 0, tests: 0 })
    expect(r.write).toBe(false)
    expect(r.reason).toContain('uzemzavar')
  })

  it('ZOLD suite es ertelmes szamok eseten IR', () => {
    // Pozitiv kontroll: enelkul a fentiek attol is zoldek lennenek, hogy a
    // fuggveny MINDIG nemet mond.
    expect(decide(0, { files: 287, tests: 3902 }).write).toBe(true)
  })
})

describe('renderBlock -- a szam es a mondat EGYUTT keletkezik', () => {
  it('a doc-komment szama es a konstans ugyanaz', () => {
    // Ez a 3. kikotes gepi valtozata. Amig kezi volt, a ketto kulon tudott
    // elavulni -- es ma egy szomszedos helyen meg is tortent.
    const b = renderBlock({ files: 12, tests: 34 }, '2026-01-01 00:00')
    expect(b).toContain('12 fajl / 34 teszt')
    expect(b).toContain('SUITE_BASELINE_FILES = 12')
    expect(b).toContain('SUITE_BASELINE_TESTS = 34')
  })

  it('a FAJLSZAM is bekerul, nem csak a teszt-szam (2. kikotes)', () => {
    // Egy collect-hibas fajl BENNE MARAD a listaban `tasks: []`-szel, tehat a
    // fajlszam nem esik -- a ketto egyutt tobbet mond, mint kulon.
    expect(renderBlock({ files: 12, tests: 34 }, 'x')).toMatch(/SUITE_BASELINE_FILES/)
  })

  it('a DATUM is bekerul', () => {
    expect(renderBlock({ files: 1, tests: 1 }, '2026-08-23 07:57')).toContain('2026-08-23 07:57')
  })
})

describe('replaceBlock', () => {
  const src = ['elotte', '// === SUITE-BASELINE:BEGIN ===', 'regi', '// === SUITE-BASELINE:END ===', 'utana'].join('\n')

  it('csak a markerek KOZOTTI reszt csereli', () => {
    const out = replaceBlock(src, '// === SUITE-BASELINE:BEGIN ===\nuj\n// === SUITE-BASELINE:END ===')
    expect(out).toContain('elotte')
    expect(out).toContain('utana')
    expect(out).toContain('uj')
    expect(out).not.toContain('regi')
  })

  it('HIBAT dob, ha a marker hianyzik -- nem talalgat', () => {
    expect(() => replaceBlock('nincs benne marker', 'x')).toThrow(/marker/)
  })
})

describe('a valodi forras-fajl', () => {
  it('tartalmazza a markereket, tehat a parancs meg tudja talalni', () => {
    // Enelkul a frissito az elso eles futasnal allna meg -- es a hiba csak
    // AKKOR derulne ki, amikor mar szukseg lenne ra.
    const s = readFileSync(join(__dirname, 'setup', 'suite-size-guard.ts'), 'utf-8')
    expect(s).toContain('// === SUITE-BASELINE:BEGIN ===')
    expect(s).toContain('// === SUITE-BASELINE:END ===')
  })
})
