// KILLSWITCH1022, the delivery path to the EXISTING sub-agents (card 1befbdb3).
//
// In this tree templates/settings.json.template is a seed for NEW agents only
// (scaffoldAgentDir writes it when the file is missing); the agents that already
// exist get template hooks through ensureAgentHooks on every dashboard start. So the
// freeze gate reaches the running fleet only if ensureAgentHooks merges it into a
// settings.json that already has a PreToolUse block. This pins that path: the
// template text alone (fleet-freeze.test.ts) would stay green if the merge dropped it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ensureAgentHooks, agentSettingsPath } from '../web/agent-scaffold.js'
import { PROJECT_ROOT } from '../config.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const NAME = 'fleetfreeze-probe'
const dir = join(PROJECT_ROOT, 'agents', NAME)
const settings = agentSettingsPath(NAME)

type Entry = { matcher?: string; hooks?: Array<{ command?: string; timeout?: number }> }
const preToolUse = (): Entry[] => (JSON.parse(readFileSync(settings, 'utf-8')) as { hooks?: { PreToolUse?: Entry[] } }).hooks?.PreToolUse ?? []
const gateEntries = () => preToolUse().filter((e) => (e.hooks ?? []).some((h) => (h.command ?? '').includes('fleet-freeze-gate.sh')))

describe('ensureAgentHooks delivers the freeze gate to an existing sub-agent', () => {
  let scopeRoot: string
  beforeEach(() => {
    if (existsSync(join(dir, 'HANDOFF.md'))) throw new Error(`refusing: agents/${NAME} looks like a live agent`)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(join(dir, '.claude'), { recursive: true })
    scopeRoot = mkTmp('ffz-scope-')
    // An agent that already has hooks, including a PreToolUse block of its own.
    writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo existing', timeout: 5 }] }] } }, null, 2))
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  const scopes = () => ({ user: join(scopeRoot, 'user.json'), project: join(scopeRoot, 'project.json') })

  it('merges the gate in once, keeps the agent\'s own entry, and a second run changes nothing', () => {
    ensureAgentHooks(NAME, scopes())
    const g = gateEntries()
    expect(g).toHaveLength(1)
    expect(g[0].matcher).toBe('*')
    expect(preToolUse().some((e) => (e.hooks ?? []).some((h) => h.command === 'echo existing'))).toBe(true)
    const before = readFileSync(settings, 'utf-8')
    ensureAgentHooks(NAME, scopes())
    expect(readFileSync(settings, 'utf-8')).toBe(before)
  })

  it('the merged command denies a tool call (exit 2) while the freeze file exists, and allows it otherwise', () => {
    ensureAgentHooks(NAME, scopes())
    const cmd = gateEntries()[0].hooks![0].command!
    const file = join(scopeRoot, 'fleet-freeze.json')
    const run = () => spawnSync('bash', ['-c', cmd], { encoding: 'utf-8', env: { ...process.env, FLEET_FREEZE_FILE: file } })
    expect(run().status).toBe(0)
    writeFileSync(file, '{}')
    expect(run().status).toBe(2)
  })
})
