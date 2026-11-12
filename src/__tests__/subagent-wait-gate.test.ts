/**
 * SUB-AGENT WAIT GATE (card b6035163): a sub-agent's Bash call may not ask for a timeout that
 * can outlive its 5-minute prompt cache.
 *
 * The gate sits on EVERY Bash call of every fleet agent, so the controls weigh as much as the
 * refusals: a false refusal of the main session (whose long suite runs are legitimate) or of a
 * sub-agent's ordinary call stops work fleet-wide. The gate saves tokens and nothing else, so
 * whatever it cannot read must pass, and say so in its log.
 *
 * NO COMMAND RUNS HERE. The command is text in the hook payload.
 *
 * NOT PINNED HERE: that Claude Code really puts `agent_id` / `agent_type` into a child's
 * PreToolUse payload and leaves them out of the main session's. That was measured live on
 * 2.1.314 (card b6035163, 2026-11-12) and has to be measured again after an upgrade: if the
 * fields are renamed, every case below still passes and the gate refuses nobody. The DENY
 * lines in store/subagent-wait-gate.log are the running meter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  return mkdtempSync(join(tmpdir(), 'waitgate-home-'))
})
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => fakeHome }))

const { ensureAgentHooks } = await import('../web/agent-scaffold.js')
mkTmp.adopt(fakeHome)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const GATE_NAME = 'subagent-wait-gate.py'
const GATE = join(ROOT, 'scripts', 'hooks', GATE_NAME)
const LIMIT = 270000

let dir: string
let logFile: string

function runRaw(input: string) {
  const r = spawnSync('python3', [GATE], {
    input,
    encoding: 'utf8',
    env: { ...process.env, MARVEEN_SUBAGENT_WAIT_GATE_LOG: logFile },
  })
  return { code: r.status, stderr: r.stderr }
}
const run = (payload: unknown) => runRaw(JSON.stringify(payload))
const logText = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')

const COMMAND = 'npx vitest run src/__tests__/a.test.ts'
/** A Bash call as a Task/Agent-tool child sends it. */
const child = (input: Record<string, unknown>, who: Record<string, unknown> = { agent_id: 'a5f17775', agent_type: 'general-purpose' }) =>
  ({ tool_name: 'Bash', ...who, tool_input: { command: COMMAND, ...input } })
/** The same call from the main session: neither marker. */
const main = (input: Record<string, unknown>) => ({ tool_name: 'Bash', tool_input: { command: COMMAND, ...input } })

