/**
 * THE MEMORY-FRONTMATTER BASH GATE REACHES EVERY SUB-AGENT THROUGH THE TEMPLATE (card 6525aba3, A6).
 *
 * didi's A6 finding G-1: the three `Bash` entries in templates/settings.json.template are how every
 * sub-agent gets the gate, and no test pinned them -- removing any one survived 469 tests. The one
 * that matters most is PreToolUse: without it the PostToolUse half finds "no snapshot" and exits 0
 * (memory-frontmatter-bash-gate.py), so the gate goes blind while the suite stays green.
 *
 * The case runs the REAL migration (ensureAgentHooks) against the REAL template on an agent whose
 * settings predate the gate, because that is the path a running fleet takes at the next start.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

vi.mock('../logger.js', () => ({
  logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
}))

let agentRoot: string
vi.mock('../web/agent-config.js', async (orig) => {
  const actual = await orig<typeof import('../web/agent-config.js')>()
  return { ...actual, agentDir: () => agentRoot }
})
const fakeHome = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  return mkdtempSync(join(tmpdir(), 'mfgate-home-'))
})
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => fakeHome }))

const { ensureAgentHooks } = await import('../web/agent-scaffold.js')
mkTmp.adopt(fakeHome)

const GATE = 'memory-frontmatter-bash-gate.py'
const EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'] as const
const SETTINGS = () => join(agentRoot, '.claude', 'settings.json')
// Scratch scopes, so the cross-scope dedupe never consults the operator's real files.
const SCOPES = () => ({ user: join(fakeHome, '.claude', 'settings.json'), project: join(agentRoot, 'no-project.json') })

function gateEntries(event: string): Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> {
  const hooks = (JSON.parse(readFileSync(SETTINGS(), 'utf-8')).hooks ?? {}) as Record<string, any[]>
  return (hooks[event] ?? []).filter(e => (e.hooks ?? []).some((h: { command?: string }) => (h.command ?? '').includes(GATE)))
}

beforeEach(() => {
  agentRoot = mkTmp('mfgate-agent-')
  mkdirSync(join(agentRoot, '.claude'), { recursive: true })
})
afterEach(() => rmSync(agentRoot, { recursive: true, force: true }))

describe('an agent whose settings predate the gate gets it on all three events', () => {
  it('old shape: the three events exist, without the gate', () => {
    // The pre-A6 shape: the events are there (tool-log capture), the gate is not, so the merge has to
    // ADD a group to an existing event rather than add the event wholesale.
    const toolLog = { matcher: '*', hooks: [{ type: 'command', command: 'python3 /x/scripts/hooks/tool-log-capture.py', timeout: 10 }] }
    writeFileSync(SETTINGS(), JSON.stringify({ hooks: { PreToolUse: [toolLog], PostToolUse: [toolLog], PostToolUseFailure: [toolLog] } }))
    expect(ensureAgentHooks('probe', SCOPES())).toBe(true)
    for (const event of EVENTS) {
      const ours = gateEntries(event)
      expect(ours, event).toHaveLength(1)
      expect(ours[0].matcher, event).toBe('Bash')
      // the existing group is kept alongside
      const all = JSON.stringify(JSON.parse(readFileSync(SETTINGS(), 'utf-8')).hooks[event])
      expect(all, event).toContain('tool-log-capture.py')
    }
  })

  it('older shape: hooks without these events at all', () => {
    writeFileSync(SETTINGS(), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'true' }] }] } }))
    expect(ensureAgentHooks('probe', SCOPES())).toBe(true)
    for (const event of EVENTS) expect(gateEntries(event), event).toHaveLength(1)
  })

  it('a second run adds nothing (no duplicate group on every start)', () => {
    writeFileSync(SETTINGS(), JSON.stringify({ hooks: {} }))
    ensureAgentHooks('probe', SCOPES())
    ensureAgentHooks('probe', SCOPES())
    for (const event of EVENTS) expect(gateEntries(event), event).toHaveLength(1)
  })

  it('the template carries it fail-open on each event: a missing script must not block every shell call', () => {
    writeFileSync(SETTINGS(), JSON.stringify({ hooks: {} }))
    ensureAgentHooks('probe', SCOPES())
    for (const event of EVENTS) {
      const cmd = gateEntries(event)[0].hooks?.find(h => (h.command ?? '').includes(GATE))?.command ?? ''
      expect(cmd, event).toContain('[ -f ')
      expect(cmd, event).toContain('exit 0')
      expect(cmd, event).not.toContain('exit 2')
    }
  })
})
