/**
 * THE CHILD-CLAUDE GUARD REACHES THE RUNNING FLEET (CHILDCLAUDEPOLLER1010, card 3954082a).
 *
 * ensureChildClaudeGuard is the startup backfill: without it the guard reaches a running
 * sub-agent no sooner than its next respawn. The sibling suite pins only that the call sites
 * exist (text); this one runs the migration on real settings files:
 *   - it wires the guard on Bash into an existing file, and a second call writes nothing;
 *   - a stale entry under another matcher is REPLACED, not kept next to the new one;
 *   - a settings file that does not parse is left byte-identical, and a DUPLICATED key is
 *     logged with this writer's name (JSON.parse keeps only the last block, so the hooks in
 *     the first one are dead without a word);
 *   - the main agent and a sub-agent without a settings file are not touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

const warn = vi.fn()
vi.mock('../logger.js', () => ({
  logger: { warn: (...a: unknown[]) => warn(...a), info: () => {}, debug: () => {}, error: () => {} },
}))

// The main agent's settings resolve under homedir(): sandbox it, so a lost MAIN_AGENT_ID check
// writes into a temp dir instead of the real ~/.claude/settings.json (see the copy-gate suite).
const FAKE_HOME = mkTmp('childguard-home-')
vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>()
  return { ...actual, homedir: () => FAKE_HOME }
})

let agentRoot: string
vi.mock('../web/agent-config.js', async (orig) => {
  const actual = await orig<typeof import('../web/agent-config.js')>()
  return { ...actual, agentDir: () => agentRoot }
})

const { ensureChildClaudeGuard, agentSettingsPath, CHILD_CLAUDE_GUARD_SCRIPT } = await import('../web/agent-scaffold.js')
const { MAIN_AGENT_ID } = await import('../config.js')

const SETTINGS = () => join(agentRoot, '.claude', 'settings.json')
const read = () => JSON.parse(readFileSync(SETTINGS(), 'utf-8')) as Record<string, any>
const ours = () => ((read().hooks?.PreToolUse ?? []) as any[])
  .filter(e => JSON.stringify(e).includes(CHILD_CLAUDE_GUARD_SCRIPT))

beforeEach(() => {
  agentRoot = mkTmp('childguard-wire-')
  mkdirSync(join(agentRoot, '.claude'), { recursive: true })
})

describe('ensureChildClaudeGuard backfills the guard into a sub-agent settings file', () => {
  it('0. SANDBOX: the main agent settings path resolves inside the fake home', () => {
    expect(agentSettingsPath(MAIN_AGENT_ID).startsWith(FAKE_HOME)).toBe(true)
  })

  it('1. wires the guard on Bash, next to the hooks already there', () => {
    const other = { matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 /x/other-gate.py' }] }
    writeFileSync(SETTINGS(), JSON.stringify({ hooks: { PreToolUse: [other] } }))
    expect(ensureChildClaudeGuard('probe')).toBe(true)
    expect(ours()).toHaveLength(1)
    expect(ours()[0].matcher).toBe('Bash')
    expect(read().hooks.PreToolUse).toContainEqual(other)
  })

  it('2. IDEMPOTENT: the second call neither writes nor duplicates', () => {
    writeFileSync(SETTINGS(), JSON.stringify({}))
    ensureChildClaudeGuard('probe')
    const before = readFileSync(SETTINGS(), 'utf-8')
    expect(ensureChildClaudeGuard('probe')).toBe(false)
    expect(readFileSync(SETTINGS(), 'utf-8')).toBe(before)
    expect(ours()).toHaveLength(1)
  })

  it('3. a stale entry under another matcher is replaced, not kept beside the new one', () => {
    const stale = { matcher: 'Read', hooks: [{ type: 'command', command: `node /old/${CHILD_CLAUDE_GUARD_SCRIPT}` }] }
    writeFileSync(SETTINGS(), JSON.stringify({ hooks: { PreToolUse: [stale] } }))
    expect(ensureChildClaudeGuard('probe')).toBe(true)
    expect(ours()).toHaveLength(1)
    expect(ours()[0].matcher).toBe('Bash')
  })

  it('4. a settings file that does not parse is left byte-identical', () => {
    const broken = '{"hooks": {"PreToolUse": [}'
    writeFileSync(SETTINGS(), broken)
    expect(ensureChildClaudeGuard('probe')).toBe(false)
    expect(readFileSync(SETTINGS(), 'utf-8')).toBe(broken)
  })

  it('4b. a duplicated key is reported, naming this writer', () => {
    warn.mockClear()
    writeFileSync(SETTINGS(), '{"hooks": {"PreToolUse": []}, "hooks": {"Stop": []}}')
    ensureChildClaudeGuard('probe')
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ site: 'ensureChildClaudeGuard', dupKeys: expect.arrayContaining([expect.stringContaining('hooks')]) }),
      expect.stringContaining('duplicate JSON keys'),
    )
  })

  it('5. the main agent and a sub-agent without a settings file are not touched', () => {
    expect(ensureChildClaudeGuard(MAIN_AGENT_ID)).toBe(false)
    expect(existsSync(agentSettingsPath(MAIN_AGENT_ID))).toBe(false)
    expect(ensureChildClaudeGuard('probe')).toBe(false)
    expect(existsSync(SETTINGS())).toBe(false)
  })
})
