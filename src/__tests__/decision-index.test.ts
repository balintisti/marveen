import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'decision-index.py')

function run(cwd: string, args: string[]) {
  const r = spawnSync('python3', [SCRIPT, ...args], { cwd, encoding: 'utf-8' })
  return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

// A LENYEG, ES AMIERT EZ A TESZT LETEZIK (kartya 72edf070): egy GENERALT fajl, amit
// semmi nem generál ujra, pontosan az a kezi lista, ami ellen keszult -- csak egy
// generatorral mellette. Ez a teszt AZ, ami ujragenerálást kikenyszerit: ha valaki egy
// scripts/ fejlecet ir at es nem futtatja a generatort, ez pirosra megy.
describe('decision-index.py -- drift-or a generalt indexre', () => {
  it('docs/scripts-decisions.md naprakesz a scripts/ fejlecekhez kepest', () => {
    const r = run(REPO_ROOT, ['--check'])
    expect(r.out).toContain('docs/scripts-decisions.md')
    expect(r.code, `ELAVULT. Javitas: python3 scripts/decision-index.py\n${r.out}`).toBe(0)
  })
})

// POZITIV KONTROLL, ES NEM SZORGALMI: a fenti allitas egy OLYAN `--check`-kel is zold
// maradna, ami MINDIG 0-t ad. Egy uj or az elso commitjan konstrukciobol zold -- ez a
// blokk az, ami megmutatja, hogy tud pirosat is mondani.
describe('decision-index.py -- a --check tud PIROSAT is mondani', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'decidx-'))
    spawnSync('git', ['init', '-q'], { cwd: tmp })
    mkdirSync(join(tmp, 'scripts'), { recursive: true })
    mkdirSync(join(tmp, 'docs'), { recursive: true })
    writeFileSync(
      join(tmp, 'scripts', 'proba.sh'),
      '#!/bin/bash\n# MIERT LETEZIK: ez egy dontes-alaku fejlec-sor a probahoz.\necho ok\n',
    )
    spawnSync('git', ['add', '-A'], { cwd: tmp })
  })

  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('HIANYZO artefaktumra 3', () => {
    const r = run(tmp, ['--check'])
    expect(r.code).toBe(3)
    expect(r.out).toContain('HIANYZIK')
  })

  it('ELAVULT artefaktumra 3', () => {
    writeFileSync(join(tmp, 'docs', 'scripts-decisions.md'), '# regi tartalom\n')
    expect(run(tmp, ['--check']).code).toBe(3)
  })

  it('generalas UTAN 0 -- es a generalt fajl NEVEZI a proba-scriptet', () => {
    expect(run(tmp, []).code).toBe(0)
    expect(run(tmp, ['--check']).code).toBe(0)
    const body = readFileSync(join(tmp, 'docs', 'scripts-decisions.md'), 'utf-8')
    expect(body).toContain('scripts/proba.sh')
    expect(body).toContain('MIERT LETEZIK')
  })

  it('a fejlec MEGVALTOZTATASA elavultta teszi -- ez a valodi drift-eset', () => {
    expect(run(tmp, []).code).toBe(0)
    writeFileSync(
      join(tmp, 'scripts', 'proba.sh'),
      '#!/bin/bash\n# MIERT LETEZIK: MASIK indoklas, mint amit a generalt fajl hordoz.\necho ok\n',
    )
    expect(run(tmp, ['--check']).code).toBe(3)
  })

  // A KOVETETT populaciora szurunk (`git ls-files`), nem a lemezre. Enelkul egy
  // gitignore-olt vagy meg fel nem vett fajl is bekerulne, es a szam gepenkent masat adna.
  it('KOVETETLEN fajl NEM kerul be a generalt indexbe', () => {
    writeFileSync(
      join(tmp, 'scripts', 'kovetetlen.sh'),
      '#!/bin/bash\n# MIERT LETEZIK: ezt soha nem vettuk fel a gitbe.\necho ok\n',
    )
    expect(run(tmp, []).code).toBe(0)
    const body = readFileSync(join(tmp, 'docs', 'scripts-decisions.md'), 'utf-8')
    expect(body).toContain('scripts/proba.sh')
    expect(body).not.toContain('kovetetlen.sh')
  })

  // A FEJLEC KET ALAKBAN LETEZIK, ES A MASODIKAT AZ ELSO VALTOZAT NEM LATTA (2026-09-03).
  // Merve: a scripts/ 52 kovetett .py fajljabol MIND AZ 52 docstringgel fejlecel es EGY SEM
  // `#`-kel. A hiany nem hibakent jelentkezett, hanem egy kisebb, hiheto szamkent -- 30/23
  // a valos 38/30 helyett. Mindket agra kell allitas, kulonben az egyik javitasa elveszi a masikat.
  it('DOCSTRING-fejlecu .py fajl bekerul az indexbe', () => {
    writeFileSync(
      join(tmp, 'scripts', 'docstringes.py'),
      '#!/usr/bin/env python3\n"""\nMIERT LETEZIK: docstringben all a dontes, nem # kommentben.\n"""\nprint(1)\n',
    )
    spawnSync('git', ['add', '-A'], { cwd: tmp })
    expect(run(tmp, []).code).toBe(0)
    const body = readFileSync(join(tmp, 'docs', 'scripts-decisions.md'), 'utf-8')
    expect(body).toContain('scripts/docstringes.py')
    expect(body).toContain('docstringben all a dontes')
  })

  it('REGRESSZIO: a # kommentes fejlec TOVABBRA IS bekerul (a docstring-ag nem veszi el)', () => {
    writeFileSync(
      join(tmp, 'scripts', 'docstringes.py'),
      '#!/usr/bin/env python3\n"""\nMIERT LETEZIK: docstringes.\n"""\nprint(1)\n',
    )
    spawnSync('git', ['add', '-A'], { cwd: tmp })
    expect(run(tmp, []).code).toBe(0)
    const body = readFileSync(join(tmp, 'docs', 'scripts-decisions.md'), 'utf-8')
    expect(body).toContain('scripts/proba.sh')      // a `#` ag
    expect(body).toContain('scripts/docstringes.py') // a docstring ag
  })

  // BLOKK-KOMMENT ALAK (`/** * ... */`). Merve: az `update-suite-baseline.mjs` JSDoc-fejlece
  // ` * MIERT LETEZIK.`-kel kezdodik, es a `#`/`//` minta azt szerkezetileg nem latta.
  it('BLOKK-kommentes fejlec bekerul az indexbe', () => {
    writeFileSync(
      join(tmp, 'scripts', 'blokkos.mjs'),
      '#!/usr/bin/env node\n/**\n * blokkos.mjs -- valami.\n *\n * MIERT LETEZIK: a blokk-komment is fejlec.\n */\nconsole.log(1)\n',
    )
    spawnSync('git', ['add', '-A'], { cwd: tmp })
    expect(run(tmp, []).code).toBe(0)
    const body = readFileSync(join(tmp, 'docs', 'scripts-decisions.md'), 'utf-8')
    expect(body).toContain('scripts/blokkos.mjs')
    expect(body).toContain('a blokk-komment is fejlec')
  })

  // A TAGITOTT FRAZIS: sor eleji WHY/MIERT, KULCSSZO-LISTA NELKUL. Ez fogja meg a
  // `WHY a separate timer when the dashboard already has an in-process watchdog` alakot.
  it('kulcsszo NELKULI, sor eleji WHY-fejlec bekerul', () => {
    writeFileSync(
      join(tmp, 'scripts', 'timer.sh'),
      '#!/bin/bash\n# WHY a separate timer when the dashboard already has one: mert a masik\n# folyamat epp azt az esetet nem latja.\necho ok\n',
    )
    spawnSync('git', ['add', '-A'], { cwd: tmp })
    expect(run(tmp, []).code).toBe(0)
    expect(readFileSync(join(tmp, 'docs', 'scripts-decisions.md'), 'utf-8')).toContain('scripts/timer.sh')
  })

  // NEGATIV KONTROLL, ES EZ TARTJA A MINTAT SZUKEN. A `decision` PUSZTA SZAVAT probaltuk:
  // 17 jeloltbol tobb mint a fele hamis volt (`log-decision --recommendation`, `review
  // decision`, `decision JSON`) -- proza, nem fejlec. Ha valaki ujra betenné, ez pirosra megy.
  it('a `decision` szo PROZABAN nem tesz be egy fajlt', () => {
    writeFileSync(
      join(tmp, 'scripts', 'prozas.sh'),
      '#!/bin/bash\n# prozas.sh -- logs the review decision and prints a decision JSON blob.\n# Usage: prozas.sh log-decision --recommendation X\necho ok\n',
    )
    spawnSync('git', ['add', '-A'], { cwd: tmp })
    expect(run(tmp, []).code).toBe(0)
    expect(readFileSync(join(tmp, 'docs', 'scripts-decisions.md'), 'utf-8')).not.toContain('scripts/prozas.sh')
  })

  // NEM OLVASOTT FEJLEC-ALAK: kulon szakasz, gepiesen -- nem kezzel irt kivetel.
  it('komment-alak NELKULI fajl a kulon szakaszba kerul, nem az indexbe', () => {
    writeFileSync(
      join(tmp, 'scripts', 'xmles.plist.template'),
      '<?xml version="1.0"?>\n<!--\nMIERT KULON FOLYAMAT, ES NEM EGY TIMER: mert a masik nem latja.\n-->\n<plist/>\n',
    )
    spawnSync('git', ['add', '-A'], { cwd: tmp })
    expect(run(tmp, []).code).toBe(0)
    const body = readFileSync(join(tmp, 'docs', 'scripts-decisions.md'), 'utf-8')
    expect(body).toContain('Nem olvasott fejlec-alak')
    expect(body).toContain('scripts/xmles.plist.template')
    expect(body).not.toContain('### `scripts/xmles.plist.template`')
  })

  // NINCS IDOBELYEG: ket egymas utani generalas BAJT-AZONOS. Enelkul a `--check` sosem
  // tudna nullat mondani, es az egesz drift-or hasznalhatatlan lenne.
  it('ket generalas bajt-azonos (nincs idobelyeg a kimenetben)', () => {
    run(tmp, [])
    const a = readFileSync(join(tmp, 'docs', 'scripts-decisions.md'), 'utf-8')
    run(tmp, [])
    const b = readFileSync(join(tmp, 'docs', 'scripts-decisions.md'), 'utf-8')
    expect(b).toBe(a)
  })
})

