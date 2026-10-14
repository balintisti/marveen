import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMainSessionRespawnCmd } from '../web/channel-monitor.js'
import { mainConfigDecisionForTest } from '../web/main-config-decision.js'
import { gitIdentityExport, gitIdentityVars } from '../web/git-identity.js'
import { runPreCheck } from '../web/schedule-runner.js'
import { MAIN_AGENT_ID } from '../config.js'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Card db775775 (didi 27453, follow-up of 49d1d6b6): startAgentProcess gave sub-agent sessions
// their own git identity, but the main agent's start and respawns, the workers, the scheduled
// tasks and the watchdog relaunch still committed under the machine's git config (the owner's
// name). Every launch path is pinned here, and a new claude launcher without an identity fails
// the enumeration at the bottom first.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LIB = join(ROOT, 'scripts', 'lib', 'git-identity.sh')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8')
const mkTmp = tmpDirs()

/** A repo whose OWN config names someone else, so only the environment can make the answer right. */
function repoWithOtherIdentity(): string {
  const dir = mkTmp('git-identity-')
  execFileSync('git', ['init', '-q', dir])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'machine owner'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'owner@example.invalid'])
  return dir
}
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))

describe('scripts/lib/git-identity.sh (behaviour)', () => {
  const ident = (name: string) => execFileSync('bash', ['-c', `. "$1"; eval "$(git_identity_env "$2") :"; git var GIT_AUTHOR_IDENT; git var GIT_COMMITTER_IDENT`, '_', LIB, name], {
    cwd: repoWithOtherIdentity(), encoding: 'utf-8', env: cleanEnv(),
  })

  it('the exported identity wins over the repo config, author and committer', () => {
    const [author, committer] = ident('friday').split('\n')
    expect(author).toMatch(/^friday <friday@agents\.local> \d+ [+-]\d{4}$/)
    expect(committer).toMatch(/^friday <friday@agents\.local> /)
  })

  it('CONTROL: without it the repo config answers, so the test above is not vacuous', () => {
    const out = execFileSync('git', ['var', 'GIT_AUTHOR_IDENT'], { cwd: repoWithOtherIdentity(), encoding: 'utf-8', env: cleanEnv() })
    expect(out).toMatch(/^machine owner <owner@example\.invalid> /)
  })

  it('a quote or $ in the name stays literal', () => {
    expect(ident("o'b $HOME").split('\n')[0]).toMatch(/^o'b \$HOME <o'b \$HOME@agents\.local> /)
  })

  it('an empty name prints nothing: the machine identity stays, the launch still runs', () => {
    expect(execFileSync('bash', ['-c', '. "$1"; git_identity_env ""', '_', LIB], { encoding: 'utf-8' })).toBe('')
  })

  it('is the same statement as the TS twin', () => {
    const sh = execFileSync('bash', ['-c', '. "$1"; git_identity_env "$2"', '_', LIB, "o'b"], { encoding: 'utf-8' })
    expect(sh).toBe(`${gitIdentityExport("o'b")} && `)
  })
})

