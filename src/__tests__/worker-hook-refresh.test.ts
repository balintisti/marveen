/**
 * WORKER HOOKS: REFRESHED AT BOOT, AND A HOOK THAT RUNS FROM A GIT WORKTREE IS REFUSED (card ad303fae).
 *
 * marveen's decision 2026-09-24: the worker's shared-hook merge runs at dashboard boot too, not only
 * when a worker session is created -- on one condition: a hook whose command runs from a worktree is
 * not taken over, loudly. The same day a test run had written exactly such a hook into the real
 * ~/.claude/settings.json (incident 66b8e1fb). Everything here runs on temp trees; homedir() is never
 * consulted because every call gets its claude dir explicitly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const warns: unknown[] = []
vi.mock('../logger.js', () => ({
  logger: { warn: (...a: unknown[]) => { warns.push(a) }, info: () => {}, debug: () => {}, error: () => {} },
}))

const { worktreeBoundHookPath, vanishedHomeHookPath, dropWorktreeBoundHooks, writeWorkerSettings, refreshWorkerSettings, makeWorkerCtx } =
  await import('../web/agent-worker.js')

let root: string
let MAIN: string, WT: string, PLAIN: string, CLAUDE: string
const hook = (command: string, matcher = 'Bash') => ({ matcher, hooks: [{ type: 'command', command }] })

beforeEach(() => {
  warns.length = 0
  root = mkdtempSync(join(tmpdir(), 'wk-hooks-'))
  MAIN = join(root, 'main'); WT = join(root, 'main-wt-x'); PLAIN = join(root, 'dot-claude-hooks'); CLAUDE = join(root, 'claude')
  mkdirSync(join(MAIN, '.git'), { recursive: true })                 // main checkout: .git is a DIRECTORY
  mkdirSync(join(MAIN, 'scripts', 'hooks'), { recursive: true })
  mkdirSync(join(WT, 'scripts', 'hooks'), { recursive: true })
  writeFileSync(join(WT, '.git'), `gitdir: ${MAIN}/.git/worktrees/x\n`) // linked worktree: .git is a FILE
  mkdirSync(PLAIN, { recursive: true })                               // like ~/.claude/hooks: no repo at all
  mkdirSync(CLAUDE, { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('worktreeBoundHookPath: the mechanism is `.git` as a FILE, not a directory name', () => {
  it('a command running from a worktree is named, with the offending path', () => {
    const cmd = `bash -c '[ -f ${WT}/scripts/hooks/gate.py ] && exec python3 ${WT}/scripts/hooks/gate.py; exit 0'`
    expect(worktreeBoundHookPath(cmd)).toBe(`${WT}/scripts/hooks/gate.py`)
  })
  it('even after the script itself is gone -- the worktree dir still answers', () => {
    expect(worktreeBoundHookPath(`python3 ${WT}/scripts/hooks/deleted.py`)).toBe(`${WT}/scripts/hooks/deleted.py`)
  })
  it('the NEAREST repo decides: a main checkout nested inside a worktree folder is a main checkout', () => {
    const inner = join(WT, 'nested-main')
    mkdirSync(join(inner, '.git'), { recursive: true })
    expect(worktreeBoundHookPath(`python3 ${inner}/scripts/x.py`)).toBeNull()
  })
  it('CONTROLS: the main checkout, a plain hooks dir, and $VAR paths all pass', () => {
    expect(worktreeBoundHookPath(`python3 ${MAIN}/scripts/hooks/db-gate.py`)).toBeNull()
    expect(worktreeBoundHookPath(`${PLAIN}/telegram_progress.py`)).toBeNull()
    expect(worktreeBoundHookPath('python3 "$CLAUDE_PROJECT_DIR/scripts/hooks/x.py"')).toBeNull()
  })
})

// didi 02:19: two input shapes the first version was blind to. `root` stands in for the home dir.
describe('the same worktree however it is spelled, and a worktree that is already gone (didi 02:19)', () => {
  it('$HOME, ${HOME} and ~ spellings of a worktree path are refused like the absolute one', () => {
    for (const pre of ['$HOME', '${HOME}', '~']) {
      expect(worktreeBoundHookPath(`python3 ${pre}/main-wt-x/scripts/hooks/gate.py`, root), pre)
        .toBe(`${WT}/scripts/hooks/gate.py`)
    }
  })
  it('CONTROL: the same spellings into the MAIN checkout pass', () => {
    for (const pre of ['$HOME', '${HOME}', '~']) {
      expect(worktreeBoundHookPath(`python3 ${pre}/main/scripts/hooks/db-gate.py`, root), pre).toBeNull()
    }
  })
  it('a hook into a REMOVED worktree (its directory is gone) is named, in any spelling', () => {
    expect(vanishedHomeHookPath(`python3 ${root}/gone-wt/scripts/hooks/gate.py`, root)).toBe(`${root}/gone-wt/scripts/hooks/gate.py`)
    expect(vanishedHomeHookPath('python3 $HOME/gone-wt/scripts/hooks/gate.py', root)).toBe(`${root}/gone-wt/scripts/hooks/gate.py`)
  })
  it('...and the day a worktree of that name is created again, the worktree check catches it', () => {
    const cmd = `python3 ${root}/gone-wt/scripts/hooks/gate.py`
    mkdirSync(join(root, 'gone-wt', 'scripts', 'hooks'), { recursive: true })
    writeFileSync(join(root, 'gone-wt', '.git'), `gitdir: ${MAIN}/.git/worktrees/gone\n`)
    expect(vanishedHomeHookPath(cmd, root)).toBeNull()
    expect(worktreeBoundHookPath(cmd, root)).toBe(`${root}/gone-wt/scripts/hooks/gate.py`)
  })
  it('CONTROLS: a not-yet-written LOG file in an existing dir, ~/.claude, and paths outside home all pass', () => {
    expect(vanishedHomeHookPath(`python3 ${MAIN}/scripts/hooks/db-gate.py >> ${MAIN}/new-hook.log`, root)).toBeNull()
    expect(vanishedHomeHookPath(`python3 ${root}/.claude/hooks/missing/x.py`, root)).toBeNull()
    expect(vanishedHomeHookPath('python3 /nonexistent-top/x.py', root)).toBeNull()
  })
  it('dropWorktreeBoundHooks refuses the vanished one too, and says why', () => {
    const block = { PreToolUse: [hook(`python3 ${root}/gone-wt/x.py`), hook(`python3 ${MAIN}/scripts/hooks/db-gate.py`)] }
    expect(dropWorktreeBoundHooks(block, 'test', root)).toEqual({ PreToolUse: [hook(`python3 ${MAIN}/scripts/hooks/db-gate.py`)] })
    expect(JSON.stringify(warns)).toContain('directory no longer exists')
  })
})

describe('writeWorkerSettings: merged, filtered, both sides', () => {
  it('a worktree hook is refused from the SHARED block and from the worker LOCAL block, loudly', () => {
    const legitShared = hook(`python3 ${MAIN}/scripts/hooks/db-gate.py`)
    const leaked = hook(`python3 ${WT}/scripts/hooks/gate.py`, 'mcp__telegram__reply')
    writeFileSync(join(CLAUDE, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [legitShared, leaked] } }))
    const ctx = makeWorkerCtx('w1', join(root, 'worker'))
    mkdirSync(ctx.configDir, { recursive: true })
    const legacyLocal = hook(`python3 ${WT}/scripts/hooks/old.py`)
    const legitLocal = hook(`${PLAIN}/local.py`)
    writeFileSync(join(ctx.configDir, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [legacyLocal, legitLocal] }, keep: 1 }))

    writeWorkerSettings(ctx, CLAUDE)
    const out = JSON.parse(readFileSync(join(ctx.configDir, 'settings.json'), 'utf-8'))
    expect(out.hooks.PreToolUse).toEqual([legitShared, legitLocal])
    expect(out.keep).toBe(1)
    expect(out.skipDangerousModePermissionPrompt).toBe(true)
    expect(JSON.stringify(out)).not.toContain(WT)
    expect(warns.length).toBe(2)
  })

  it('when every hook is refused, no hooks key survives from the old file', () => {
    writeFileSync(join(CLAUDE, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [hook(`python3 ${WT}/a.py`)] } }))
    const ctx = makeWorkerCtx('w2', join(root, 'worker2'))
    mkdirSync(ctx.configDir, { recursive: true })
    writeFileSync(join(ctx.configDir, 'settings.json'), JSON.stringify({ hooks: { Stop: [hook(`python3 ${WT}/b.py`)] } }))
    writeWorkerSettings(ctx, CLAUDE)
    expect(JSON.parse(readFileSync(join(ctx.configDir, 'settings.json'), 'utf-8')).hooks).toBeUndefined()
  })

  it('dropWorktreeBoundHooks keeps an event only if something in it survives', () => {
    const out = dropWorktreeBoundHooks({ Stop: [hook(`python3 ${WT}/x.py`)], PreToolUse: [hook(`${PLAIN}/y.py`)] }, 'test')
    expect(Object.keys(out ?? {})).toEqual(['PreToolUse'])
  })
})

describe('refreshWorkerSettings: existing workers only', () => {
  it('refreshes a worker that exists and does NOT create one that does not', () => {
    writeFileSync(join(CLAUDE, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [hook(`${PLAIN}/new-gate.py`)] } }))
    const live = makeWorkerCtx('live', join(root, 'wlive'))
    const never = makeWorkerCtx('never', join(root, 'wnever'))
    mkdirSync(live.configDir, { recursive: true })
    writeFileSync(join(live.configDir, 'settings.json'), JSON.stringify({}))
    expect(refreshWorkerSettings([live, never], CLAUDE)).toEqual(['live'])
    expect(readFileSync(join(live.configDir, 'settings.json'), 'utf-8')).toContain('new-gate.py')
    expect(existsSync(never.configDir)).toBe(false)
  })
})

describe('wiring: the boot path calls it, inside the guarded hook block', () => {
  it('web.ts runs refreshWorkerSettings after the agent hook backfill and before its catch', () => {
    const src = readFileSync(join(__dirname, '..', 'web.ts'), 'utf-8')
    const call = src.indexOf('refreshWorkerSettings()')
    const backfill = src.indexOf('ensureMemoryIndexWriteGate(agentName)')
    const guardEnd = src.indexOf("'Agent hook backfill skipped'")
    expect(call).toBeGreaterThan(backfill)
    expect(call).toBeLessThan(guardEnd)
  })
})