// ============================================================================================
// A NAGYBETUS NYITANY AGA (kartya 6819ff25, didi lelete, friday merese 2026-09-11)
//
// A `^WHY` horgony a SZORENDRE bukott: egy `WHAT WENT WRONG, AND WHY ... IS NOT THE FIX.`
// fejlec dontes-sor, es a kinyero szerkezetileg nem latta -- kozben a `--check` `naprakesz`-t
// mondott, rc=0. Nem hianyzo kapu, hanem olyan, ami ZOLDET mond arra, amit nem lat.
//
// A KEZENFEKVO TAGITAS MERVE ES ELVETVE: `\bWHY\b` barhol a sorban 18 uj jelolt-sort ad,
// mind a 18 elolvasva, 11 proza -> 61% hamis pozitiv. Ezert all itt KET negativ teszt is:
// azok rogzitik, hogy a horgony NEM tagult el addig. Ha valaki `\bWHY\b`-ra csereli, ezek
// mennek pirosra -- nem a pozitivak.
// ============================================================================================
describe('decision-index.py -- a NAGYBETUS NYITANY, es ameddig NEM tagul', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'decidx-caps-'))
    spawnSync('git', ['init', '-q'], { cwd: tmp })
    mkdirSync(join(tmp, 'scripts'), { recursive: true })
    mkdirSync(join(tmp, 'docs'), { recursive: true })
  })

  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  function generate(): string {
    spawnSync('git', ['add', '-A'], { cwd: tmp })
    expect(run(tmp, []).code).toBe(0)
    return readFileSync(join(tmp, 'docs', 'scripts-decisions.md'), 'utf-8')
  }

  // A MERT ESET MAGA: `scripts/assert-isolated.py` a torzson, es 0 talalat az indexben.
  it('a WHY NEM a sor elejen all, de a NAGYBETUS nyitanyban -- bekerul', () => {
    writeFileSync(
      join(tmp, 'scripts', 'izolalt.py'),
      '#!/usr/bin/env python3\n"""Proba.\n\nWHAT WENT WRONG, AND WHY "READ THE VARIABLE" IS NOT THE FIX. Egy mechanizmus kell.\n"""\nprint(1)\n',
    )
    const body = generate()
    expect(body).toContain('scripts/izolalt.py')
    expect(body).toContain('WHAT WENT WRONG, AND WHY')
  })

  // A MASIK FELE, es ezt egy FAJL-szintu cenzus sosem latja: a fajl MAR indexelt egy masik
  // sora miatt, es ez a SZEKCIO-CIME marad ki. A `===` elotag miatt bukott a `^WHY`.
  it('`===` elotagu szekcio-cim is bekerul, a fajl mar meglevo sora MELLE', () => {
    writeFileSync(
      join(tmp, 'scripts', 'kapu.py'),
      '#!/usr/bin/env python3\n"""Proba.\n\nWHY THIS EXISTS: az elso indok.\n\n=== WHY THE TARGET IS MATCHED BY realpath AND NOT BY NAME\n\nMert tiz ut vezet ide.\n"""\nprint(1)\n',
    )
    const body = generate()
    expect(body).toContain('WHY THIS EXISTS: az elso indok.')
    expect(body).toContain('=== WHY THE TARGET IS MATCHED BY realpath')
  })

  // NEGATIV 1 -- TORDELT PROZA. Ez volt a 11 hamis pozitiv tobbsege.
  it('mondat KOZEPEN allo `why` NEM tesz be egy fajlt', () => {
    writeFileSync(
      join(tmp, 'scripts', 'prozas2.sh'),
      '#!/bin/bash\n# prozas2.sh -- a kimenet nem volt bizonyitek arra, amit allitottunk;\n# evidence. That is why test 3 exists at all.\necho ok\n',
    )
    expect(generate()).not.toContain('scripts/prozas2.sh')
  })

  // NEGATIV 2 -- SZERZODES-TABLAZAT SORA. Harom fajl hordozza ugyanezt a sort a torzson
  // (calendar-agenda.sh, capacity-report.sh, card-flow-report.sh), es egyik sem dontes.
  it('szerzodes-tablazat sora NEM tesz be egy fajlt', () => {
    writeFileSync(
      join(tmp, 'scripts', 'szerzodes.sh'),
      '#!/bin/bash\n# szerzodes.sh -- a ket kimenet:\n#     {"ok":false,"error":"..."}   we could not look, and this is why\necho ok\n',
    )
    expect(generate()).not.toContain('scripts/szerzodes.sh')
  })
})

