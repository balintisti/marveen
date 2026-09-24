/**
 * EVERY COMMIT FROM AN AGENT'S SESSION CARRIES THAT AGENT'S IDENTITY (card 49d1d6b6).
 *
 * The identity is exported at launch, so it wins over whatever a repo or worktree config says --
 * which is the point: on 2026-09-24 a shared `.git/config` held a stray `jarvis@localhost`
 * identity and 45 commits by several agents carried it. Measured through git itself, not by
 * reading the string back.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { gitIdentityEnv } = await import('../web/agent-process.js')

const repo = mkdtempSync(join(tmpdir(), 'agent-git-id-'))
execFileSync('git', ['init', '-q', repo])
// the incident's shape: a repo-level identity that is NOT the agent's
execFileSync('git', ['-C', repo, 'config', 'user.name', 'jarvis (cherry-pick probe)'])
execFileSync('git', ['-C', repo, 'config', 'user.email', 'jarvis@localhost'])
afterAll(() => rmSync(repo, { recursive: true, force: true }))

const identUnder = (prefix: string) => execFileSync('bash', ['-c',
  `${prefix}cd ${JSON.stringify(repo)} && git var GIT_AUTHOR_IDENT && git var GIT_COMMITTER_IDENT`],
  { encoding: 'utf-8' })

describe('gitIdentityEnv', () => {
  it('the agent identity wins over a stray repo-level identity, for author AND committer', () => {
    const out = identUnder(gitIdentityEnv('dexter'))
    const lines = out.trim().split('\n')
    expect(lines).toHaveLength(2)
    for (const l of lines) expect(l).toMatch(/^dexter <dexter@agents\.local> \d+ [+-]\d{4}$/)
    expect(out).not.toContain('jarvis')
  })

  it('CONTROL: without the prefix the stray repo identity is what git uses (the meter can say no)', () => {
    expect(identUnder('')).toContain('jarvis@localhost')
  })

  it('a name with shell metacharacters stays one literal value -- in BOTH fields, and nothing runs', () => {
    // A weaker first form checked only that the combined output CONTAINED the literal; a mutant that
    // unquoted the author name alone passed it (the committer line still matched) and actually ran
    // the substitution. So each line is checked on its own, and the side effect is looked for.
    const sandbox = mkdtempSync(join(tmpdir(), 'agent-git-id-cwd-'))
    try {
      const name = "o'brien $(touch pwned)"
      const out = execFileSync('bash', ['-c',
        `cd ${JSON.stringify(sandbox)} && ${gitIdentityEnv(name)}cd ${JSON.stringify(repo)} && git var GIT_AUTHOR_IDENT && git var GIT_COMMITTER_IDENT`],
        { encoding: 'utf-8' })
      const [author, committer] = out.trim().split('\n')
      const want = `${name} <${name}@agents.local> `
      expect(author.startsWith(want)).toBe(true)
      expect(committer.startsWith(want)).toBe(true)
      expect(existsSync(join(sandbox, 'pwned'))).toBe(false)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})

describe('wiring: the launch command exports it before the agent starts', () => {
  it('startAgentProcess puts gitIdentityEnv(name) into the command, before the cd and the claude binary', () => {
    const src = readFileSync(join(__dirname, '..', 'web', 'agent-process.ts'), 'utf-8')
    const cmdLine = src.split('\n').find((l) => l.includes('const cmd = `export PATH='))
    expect(cmdLine).toBeDefined()
    const at = cmdLine!.indexOf('${gitIdentityEnv(name)}')
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(cmdLine!.indexOf('cd "${dir}"'))
  })
})