beforeEach(() => {
  dir = mkTmp('waitgate-')
  logFile = join(dir, 'gate.log')
  agentRoot = join(dir, 'agent')
  mkdirSync(join(agentRoot, '.claude'), { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('sub-agent wait gate: refuses a sub-agent call that may outlive the cache', () => {
  it.each([
    ['five minutes', child({ timeout: 300000 })],
    ['one millisecond above the limit', child({ timeout: LIMIT + 1 })],
    ['the tool maximum', child({ timeout: 600000 })],
    ['a child known by agent_id only', child({ timeout: 300000 }, { agent_id: 'a5f17775' })],
    ['a child known by agent_type only', child({ timeout: 300000 }, { agent_type: 'general-purpose' })],
    ['a numeric string', child({ timeout: '300000' })],
    ['run_in_background spelled out as false', child({ timeout: 300000, run_in_background: false })],
  ])('%s', (_name, payload) => {
    const r = run(payload)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('REFUSED')
  })

  it('a timeout too large to be a number is still refused, and the message does not crash on it', () => {
    const r = runRaw(`{"tool_name":"Bash","agent_type":"general-purpose","tool_input":{"command":"x","timeout":1e400}}`)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('REFUSED')
  })

  it('the refusal names what was asked, the limit, and both ways out', () => {
    const r = run(child({ timeout: 300000 }))
    expect(r.stderr).toContain('300000 ms')
    expect(r.stderr).toContain(`limit ${LIMIT} ms`)
    expect(r.stderr).toContain('Nothing was started')
    // way out 1: it fits, ask for less
    expect(r.stderr).toContain(`"timeout": ${LIMIT} or less`)
    // way out 2: it does not fit, so NOT a lower timeout (that kills the run half way)
    expect(r.stderr).toContain('do NOT just')
    expect(r.stderr).toContain('detached')
    expect(r.stderr).toContain('hand the command back to your parent')
  })

  it('writes one DENY line with the timeout, the agent type and the command', () => {
    run(child({ timeout: 300000 }))
    const lines = logText().trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(' DENY timeout=300000 agent_type=general-purpose | ')
    expect(lines[0]).toContain(COMMAND)
  })

  // The DENY lines are the running meter named in the header, and every case above sends the
  // log to a path of its own. This one runs a copy of the hook from an install-shaped tree and
  // leaves the override out, so the line has to land where the meter is read.
  it('without the override the DENY line lands in <install root>/store/subagent-wait-gate.log', () => {
    const install = join(dir, 'install')
    const gateCopy = join(install, 'scripts', 'hooks', GATE_NAME)
    mkdirSync(dirname(gateCopy), { recursive: true })
    mkdirSync(join(install, 'store'))
    copyFileSync(GATE, gateCopy)
    const env = { ...process.env }
    delete env.MARVEEN_SUBAGENT_WAIT_GATE_LOG
    const r = spawnSync('python3', [gateCopy], { input: JSON.stringify(child({ timeout: 300000 })), encoding: 'utf8', env })
    expect(r.status).toBe(2)
    const lines = readFileSync(join(install, 'store', 'subagent-wait-gate.log'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(' DENY timeout=300000 ')
    expect(logText()).toBe('')
  })
})

describe('sub-agent wait gate: lets the rest through, silently', () => {
  it.each([
    ['a sub-agent exactly at the limit', child({ timeout: LIMIT })],
    ['a sub-agent with a short timeout', child({ timeout: 60000 })],
    ['a sub-agent with no timeout (the tool default is 2 minutes)', child({})],
    ['a sub-agent starting it in the background', child({ timeout: 600000, run_in_background: true })],
    ['the main session with the tool maximum', main({ timeout: 600000 })],
    ['the main session with empty markers', { ...main({ timeout: 600000 }), agent_id: '', agent_type: '  ' }],
    ['a sub-agent tool that is not Bash', { ...child({ timeout: 600000 }), tool_name: 'Read' }],
    ['a timeout that is a boolean', child({ timeout: true })],
    ['a timeout that is not a number', child({ timeout: 'soon' })],
  ])('%s', (_name, payload) => {
    const r = run(payload)
    expect(r.code).toBe(0)
    expect(r.stderr).toBe('')
    expect(logText()).toBe('')
  })
})

describe('sub-agent wait gate: fails open, out loud', () => {
  it.each([
    ['stdin that is not JSON', 'this is not json'],
    ['a payload that is not an object', '[]'],
    ['a sub-agent Bash call whose tool_input is not an object', JSON.stringify({ tool_name: 'Bash', agent_type: 'general-purpose', tool_input: ['x'] })],
  ])('%s', (_name, input) => {
    const r = runRaw(input)
    expect(r.code).toBe(0)
    const lines = logText().trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(' FAIL-OPEN ')
  })

  it('a log it cannot write changes no verdict', () => {
    logFile = join(dir, 'no-such-dir', 'gate.log')
    expect(run(child({ timeout: 300000 })).code).toBe(2)
    expect(run(child({ timeout: 60000 })).code).toBe(0)
  })
})

describe('sub-agent wait gate: reaches every sub-agent through the template', () => {
  const SETTINGS = () => join(agentRoot, '.claude', 'settings.json')
  // Scratch scopes, so the cross-scope dedupe never consults the operator's real files.
  const SCOPES = () => ({ user: join(fakeHome, '.claude', 'settings.json'), project: join(agentRoot, 'no-project.json') })
  const preToolUse = (): Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> =>
    (JSON.parse(readFileSync(SETTINGS(), 'utf-8')).hooks ?? {}).PreToolUse ?? []
  const ours = () => preToolUse().filter(e => (e.hooks ?? []).some(h => (h.command ?? '').includes(GATE_NAME)))
  const commandsNaming = (script: string) =>
    preToolUse().flatMap(e => e.hooks ?? []).filter(h => (h.command ?? '').includes(script))

  it('an agent whose Bash group predates the gate gets it once, on Bash, next to what it had', () => {
    // The shape a running fleet has today: the Bash group with the two older gates.
    const wrap = (s: string) => `bash -c '[ -f ${ROOT}/scripts/hooks/${s} ] && exec python3 ${ROOT}/scripts/hooks/${s}; exit 0'`
    writeFileSync(SETTINGS(), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [
      { type: 'command', command: wrap('main-checkout-git-guard.py'), timeout: 10 },
      { type: 'command', command: wrap('heavy-run-gate.py'), timeout: 10 },
    ] }] } }))
    expect(ensureAgentHooks('probe', SCOPES())).toBe(true)
    expect(ours()).toHaveLength(1)
    expect(ours()[0].matcher).toBe('Bash')
    expect(commandsNaming(GATE_NAME)).toHaveLength(1)
    expect(commandsNaming('heavy-run-gate.py')).toHaveLength(1)
    expect(commandsNaming('main-checkout-git-guard.py')).toHaveLength(1)
  })

  it('an agent with no PreToolUse hooks at all gets it, and a second run adds nothing', () => {
    writeFileSync(SETTINGS(), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'true' }] }] } }))
    expect(ensureAgentHooks('probe', SCOPES())).toBe(true)
    ensureAgentHooks('probe', SCOPES())
    expect(commandsNaming(GATE_NAME)).toHaveLength(1)
    expect(ours()[0].matcher).toBe('Bash')
  })

  it('is wired fail-open: a missing script must not block every shell call', () => {
    writeFileSync(SETTINGS(), JSON.stringify({ hooks: {} }))
    ensureAgentHooks('probe', SCOPES())
    const cmd = commandsNaming(GATE_NAME)[0]?.command ?? ''
    expect(cmd).toContain(`[ -f ${ROOT}/scripts/hooks/${GATE_NAME} ]`)
    expect(cmd).toContain(`exec python3 ${ROOT}/scripts/hooks/${GATE_NAME}`)
    expect(cmd.trimEnd().endsWith("exit 0'")).toBe(true)
  })
})
