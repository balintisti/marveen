// WORKTREE LAG NOTICE (card ad18de7b): say it when the suite ran on a tree that is
// behind the main worktree.
//
// Measured 2026-09-11: 9 of 10 test worktrees were 143-892 commits behind. The usual
// way to test a fix is to copy the edited files into such a worktree and run the
// suite there. The result was GREEN, also for tests that only exist on the newer
// tree: they were never collected, so nothing failed. The summary line cannot show
// this, because its denominator is the old tree's own test count.
//
// A notice, not a gate: a PR branch based on the upstream tip is legitimately far
// behind a running tree that carries local merges, and a refusal there would teach
// people to ignore the guard. Silent on the main worktree itself (CI, a fresh clone)
// and wherever git cannot answer.
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'

export interface WorktreeLag {
  self: string
  mainPath: string
  mainHead: string
  behind: number
  /** Tracked files with local edits: copied-in files that run against the OLD tree around them. */
  dirty: number
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
}

export function measureLag(cwd: string): WorktreeLag | null {
  try {
    const self = realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim())
    // The first record of `worktree list` is always the main worktree.
    const first = git(cwd, ['worktree', 'list', '--porcelain']).split('\n\n')[0].split('\n')
    const pathLine = first.find((l) => l.startsWith('worktree '))
    const headLine = first.find((l) => l.startsWith('HEAD '))
    if (!pathLine || !headLine) return null // bare main repository: nothing to compare with
    const mainPath = realpathSync(pathLine.slice('worktree '.length))
    if (mainPath === self) return null
    const mainHead = headLine.slice('HEAD '.length)
    const behind = Number(git(cwd, ['rev-list', '--count', `HEAD..${mainHead}`]).trim())
    const dirty = git(cwd, ['status', '--porcelain', '--untracked-files=no']).split('\n').filter(Boolean).length
    return { self, mainPath, mainHead, behind, dirty }
  } catch {
    return null
  }
}

export function lagNotice(lag: WorktreeLag | null): string | null {
  if (!lag || lag.behind === 0) return null
  return [
    `WORKTREE LAG: ${lag.self} is ${lag.behind} commit(s) behind the main worktree ${lag.mainPath} (HEAD ${lag.mainHead.slice(0, 10)}).`,
    'Tests that exist there but not here did NOT run: a green result here says nothing about them.',
    lag.dirty > 0
      ? `${lag.dirty} tracked file(s) carry local edits: they ran against the OLD tree around them.`
      : 'No tracked file carries local edits.',
    `To measure on the current tree: git worktree add <dir under your home> ${lag.mainHead.slice(0, 10)}`,
  ].join('\n')
}

// vitest globalSetup: the returned teardown runs after the run summary, so the notice
// lands next to the line people read.
export default function setup(): () => void {
  const notice = lagNotice(measureLag(process.cwd()))
  return () => {
    if (notice) process.stderr.write(`\n${notice}\n`)
  }
}
