import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// scripts/seed-refresh.sh + its post-merge hook (card 03126955): the seed refresh on the path a
// merge-updated host actually takes. update.sh's refresh never ran there (last run 2026-08-16), so a
// shipped fix to a seeded skill or task reached new installs only. The untouched-only RULE itself is
// pinned by seed-refresh-untouched-only.test.ts; this file pins the wrapper: the dry run writes
// nothing, --apply writes only untouched copies, a blind run refuses loudly, and a real `git merge`
// in the main checkout (and not in a worktree) is what triggers it.

const mkTmp = tmpDirs()
const ROOT = join(__dirname, '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'seed-refresh.sh')
const INSTALLER = join(ROOT, 'scripts', 'install-seed-refresh-hook.sh')

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8', stdio: 'pipe' })
}

/** An install (git repo with a seed history + update.sh + the two scripts) and a ~/.claude tree. */
function makeFixture(env = 'MAIN_AGENT_ID=marveen\nBOT_NAME=Marveen\nOWNER_NAME=Isti\nWEB_PORT=3420\n') {
  const base = mkTmp('seedrefresh-script-')
  const install = join(base, 'install')
  const home = join(base, 'home')
  mkdirSync(join(install, 'seed-skills', 'demo'), { recursive: true })
  mkdirSync(join(install, 'seed-scheduled-tasks', 'demo-task'), { recursive: true })
  mkdirSync(join(install, 'scripts'), { recursive: true })
  mkdirSync(join(install, 'store'), { recursive: true })
  copyFileSync(join(ROOT, 'update.sh'), join(install, 'update.sh'))
  copyFileSync(SCRIPT, join(install, 'scripts', 'seed-refresh.sh'))
  writeFileSync(join(install, '.env'), env)
  writeFileSync(join(install, '.gitignore'), 'store/\n.env\n')
  git(install, ['init', '-q', '-b', 'main'])
  git(install, ['config', 'user.email', 'test@example.invalid'])
  git(install, ['config', 'user.name', 'test'])
  const skill = join(install, 'seed-skills', 'demo', 'SKILL.md')
  const task = join(install, 'seed-scheduled-tasks', 'demo-task', 'SKILL.md')
  for (let i = 1; i <= 3; i++) {
    writeFileSync(skill, `skill v${i}\n`)
    writeFileSync(task, `task v${i} {{MAIN_AGENT_ID}}\n`)
    git(install, ['add', '-A'])
    git(install, ['commit', '-q', '-m', `v${i}`])
  }
  const skillCopy = join(home, '.claude', 'skills', 'demo', 'SKILL.md')
  const taskCopy = join(home, '.claude', 'scheduled-tasks', 'demo-task', 'SKILL.md')
  mkdirSync(join(home, '.claude', 'skills', 'demo'), { recursive: true })
  mkdirSync(join(home, '.claude', 'scheduled-tasks', 'demo-task'), { recursive: true })
  writeFileSync(skillCopy, 'skill v1\n')                         // untouched, two releases behind
  writeFileSync(taskCopy, 'task v1 marveen\nmy own line\n')      // edited by the operator
  return { base, install, home, skillCopy, taskCopy }
}

