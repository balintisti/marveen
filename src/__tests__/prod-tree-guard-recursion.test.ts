// The post-checkout guard's own revert is itself a branch switch, so it
// re-enters the hook. Until 2026-08-29 that was stopped by a broad exit:
//
//     case "$BRANCH" in develop|main|master) exit 0 ;; esac
//
// It worked -- the revert always landed on a trunk name -- but it bought the
// recursion guard by silencing the guard for the ONE switch that matters most
// (cards 6414366f and bae4df49: moving the prod checkout to develop/main arms
// the blocking secret-gate hook AND the update.sh that pulls from a foreign
// upstream, both at once). The exit is now explicit and narrow:
//
//     [ "${MARVEEN_GUARD_REVERTING:-0}" = "1" ] && exit 0
//
// marveen's ruling on 6414366f left the code in place but the BEHAVIOUR
// unmeasured, in his words "probable, but I did not measure it", and asked for
// two controls: after the internal revert the hook must not fire again, and a
// manual `git checkout develop` must NOT be silent. These are those two.
//
// WHY THE EXISTING SUITE COULD NOT CATCH THIS: every switch in
// prod-tree-guard-revert-target.test.ts targets `stale-trunk`, a name the old
// `case` never matched -- so that whole file passes with the old, silencing
// hook installed. The regression lives on the literal names, and nothing
// switched to them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, copyFileSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const INSTALLER = join(ROOT, 'scripts', 'install-prod-tree-guard-hook.sh')

let repo: string
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const head = () => git('rev-parse', '--abbrev-ref', 'HEAD')
// Every checkout writes one HEAD reflog line. One user switch that is reverted
// leaves exactly TWO; a hook that re-entered its own revert leaves more. This
// is the discriminator for the recursion guard, and it needs no network.
const switches = () =>
  git('reflog', 'show', 'HEAD').split('\n').filter((l) => l.includes('checkout: moving from')).length

beforeEach(() => {
  // realpath: on macOS mktemp hands back /var/... while `git rev-parse
  // --show-toplevel` reports /private/var/..., and the hook compares those two
  // strings. Unresolved, the guard exits at that compare and EVERY assertion
  // below passes against a hook that never ran. Measured while writing this.
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'prod-guard-rec-')))
  git('init', '-q', '.')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  writeFileSync(join(repo, 'scripts', 'old.sh'), 'old\n')
  git('add', '-A'); git('commit', '-qm', 'base')
  // The literal names the old `case` matched, which is the point of this file.
  git('branch', 'develop')
  git('branch', 'main')
  git('checkout', '-q', '-b', 'feat/deployment')
  // Run the installer from a COPY inside the temp repo: by absolute path it
  // resolves its hook dir from its OWN location and would rewrite the live
  // install's hooks (documented in prod-tree-guard-revert-target.test.ts).
  copyFileSync(INSTALLER, join(repo, 'scripts', 'install-prod-tree-guard-hook.sh'))
  // No store/.dashboard-token on purpose: the hook must not reach the network
  // from a test. It exits before the alert, AFTER the revert -- so the revert
  // is still fully observable.
  execFileSync('bash', ['scripts/install-prod-tree-guard-hook.sh'], { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
})
afterEach(() => { if (repo) rmSync(repo, { recursive: true, force: true }) })

describe('prod-tree-guard post-checkout: recursion guard and the trunk-name silence', () => {
  // POSITIVE CONTROL, twice over: the hook exists here, and it actually RUNS
  // in this repo. Without the second half every expectation below is satisfied
  // by a guard that exited at the PROD_ROOT compare.
  it('installed the hook into the temp repo AND it fires here', () => {
    expect(existsSync(join(repo, '.git', 'hooks', 'post-checkout'))).toBe(true)
    git('checkout', 'develop')
    expect(head()).toBe('feat/deployment')
  })

  it('a manual switch to `develop` is NOT silent -- it reverts', () => {
    git('checkout', 'develop')
    expect(head()).toBe('feat/deployment')
  })

  it('a manual switch to `main` is NOT silent either', () => {
    git('checkout', 'main')
    expect(head()).toBe('feat/deployment')
  })

  it('the internal revert does not re-enter: exactly one revert per switch', () => {
    const before = switches()
    git('checkout', 'develop')
    expect(head()).toBe('feat/deployment')
    // user switch + the guard's revert = 2. A hook that re-entered its own
    // revert would add at least one more.
    expect(switches() - before).toBe(2)
  })

  it('NEGATIVE CONTROL: a deliberate switch to develop stays, and adds one switch', () => {
    const before = switches()
    execFileSync('git', ['checkout', 'develop'], {
      cwd: repo, encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, MARVEEN_PROD_CHECKOUT_OK: '1' },
    })
    expect(head()).toBe('develop')
    expect(switches() - before).toBe(1)
  })

  // The recursion guard rests on one assumption that had never been measured:
  // that `VAR=1 git checkout` reaches the hook git spawns. Probed directly,
  // with a hook that only records what it saw, so the mechanism is pinned
  // independently of the guard's own logic.
  //
  // The obvious mutation -- strip the REVERTING check from the installed hook
  // and watch this file go red -- is deliberately NOT run: without it the
  // revert re-enters and can ping-pong between branches, and a test that may
  // not terminate is not a test.
  it('`VAR=1 git checkout` passes the variable into the hook (and a bare one does not)', () => {
    const log = join(repo, 'seen.log')
    const probe = join(repo, '.git', 'hooks', 'post-checkout')
    writeFileSync(probe, `#!/usr/bin/env bash\necho "[\${MARVEEN_GUARD_REVERTING:-UNSET}]" >> ${JSON.stringify(log)}\n`)
    chmodSync(probe, 0o755)
    git('checkout', 'develop')                                   // bare
    execFileSync('git', ['checkout', 'feat/deployment'], {        // inline var
      cwd: repo, encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, MARVEEN_GUARD_REVERTING: '1' },
    })
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['[UNSET]', '[1]'])
  })
})
