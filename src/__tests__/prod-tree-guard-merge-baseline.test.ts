/**
 * A MERGE ALTAL KIKENYSZERITETT ALAPVONAL-FRISSITES (kartya 832e2df6).
 *
 * A LELET: 29 prod-tree megkerulesbol 18 ugyanaz az egy allapot -- a merge-elt fanak tobb
 * tesztje van, tehat a merge MECHANIKUSAN kikenyszerit egy alapvonal-commitot, csak addigra a
 * `MERGE_HEAD` mar nincs, tehat a meglevo merge-felreallas szerkezetileg nem er oda.
 * MERVE, 18/18: minden megkerulesi esemeny olyan committal parosul, aminek a SZULOJE merge, es
 * ami CSAK a generalt alapvonal-fajlt erinti.
 *
 * A HORGONY SZANDEKOSAN NEM FAJLNEV (marveen dontese): egy fajl-allowlista nev-alapu kivetel
 * lenne, es egy nev-kulcsos felsorolas szerkezetileg vak arra, aminek MAS a neve. Helyette a
 * HEAD merge-volta + a GENERATOR sajat markere.
 *
 * A NEGATIV ESETEK A SULY: egy tul-tag felreallas engedne, hogy a fo fa a VEDELMET HORDOZO
 * fajlt szerkessze. Ezert a 3., 4., 6. es 7. eset legalabb annyira fontos, mint az 1.
 * A 7. az ALLAPOT-HORGONY sajat kontrollja: ugyanaz a diff, ugyanazok az ertekek, csak a HEAD
 * nem merge -> BLOKKOL. Ha atmenne, a merge-feltetel diszlet lenne.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const INSTALLER = join(REPO, 'scripts', 'install-prod-tree-guard-hook.sh')
const BL = 'src/__tests__/setup/suite-size-guard.ts'

let dir = ''
let guard = ''
const git = (args: string[], cwd = dir) => execFileSync('git', args, { cwd, encoding: 'utf8' })

function baseline(stamp: string, files: number, tests: number): string {
  return [
    '// === SUITE-BASELINE:BEGIN ===',
    `/** Merve ${stamp} -- vitest list --json -> ${files} fajl / ${tests} teszt. */`,
    `export const SUITE_BASELINE_FILES = ${files}`,
    `export const SUITE_BASELINE_TESTS = ${tests}`,
    '// === SUITE-BASELINE:END ===',
    '',
  ].join('\n')
}

/** A telepitett or dontese egy STAGED allapotra. Nem commitol es nem hajt vegre semmit. */
function blocks(env: Record<string, string> = {}): boolean {
  try {
    execFileSync('bash', [guard], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } })
    return false
  } catch {
    return true
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'prodguard-merge-'))
  mkdirSync(join(dir, 'src/__tests__/setup'), { recursive: true })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'store'), { recursive: true })
  git(['init', '-q', '-b', 'main', '.'])
  git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't'])
  writeFileSync(join(dir, BL), baseline('2026-09-04 10:00', 100, 1000))
  writeFileSync(join(dir, 'other.txt'), 'x\n')
  git(['add', '-A']); git(['commit', '-qm', 'init'])
  // A MERGE TOPOLOGIA ELOSZOR, es csak AZUTAN a telepites: az or post-checkout hookja
  // visszaallitja az agat, tehat telepites utan mar nem lehetne agat valtani.
  git(['checkout', '-qb', 'feat1']); writeFileSync(join(dir, 'f.txt'), 'f\n')
  git(['add', '-A']); git(['commit', '-qm', 'feat'])
  git(['checkout', '-q', 'main']); writeFileSync(join(dir, 'm.txt'), 'm\n')
  git(['add', '-A']); git(['commit', '-qm', 'main'])
  git(['merge', '--no-ff', '-q', 'feat1', '-m', 'merge: feat1'])
  // A telepito a REPON BELUL kell legyen: a hook-konyvtarat a SAJAT helyebol oldja fel.
  copyFileSync(INSTALLER, join(dir, 'scripts', 'install-prod-tree-guard-hook.sh'))
  writeFileSync(join(dir, '.git/info/exclude'), 'scripts/\n')
  execFileSync('bash', ['scripts/install-prod-tree-guard-hook.sh'], { cwd: dir, stdio: 'ignore' })
  guard = join(dir, '.git/hooks/pre-commit.d/05-prod-tree-guard')
})
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

const reset = () => { git(['reset', '-q']); git(['checkout', '-q', '--', '.']) }
const stage = (content: string) => { writeFileSync(join(dir, BL), content); git(['add', BL]) }

describe('prod-tree-guard: a merge altal kikenyszeritett alapvonal-frissites', () => {
  it('ELOFELTETEL: az or telepult, es a HEAD merge-commit', () => {
    // Enelkul minden lenti eset egy NEM LETEZO fajl futtatasabol adna "blokkol"-t --
    // a negativ esetek atmennenek egy halott meron, es csak a pozitivak arulnak el.
    expect(existsSync(guard)).toBe(true)
    expect(() => git(['rev-parse', '-q', '--verify', 'HEAD^2'])).not.toThrow()
  })

  it('1. alapvonal-frissites merge UTAN, novekvo ertekekkel -> ATENGED', () => {
    stage(baseline('2026-09-04 11:00', 105, 1050))
    expect(blocks()).toBe(false)
    reset()
  })

  it('2. ugyanaz, de EGY MASIK fajl is staged -> BLOKKOL', () => {
    stage(baseline('2026-09-04 11:00', 105, 1050))
    writeFileSync(join(dir, 'zaj.txt'), 'zaj\n'); git(['add', 'zaj.txt'])
    expect(blocks()).toBe(true)
    reset(); rmSync(join(dir, 'zaj.txt'), { force: true })
  })

  it('3. az ertek CSOKKEN -> BLOKKOL (ezzel lehetne keszlet-zsugorodast elrejteni)', () => {
    stage(baseline('2026-09-04 11:00', 90, 900))
    expect(blocks()).toBe(true)
    reset()
  })

  it('4. valtozas a generalt blokkon KIVUL -> BLOKKOL', () => {
    stage(baseline('2026-09-04 11:00', 105, 1050) + '\n// kezi sor\n')
    expect(blocks()).toBe(true)
    reset()
  })

  it('5. CSAK az idobelyeg valtozik -> ATENGED (mert szeleset: 379380f0)', () => {
    // Egy "a szamnak novekednie kell" feltetel ezt kizarna; a "nem csokken" nem.
    stage(baseline('2026-09-04 12:00', 100, 1000))
    expect(blocks()).toBe(false)
    reset()
  })

  it('6. a fajl NEM hordozza a generator markeret -> BLOKKOL', () => {
    stage(baseline('2026-09-04 11:00', 105, 1050).replace('=== SUITE-BASELINE:BEGIN ===', 'nincs marker'))
    expect(blocks()).toBe(true)
    reset()
  })

  it('7. UGYANAZ a valtozas, de a HEAD NEM merge-commit -> BLOKKOL', () => {
    // AZ ALLAPOT-HORGONY SAJAT KONTROLLJA. Ugyanaz a fajl, ugyanaz a diff, ugyanazok az
    // ertekek -- csak a HEAD allapota mas.
    git(['commit', '-q', '--allow-empty', '--no-verify', '-m', 'sima commit'])
    expect(() => git(['rev-parse', '-q', '--verify', 'HEAD^2'])).toThrow()
    stage(baseline('2026-09-04 11:00', 105, 1050))
    expect(blocks()).toBe(true)
    reset()
  })
})

describe('prod-tree-guard: a megkerules INDOKA kotelezo', () => {
  it('8. MARVEEN_PROD_COMMIT_OK=1 indok NELKUL -> BLOKKOL', () => {
    stage(baseline('2026-09-04 13:00', 106, 1060))
    expect(blocks({ MARVEEN_PROD_COMMIT_OK: '1', MARVEEN_PROD_COMMIT_REASON: '' })).toBe(true)
    reset()
  })

  it('9. ugyanaz INDOKKAL -> ATENGED (a kijaratot szigoritjuk, nem zarjuk be)', () => {
    stage(baseline('2026-09-04 13:00', 106, 1060))
    expect(blocks({ MARVEEN_PROD_COMMIT_OK: '1', MARVEEN_PROD_COMMIT_REASON: 'mert kell' })).toBe(false)
    reset()
  })
})
