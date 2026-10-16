/**
 * FO-CHECKOUT GIT-OR (kartya 468cf59a): `git clean` / `git reset --hard` csak akkor tiltott,
 * ha a CEL-FA a fo checkout. A worktree-ben ugyanez rutin (mutacios kor utani visszaallitas),
 * ezert a kontrollok (worktree -> enged) ugyanolyan fontosak, mint a tiltasok.
 *
 * EZ A FAJL SEMMIT NEM TOROL. A kapu egy eldobhato repora (MARVEEN_GIT_GUARD_MAIN) dont,
 * a parancs csak SZOVEG a hook-payloadban, soha nem fut le.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'hooks', 'main-checkout-git-guard.py')

let root: string
let main: string
let wt: string
let other: string

function run(command: string, cwd: string, extra: Record<string, unknown> = {}) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd, ...extra })
  const r = spawnSync('python3', [GATE], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, MARVEEN_GIT_GUARD_MAIN: main },
  })
  return { code: r.status, stderr: r.stderr }
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'git-guard-')))
  main = join(root, 'main')
  wt = join(root, 'wt')
  other = join(root, 'other')
  mkdirSync(main)
  mkdirSync(other)
  mkdirSync(join(main, 'store'))
  const git = (...a: string[]) => execFileSync('git', a, { cwd: main, stdio: 'pipe' })
  git('init', '-q')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
  git('worktree', 'add', '-q', '--detach', wt)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('main-checkout git guard: refuses on the main checkout', () => {
  it.each([
    ['git clean -fd'],
    ['git reset --hard'],
    ['git reset --hard HEAD~1'],
    // the 09-19 command: backticks inside a double-quoted echo ran as substitution
    ['echo -n "  `git clean -fd` ellen vedve: "'],
    ['echo "x $(git reset --hard) y"'],
    ["bash -c 'git clean -fdx'"],
    ['/usr/bin/git clean -fd'],
    ['git status && git clean -f -d'],
  ])('%s from the main checkout -> exit 2', (command) => {
    expect(run(command, main).code).toBe(2)
  })

  it('reaches the main checkout from elsewhere through -C, cd, and --work-tree', () => {
    expect(run(`git -C ${main} clean -fd`, other).code).toBe(2)
    expect(run(`git -C "${main}" reset --hard`, other).code).toBe(2)
    expect(run(`cd ${main} && git reset --hard HEAD`, other).code).toBe(2)
    expect(run(`git --work-tree=${main} --git-dir=${main}/.git clean -fd`, other).code).toBe(2)
    expect(run(`git --git-dir=${main}/.git clean -fd`, other).code).toBe(2)
  })

  it('refuses an unresolvable target only when the cwd is the main checkout', () => {
    expect(run('cd "$WT" && git reset --hard', main).code).toBe(2)
    expect(run('git -C $WT clean -fd', main).code).toBe(2)
    expect(run('cd "$WT" && git reset --hard', other).code).toBe(0)
  })

  it('names the target and the way out, and logs the refusal', () => {
    const r = run('git clean -fd', main)
    expect(r.stderr).toContain(`git clean -> ${main}`)
    expect(r.stderr).toContain('MARVEEN_GIT_GUARD=allow')
    expect(r.stderr).toContain('git -C <worktree-ut>')
    expect(readFileSync(join(main, 'store', 'main-checkout-git-guard.log'), 'utf8')).toMatch(/\tDENY\tgit clean -> /)
  })
})

describe('main-checkout git guard: lets the routine through', () => {
  it.each([
    ['git reset --hard', 'wt'],
    ['git clean -fd', 'wt'],
    ['git clean -fd', 'other'],
    ['git status', 'main'],
    ['git reset --soft HEAD~1', 'main'],
    ['git reset HEAD -- file', 'main'],
    ['git clean -n', 'main'],
    ['git clean -fdn', 'main'],
    ['git clean --dry-run -d', 'main'],
    ['ls .git/hooks', 'main'],
    // the closing quote of `sh -c '...'` ends the git invocation: `--hard` after it is echo's
    ["sh -c 'git reset HEAD' && echo '--hard'", 'main'],
  ])('%s in %s -> exit 0', (command, where) => {
    const cwd = { main, wt, other }[where as 'main' | 'wt' | 'other']
    expect(run(command, cwd).code).toBe(0)
  })

  it('resets a worktree from the main checkout when the path is literal', () => {
    expect(run(`git -C ${wt} reset --hard`, main).code).toBe(0)
    expect(run(`cd ${wt} && git clean -fd`, main).code).toBe(0)
  })

  it('passes with the logged override', () => {
    const r = run('MARVEEN_GIT_GUARD=allow git reset --hard', main)
    expect(r.code).toBe(0)
    expect(readFileSync(join(main, 'store', 'main-checkout-git-guard.log'), 'utf8')).toMatch(/\tOVERRIDE\t/)
  })

  it('fails open on a non-Bash tool and on an unparseable payload', () => {
    expect(run('git clean -fd', main, { tool_name: 'Read' }).code).toBe(0)
    // the env override is what keeps this log line out of the LIVE store: measured
    // 2026-10-16, without it 13 FAIL-OPEN lines from test runs landed there
    const r = spawnSync('python3', [GATE], {
      input: 'not json', encoding: 'utf8', env: { ...process.env, MARVEEN_GIT_GUARD_MAIN: main },
    })
    expect(r.status).toBe(0)
    expect(readFileSync(join(main, 'store', 'main-checkout-git-guard.log'), 'utf8')).toMatch(/\tFAIL-OPEN\tunparseable/)
  })
})

describe('main-checkout git guard: finds the main checkout by itself', () => {
  it('a copy in a linked worktree still names the MAIN worktree', () => {
    const driver = `
import importlib.util, os
spec = importlib.util.spec_from_file_location("g", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
print(g.main_checkout())
`
    const env = { ...process.env }
    delete env.MARVEEN_GIT_GUARD_MAIN
    const got = execFileSync('python3', ['-c', driver], { encoding: 'utf8', env }).trim()
    const common = execFileSync('git', ['-C', dirname(GATE), 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()
    expect(got).toBe(realpathSync(dirname(common)))
  })
})