describe('main agent: start and every respawn', () => {
  it('channels.sh: both new-session launches carry the main agent identity', () => {
    const s = read('scripts/channels.sh')
    expect(s).toMatch(/^GIT_ID_ENV="\$\(git_identity_env "\$\{MAIN_AGENT_ID:-marveen\}"\)"$/m)
    expect(s.match(/new-session -d -s "\$SESSION"[^\n]*\n\s*"[^\n]*\$\{GIT_ID_ENV\}\$CLAUDE --dangerously-skip-permissions/g)).toHaveLength(2)
  })

  it('channel-monitor respawn command carries it before claude (behaviour)', () => {
    const cmd = buildMainSessionRespawnCmd({
      claudePath: '/usr/local/bin/claude',
      pluginId: 'telegram@claude-plugins-official',
      model: 'claude-opus-4-8[1m]',
      config: mainConfigDecisionForTest(),
      channelStateEnv: { name: 'TELEGRAM_STATE_DIR', dir: '/opt/marveen/.claude/channels/telegram' },
      continueSession: false,
    })
    expect(cmd).toContain(`&& ${gitIdentityExport(MAIN_AGENT_ID)} `)
    expect(cmd.indexOf('GIT_AUTHOR_NAME')).toBeLessThan(cmd.indexOf('/usr/local/bin/claude'))
  })

  it('channel-watchdog.sh respawn command', () => {
    expect(read('scripts/channel-watchdog.sh')).toMatch(/^RESPAWN_CMD="[^\n]*\$\(git_identity_env "\$MAIN_AGENT_ID"\)\$CLAUDE --dangerously-skip-permissions/m)
  })

  it('stuck-modal-guard.sh respawn command (identity from the session name)', () => {
    expect(read('scripts/stuck-modal-guard.sh')).toMatch(/local RESPAWN_CMD="[^\n]*\$\(git_identity_env "\$\{SESSION%-channels\}"\)\$CLAUDE_Q --dangerously-skip-permissions/)
  })

  it('morning-briefing.sh exports it before the print-mode run', () => {
    expect(read('scripts/morning-briefing.sh')).toMatch(/^eval "\$\(git_identity_env "\$\{_MAIN_ID:-marveen\}"\) :"\n\nCLAUDE_CODE_DISABLE_AGENT_VIEW=1 \$CLAUDE/m)
  })

  it('every script sources the lib with a no-op fallback, so a missing helper cannot stop a launch', () => {
    for (const f of ['channels.sh', 'channel-watchdog.sh', 'stuck-modal-guard.sh', 'watchdog.sh', 'morning-briefing.sh']) {
      expect(read(`scripts/${f}`), f).toMatch(/lib\/git-identity\.sh" 2>\/dev\/null \|\| git_identity_env\(\) \{ :; \}/)
    }
  })
})

describe('sub-agent relaunch, workers, scheduled and background tasks', () => {
  it('watchdog.sh sub-agent relaunch keeps the agent identity', () => {
    expect(read('scripts/watchdog.sh')).toMatch(/CMD="\$\{ISO_ENV\}[^\n]*\$\(git_identity_env "\$AGENT_ID"\)[^\n]*--dangerously-skip-permissions/)
  })

  it('agent-worker.ts: the worker launch carries its session name', () => {
    expect(read('src/web/agent-worker.ts')).toMatch(/customEnvPrefix \+\n[^\n]*\n\s*gitIdentityEnv\(ctx\.session\) \+\n\s*`cd /)
  })

  it('background-tasks.ts: in the pane command, not the tmux client env', () => {
    expect(read('src/web/routes/background-tasks.ts')).toMatch(/const shellCmd = \[\n[^\]]*gitIdentityExport\(agentId\),\n\s*`\$\{CLAUDE\} -p/)
  })

  it('command-task.ts: the command runs under the task agent', () => {
    const s = read('src/web/command-task.ts')
    expect(s).toContain('spawn("bash", ["-lc", cmd], { env: { ...process.env, ...gitIdentityVars(agent) } })')
    expect(s).toContain('runCommand(resolveCommandPlaceholders(task.command), timeoutMs, task.agent || MAIN_AGENT_ID)')
  })

  it('a pre-check script runs under the task agent (behaviour)', () => {
    const repo = repoWithOtherIdentity()
    const out = join(repo, 'ident.txt')
    const script = join(repo, 'pre.sh')
    writeFileSync(script, `cd ${JSON.stringify(repo)} && git var GIT_AUTHOR_IDENT > ${JSON.stringify(out)}\nexit 0\n`)
    runPreCheck({ name: 'git-identity-probe', agent: 'dexter', preCheck: script } as unknown as ScheduledTask)
    expect(readFileSync(out, 'utf-8')).toMatch(/^dexter <dexter@agents\.local> /)
  })

  it('gitIdentityVars is the four variables git reads', () => {
    expect(gitIdentityVars('a')).toEqual({ GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@agents.local', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@agents.local' })
  })
})

// Every code line (not a comment) in scripts/*.sh and src/**/*.ts that launches claude with
// --dangerously-skip-permissions must sit in a file that sets a git identity. A new launch path
// added without it fails here before it can ship.
function* walk(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'node_modules') yield* walk(p) } else yield p
  }
}

// A file here takes the identity from its caller instead of building one; the reason names the
// test that pins the caller.
const TAKES_IT_FROM_CALLER: Record<string, string> = {
  'src/web/ssh-tmux.ts': 'buildRemoteLaunchCommand gets envPrefix: gitIdentityEnv(name) from startRemoteAgentProcess (agent-git-identity.test.ts)',
}

describe('no launch path is missing a git identity (enumeration)', () => {
  it('each file with a --dangerously-skip-permissions launch line also sets one', () => {
    const files = [
      ...readdirSync(join(ROOT, 'scripts')).filter((f) => f.endsWith('.sh')).map((f) => join(ROOT, 'scripts', f)),
      ...[...walk(join(ROOT, 'src'))].filter((f) => f.endsWith('.ts')),
    ]
    const launchers: string[] = []
    const missing: string[] = []
    for (const f of files) {
      const code = readFileSync(f, 'utf-8').split('\n')
        .filter((l) => { const t = l.trim(); return !t.startsWith('#') && !t.startsWith('//') && !t.startsWith('*') })
      if (!code.some((l) => l.includes('--dangerously-skip-permissions'))) continue
      launchers.push(relative(ROOT, f))
      if (relative(ROOT, f) in TAKES_IT_FROM_CALLER) continue
      if (!code.some((l) => /git_identity_env|gitIdentityEnv|gitIdentityExport|GIT_ID_ENV/.test(l))) missing.push(relative(ROOT, f))
    }
    expect(launchers.length).toBeGreaterThanOrEqual(8)
    expect(missing).toEqual([])
    // An exemption for a file that no longer launches anything would hide nothing; drop it.
    expect(Object.keys(TAKES_IT_FROM_CALLER).filter((f) => !launchers.includes(f))).toEqual([])
  })
})
