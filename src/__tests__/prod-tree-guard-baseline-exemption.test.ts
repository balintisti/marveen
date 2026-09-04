/**
 * A PROD-TREE GUARD ALAPVONAL-KIVETELE (kartya c3573fd6).
 *
 * MIERT LETEZIK. Az or a SAJAT DOKUMENTALT TOBBSEGI ESETEBEN volt megkerulve. Merve
 * 2026-09-04-en a `store/prod-tree-override.log`-bol: **29 felulbiralas, ebbol 18 (62%)**
 * a koteg UTANI alapvonal-frissites -- ott a MERGE_HEAD MAR NEM letezik, tehat a
 * merge-kivetel (kartya 8c08c0bc) szerkezetileg nem er ide. Es a naplo gyujtotte a zajt:
 * 29-bol **26 indok nelkul**, **6 pedig ures** (`files=0`).
 *
 * Egy or, amit a normal munkafolyamatban ki kell kapcsolni, rossz helyen huzza a vonalat --
 * es a kikapcsolas szokassa valik, ami utan a kovetkezo, VALODI blokkolast is reflexbol
 * kerulik meg.
 *
 * MIERT EZ AZ ALAK, ES NEM A KEZENFEKVO. marveen szandekosan NEM javasolta a fajlra szolo
 * kivetelt: az engedne, hogy a fo fa a VEDELMET HORDOZO fajlt szerkessze. Ez szukebb, es a
 * harom feltetel EGYUTT kell. A dontő a HARMADIK: az alapvonal LESZALLITASA epp az a
 * mozdulat, amivel egy keszlet-zsugorodast el lehetne rejteni, tehat annak blokkolva kell
 * maradnia.
 *
 * A tortenetre merve: 56 nem-merge commitbol 43 CSAK a generalt blokkot erinti, es az
 * ertekek monoton nonek (404/5148 -> 415/5265) -- vagyis a kivetel a tenyleges tobbsegi
 * esetet fedi, es semmit nem enged, amit ma barki csinalna.
 *
 * A (2)-(5) eset a lenyeg: egy kivetel annyit er, amennyit MEGTAGAD. Az (1) egyedul
 * ugyanugy kinezne egy olyan orbol is, ami mindent atenged.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, copyFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const INSTALLER = join(HERE, '..', '..', 'scripts', 'install-prod-tree-guard-hook.sh')
const REL = 'src/__tests__/setup/suite-size-guard.ts'

const made: string[] = []
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }) })

const sh = (cwd: string, cmd: string) =>
  execFileSync('/bin/bash', ['-c', cmd], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function baseline(files: number, tests: number): string {
  return `/** Merve 2026. 09. 04. -- \`npx vitest list --json\` -> ${files} fajl / ${tests} teszt. */\n`
    + `export const SUITE_BASELINE_FILES = ${files}\n`
    + `export const SUITE_BASELINE_TESTS = ${tests}\n`
}

/** Eldobhato repo, TELEPITETT orrel. A telepitot BEMASOLJUK: abszolut uton hivva a
 *  `--git-common-dir` a FO checkoutra mutatna (merve 2026-09-04, egyszer meg is tortent). */
function repo(): string {
  const d = mkdtempSync(join(tmpdir(), 'baseline-exempt-'))
  made.push(d)
  mkdirSync(join(d, 'src/__tests__/setup'), { recursive: true })
  mkdirSync(join(d, 'scripts'), { recursive: true })
  writeFileSync(join(d, REL), baseline(400, 5000))
  writeFileSync(join(d, 'other.txt'), 'x\n')
  copyFileSync(INSTALLER, join(d, 'scripts', 'install-prod-tree-guard-hook.sh'))
  sh(d, 'git init -q . && git config user.email t@t && git config user.name t'
       + ' && git add -A && git commit -qm base'
       + ' && bash scripts/install-prod-tree-guard-hook.sh >/dev/null 2>&1')
  return d
}

/** Igaz, ha a commit LETREJOTT (a kapu atengedte). */
function commits(d: string, msg: string): boolean {
  const before = sh(d, 'git rev-parse HEAD').trim()
  try { sh(d, `git commit -m ${JSON.stringify(msg)}`) } catch { /* a hook blokkolt */ }
  return sh(d, 'git rev-parse HEAD').trim() !== before
}

describe('prod-tree-guard alapvonal-kivetel', () => {
  it('ATENGEDI a gepi alapvonal-frissitest, ha az ertekek NONEK', () => {
    const d = repo()
    writeFileSync(join(d, REL), baseline(401, 5010))
    sh(d, `git add ${REL}`)
    expect(commits(d, 'alapvonal-frissites')).toBe(true)
  })

  it('BLOKKOLJA, ha az alapvonal CSOKKEN -- ezzel lehetne zsugorodast elrejteni', () => {
    const d = repo()
    writeFileSync(join(d, REL), baseline(399, 4990))
    sh(d, `git add ${REL}`)
    expect(commits(d, 'alapvonal-csokkentes')).toBe(false)
  })

  it('BLOKKOLJA, ha barmi MAS is a staged halmazban van', () => {
    const d = repo()
    writeFileSync(join(d, REL), baseline(402, 5020))
    appendFileSync(join(d, 'other.txt'), 'y\n')
    sh(d, `git add ${REL} other.txt`)
    expect(commits(d, 'alapvonal + idegen fajl')).toBe(false)
  })

  it('BLOKKOLJA a fajl BLOKKON KIVULI valtozasat', () => {
    const d = repo()
    writeFileSync(join(d, REL), baseline(403, 5030) + '\n// idegen sor\n')
    sh(d, `git add ${REL}`)
    expect(commits(d, 'blokkon kivuli valtozas')).toBe(false)
  })

  it('a sima commit vedelme VALTOZATLAN (nem lazitottunk)', () => {
    const d = repo()
    appendFileSync(join(d, 'other.txt'), 'z\n')
    sh(d, 'git add other.txt')
    expect(commits(d, 'sima commit a prod fan')).toBe(false)
  })
})
