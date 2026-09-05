import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HELPER = join(ROOT, 'scripts', 'git-at.sh')

// A `git-at.sh` LETJOGOSULTSAGA (kartya e63ce68e).
//
// A `git show "$ag:$ut"` alak zsh-ban NEMAN elromlik: a shell a `:` utani elso
// betut valtozo-modositonak olvassa, es az utvonal ELTUNIK. A parancs ezutan a
// puszta AGRA fut -- ami letezik --, tehat a letezes-ellenorzes MINDEN refre
// igazat mond.
//
// Harom agens futott bele egy nap alatt, MINDHARMAN a szabaly leirasa utan.
// Az egyik eset egy BIZTONSAGI kapu allapotarol szolt, es a megnyugtato iranyba
// tevedett.
//
// EZERT AZ ELSO TESZT NEM A SEGEDET MERI, HANEM A CSAPDAT: ha a zsh viselkedese
// valaha megvaltozik, ez a teszt bukik, es akkor a segéd indoklasa is
// ujragondolando. Egy szerszam, aminek az INDOKA elavult, ugyanolyan teher, mint
// egy hianyzo szerszam.

/** Egy eldobhato repo, ahol a fajl LETEZIK, es egy ref, ahol nem. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'git-at-'))
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf-8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  writeFileSync(join(dir, 'alap.txt'), 'alap\n')
  git('add', '-A'); git('commit', '-qm', 'alap')
  git('checkout', '-q', '-b', 'van-benne')
  mkdirSync(join(dir, 'scripts'))
  writeFileSync(join(dir, 'scripts', 'secret-gate.ts'), 'export const gate = true\n')
  git('add', '-A'); git('commit', '-qm', 'gate')
  git('checkout', '-q', 'main')
  return dir
}

const runHelper = (dir: string, args: string[]) =>
  spawnSync('bash', [HELPER, ...args], { cwd: dir, encoding: 'utf-8' })

describe('A CSAPDA -- amiert a segéd letezik', () => {
  it('zsh-ban a nyers alak MINDKET refre igazat mond (az egyiken nincs is ott)', () => {
    const dir = fixture()
    try {
      // Pontosan az az alak, ami harom agenst megfogott. `scripts/` -> `s` ->
      // a zsh modositokent olvassa, az utvonal eltunik, a parancs az AGRA fut.
      const script = `
        for b in main van-benne; do
          if git cat-file -e "$b:scripts/secret-gate.ts" 2>/dev/null; then echo "$b VAN"; else echo "$b NINCS"; fi
        done`
      const r = spawnSync('zsh', ['-c', script], { cwd: dir, encoding: 'utf-8' })
      // A `main` agon NINCS ott a fajl -- megis VAN-t mond.
      expect(r.stdout).toContain('main VAN')
      expect(r.stdout).toContain('van-benne VAN')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a csapda a PATH ELSO BETUJEN mulik -- ezert kiszamithatatlan', () => {
    const dir = fixture()
    try {
      // `.gitignore` -> a `.` nem modosito -> a nyers alak VELETLENUL helyes.
      // Ugyanaz a leirt alak, mas eredmeny: ezt fejben tartani nem lehet.
      const r = spawnSync('zsh', ['-c',
        'if git cat-file -e "$0:nincs-ilyen.txt" 2>/dev/null; then echo VAN; else echo NINCS; fi', 'main'],
        { cwd: dir, encoding: 'utf-8' })
      expect(r.stdout.trim()).toBe('NINCS')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('git-at.sh exists -- a helyes valasz', () => {
  it('NEM-et mond ott, ahol a fajl tenyleg nincs (a nyers alak itt hazudott)', () => {
    const dir = fixture()
    try {
      expect(runHelper(dir, ['exists', 'main', 'scripts/secret-gate.ts']).status).toBe(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('IGEN-t mond ott, ahol tenyleg ott van', () => {
    const dir = fixture()
    try {
      expect(runHelper(dir, ['exists', 'van-benne', 'scripts/secret-gate.ts']).status).toBe(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('egyezik a fuggetlen `git ls-tree` meressel MINDKET refen', () => {
    // Ket kulonbozo uton ugyanaz a valasz. A kulonbseg az egyetlen dolog, ami
    // nem tud csendben tevedni.
    const dir = fixture()
    try {
      for (const ref of ['main', 'van-benne']) {
        const viaTree = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], { cwd: dir, encoding: 'utf-8' })
          .split('\n').includes('scripts/secret-gate.ts')
        const viaHelper = runHelper(dir, ['exists', ref, 'scripts/secret-gate.ts']).status === 0
        expect(viaHelper, `ref=${ref}`).toBe(viaTree)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('git-at.sh show / which', () => {
  it('show a fajl TARTALMAT adja, nem a commitot', () => {
    // A nyers alak elromlasakor a `git show` a BRANCH TIP COMMITJAT irja ki --
    // ami ugy nez ki, mint egy valasz, csak nem a kerdesre.
    const dir = fixture()
    try {
      const r = runHelper(dir, ['show', 'van-benne', 'scripts/secret-gate.ts'])
      expect(r.stdout).toContain('export const gate = true')
      expect(r.stdout).not.toContain('commit ')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('which CSAK azokat a refeket sorolja, ahol tenyleg ott van', () => {
    const dir = fixture()
    try {
      const r = runHelper(dir, ['which', 'scripts/secret-gate.ts', 'main', 'van-benne'])
      expect(r.stdout.trim().split('\n').filter(Boolean)).toEqual(['van-benne'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('ismeretlen alparanccsal HASZNALATOT ir es nem-nullaval lep ki', () => {
    const dir = fixture()
    try {
      const r = runHelper(dir, ['nincs-ilyen'])
      expect(r.status).not.toBe(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

// A MERT LELET (kartya d8d5b92c, mandark 2026-09-03): a segéd az AKTUALIS
// konyvtar repojara fut, es egy agens-cwd sosem az a repo, amire a kerdes
// vonatkozik. Egy Delta-CRM utat a marveen repoban keresett -> `rc=1 NINCS`,
// NULLA stderrel, bajt-azonosan egy igaz nemlegessel.
//
// ES AMI A JAVITAS KOZBEN DOLT MEG: az elso javitasom egy ref-ellenorzes volt,
// ami a mert esetet NEM fogja meg -- az `origin/main` MINDKET repoban feloldodik,
// csak mas fara. Ezert a nemleges valasz mostantol MEGNEVEZI a fat, es van `-C`.
describe('git-at.sh -- melyik FAT kerdeztuk (kartya d8d5b92c)', () => {
  it('a NEMLEGES valasz megnevezi a repot es a refet a stderr-en', () => {
    const dir = fixture()
    try {
      const r = runHelper(dir, ['exists', 'main', 'scripts/secret-gate.ts'])
      expect(r.status).toBe(1)                    // valodi nemleges: a kod nem valtozik
      // EGYETLEN sor, es MINDHAROM adat RAJTA. A `toContain` onmagaban nem eleg:
      // a printf UJRAHASZNALJA a formatumot, ha tobb argumentumot kap, mint
      // ahany %s van benne -- egy elrontott uzenet igy HAROM sort ir ki, es a
      // szavak kulon-kulon mind ott vannak. Ezt egy mutacio mutatta meg: a
      // formatum-sztring szetverese TULELTE az elso valtozatot.
      const lines = r.stderr.trim().split('\n').filter(Boolean)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('main')          // MELYIK ref
      expect(lines[0]).toContain(dir)             // MELYIK fa -- ez a hianyzo fel
      expect(lines[0]).toContain('scripts/secret-gate.ts')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('-C egy MASIK repot kerdez, idegen cwd-bol -- ez maga a mert eset', () => {
    // `here` egy MASIK repo, ami nem ismeri a `van-benne` agat -- pontosan az az
    // allapot, amibe egy agens-cwd tesz: ervenyes repo, rossz fa.
    const here = mkdtempSync(join(tmpdir(), 'git-at-masik-'))
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: here })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: here })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: here })
    writeFileSync(join(here, 'x.txt'), 'x\n')
    execFileSync('git', ['add', '-A'], { cwd: here })
    execFileSync('git', ['commit', '-qm', 'x'], { cwd: here })
    const there = fixture()
    try {
      const withoutC = runHelper(here, ['exists', 'van-benne', 'scripts/secret-gate.ts'])
      const withC = runHelper(here, ['-C', there, 'exists', 'van-benne', 'scripts/secret-gate.ts'])
      // A -C nelkuli valasz NEM "nincs" (1), hanem "nem merheto" (3), es megnevezi a fat.
      expect(withoutC.status).toBe(3)
      expect(withoutC.stderr).toContain(here)
      // A -C-vel ugyanabbol a cwd-bol a HELYES valasz jon.
      expect(withC.status).toBe(0)
    } finally {
      rmSync(here, { recursive: true, force: true }); rmSync(there, { recursive: true, force: true })
    }
  })

  it('fel nem oldodo ref: exit 3, NEM 1 -- a "nem merheto" nem "nincs"', () => {
    const dir = fixture()
    try {
      const r = runHelper(dir, ['exists', 'nincs-ilyen-ref-xyz', 'alap.txt'])
      expect(r.status).toBe(3)
      expect(r.stderr).toContain('nincs-ilyen-ref-xyz')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('nem-git konyvtarban: exit 3, es kimondja, hogy nem merheto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-at-nem-repo-'))
    try {
      const r = runHelper(dir, ['exists', 'main', 'alap.txt'])
      expect(r.status).toBe(3)
      expect(r.stderr).toMatch(/NEM MERHETO|NEM git repo/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('which: egy fel nem oldodo ref NEM csendben marad ki -- exit 3 es nevesitve', () => {
    const dir = fixture()
    try {
      const r = runHelper(dir, ['which', 'scripts/secret-gate.ts', 'van-benne', 'nincs-ilyen-ref-xyz'])
      expect(r.stdout.trim().split('\n').filter(Boolean)).toEqual(['van-benne'])
      expect(r.status).toBe(3)                    // a listat NEM szabad tisztanak olvasni
      expect(r.stderr).toContain('nincs-ilyen-ref-xyz')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
