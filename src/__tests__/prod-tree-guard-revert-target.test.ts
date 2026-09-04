// The prod-tree-guard's post-checkout auto-revert used to aim at the first
// existing of develop/main/master. That premise expired: on 2026-08-29 the
// deployment lived on a feature branch and `develop` was 510 commits behind,
// carrying neither scripts/secret-gate.ts nor scripts/card-comment.sh.
//
// The guard therefore did not merely fail to PREVENT a strip -- it PERFORMED
// one: an operator asking for `some/other-branch` landed on `develop` with
// those files gone from the working tree, and the guard reported
// "AUTO-VISSZAALLITAS: igen (develop)" as a success.
//
// These tests lock the revert target to the branch the tree actually came
// from, and lock the refusal when that branch is not knowable. They are
// deliberately BEHAVIOURAL -- they install the real hook via the real
// installer and perform real checkouts -- because the bug was not in a
// predicate but in what the tree looked like afterwards.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const INSTALLER = join(ROOT, 'scripts', 'install-prod-tree-guard-hook.sh')

let repo: string
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const head = () => git('rev-parse', '--abbrev-ref', 'HEAD')

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'prod-guard-'))
  git('init', '-q', '.')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  writeFileSync(join(repo, 'scripts', 'old.sh'), 'old\n')
  git('add', '-A'); git('commit', '-qm', 'base')
  // The stale trunk: exists, is behind, and lacks the deployed files.
  git('branch', 'stale-trunk')
  git('branch', 'develop')
  git('checkout', '-q', '-b', 'feat/deployment')
  writeFileSync(join(repo, 'scripts', 'secret-gate.ts'), 'the gate\n')
  git('add', '-A'); git('commit', '-qm', 'the deployed work')
  // A second ref on the deployment tip. Harmless in reality (a backup branch),
  // but it is what makes a sha->name mapping ambiguous, so it must not stop
  // the revert. An earlier candidate fix refused here and the strip returned.
  git('branch', 'twin', 'feat/deployment')
  // THE INSTALLER MUST BE RUN FROM A COPY INSIDE THE TEMP REPO, never by its
  // path in this worktree. It resolves its hook dir via `git rev-parse
  // --git-common-dir` from its OWN location, and for a linked worktree that
  // is the MAIN checkout's shared .git/hooks -- so invoking it by absolute
  // path rewrites the live install's hooks and leaves the temp repo with no
  // hook at all. Measured 2026-08-29: it did exactly that, and the four
  // "does not revert" cases below went GREEN against a repo with no guard
  // installed. Hence the positive control immediately after.
  copyFileSync(INSTALLER, join(repo, 'scripts', 'install-prod-tree-guard-hook.sh'))
  // No store/.dashboard-token: the hook must not reach the network from a test.
  execFileSync('bash', ['scripts/install-prod-tree-guard-hook.sh'], { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
})
afterEach(() => { if (repo) rmSync(repo, { recursive: true, force: true }) })

const deployedFile = () => existsSync(join(repo, 'scripts', 'secret-gate.ts'))

describe('prod-tree-guard post-checkout: revert target', () => {
  // POSITIVE CONTROL. Without it, every "does not revert" expectation below is
  // satisfied by a repo that simply has no hook -- the exact failure this file
  // hit while being written.
  it('installed the hook into the temp repo, not into the shared hook dir', () => {
    expect(existsSync(join(repo, '.git', 'hooks', 'post-checkout'))).toBe(true)
  })

  it('reverts to the branch it came from, not to a trunk name', () => {
    expect(head()).toBe('feat/deployment')
    git('checkout', 'stale-trunk')
    expect(head()).toBe('feat/deployment')
  })

  it('leaves the deployed files in the tree after a switch away', () => {
    expect(deployedFile()).toBe(true)
    git('checkout', 'stale-trunk')
    // The regression this whole file exists for: under the old hook the tree
    // ended on `develop` and this file was gone.
    expect(deployedFile()).toBe(true)
  })

  it('never lands on a trunk name just because one exists', () => {
    git('checkout', 'stale-trunk')
    expect(['develop', 'main', 'master', 'stale-trunk']).not.toContain(head())
  })

  it('reverts a `checkout -b` at the same commit too', () => {
    git('checkout', '-b', 'brand/new')
    expect(head()).toBe('feat/deployment')
  })

  it('does not revert when the switch is deliberate', () => {
    execFileSync('git', ['checkout', 'stale-trunk'], {
      cwd: repo, encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, MARVEEN_PROD_CHECKOUT_OK: '1' },
    })
    expect(head()).toBe('stale-trunk')
  })

  it('does not revert a dirty tree, and preserves the modification', () => {
    writeFileSync(join(repo, 'scripts', 'old.sh'), 'locally modified\n')
    git('checkout', 'stale-trunk')
    expect(head()).toBe('stale-trunk')
    expect(git('status', '--porcelain', '--untracked-files=no')).toContain('scripts/old.sh')
  })

  it('REFUSES rather than guessing when the previous position had no branch name', () => {
    // Detach at a commit no branch points at: the revert target is unknowable.
    // Refusing is the required behaviour -- a guard that restores the WRONG
    // tree is worse than one that restores nothing, because an unreverted
    // switch is visible and a wrongly "restored" tree is not.
    execFileSync('git', ['checkout', '-q', '--detach', 'feat/deployment'], {
      cwd: repo, encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, MARVEEN_PROD_CHECKOUT_OK: '1' },
    })
    writeFileSync(join(repo, 'scripts', 'detached-only.txt'), 'x\n')
    git('add', '-A')
    execFileSync('git', ['commit', '-qm', 'detached only'], {
      cwd: repo, encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, MARVEEN_PROD_COMMIT_OK: '1',
        // AZ INDOK 2026-09-04 OTA KOTELEZO (kartya 832e2df6). Ez nem a teszt lazitasa:
        // a felulbiralas SZERZODESE valtozott, es egy valodi felhasznalonak is ezt kell
        // megadnia. Indok nelkul a kapu MEGTAGAD -- arra kulon eset all a
        // prod-tree-guard-merge-baseline.test.ts-ben (8. es 9.).
        MARVEEN_PROD_COMMIT_REASON: 'teszt-fixture: a felulbiralasi ut gyakorlasa' },
    })
    git('checkout', 'stale-trunk')
    expect(head()).toBe('stale-trunk')
  })

  it('does not fire on a file checkout (not a branch switch)', () => {
    writeFileSync(join(repo, 'scripts', 'old.sh'), 'scribble\n')
    git('checkout', '--', 'scripts/old.sh')
    expect(head()).toBe('feat/deployment')
  })
})
