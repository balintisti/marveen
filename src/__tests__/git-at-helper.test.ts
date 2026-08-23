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
