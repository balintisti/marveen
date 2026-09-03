// Regression test for the update checker's branch selection.
//
// The checker used to hardcode `main` while update.sh pulls
// `origin/<current branch>`. On any checkout that follows another branch
// (e.g. `develop`) the two disagreed: the dashboard advertised a "new version"
// the update button could never deliver, and stayed silent about the commits
// that actually were on the way. trackedBranch() is what keeps the two in sync,
// so it is pinned here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { trackedBranch, currentVersion, getUpdateStatus } from '../web/update-checker.js'
import { PROJECT_ROOT } from '../config.js'

function gitBranch(): string {
  return execFileSync('/usr/bin/git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: PROJECT_ROOT, timeout: 3000, encoding: 'utf-8',
  }).trim()
}

describe('update checker branch selection', () => {
  it('follows the branch the checkout is actually on', () => {
    const actual = gitBranch()
    // Detached HEAD reports the literal "HEAD"; the helper substitutes main
    // there, matching what update.sh tells the operator to check out.
    const expected = actual && actual !== 'HEAD' ? actual : 'main'
    expect(trackedBranch()).toBe(expected)
  })

  it('never returns an empty ref', () => {
    // An empty branch would produce `origin/` / `commits/` requests that fail
    // in confusing ways; the fallback must always yield a usable ref.
    expect(trackedBranch()).toBeTruthy()
  })

  it('does not silently assume main on a non-main checkout', () => {
    const actual = gitBranch()
    if (!actual || actual === 'HEAD' || actual === 'main') return // nothing to prove here
    expect(trackedBranch()).not.toBe('main')
  })
})

// The Updates panel shows the running instance's semver; it must come from
// package.json and never be fabricated. currentVersion() is the single source.
describe('update checker current version', () => {
  it('returns the semver from package.json at PROJECT_ROOT', () => {
    const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'))
    expect(currentVersion()).toBe(pkg.version)
    // sanity: it is a real semver, not an empty/garbage value
    expect(currentVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('is exposed on the /api/updates status object', () => {
    expect(getUpdateStatus().version).toBe(currentVersion())
  })

  it('returns empty (never fabricates) when package.json is missing/unreadable', () => {
    expect(currentVersion('/nonexistent-root-xyz')).toBe('')
    expect(currentVersion('/etc')).toBe('') // dir exists, no package.json -> ''
  })
})

// ===== A DETACHED-HEAD TARTALEK, AMI EDDIG SOHA NEM FUTOTT LE (kartya 53b497c9) =====
//
// didi lelete: a fenti teszt a valodi checkoutban fut, ott a HEAD SOSEM detached, tehat a
// `b && b !== 'HEAD' ? b : 'main'` MASODIK aga soha nem hajtodott vegre. Nem gyenge allitas
// volt -- a BEMENET nem ert el oda, ahol az allitas erdekes.
//
// Ezert nem eleg megismetelni a fenti tesztet: elo kell allitani az allapotot. Egy eldobhato
// git-repo detached HEAD-del pontosan azt adja, es nem nyul a valodi checkouthoz.
describe('trackedBranch -- a detached-HEAD tartalek (53b497c9)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tracked-branch-'))
    const git = (...args: string[]) =>
      execFileSync('/usr/bin/git', args, { cwd: tmp, encoding: 'utf-8' })
    git('init', '-q', '-b', 'sajat-ag')
    git('config', 'user.email', 'x@example.invalid')
    git('config', 'user.name', 'teszt')
    writeFileSync(join(tmp, 'a.txt'), 'x\n')
    git('add', 'a.txt')
    git('commit', '-q', '-m', 'elso')
  })

  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  // POZITIV KONTROLL ELOSZOR: ha a temp repo NEM adna vissza a sajat agat, akkor a lenti
  // detached-allitas ugyanugy 'main'-t latna, es semmit nem bizonyitana. Ez a sor valasztja
  // szet a "mukodik a tartalek" esetet attol, hogy "a merom mindenre main-t mond".
  it('NEM detached: a temp repo SAJAT agat adja vissza, nem a tartalekot', () => {
    expect(trackedBranch(tmp)).toBe('sajat-ag')
  })

  it('DETACHED HEAD: a tartalek `main`-t ad', () => {
    const sha = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf-8' }).trim()
    execFileSync('/usr/bin/git', ['checkout', '-q', '--detach', sha], { cwd: tmp })
    // Kontroll, hogy tenyleg detached: a git maga a literal "HEAD"-et adja.
    const raw = execFileSync('/usr/bin/git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: tmp, encoding: 'utf-8' }).trim()
    expect(raw, 'a fixture nem allt detached allapotba -- a teszt igy semmit nem mer').toBe('HEAD')
    expect(trackedBranch(tmp)).toBe('main')
  })

  // A HARMADIK AG: ha a git egyaltalan nem fut (nem repo), a fuggveny szinten `main`-t ad.
  // Ez eddig szinten fedetlen volt, es ugyanaz a csalad: a catch-ag csak bajban sul el.
  it('NEM git-fa: a catch-ag is `main`-t ad', () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'not-a-repo-'))
    try {
      expect(trackedBranch(notRepo)).toBe('main')
    } finally {
      rmSync(notRepo, { recursive: true, force: true })
    }
  })
})
