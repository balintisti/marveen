import { describe, it, expect, vi, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

// Card 9419cf92: scaffoldAgentDir discarded the ensure* returns, and every one of
// them returns false both for "already wired" and for "could not install", silently.
// missingScaffoldGates reads the final settings.json instead. These tests pin that it
// names the RIGHT gate (one removed -> exactly that one reported), not only that it
// reports something.

const SANDBOX = mkTmp('scaffoldgates-')

vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>()
  return { ...actual, homedir: () => join(SANDBOX, 'home') }
})
vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, PROJECT_ROOT: join(SANDBOX, 'project'), STORE_DIR: join(SANDBOX, 'project', 'store') }
})
vi.mock('../web/agent-config.js', async (orig) => {
  const actual = await orig<typeof import('../web/agent-config.js')>()
  return { ...actual, agentDir: (name: string) => join(SANDBOX, 'agents', name) }
})

const { missingScaffoldGates, scaffoldAgentDir } = await import('../web/agent-scaffold.js')
const { MAIN_AGENT_ID } = await import('../config.js')

afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }))

const GATES: Array<[gate: string, event: string, script: string]> = [
  ['staleness-guard', 'UserPromptSubmit', 'staleness-guard.py'],
  ['egress-gate', 'PreToolUse', 'egress-gate.mjs'],
  ['memory-index-write-gate', 'PreToolUse', 'memory-index-write-gate.py'],
  ['outgoing-copy-gate', 'PreToolUse', 'outgoing-copy-gate.py'],
  ['email-send-gate', 'PreToolUse', 'email-send-gate.mjs'],
  ['self-pace-gate', 'PreToolUse', 'self-pace-gate.mjs'],
]

function writeAgent(name: string, opts: { without?: string; quarantine?: boolean; raw?: string } = {}) {
  const claude = join(SANDBOX, 'agents', name, '.claude')
  mkdirSync(join(claude, 'agents'), { recursive: true })
  if (opts.quarantine !== false) writeFileSync(join(claude, 'agents', 'quarantine-reader.md'), 'x')
  if (opts.raw !== undefined) { writeFileSync(join(claude, 'settings.json'), opts.raw); return }
  const hooks: Record<string, unknown[]> = { PreToolUse: [], UserPromptSubmit: [] }
  for (const [gate, event, script] of GATES) {
    if (gate === opts.without) continue
    hooks[event].push({ matcher: '*', hooks: [{ type: 'command', command: `python3 /x/scripts/${script}` }] })
  }
  writeFileSync(join(claude, 'settings.json'), JSON.stringify({ hooks }))
}

describe('missingScaffoldGates (card 9419cf92)', () => {
  it('all gates and the quarantine reader in place -> nothing missing', () => {
    writeAgent('full')
    expect(missingScaffoldGates('full')).toEqual([])
  })

  it.each(GATES.map(([gate]) => gate))('%s removed -> exactly that gate is reported', (gate) => {
    const name = `no-${gate}`
    writeAgent(name, { without: gate })
    expect(missingScaffoldGates(name)).toEqual([gate])
  })

  it('a gate script under the WRONG event does not count (staleness belongs to UserPromptSubmit)', () => {
    const claude = join(SANDBOX, 'agents', 'wrong-event', '.claude')
    writeAgent('wrong-event', { without: 'staleness-guard' })
    writeFileSync(join(claude, 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: GATES.map(([, , script]) => ({ hooks: [{ type: 'command', command: `/x/${script}` }] })),
      },
    }))
    expect(missingScaffoldGates('wrong-event')).toEqual(['staleness-guard'])
  })

  it('no quarantine-reader.md -> reported', () => {
    writeAgent('noqr', { quarantine: false })
    expect(missingScaffoldGates('noqr')).toEqual(['quarantine-reader'])
  })

  it('unparseable settings.json -> reported, not read as "no hooks configured"', () => {
    writeAgent('broken', { raw: '{ "hooks": ' })
    expect(missingScaffoldGates('broken')).toEqual(['settings.json (absent or unparseable)'])
  })

  it('the main agent is out of scope (its gates are repo-shipped, #1305)', () => {
    expect(missingScaffoldGates(MAIN_AGENT_ID)).toEqual([])
  })

  it('END TO END: scaffoldAgentDir returns normally while every ensure* skipped, and the check says so', () => {
    // The sandbox is under the OS tmp dir, so isUnsafeHookCommand refuses every gate
    // command and no template exists: each ensure* returns false without a word.
    // That is the card's failure mode, reproduced on the real scaffold.
    expect(() => scaffoldAgentDir('silent')).not.toThrow()
    expect(missingScaffoldGates('silent')).toEqual([
      'quarantine-reader',
      'settings.json (absent or unparseable)',
    ])
  })
})

describe('the create route measures the FINAL settings.json (card 9419cf92)', () => {
  // writeAgentSettingsFromProfile rewrites settings.json after the scaffold, so a check
  // placed before it would measure a state the agent never runs with.
  const code = readFileSync(join(__dirname, '..', 'web', 'routes', 'agents.ts'), 'utf-8')
  const handler = code.slice(code.indexOf('scaffoldAgentDir(name)'))

  it('calls missingScaffoldGates after the last settings writer of the handler', () => {
    const writer = handler.indexOf('writeAgentSettingsFromProfile(name')
    const check = handler.indexOf('missingScaffoldGates(name)')
    expect(writer).toBeGreaterThan(-1)
    expect(check).toBeGreaterThan(writer)
  })

  it('returns the missing gates to the creator', () => {
    expect(handler).toMatch(/json\(res, \{ ok: true, name, missingGates \}\)/)
  })
})