// ============================================================================================
// A MODUL-SZINTU FUTAS GUARDJA (ugyanaz a kartya). Guard nelkul egy `import` LEFUTTATTA a
// `main()`-t, vagyis UJRAGENERALTA a `docs/scripts-decisions.md`-t abban a faban, ahonnan
// importaltak. 2026-09-11-en egy oran belul KETTEN futottunk bele (didi, majd friday),
// mindketten epp azert importaltuk, hogy a kinyerot empirikusan merjuk.
// A POPULACIO: 55 kovetett `scripts/*.py` hordoz `def main(`-t, ebbol 54 hivja `if __name__`
// guard alatt, es EZ AZ EGY nem hivta.
// A BIZONYITEK a FAJL HIANYA, nem a kilepesi kod: az import sikeres mindket valtozatban.
// ============================================================================================
describe('decision-index.py -- az import nem ir fajlt', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'decidx-import-'))
    spawnSync('git', ['init', '-q'], { cwd: tmp })
    mkdirSync(join(tmp, 'scripts'), { recursive: true })
    mkdirSync(join(tmp, 'docs'), { recursive: true })
    writeFileSync(
      join(tmp, 'scripts', 'proba.sh'),
      '#!/bin/bash\n# MIERT LETEZIK: hogy legyen mit generalni.\necho ok\n',
    )
    spawnSync('git', ['add', '-A'], { cwd: tmp })
  })

  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('importkor NEM keletkezik docs/scripts-decisions.md', () => {
    const prog = [
      'import importlib.util, sys',
      `spec = importlib.util.spec_from_file_location('di', ${JSON.stringify(SCRIPT)})`,
      'm = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(m)',
      "print('IMPORT_OK', callable(m.header), callable(m.is_decision))",
    ].join('\n')
    const r = spawnSync('python3', ['-c', prog], { cwd: tmp, encoding: 'utf-8' })
    expect(r.status, r.stderr ?? '').toBe(0)
    expect(r.stdout).toContain('IMPORT_OK True True')
    expect(existsSync(join(tmp, 'docs', 'scripts-decisions.md'))).toBe(false)
  })

  // POZITIV KONTROLL: ugyanaz a proba a GUARD NELKULI alakon MEGIRJA a fajlt. Enelkul a
  // fenti allitas egy olyan szkripttel is zold lenne, ami egyaltalan nem tud generalni.
  it('KONTROLL: a guard nelkuli masolat UGYANEZZEL a probaval megirja', () => {
    const src = readFileSync(SCRIPT, 'utf-8')
    const noGuard = src.replace("if __name__ == '__main__':\n    sys.exit(main())", 'sys.exit(main())')
    expect(noGuard, 'a guard horgonya elmozdult -- a kontroll nem mer semmit').not.toBe(src)
    const copy = join(tmp, 'noguard.py')
    writeFileSync(copy, noGuard)
    spawnSync('python3', ['-c', [
      'import importlib.util',
      `spec = importlib.util.spec_from_file_location('di2', ${JSON.stringify('__COPY__')})`,
      'm = importlib.util.module_from_spec(spec)',
      'try:\n    spec.loader.exec_module(m)\nexcept SystemExit:\n    pass',
    ].join('\n').replace('__COPY__', copy)], { cwd: tmp, encoding: 'utf-8' })
    expect(existsSync(join(tmp, 'docs', 'scripts-decisions.md'))).toBe(true)
  })
})
