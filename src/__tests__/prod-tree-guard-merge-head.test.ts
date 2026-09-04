/**
 * A MERGE EZEN A FAN SZANKCIONALT -- TEHAT A LEZARASA SEM MEGKERULES (kartya `8c08c0bc`).
 *
 * MERVE 2026-09-04, a fo checkout SAJAT HEAD-reflogjabol (a reflog worktree-nkent kulon fajl):
 * 2026-08-20 ota **116 merge / 91 commit**, es a 116-bol **82 kartya-id nevu agrol** -- a
 * koordinator napi kotegei. A build EBBOL a fabol keszul, es a `post-checkout` or SZANDEKOSAN
 * ide allitja vissza. A kartya eredeti diagnozisa ("az or a rossz esetre szigoru") ezert
 * FORDITVA allt: a merge a szankcionalt muvelet, es a sima commit az, amit az or helyesen fog meg.
 *
 * EGY TISZTA AUTO-MERGE AMUGY SEM ER IDE: a git a `pre-merge-commit` hookot hivja, ami nincs
 * telepitve (merve ugyanaznap, kontrollal). Ami ide er, az az UTKOZO merge feloldasa utani kezi
 * `git commit` -- ugyanannak a muveletnek a befejezese --, es eddig meg volt tagadva.
 *
 * A HATOKOR-ALLITAS, ES EZ A FAJL LEGFONTOSABB RESZE. A `MERGE_HEAD` PONTOSAN addig letezik, amig
 * a merge BEFEJEZETLEN. Merve:
 *
 *     utkozo merge alatt, feloldas elott ....... LETEZIK
 *     a feloldas utani kezi commit pillanataban  LETEZIK
 *     `git merge --no-commit` utan ............. LETEZIK
 *     a merge BEFEJEZESE utan .................. **NINCS**
 *
 * Ezert egy KESOBBI, fuggetlen commit ugyanugy blokkolt marad, es ezt a 4. eset allitja is. Ez
 * nem mellekes: a felulbiralasi naplo 27 sorabol **17 a `suite-size-guard.ts` baseline-je**, amit
 * a merge UTAN kell frissiteni -- ott a `MERGE_HEAD` mar nincs meg, tehat **ezt a tobbseget ez a
 * valtozas NEM fedi le.** A kartya ezt kulon rogziti; itt azert all, hogy senki ne olvassa
 * tobbnek, mint ami.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const INSTALLER = join(ROOT, 'scripts', 'install-prod-tree-guard-hook.sh')

let repo: string
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/**
 * A TOPOLOGIA A TELEPITES ELOTT EPUL, ES EZ NEM STILUS -- MERT CSAPDA.
 *
 * A telepito NEM CSAK a `pre-commit` ort rakja fel: `post-checkout`-ot is, es az a tiszta fat
 * VISSZAALLITJA arra az agra, amirol jott (ez a prod-tree or masik fele, szandekosan). Merve
 * 2026-09-04: telepites utan egy `git checkout other` UTAN a HEAD tovabbra is `main`.
 *
 * Az elso fixture-om a telepites UTAN valtott agat, tehat MINDKET "divergens" commit ugyanarra az
 * agra kerult -- a merge `rc=0`-val, utkozes nelkul futott le, es harom eset a SETUP-on bukott el,
 * nem az allitason. A tunet megtevesztő volt: `MERGE_HEAD: nincs`, ami ugy nez ki, mintha a
 * vizsgalt kod nem mukodne.
 *
 * Ezert minden ag es minden divergens commit a telepites ELOTT keszul. A telepites utan mar csak
 * az tortenik, ami a MERES targya: a merge es a commit.
 */

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'prod-guard-merge-'))
  git('init', '-q', '-b', 'main', '.')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  writeFileSync(join(repo, 'a.txt'), 'base\n')
  git('add', '-A'); git('commit', '-qm', 'base')

  // Ket merge-forras, MINDKETTO a telepites elott (lasd a fenti docblockot).
  git('checkout', '-q', '-b', 'utkozo')
  writeFileSync(join(repo, 'a.txt'), 'theirs\n')
  git('add', '-A'); git('commit', '-qm', 'theirs')

  git('checkout', '-q', '-b', 'tiszta', 'main')
  writeFileSync(join(repo, 'uj.txt'), 'nem utkozik\n')
  git('add', '-A'); git('commit', '-qm', 'clean side')

  git('checkout', '-q', 'main')
  writeFileSync(join(repo, 'a.txt'), 'ours\n')
  git('add', '-A'); git('commit', '-qm', 'ours')

  // A TELEPITOT A TEMP REPOBA MASOLVA kell futtatni, SOHA nem abszolut uton: a hook-konyvtarat
  // a SAJAT helyebol oldja fel (`git rev-parse --git-common-dir`), es egy csatolt worktreebol az
  // az ELES checkout megosztott .git/hooks-ja. A testverfajl megmerte, hogy pontosan ez tortent,
  // es negy eset ment zoldre egy hook NELKULI repo ellen.
  copyFileSync(INSTALLER, join(repo, 'scripts', 'install-prod-tree-guard-hook.sh'))
  execFileSync('bash', ['scripts/install-prod-tree-guard-hook.sh'], { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
})
afterEach(() => { if (repo) rmSync(repo, { recursive: true, force: true }) })

