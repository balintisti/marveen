/**
 * FO-CHECKOUT GIT-OR (kartya 468cf59a): `git clean` / `git reset --hard` csak akkor tiltott,
 * ha a CEL-FA a fo checkout. A worktree-ben ugyanez rutin (mutacios kor utani visszaallitas),
 * ezert a kontrollok (worktree -> enged) ugyanolyan fontosak, mint a tiltasok.
 *
 * EZ A FAJL SEMMIT NEM TOROL. A kapu egy eldobhato repora (MARVEEN_GIT_GUARD_MAIN) dont,
 * a parancs csak SZOVEG a hook-payloadban, soha nem fut le.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const mkTmp = tmpDirs()

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
  root = realpathSync(mkTmp('git-guard-'))
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

  it.each([
    ['git checkout -- .'],
    ['git checkout .'],
    ['git checkout HEAD -- .'],
    ['git checkout -- :/'],
    ['git restore .'],
    ['git restore -s HEAD -W .'],
    ['git restore --staged --worktree .'],
    ['git restore -SW .'],
  ])('whole-tree discard %s from the main checkout -> exit 2 (marveen 30585)', (command) => {
    expect(run(command, main).code).toBe(2)
  })

  it('a whole-tree discard reaches the main checkout through -C and cd too', () => {
    expect(run(`git -C ${main} checkout -- .`, other).code).toBe(2)
    expect(run(`cd ${main} && git restore .`, other).code).toBe(2)
  })

  it('passes a named file, a branch switch, and an index-only restore on the main checkout', () => {
    expect(run('git checkout -- src/x.ts', main).code).toBe(0)
    expect(run('git checkout develop', main).code).toBe(0)
    expect(run('git restore --staged .', main).code).toBe(0)
    expect(run('git restore -S .', main).code).toBe(0)
    expect(run('git restore -qS .', main).code).toBe(0)
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
    // marveen 30585: the whole-tree discard stays routine inside a worktree
    ['git checkout -- .', 'wt'],
    ['git restore .', 'wt'],
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

// didi 2026-10-16 (card comment 36728): 47 shapes fed to the live hook, 13 false
// passes. Each one below passed before the fix.
describe('main-checkout git guard: the target behind nesting, variables and abbreviations', () => {
  const runHome = (command: string, cwd: string) => spawnSync('python3', [GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8',
    env: { ...process.env, MARVEEN_GIT_GUARD_MAIN: main, HOME: root },
  }).status

  it.each([
    [() => `bash -c 'cd ${main} && git clean -fd'`],
    [() => `sh -c "cd ${main}; git reset --hard HEAD"`],
    [() => `eval "cd ${main} && git clean -fd"`],
    [() => `{ cd ${main}; git clean -fd; }`],
    [() => `if cd ${main}; then git clean -fd; fi`],
    [() => `R=${main}; git -C $R clean -fd`],
    [() => `R="${main}"; git -C "$R" reset --hard`],
    [() => `GIT_DIR=${main}/.git GIT_WORK_TREE=${main} git clean -fd`],
    [() => `GIT_WORK_TREE=${main} git clean -fd`],
    [() => `GIT_DIR=${main}/.git git reset --hard`],
  ])('a cd or target the shell resolves -> exit 2 (%#)', (cmd) => {
    expect(run(cmd(), other).code).toBe(2)
  })

  it('resolves $HOME and ${HOME}', () => {
    expect(runHome('cd $HOME/main && git clean -fd', other)).toBe(2)
    expect(runHome('cd "${HOME}/main" && git reset --hard', other)).toBe(2)
    expect(runHome('cd $HOME/wt && git reset --hard', other)).toBe(0)
    expect(runHome('cd "$HOME"/main && git clean -fd', other)).toBe(2)
    expect(runHome('bash -c "cd \\"$HOME/main\\" && git clean -fd"', other)).toBe(2)
    expect(runHome('cd "$HOME"/wt && git clean -fd', other)).toBe(0)
  })

  it('git accepts a unique prefix of --hard', () => {
    expect(run('git reset --har HEAD', main).code).toBe(2)
    expect(run('git reset --ha HEAD', main).code).toBe(2)
    expect(run('git reset --soft HEAD~1', main).code).toBe(0)
  })

  it('a cd in a closed subshell, or one that fails, leaves the shell in the main checkout', () => {
    expect(run(`(cd ${wt}) && git clean -fd`, main).code).toBe(2)
    expect(run(`cd ${root}/does-not-exist; git reset --hard`, main).code).toBe(2)
    // ...and from elsewhere the same failed cd is no reason to refuse
    expect(run(`cd ${root}/does-not-exist; git reset --hard`, other).code).toBe(0)
  })

  it('still lets worktree routine through in every nested form', () => {
    expect(run(`bash -c 'cd ${wt} && git clean -fd'`, other).code).toBe(0)
    expect(run(`R=${wt}; git -C $R clean -fd`, other).code).toBe(0)
    expect(run(`(cd ${main} && git status) && cd ${wt} && git clean -fd`, other).code).toBe(0)
    expect(run(`cd ${wt} && git reset --hard`, main).code).toBe(0)
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

// didi 2026-10-16 (card 468cf59a comment 36845): the fixed spellings of the tree root
// were an enumeration; these all discard the whole tree and passed. The guard now
// NORMALISES the pathspec against the directory git runs in.
describe('main-checkout git guard: any spelling of the tree root is the whole tree', () => {
  let mainSub: string
  let wtSub: string
  beforeAll(() => {
    mainSub = join(main, 'scripts')
    wtSub = join(wt, 'scripts')
    mkdirSync(mainSub, { recursive: true })
    mkdirSync(wtSub, { recursive: true })
  })

  const SPELLINGS = ['./.', ':(top)', ':/:', ':(top).', 'scripts/..', './scripts/..', 'scripts/../.', ':(top)scripts/..', 'scripts/../*', ':!scripts/x.py']

  it.each(SPELLINGS.flatMap((s) => [[`git checkout -- '${s}'`], [`git restore '${s}'`]]))(
    '%s from the main checkout -> exit 2', (command) => {
      const r = run(command, main)
      expect(r.code).toBe(2)
      expect(r.stderr).toContain('resolves to the repo root')
    })

  // didi 36865: git reads a pathspec as a glob and `*` crosses `/`, so a glob in the
  // FIRST segment reaches every top-level entry, like '*'.
  it.each([["'?*'"], ["'[a-z]*'"], ["'sc*' '[a-z]*'"], ["':(top)?*'"], ["':(glob)?*'"], ["'*.md'"]])(
    'a glob in the first segment (%s) is the whole tree', (s) => {
      expect(run(`git checkout -- ${s}`, main).code).toBe(2)
      expect(run(`git restore ${s}`, main).code).toBe(2)
      expect(run(`git checkout -- ${s}`, wt).code).toBe(0)
    })

  it('a glob below a named directory, or a literal pathspec, is not the whole tree', () => {
    expect(run("git checkout -- 'scripts/*.py'", main).code).toBe(0)
    expect(run("git restore 'scripts/?oo.py'", main).code).toBe(0)
    expect(run("git checkout -- ':(literal)?x'", main).code).toBe(0)
    expect(run("git checkout -- '?*'", mainSub).code).toBe(0)
  })

  it('a pathspec in a variable: resolved when the assignment is literal, refused when not', () => {
    expect(run('P=.; git checkout -- $P', main).code).toBe(2)
    expect(run('P=.; git checkout -- "$P"', main).code).toBe(2)
    expect(run('P=./.; git restore $P', main).code).toBe(2)
    expect(run('P=scripts/foo.py; git checkout -- $P', main).code).toBe(0)
    // not resolvable statically -> fail closed on the main checkout, with the real reason
    const r = run('git checkout -- $(git rev-parse --show-toplevel)', main)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('variable or substitution')
    expect(run('git checkout -- "$SOMEWHERE"', main).code).toBe(2)
    expect(run('git restore "$SOMEWHERE"', main).code).toBe(2)
    expect(run('git checkout -- `pwd`', main).code).toBe(2)
    expect(run('git restore --pathspec-from-file=list.txt', main).code).toBe(2)
  })

  it('from a subdirectory, .. and the absolute root reach the root', () => {
    expect(run('git checkout -- ..', mainSub).code).toBe(2)
    expect(run('git restore ../.', mainSub).code).toBe(2)
    expect(run("git checkout -- ':(top)'", mainSub).code).toBe(2)
    expect(run('git checkout -- :/', mainSub).code).toBe(2)
    expect(run(`git restore ${main}`, mainSub).code).toBe(2)
    expect(run('git checkout -- ../scripts/..', mainSub).code).toBe(2)
    expect(run('git checkout -- ../scripts/foo.py', mainSub).code).toBe(0)
  })

  it('the same spellings are routine in a non-main worktree', () => {
    for (const s of ['./.', ':(top)', ':/:', 'scripts/..', '.']) {
      expect(run(`git checkout -- '${s}'`, wt).code).toBe(0)
      expect(run(`git restore '${s}'`, wt).code).toBe(0)
    }
    expect(run('git checkout -- ..', wtSub).code).toBe(0)
    expect(run('git checkout -- "$P"', wt).code).toBe(0)
    expect(run(`git -C ${wt} checkout -- ./.`, main).code).toBe(0)
    expect(run(`git -C ${wt} restore ':(top)'`, main).code).toBe(0)
  })

  it.each([
    ['git checkout -- package.json'],
    ['git checkout -- scripts/foo.py'],
    ['git checkout -- scripts/../package.json'],
    ['git checkout -- ./scripts/foo.py'],
    ["git checkout -- ':(top)scripts/foo.py'"],
    ['git checkout -- :/scripts/foo.py'],
    ['git restore scripts/foo.py'],
    ['git restore scripts/../package.json'],
    ['git restore -s HEAD~1 package.json'],
    ['git restore -s $REV package.json'],
    ['git checkout develop'],
    ['git checkout $BRANCH'],
    ['git checkout -b feature/x'],
    ['git restore --staged ./.'],
    ["git restore -S ':(top)'"],
    ['git status'],
    ['git diff -- .'],
  ])('%s from the main checkout -> exit 0', (command) => {
    expect(run(command, main).code).toBe(0)
  })
})
