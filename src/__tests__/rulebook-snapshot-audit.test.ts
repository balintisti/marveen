// The self-checking detector for truncated snapshot commits (card c26193d7).
//
// didi's second idea, and the more valuable half: a commit can be judged
// ENTIRELY BY ITSELF -- MANIFEST.tsv line count versus the number of files
// under store/ -- with no reference to any live source. That makes it work on
// history written before the fix existed, and it does not have to trust the run
// that produced the commit.
//
// Measured on the live store the moment it was written: 5 truncated commits in
// 106, ALL from that same evening (20:47 -- 21:25). didi had measured the 12
// most recent and found 3; the two extra were minutes old, which is what makes
// this a rate rather than an anecdote.
//
// `-- store` is load-bearing, and that is a measured defect fix rather than a
// detail: MANIFEST.tsv lives in the repo ROOT, so a whole-tree count is always
// manifest+1 and every healthy commit would be flagged. A checker that flags the
// correct state is worse than no checker -- the same shape as the
// `CREATE INDEX CONCURRENTLY` false alarm on the other rulebook.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const AUDIT = join(__dirname, '..', '..', 'scripts', 'rulebook-snapshot-audit.sh')

/** A hand-built snapshot repo, so both the healthy and the truncated shape are
 *  exact rather than raced into existence. */
function repoWith(commits: Array<{ manifest: number; store: number }>) {
  const repo = mkdtempSync(join(tmpdir(), 'rbaudit-'))
  const git = (...args: string[]) =>
    spawnSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    })
  git('init', '-q')
  for (const c of commits) {
    rmSync(join(repo, 'store'), { recursive: true, force: true })
    mkdirSync(join(repo, 'store', 'skills'), { recursive: true })
    for (let i = 0; i < c.store; i++) writeFileSync(join(repo, 'store', 'skills', `f${i}.md`), `${i}\n`)
    writeFileSync(join(repo, 'MANIFEST.tsv'),
      Array.from({ length: c.manifest }, (_, i) => `skills/f${i}.md\t/src/f${i}.md`).join('\n') + '\n')
    git('add', '-A')
    git('commit', '-q', '-m', `snapshot: ${c.manifest} fajl`)
  }
  const run = () => spawnSync('bash', [AUDIT], { encoding: 'utf8', env: { ...process.env, RULEBOOK_REPO: repo } })
  return { repo, run }
}

describe('rulebook snapshot audit', () => {
  it('NEGATIVE CONTROL: healthy commits produce no finding and exit 0', () => {
    // Without this, an always-firing version would look like it works -- and the
    // whole-tree variant this replaced DID always fire.
    const w = repoWith([{ manifest: 10, store: 10 }, { manifest: 12, store: 12 }])
    const r = w.run()
    expect(r.status).toBe(0)
    expect(r.stdout).not.toMatch(/CSONKA/)
    expect(r.stdout).toMatch(/megvizsgalva: 2 commit .*csonka: 0/)
  })

  it('finds the truncated commit, names both numbers, and exits non-zero', () => {
    const w = repoWith([{ manifest: 10, store: 10 }, { manifest: 12, store: 4 }, { manifest: 12, store: 12 }])
    const r = w.run()
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/CSONKA .*manifest=12 {2}store=4/)
    expect(r.stdout).toMatch(/csonka: 1/)
    // The two healthy commits are NOT reported: the finding is one line, not three.
    expect(r.stdout.split('\n').filter(l => l.startsWith('CSONKA')).length).toBe(1)
  })

  it('counts only store/, because MANIFEST.tsv in the root would make every commit look short', () => {
    // The full tree of a HEALTHY commit here is 11 entries (10 + manifest) against
    // a 10-line manifest. A whole-tree checker calls that a defect; this one must not.
    const w = repoWith([{ manifest: 10, store: 10 }])
    expect(w.run().status).toBe(0)
  })

  it('a repo with no manifest at all is skipped, not silently passed', () => {
    const repo = mkdtempSync(join(tmpdir(), 'rbaudit-empty-'))
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
    spawnSync('git', ['-C', repo, 'init', '-q'], { env })
    writeFileSync(join(repo, 'x.txt'), 'x\n')
    spawnSync('git', ['-C', repo, 'add', '-A'], { env })
    spawnSync('git', ['-C', repo, 'commit', '-q', '-m', 'no manifest'], { env })
    const r = spawnSync('bash', [AUDIT], { encoding: 'utf8', env: { ...process.env, RULEBOOK_REPO: repo } })
    // Zero examined is reported as zero examined -- an empty population must not
    // read as a clean bill of health.
    expect(r.stdout).toMatch(/megvizsgalva: 0 commit/)
  })
})
