import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { lagNotice, measureLag } from './setup/worktree-lag-notice.js'

const mkTmp = tmpDirs()

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' })
}

function commit(repo: string, name: string): void {
  writeFileSync(join(repo, name), name)
  git(repo, 'add', name)
  git(repo, 'commit', '-q', '-m', name)
}

// A main repo with one commit, a linked worktree on it, then `ahead` more commits on main.
function repoWithWorktree(ahead: number): { main: string; wt: string } {
  const root = realpathSync(mkTmp('lag-'))
  const main = join(root, 'main')
  const wt = join(root, 'wt')
  execFileSync('git', ['init', '-q', main])
  commit(main, 'a.txt')
  git(main, 'worktree', 'add', '-q', '-b', 'side', wt)
  for (let i = 0; i < ahead; i++) commit(main, `n${i}.txt`)
  return { main, wt }
}

describe('worktree lag notice (card ad18de7b)', () => {
  it('counts how far a linked worktree is behind the main worktree, and its edited tracked files', () => {
    const { main, wt } = repoWithWorktree(2)
    writeFileSync(join(wt, 'a.txt'), 'copied-in edit')
    const lag = measureLag(wt)
    expect(lag).toMatchObject({ self: wt, mainPath: main, behind: 2, dirty: 1 })
    expect(lag?.mainHead).toBe(git(main, 'rev-parse', 'HEAD').trim())
    const text = lagNotice(lag)
    expect(text).toContain(`${wt} is 2 commit(s) behind the main worktree ${main}`)
    expect(text).toContain('1 tracked file(s) carry local edits')
  })

  it('is silent on the main worktree itself, on an up-to-date worktree, and outside git', () => {
    const { main, wt } = repoWithWorktree(0)
    expect(measureLag(main)).toBeNull()
    expect(measureLag(wt)?.behind).toBe(0)
    expect(lagNotice(measureLag(wt))).toBeNull()
    expect(measureLag(realpathSync(mkTmp('nogit-')))).toBeNull()
  })

  it('is wired as a globalSetup, so every suite run reports it', async () => {
    // Imported at run time: the config lies outside tsconfig's rootDir.
    const configPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'vitest.config.ts')
    const config = (await import(pathToFileURL(configPath).href)).default
    expect(config.test?.globalSetup).toContain('./src/__tests__/setup/worktree-lag-notice.ts')
  })
})
