import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decide, diagnose, renderBlock, replaceBlock } from '../../scripts/update-suite-baseline.mjs'

// AZ ALAPVONAL-FRISSITO TESZTJEI (kartya c0f10926).
//
// A legfontosabb allitas itt NEM az, hogy helyesen ir -- hanem hogy MIKOR NEM IR.
// Egy frissito, ami egy CSONKA futasbol ir szamot, csendben ervenyesnek rogziti
// pontosan azt a vesztest, amit az or fogni hivatott. Az rosszabb lenne a kezi
// allapotnal, mert ugy nezne ki, mintha megoldottuk volna.

describe('decide -- mikor NEM szabad alapvonalat irni', () => {
  it('CSONKA GYUJTES utan NEM ir (ez a kartya legveszelyesebb resze)', () => {
    const r = decide(1, { files: 200, tests: 3000 })
    expect(r.write).toBe(false)
    expect(r.reason).toContain('GYUJTES NEM TELJES')
  })

  it('a megallas indoka MEGMONDJA, miert rosszabb az iras a semminel', () => {
    // Egy "nem irtam" uzenet, ami nem mondja meg, MIERT, ugyanolyan konnyen
    // valik zajja, mint egy hamis riasztas.
    expect(decide(1, { files: 1, tests: 1 }).reason).toContain('CSENDBEN')
  })

  it('a megallas SZETVALASZTJA a buko tesztet a be nem toltodott fajltol', () => {
    // A kikotes eredeti szovege ("RC nem nulla -- BUKAS vagy betoltesi hiba")
    // ket dolgot mosott ossze:
    //   BUKAS          -> a GYUJTOTT szamot nem valtoztatja (egy buko teszt
    //                     ugyanugy egy teszt), tehat NEM akadalya az alapvonalnak
    //   BETOLTESI HIBA -> EZ valtoztatja meg, es EZ tartozik ide
    // A regi szoveg egy piros suite miatt is megtagadta a frissitest -- amire a
    // valasz az lett volna, hogy valaki KEZZEL irja at a szamot. Vagyis eppen azt
    // a kezi utat tartotta eletben, amit ez a kartya megszuntet.
    const r = decide(1, { files: 1, tests: 1 })
    expect(r.reason).toContain('NEM azt jelenti, hogy egy teszt BUKIK')
    expect(r.reason).toContain('BE SEM TOLTODOTT')
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

  it('a MERES MODJA is bekerul -- kulonben a --fast utan a komment hazudna', () => {
    // A `--fast` ut a `vitest list`-tel mer. Ha a blokk fixen "vitest run"-t
    // irna, a szam es a MONDATA csuszna szet -- pont az a hiba, ami ellen ez a
    // generalt blokk keszult.
    expect(renderBlock({ files: 1, tests: 1 }, 'x', 'npx vitest list --json'))
      .toContain('npx vitest list --json')
    expect(renderBlock({ files: 1, tests: 1 }, 'x')).toContain('npx vitest run')
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

// A KIIRT OK IS ALLITAS, ES KET ISMERT ESETBEN HAMIS VOLT (kartya e065cf1c).
//
// A megtagadas mindig helyes volt -- csonka gyujtesbol nem irunk alapvonalat. Az
// INDOK viszont azt mondta, hogy „egy fajl BE SEM TOLTODOTT. Eloszor azt javitsd",
// ami a fo checkoutban HAMIS: ott az elo-telepites-or tagadta meg a futast, es a
// keszleten nincs mit javitani. marveen ebbol egy nem letezo betoltesi hibat kezdett
// volna keresni. Ugyanaz az alak, mint a `CREATE INDEX CONCURRENTLY` hamis riasztasa.
describe('a megtagadas OKA is mert allitas legyen, ne az altalanos tipp (e065cf1c)', () => {
  it('felismeri az elo-telepites-or elutasitasat a MERT kimenetbol', () => {
    expect(diagnose('Error: REFUSING TO RUN TESTS: /Users/isti/marveen looks like a LIVE install'))
      .toBe('live-install')
  })

  it('felismeri a node-ABI eltérest', () => {
    expect(diagnose('ERR_DLOPEN_FAILED')).toBe('node-abi')
    expect(diagnose('was compiled against a different Node.js version')).toBe('node-abi')
  })

  // NEGATIV KONTROLL: egy VALODI betoltesi hiba NEM kaphat specialis okot, kulonben a
  // javitas pont azt az esetet nemitana el, amire az altalanos uzenet igaz.
  it('egy valodi betoltesi hibara NEM talal ki okot', () => {
    expect(diagnose('SyntaxError: Unexpected token in foo.test.ts')).toBe(null)
    expect(diagnose('')).toBe(null)
  })

  it('elo-telepitesnel a keszletet NEM hibaztatja, es megmondja, hova menjen a futtato', () => {
    const r = decide(1, null, 'live-install')
    expect(r.write).toBe(false)
    expect(r.reason).toContain('NINCS MIT JAVITANI')
    expect(r.reason).toContain('WORKTREEBOL')
    // EZ A LENYEG: a felrevezeto mondat NEM lehet ott.
    expect(r.reason).not.toContain('BE SEM TOLTODOTT')
  })

  it('node-ABI-nal a kornyezetet nevezi meg, nem a keszletet', () => {
    const r = decide(1, null, 'node-abi')
    expect(r.reason).toContain('KORNYEZET HIBAJA')
    expect(r.reason).toContain('node@22')
    expect(r.reason).not.toContain('BE SEM TOLTODOTT')
  })

  // A REGI SZERZODES VALTOZATLAN: ok nelkul PONTOSAN a regi uzenet megy. Enelkul a
  // javitas elnemitana azt az esetet is, amire az altalanos mondat IGAZ.
  it('ismeretlen ok eseten a regi, altalanos indok all', () => {
    const r = decide(1, { files: 1, tests: 1 })
    expect(r.reason).toContain('BE SEM TOLTODOTT')
    expect(decide(1, { files: 1, tests: 1 }, null).reason).toContain('BE SEM TOLTODOTT')
  })

  // ES A MEGTAGADAS MAGA SOSEM LAZUL: barmelyik ok mellett is, nem irunk alapvonalat.
  it('egyik ok sem teszi irhatova az alapvonalat', () => {
    for (const cause of ['live-install', 'node-abi', null] as const) {
      expect(decide(1, { files: 300, tests: 4000 }, cause).write).toBe(false)
    }
  })
})
