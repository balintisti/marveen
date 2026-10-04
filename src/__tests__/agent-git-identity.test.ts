/**
 * EVERY COMMIT FROM AN AGENT'S SESSION CARRIES THAT AGENT'S IDENTITY (card 49d1d6b6).
 *
 * The identity is exported at launch, so it wins over whatever a repo or worktree config says --
 * which is the point: on 2026-09-24 a shared `.git/config` held a stray `jarvis@localhost`
 * identity and 45 commits by several agents carried it. Measured through git itself, not by
 * reading the string back.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const { gitIdentityEnv } = await import('../web/agent-process.js')

const mkTmp = tmpDirs()
const repo = mkTmp('agent-git-id-')
execFileSync('git', ['init', '-q', repo])
// the incident's shape: a repo-level identity that is NOT the agent's
execFileSync('git', ['-C', repo, 'config', 'user.name', 'jarvis (cherry-pick probe)'])
execFileSync('git', ['-C', repo, 'config', 'user.email', 'jarvis@localhost'])

// The suite itself runs inside an agent session, and once this card is deployed that session
// EXPORTS an identity (didi 27453): inherited, it would win over the repo config and turn the
// control below green-for-the-wrong-reason red. Every probe starts from an env without it.
const GIT_IDENT_VARS = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !GIT_IDENT_VARS.includes(k)))

const identUnder = (prefix: string) => execFileSync('bash', ['-c',
  `${prefix}cd ${JSON.stringify(repo)} && git var GIT_AUTHOR_IDENT && git var GIT_COMMITTER_IDENT`],
  { encoding: 'utf-8', env: cleanEnv })

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
    const sandbox = mkTmp('agent-git-id-cwd-')
    const name = "o'brien $(touch pwned)"
    const out = execFileSync('bash', ['-c',
      `cd ${JSON.stringify(sandbox)} && ${gitIdentityEnv(name)}cd ${JSON.stringify(repo)} && git var GIT_AUTHOR_IDENT && git var GIT_COMMITTER_IDENT`],
      { encoding: 'utf-8', env: cleanEnv })
    const [author, committer] = out.trim().split('\n')
    const want = `${name} <${name}@agents.local> `
    expect(author.startsWith(want)).toBe(true)
    expect(committer.startsWith(want)).toBe(true)
    expect(existsSync(join(sandbox, 'pwned'))).toBe(false)
  })
})

describe('the REMOTE launch carries it too (jarvis, intersection check)', () => {
  it('buildRemoteLaunchCommand puts the prefix after PATH and before the cd; without it, unchanged', async () => {
    const { buildRemoteLaunchCommand } = await import('../web/ssh-tmux.js')
    const withId = buildRemoteLaunchCommand({ workdir: '/p', model: 'm', continue: false, envPrefix: gitIdentityEnv('dexter') })
    const at = withId.indexOf("GIT_AUTHOR_NAME='dexter'")
    expect(at).toBeGreaterThan(withId.indexOf('export PATH='))
    expect(at).toBeLessThan(withId.indexOf("cd '/p'"))
    const without = buildRemoteLaunchCommand({ workdir: '/p', model: 'm', continue: false })
    expect(without).not.toContain('GIT_AUTHOR')
  })

  it('startRemoteAgentProcess passes gitIdentityEnv(name) to it', () => {
    const src = readFileSync(join(__dirname, '..', 'web', 'agent-process.ts'), 'utf-8')
    expect(src).toMatch(/buildRemoteLaunchCommand\(\{[^}]*envPrefix: gitIdentityEnv\(name\)/)
  })
})

describe('wiring: the launch command exports it before the agent starts', () => {
  it('startAgentProcess puts gitIdentityEnv(name) into the command, before the cd and the claude binary', () => {
    // ONE builder serves the normal start and the fallback-cwd retry; a second builder would need
    // the export too, so the count is pinned as well as the position.
    const src = readFileSync(join(__dirname, '..', 'web', 'agent-process.ts'), 'utf-8')
    const cmdLines = src.split('\n').filter((l) => l.includes('export PATH=') && l.includes('${claudeBin()}'))
    expect(cmdLines).toHaveLength(1)
    const cmdLine = cmdLines[0]
    const at = cmdLine.indexOf('${gitIdentityEnv(name)}')
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(cmdLine.indexOf('cd "${launchCwd}"'))
    expect(at).toBeLessThan(cmdLine.indexOf('${claudeBin()}'))
  })
})