function run(f: { install: string; home: string }, args: string[] = []) {
  const r = spawnSync('bash', [join(f.install, 'scripts', 'seed-refresh.sh'), ...args], {
    encoding: 'utf-8',
    env: { ...process.env, HOME: f.home, SEED_REFRESH_INSTALL_DIR: f.install },
  })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

describe('seed-refresh.sh', () => {
  it('dry run: names the untouched stale copy and writes NOTHING', () => {
    const f = makeFixture()
    const r = run(f)
    expect(r.code).toBe(0)
    expect(r.out).toContain('WOULD REFRESH skills/demo/SKILL.md')
    expect(r.out).not.toContain('scheduled-tasks/demo-task/SKILL.md')
    expect(r.out).toMatch(/DRY RUN, nothing written .* 1 would refresh/)
    expect(readFileSync(f.skillCopy, 'utf-8')).toBe('skill v1\n')
    expect(readFileSync(f.taskCopy, 'utf-8')).toBe('task v1 marveen\nmy own line\n')
  })

  it('--apply: refreshes the untouched copy, keeps the edited one byte for byte', () => {
    const f = makeFixture()
    const r = run(f, ['--apply'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('REFRESHED skills/demo/SKILL.md')
    expect(r.out).toMatch(/applied .* 1 refreshed, 1 keep decisions/)
    expect(readFileSync(f.skillCopy, 'utf-8')).toBe('skill v3\n')
    expect(readFileSync(f.taskCopy, 'utf-8')).toBe('task v1 marveen\nmy own line\n')
    expect(run(f, ['--apply']).out).toMatch(/0 refreshed/)   // idempotent
  })

  it('BLIND without MAIN_AGENT_ID: exit 3, says so, writes nothing', () => {
    const f = makeFixture('BOT_NAME=Marveen\n')
    const r = run(f, ['--apply'])
    expect(r.code).toBe(3)
    expect(r.out).toContain('BLIND -- MAIN_AGENT_ID is not set')
    expect(readFileSync(f.skillCopy, 'utf-8')).toBe('skill v1\n')
  })

  it('BLIND when update.sh lost a function: exit 3, says which, writes nothing', () => {
    const f = makeFixture()
    const u = join(f.install, 'update.sh')
    writeFileSync(u, readFileSync(u, 'utf-8').replace('refresh_untouched_seeds() {', 'refresh_seeds_renamed() {'))
    const r = run(f, ['--apply'])
    expect(r.code).toBe(3)
    expect(r.out).toContain('refresh_untouched_seeds() not found')
    expect(readFileSync(f.skillCopy, 'utf-8')).toBe('skill v1\n')
  })
})

describe('install-seed-refresh-hook.sh', () => {
  function installHook(dir: string) {
    return spawnSync('bash', [INSTALLER], { cwd: dir, encoding: 'utf-8' })
  }

  it('a merge in the MAIN checkout refreshes the untouched copy; a merge in a worktree does not', () => {
    const f = makeFixture()
    expect(installHook(f.install).status).toBe(0)
    const env = { ...process.env, HOME: f.home }
    const merge = (dir: string, branch: string, content: string) => {
      execFileSync('git', ['-C', dir, 'checkout', '-q', '-b', branch], { env })
      writeFileSync(join(dir, 'seed-skills', 'demo', 'SKILL.md'), content)
      execFileSync('git', ['-C', dir, 'commit', '-q', '-am', branch], { env })
      execFileSync('git', ['-C', dir, 'checkout', '-q', '-'], { env })
      return execFileSync('git', ['-C', dir, 'merge', '--no-ff', '-q', '-m', `merge ${branch}`, branch], { env, encoding: 'utf-8', stdio: 'pipe' })
    }
    // a worktree first: same shared hook, must not touch the installed copy
    const wt = join(f.base, 'wt')
    git(f.install, ['worktree', 'add', '-q', '-b', 'wt-home', wt])
    merge(wt, 'wt-feature', 'skill v4 from a worktree\n')
    expect(readFileSync(f.skillCopy, 'utf-8')).toBe('skill v1\n')
    // the main checkout: the hook runs and refreshes to the merged version
    merge(f.install, 'feature', 'skill v4\n')
    expect(readFileSync(f.skillCopy, 'utf-8')).toBe('skill v4\n')
    expect(readFileSync(f.taskCopy, 'utf-8')).toBe('task v1 marveen\nmy own line\n')
    expect(readFileSync(join(f.install, 'store', 'seed-refresh.log'), 'utf-8')).toContain('REFRESHED skills/demo/SKILL.md')
  })

  it('leaves a post-merge hook that is not ours alone (exit 1, unchanged)', () => {
    const f = makeFixture()
    const hook = join(f.install, '.git', 'hooks', 'post-merge')
    writeFileSync(hook, '#!/bin/sh\necho someone else\n')
    const r = installHook(f.install)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('is not ours; NOT overwritten')
    expect(readFileSync(hook, 'utf-8')).toBe('#!/bin/sh\necho someone else\n')
    expect(existsSync(`${hook}.tmp`)).toBe(false)
  })
})
