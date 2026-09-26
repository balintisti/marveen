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
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, rmSync, readdirSync, realpathSync, symlinkSync } from 'node:fs'
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
  return execFileSync('python3', [SCRIPT, '--skip-db', '--skip-worktrees', '--skip-compile-cache', ...args], {
    encoding: 'utf8',
  })
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
      execFileSync('python3', [SCRIPT, '--skip-db', '--skip-worktrees', '--skip-compile-cache', '--max-age-hours', '0.1'], {
        encoding: 'utf8',
      })
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

/**
 * Kartya 9f499b14: compile-cache meretkorlat + worktree-riport. A worktree-fel ALAPBOL csak
 * riportol (--apply-worktrees nelkul), es minden kizaro feltetelnek van egy fa a fixture-ben,
 * ami PONTOSAN azon bukik el -- plusz egy, ami megy (kulonben a "0 torles" nem kulonboztetheto
 * meg egy vak merotol).
 */
function runAll(args: string[]): string {
  return execFileSync('python3', [SCRIPT, '--skip-db', '--jest-dir', '/nonexistent/jest_dx', ...args], {
    encoding: 'utf8',
  })
}

function sh(cmd: string[], cwd: string) {
  return execFileSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function age(dir: string, hours: number) {
  const t = (Date.now() - hours * 3600 * 1000) / 1000
  for (const n of readdirSync(dir)) utimesSync(join(dir, n), t, t)
  utimesSync(dir, t, t)
}

function wtFixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'devgc-wt-')))
  made.push(base)
  const remote = join(base, 'remote.git')
  const repo = join(base, 'repo')
  sh(['git', 'init', '-q', '--bare', remote], base)
  sh(['git', 'init', '-q', '-b', 'main', repo], base)
  const g = (args: string[], cwd = repo) => sh(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], cwd)
  writeFileSync(join(repo, 'a.txt'), 'a')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'init'])
  g(['remote', 'add', 'fork', remote])
  g(['push', '-q', 'fork', 'main'])
  g(['fetch', '-q', 'fork'])
  const wt = (name: string) => {
    const p = join(base, name)
    g(['worktree', 'add', '-q', '--detach', p, 'main'])
    return p
  }
  const pushed = wt('wt-pushed')
  const dirty = wt('wt-dirty')
  writeFileSync(join(dirty, 'untracked.txt'), 'x')
  const local = wt('wt-local')
  writeFileSync(join(local, 'b.txt'), 'b')
  g(['add', '.'], local)
  g(['commit', '-q', '-m', 'local only'], local)
  const young = wt('wt-young')
  const target = wt('wt-nm-target')
  const user = wt('wt-nm-user')
  symlinkSync(target, join(user, 'node_modules'))
  // node_modules symlink is untracked -> the user tree is dirty; only the TARGET matters here
  for (const p of [pushed, dirty, local, target, user]) age(p, 72)
  age(young, 1)
  return { repo, pushed, dirty, local, young, target, user }
}

describe('dev-gc: worktree-riport (9f499b14)', () => {
  it('csak a tiszta, tavolin levo, regi fa jelolt; minden mas a SAJAT okan marad', () => {
    const f = wtFixture()
    const out = runAll(['--skip-compile-cache', '--wt-repo', `${f.repo}:fork`])
    expect(out).toMatch(/REPORT-ONLY worktrees .*would remove 1,/)
    expect(out).toContain(`would remove: ${f.pushed}`)
    expect(out).toMatch(/'dirty': 2/) // wt-dirty + wt-nm-user (untracked symlink)
    expect(out).toMatch(/'local-only-commits': 1/)
    expect(out).toMatch(/'young': 1/)
    expect(out).toMatch(/'node_modules-target': 1/)
    // riport: SEMMI nem tunt el
    for (const p of [f.pushed, f.dirty, f.local, f.young, f.target]) expect(existsSync(p)).toBe(true)
  })

  it('--apply-worktrees NELKUL a --dry-run nelkuli futas sem torol', () => {
    const f = wtFixture()
    runAll(['--skip-compile-cache', '--wt-repo', `${f.repo}:fork`])
    expect(existsSync(f.pushed)).toBe(true)
  })

  it('--apply-worktrees csak a jeloltet veszi ki, az agat nem torli', () => {
    const f = wtFixture()
    const out = runAll(['--skip-compile-cache', '--apply-worktrees', '--wt-repo', `${f.repo}:fork`])
    expect(out).toMatch(/worktrees .*removed 1,/)
    expect(existsSync(f.pushed)).toBe(false)
    for (const p of [f.dirty, f.local, f.young, f.target]) expect(existsSync(p)).toBe(true)
  })

  it('egy NEM konfiguralt remote (pl. a halott old-origin helyett eliras) senkit nem enged at', () => {
    const f = wtFixture()
    const out = runAll(['--skip-compile-cache', '--wt-repo', `${f.repo}:nincsilyen`])
    expect(out).toMatch(/would remove 0,/)
    expect(out).toMatch(/'remote-not-configured': 6/)
  })

  it('24 ora alatti korkuszobot es remote nelkuli repot megtagad', () => {
    for (const extra of [['--wt-min-age-hours', '2'], ['--wt-repo', '/x']]) {
      let rc = 0
      try {
        runAll(['--skip-compile-cache', ...extra])
      } catch (e: any) {
        rc = e.status
      }
      expect(rc).toBe(2)
    }
  })
})

describe('dev-gc: compile-cache meretkorlat (9f499b14)', () => {
  function cacheFixture(name = 'node-compile-cache') {
    const base = mkdtempSync(join(tmpdir(), 'devgc-cc-'))
    made.push(base)
    const d = join(base, name)
    mkdirSync(d)
    const files = [0, 1, 2].map((i) => {
      const p = join(d, `f${i}`)
      writeFileSync(p, Buffer.alloc(64 * 1024))
      const t = (Date.now() - (10 - i) * 3600 * 1000) / 1000 // f0 a legregebbi
      utimesSync(p, t, t)
      return p
    })
    return { d, files }
  }

  it('a korlat folott a LEGREGEBBI megy eloszor, amig ala nem er', () => {
    const f = cacheFixture()
    // ~0.15 MB korlat: 3 x 64 KiB = 192 KiB -> egy fajlnak mennie kell
    const out = runAll(['--skip-worktrees', '--compile-cache-dir', f.d, '--compile-cache-cap-mb', '0.15'])
    expect(out).toMatch(/compile caches .*: 1 files/)
    expect(existsSync(f.files[0])).toBe(false)
    expect(existsSync(f.files[1])).toBe(true)
    expect(existsSync(f.files[2])).toBe(true)
  })

  it('a korlat alatt semmi nem megy', () => {
    const f = cacheFixture()
    const out = runAll(['--skip-worktrees', '--compile-cache-dir', f.d])
    expect(out).toMatch(/compile caches .*: 0 files/)
    for (const p of f.files) expect(existsSync(p)).toBe(true)
  })

  it('idegen nevu konyvtarat megtagad', () => {
    const f = cacheFixture('valami-mas')
    const out = runAll(['--skip-worktrees', '--compile-cache-dir', f.d, '--compile-cache-cap-mb', '0.01'])
    expect(out).toMatch(/REFUSED dirs/)
    for (const p of f.files) expect(existsSync(p)).toBe(true)
  })
})
