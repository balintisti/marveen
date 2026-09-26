/**
 * scripts/dev-gc.py -- a napi takarito a ket fejlesztoi felhalmozora (kartya 251b5785).
 *
 * Ket fele van, es mindkettonek a VEDELME a lenyeg, nem a torlese:
 *   jest_dx ... csak a 24 oranal regebbi FAJL megy, es csak egy `jest_dx` nevu konyvtarban
 *               a /private/tmp vagy a /private/var/folders alatt -- egy friss fajl MARAD
 *   e2e DB .... ugyanaz a nev-minta, mint a DB-kapue, aktiv kapcsolat nelkul, es a parancs
 *               a kapu SAJAT verdict()-jen megy at, mielott lefut
 *
 * A DB-felet szerver NELKUL teszteljuk: a plan_db tiszta fuggveny, az mtime-forras
 * injektalhato. Ez a fajl egyetlen adatbazist sem dob el.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'dev-gc.py')
const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

function jestFixture(dirName = 'jest_dx') {
  const base = mkdtempSync(join(tmpdir(), 'devgc-'))
  made.push(base)
  const d = join(base, dirName)
  mkdirSync(join(d, 'sub'), { recursive: true })
  const old = join(d, 'sub', 'old.map')
  const fresh = join(d, 'sub', 'fresh.map')
  writeFileSync(old, 'x')
  writeFileSync(fresh, 'x')
  const twoDaysAgo = (Date.now() - 48 * 3600 * 1000) / 1000
  utimesSync(old, twoDaysAgo, twoDaysAgo)
  return { d, old, fresh }
}

function run(args: string[]): string {
  return execFileSync('python3', [SCRIPT, '--skip-db', ...args], { encoding: 'utf8' })
}

describe('dev-gc: jest_dx', () => {
  it('a 24 oranal regebbi fajl megy, a FRISS marad (futo jest ne serüljon)', () => {
    const f = jestFixture()
    const out = run(['--jest-dir', f.d])
    expect(out).toMatch(/jest_dx: 1 files/)
    expect(existsSync(f.old)).toBe(false)
    expect(existsSync(f.fresh)).toBe(true)
  })

  it('--dry-run semmit nem torol, de megszamolja', () => {
    const f = jestFixture()
    expect(run(['--dry-run', '--jest-dir', f.d])).toMatch(/DRY-RUN jest_dx: 1 files/)
    expect(existsSync(f.old)).toBe(true)
  })

  it('egy NEM jest_dx nevu konyvtarat megtagad, es kiirja', () => {
    const f = jestFixture('not_jest')
    const out = run(['--jest-dir', f.d])
    expect(out).toMatch(/REFUSED dirs/)
    expect(existsSync(f.old)).toBe(true)
  })

  it('1 ora alatti kuszobot megtagad (egy futo jest cache-e alatt lenne)', () => {
    let rc = 0
    try {
      execFileSync('python3', [SCRIPT, '--skip-db', '--max-age-hours', '0.1'], { encoding: 'utf8' })
    } catch (e: any) {
      rc = e.status
    }
    expect(rc).toBe(2)
  })
})

/** plan_db szerver nelkul: sorok + egy kitalalt mtime-forras; a VALODI kapuval. */
function plan(rows: [number, string, number][], ageHoursByOid: Record<number, number | null>, env: Record<string, string> = {}) {
  const driver = `
import importlib.util, json, sys, time
def load(n, p):
    s = importlib.util.spec_from_file_location(n, p); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
gc = load("gc", ${JSON.stringify(SCRIPT)})
gate = gc.load_gate()
a = json.loads(sys.stdin.read())
now = time.time()
ages = {int(k): v for k, v in a["ages"].items()}
def mt(path):
    oid = int(path.rsplit("/", 1)[1])
    v = ages.get(oid)
    return None if v is None else now - v * 3600
drop, skipped = gc.plan_db([tuple(r) for r in a["rows"]], "/pgdata", now, 24 * 3600, gate, a["env"], mt)
print(json.dumps({"drop": [n for n, _ in drop], "skipped": skipped}))
`
  const out = execFileSync('python3', ['-c', driver], {
    input: JSON.stringify({ rows, ages: ageHoursByOid, env }),
    encoding: 'utf8',
  })
  return JSON.parse(out.trim()) as { drop: string[]; skipped: Record<string, string[]> }
}

describe('dev-gc: e2e DB-k kivalasztasa (plan_db)', () => {
  it('egy regi, tetlen crm_e2e_<agens>_<utotag> megy', () => {
    expect(plan([[1, 'crm_e2e_dexter_a1', 0]], { 1: 30 }).drop).toEqual(['crm_e2e_dexter_a1'])
  })

  it('a ket elo csapda: a baseline es a KOZOS DB nevre esik ki, akarhany eves', () => {
    const r = plan([[1, 'crm_e2e_didi', 0], [2, 'crm_e2e_test', 0], [3, 'crm_e2e_test_x', 0]], { 1: 900, 2: 900, 3: 900 })
    expect(r.drop).toEqual([])
    expect(r.skipped.name.sort()).toEqual(['crm_e2e_didi', 'crm_e2e_test', 'crm_e2e_test_x'])
  })

  it('aktiv kapcsolattal nem megy', () => {
    const r = plan([[1, 'crm_e2e_didi_x', 1]], { 1: 30 })
    expect(r.drop).toEqual([])
    expect(r.skipped.active).toEqual(['crm_e2e_didi_x'])
  })

  it('friss (24 oran beluli) nem megy, ismeretlen koru sem', () => {
    const r = plan([[1, 'crm_e2e_didi_x', 0], [2, 'crm_e2e_didi_y', 0]], { 1: 2, 2: null })
    expect(r.drop).toEqual([])
    expect(r.skipped.young).toEqual(['crm_e2e_didi_x'])
    expect(r.skipped['age-unknown']).toEqual(['crm_e2e_didi_y'])
  })

  it('a KAPU donti el utoljara: egy tavoli PGHOST mellett a kapu nem enged, es a job sem', () => {
    const r = plan([[1, 'crm_e2e_didi_x', 0]], { 1: 30 }, { PGHOST: 'db.example.com' })
    expect(r.drop).toEqual([])
    expect(r.skipped.gate).toEqual(['crm_e2e_didi_x'])
  })
})
