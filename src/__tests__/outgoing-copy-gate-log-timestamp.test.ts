import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Kartya 3c753513. A hianyzo nev-szabaly panasza SZANDEKOSAN minden hivasnal kimegy -- de a
// `store/outgoing-copy-gate.log` merve 2026-09-03-an **9778 sor / 1,8 MB**, MIND ugyanaz a
// mondat, es EGYIKEN SEM volt idopont. A fajl mtime-ja csak az UTOLSO irast mondja meg, tehat
// a "mikor kezdodott", "mikor allt le", "surusodik-e" kerdesek megvalaszolhatatlanok voltak.
//
// Ugyanaz a defektus-osztaly, mint a `10ba8fd4`-en a `dashboard.log`-nal: ott a datum hianya
// EGY ejszaka OT hamis leolvasast okozott harom kulonbozo agensnel.
//
// AMIT EZ NEM VALTOZTAT: a hangerot. Nem dedup, nem rotacio -- azok CSOKKENTENEK a jelzest, es
// az mas dontes. A sor ugyanannyiszor keletkezik, csak most megmondja, MIKOR.

const ROOT = join(__dirname, '..', '..')
const GATE = join(ROOT, 'scripts', 'hooks', 'outgoing-copy-gate.py')
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4} /

describe('outgoing-copy gate: a naplo-sor idobelyeget visz (3c753513)', () => {
  let tree: string

  beforeEach(() => {
    // Eldobhato TELEPITESI FA: a hook a sajat helyebol szarmaztatja a store/ utat, tehat a
    // naplo ide keletkezik, es a valodi store/-hoz nem nyulunk.
    tree = mkdtempSync(join(tmpdir(), 'gatelog-'))
    mkdirSync(join(tree, 'scripts', 'hooks'), { recursive: true })
    mkdirSync(join(tree, 'store'), { recursive: true })
    copyFileSync(GATE, join(tree, 'scripts', 'hooks', 'outgoing-copy-gate.py'))
  })

  afterEach(() => rmSync(tree, { recursive: true, force: true }))

  function loadGate(extra = ''): void {
    execFileSync('python3', ['-c', `
import importlib.util
spec = importlib.util.spec_from_file_location("gate", ${JSON.stringify(join(tree, 'scripts', 'hooks', 'outgoing-copy-gate.py'))})
g = importlib.util.module_from_spec(spec)
try: spec.loader.exec_module(g)
except SystemExit: pass
${extra}
`], { encoding: 'utf-8' })
  }

  function logLines(): string[] {
    const p = join(tree, 'store', 'outgoing-copy-gate.log')
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf-8').split('\n').filter((l) => l.trim())
  }

  // A VALODI UT, nem egy szintetikus hivas: a hianyzo szabaly-fajl panasza a modul betoltesekor
  // keletkezik, mert a rules json nincs a temp faban.
  it('a HIANYZO szabaly-fajl panasza idobelyeggel keletkezik', () => {
    loadGate()
    const lines = logLines()
    expect(lines.length, 'nem keletkezett naplo-sor: a proba nem a valodi utat merte').toBeGreaterThan(0)
    for (const l of lines) expect(l).toMatch(STAMP)
  })

  // NEGATIV KONTROLL: a REGI alak a sor ELEJEN kezdodott a szoveggel. Ha barmelyik sor igy
  // nez ki, egy iras-hely kimaradt az atallasbol -- es epp az lenne a nema fele.
  it('EGYETLEN sor sem kezdodik a regi, idobelyeg NELKULI alakkal', () => {
    loadGate('g._gate_log("outgoing-copy-gate: MASODIK SOR")')
    const lines = logLines()
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.filter((l) => l.startsWith('outgoing-copy-gate:')).length).toBe(0)
  })

  // A HANGERO NEM CSOKKENT: UGYANAZ a sor ketszer hivva KET sort ad.
  //
  // AZ ELSO ALAKJA KET KULONBOZO uzenetet irt (A es B), es egy szoveg-kulcsu dedup-mutacio
  // ATMENT rajta -- vagyis a teszt neve tobbet allitott, mint amennyit mert. A valos eset epp
  // az AZONOS sor: a hianyzo szabaly-fajl panasza beture ugyanaz minden hivasnal, ezert lett
  // 9778 azonos sor. A fixture-nek ezt kell utanoznia, kulonben a dedup eszrevetlen maradna.
  it('UGYANAZ a sor ketszer -> KET bejegyzes (a panasz gyakorisaga valtozatlan)', () => {
    loadGate('g._gate_log("outgoing-copy-gate: AZONOS"); g._gate_log("outgoing-copy-gate: AZONOS")')
    const same = logLines().filter((l) => / outgoing-copy-gate: AZONOS$/.test(l))
    expect(same.length, 'egy dedup itt csendben elvenne a jelzest').toBe(2)
  })
})
