import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
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