/** Megprobal commitolni; true = ATMENT, false = a hook MEGTAGADTA. */
function tryCommit(msg: string): boolean {
  try {
    execFileSync('git', ['commit', '-qm', msg], { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
    return true
  } catch { return false }
}

/** A mar meglevo `utkozo` ag beolvasztasa -> utkozes -> MERGE_HEAD. */
function startConflictingMerge(): void {
  try { execFileSync('git', ['merge', '--no-edit', 'utkozo'], { cwd: repo, stdio: 'pipe' }) } catch { /* utkozik, ez a cel */ }
}

/** Van-e folyamatban levo merge? (a rev-parse nem-nullaval lep ki, ha nincs) */
function mergeInProgress(): boolean {
  try {
    execFileSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: repo, stdio: 'pipe' })
    return true
  } catch { return false }
}

describe('prod-tree-guard: a folyamatban levo merge lezarasa atmegy', () => {
  it('POZITIV KONTROLL: a hook a TEMP repoba telepult, es MEG IS FOG', () => {
    // Enelkul minden "atmegy" allitas kielegitheto egy hook NELKULI repoval -- pontosan az a
    // hiba, amit a testverfajl megmert.
    expect(existsSync(join(repo, '.git', 'hooks', 'pre-commit.d', '05-prod-tree-guard'))).toBe(true)
    writeFileSync(join(repo, 'b.txt'), 'x\n')
    git('add', '-A')
    expect(tryCommit('sima commit')).toBe(false)
  })

  it('UTKOZO merge feloldasa utani kezi commit: ATMEGY (ez a javitas)', () => {
    startConflictingMerge()
    expect(mergeInProgress()).toBe(true)
    writeFileSync(join(repo, 'a.txt'), 'resolved\n')
    git('add', '-A')
    expect(tryCommit('merge feloldva')).toBe(true)
  })

  it('`git merge --no-commit` utan is ATMEGY -- ugyanaz a befejezetlen allapot', () => {
    execFileSync('git', ['merge', '--no-commit', '--no-edit', 'tiszta'], { cwd: repo, stdio: 'pipe' })
    expect(mergeInProgress()).toBe(true)
    expect(tryCommit('kezi merge-commit')).toBe(true)
  })

  it('A HATAR: a merge BEFEJEZESE UTANI kovetkezo commit MEG MINDIG BLOKKOLT', () => {
    // EZ AZ, AMI MIATT A VALTOZAS NEM BLANKO-MEGKERULES. Es egyben a kimondott korlatja: a
    // felulbiralasi naplo 27 sorabol 17 EPP ILYEN (a merge utani baseline-frissites), tehat azt
    // a tobbseget ez NEM oldja meg. Ha ez az allitas valaha zoldrol pirosra vagy forditva
    // fordul, a hatokor valtozott meg, nem egy reszlet.
    startConflictingMerge()
    writeFileSync(join(repo, 'a.txt'), 'resolved\n')
    git('add', '-A')
    expect(tryCommit('merge feloldva')).toBe(true)
    expect(mergeInProgress()).toBe(false)
    writeFileSync(join(repo, 'e.txt'), 'kesobbi, fuggetlen\n')
    git('add', '-A')
    expect(tryCommit('a merge utani kovetkezo commit')).toBe(false)
  })

  it('EGY MASIK FABAN a merge-ag NEM SZOLAL MEG -- az uzenet a prod fara van szukitve', () => {
    // MERT HIANY POTLASA: a `$TOPLEVEL = $PROD_ROOT` feltetelt a merge-agbol KIVEVE a batéria
    // tobbi esete VALTOZATLANUL zold maradt (mutacio 3, 2026-09-04). Nem defektus -- egy nem-prod
    // faban az or amugy is atengedne --, hanem REDUNDANS FELTETEL a BLOKKOLAS szempontjabol.
    // Ami NEM redundans, az az UZENET: nelkule minden worktree minden merge-lezarasa kiirna egy
    // "prod-tree-guard: ..." sort, ami nem rola szol. Ez az allitas azt a felet rogziti, es
    // ezzel a 3. mutacio is diszkriminal.
    const wt = mkdtempSync(join(tmpdir(), 'prod-guard-wt-'))
    try {
      execFileSync('git', ['worktree', 'add', '-q', '--detach', wt, 'main'], { cwd: repo, stdio: 'pipe' })
      // Ugyanaz a befejezetlen merge, csak a CSATOLT worktreeben (ott TOPLEVEL != PROD_ROOT).
      execFileSync('git', ['merge', '--no-commit', '--no-edit', 'tiszta'], { cwd: wt, stdio: 'pipe' })
      // A GUARD A STDERR-RE IR, ES AZ `execFileSync` A STDOUT-TAL TER VISSZA. Az elso alakom
      // a stdout-ot allitotta, tehat a mutacio (a prod-ellenorzes kivetele a merge-agbol) UGY IS
      // tulelt, hogy az uzenet tenylegesen megjelent -- a lap sajat lecke je arrol, hogy egy
      // burkolo eldobhatja azt a csatornat, amin az or beszel. Ezert `spawnSync` es stderr.
      const r = spawnSync('git', ['commit', '-m', 'merge egy masik faban'], { cwd: wt, encoding: 'utf8' })
      expect(r.status).toBe(0)
      expect(r.stderr ?? '').not.toContain('prod-tree-guard')
    } finally {
      rmSync(wt, { recursive: true, force: true })
      try { execFileSync('git', ['worktree', 'prune'], { cwd: repo, stdio: 'pipe' }) } catch { /* takaritas */ }
    }
  })

  it('a felulbiralas TOVABBRA IS mukodik, es a merge-ut nem valtja ki', () => {
    // A ket ut fuggetlen: a MERGE_HEAD-es atengedes nem teszi feleslegesse a kimondott
    // felulbiralast, es nem is rontja el.
    writeFileSync(join(repo, 'f.txt'), 'x\n')
    git('add', '-A')
    execFileSync('git', ['commit', '-qm', 'szandekos felulbiralas'], {
      cwd: repo, stdio: 'pipe', env: { ...process.env, MARVEEN_PROD_COMMIT_OK: '1',
        // AZ INDOK 2026-09-04 OTA KOTELEZO (kartya 832e2df6). Ez nem a teszt lazitasa:
        // a felulbiralas SZERZODESE valtozott, es egy valodi felhasznalonak is ezt kell
        // megadnia. Indok nelkul a kapu MEGTAGAD -- arra kulon eset all a
        // prod-tree-guard-merge-baseline.test.ts-ben (8. es 9.).
        MARVEEN_PROD_COMMIT_REASON: 'teszt-fixture: a felulbiralasi ut gyakorlasa' },
    })
    expect(git('log', '-1', '--format=%s')).toBe('szandekos felulbiralas')
  })
})
