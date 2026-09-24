/**
 * THE OUTGOING-COPY GATE REACHES THE SUB-AGENTS (card 2cbe5eb3).
 *
 * Measured 2026-09-24 on parsed JSON, on every settings layer an agent session loads: 0 of 7
 * sub-agents had outgoing-copy-gate.py wired, while the same parser found email-send-gate on
 * all 7. The gate EXISTED and did not ARRIVE: only the coordinator's tracked project settings
 * carried it. (A second meter said 7 of 7 -- `grep -lc ... | wc -l` counted the "0" line grep
 * prints for a non-matching file. It failed in the reassuring direction.)
 *
 * What this suite pins, beyond "an entry is present":
 *   - the matcher covers reply AND edit_message (an edit can swap checked text for unchecked);
 *   - an older, narrower entry is REPLACED, not kept next to the new one;
 *   - the main agent is left alone (its gate lives in the tracked project settings);
 *   - the command is fail-OPEN on a missing script (Telegram is the owner's only supervision
 *     channel), while a FOUND problem still blocks;
 *   - case 8 runs the command that was WRITTEN into settings, end to end, on a real payload:
 *     presence of an entry is not delivery, and this is the one case that measures delivery
 *     at the command level.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

vi.mock('../logger.js', () => ({
  logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
}))

let agentRoot: string
vi.mock('../web/agent-config.js', async (orig) => {
  const actual = await orig<typeof import('../web/agent-config.js')>()
  return { ...actual, agentDir: () => agentRoot }
})

const { ensureTelegramCopyGate, TELEGRAM_COPY_GATE_MATCHER } = await import('../web/agent-scaffold.js')
const { MAIN_AGENT_ID } = await import('../config.js')

const SETTINGS = () => join(agentRoot, '.claude', 'settings.json')
const read = () => JSON.parse(readFileSync(SETTINGS(), 'utf-8')) as Record<string, any>
const entries = () => (read().hooks?.PreToolUse ?? []) as any[]
const ours = () => entries().filter(e => JSON.stringify(e).includes('outgoing-copy-gate.py'))

beforeEach(() => {
  agentRoot = mkdtempSync(join(tmpdir(), 'copygate-wire-'))
  mkdirSync(join(agentRoot, '.claude'), { recursive: true })
})
afterEach(() => rmSync(agentRoot, { recursive: true, force: true }))

describe('the outgoing-copy gate is wired into a sub-agent settings file', () => {
  it('1. writes itself into an EMPTY settings file', () => {
    writeFileSync(SETTINGS(), JSON.stringify({}))
    expect(ensureTelegramCopyGate('probe')).toBe(true)
    expect(ours()).toHaveLength(1)
  })

  it('2. IDEMPOTENT: the second call neither writes nor duplicates', () => {
    writeFileSync(SETTINGS(), JSON.stringify({}))
    ensureTelegramCopyGate('probe')
    expect(ensureTelegramCopyGate('probe')).toBe(false)
    expect(ours()).toHaveLength(1)
  })

  it('3. CONTROL: existing hooks survive (the email gate the fleet already has)', () => {
    writeFileSync(SETTINGS(), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Bash|.*send_email.*', hooks: [{ type: 'command', command: 'node email-send-gate.mjs' }] }] },
    }))
    ensureTelegramCopyGate('probe')
    expect(JSON.stringify(entries())).toContain('email-send-gate.mjs')
    expect(ours()).toHaveLength(1)
  })

  it('4. the main agent is left alone: no write, file untouched', () => {
    writeFileSync(SETTINGS(), JSON.stringify({ marker: 1 }))
    expect(ensureTelegramCopyGate(MAIN_AGENT_ID)).toBe(false)
    expect(read()).toEqual({ marker: 1 })
  })

  it('5. the matcher covers reply AND edit_message; an older reply-only entry is REPLACED', () => {
    writeFileSync(SETTINGS(), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'mcp__plugin_telegram_telegram__reply', hooks: [{ type: 'command', command: 'python3 /old/scripts/hooks/outgoing-copy-gate.py' }] }] },
    }))
    expect(ensureTelegramCopyGate('probe')).toBe(true)
    expect(ours()).toHaveLength(1)
    expect(ours()[0].matcher).toBe(TELEGRAM_COPY_GATE_MATCHER)
    const re = new RegExp(`^(?:${TELEGRAM_COPY_GATE_MATCHER})$`)
    expect(re.test('mcp__plugin_telegram_telegram__reply')).toBe(true)
    expect(re.test('mcp__plugin_telegram_telegram__edit_message')).toBe(true)
    expect(re.test('mcp__plugin_telegram_telegram__react')).toBe(false)
  })

  it('6. FAIL-OPEN on a missing script: `exit 0`, never `exit 2`', () => {
    writeFileSync(SETTINGS(), JSON.stringify({}))
    ensureTelegramCopyGate('probe')
    const cmd = ours()[0].hooks[0].command as string
    expect(cmd).toContain('[ -f ')
    expect(cmd).toContain('exit 0')
    expect(cmd).not.toContain('exit 2')
  })
})

describe('the wiring is CALLED, not only defined', () => {
  it('7. src/web.ts calls it in the startup loop, and scaffoldAgentDir calls it after the template seed', () => {
    const web = readFileSync(new URL('../web.ts', import.meta.url), 'utf-8')
    expect(web).toMatch(/if \(ensureTelegramCopyGate\(agentName\)\)/)
    const src = readFileSync(new URL('../web/agent-scaffold.ts', import.meta.url), 'utf-8')
    const i = src.indexOf('export function scaffoldAgentDir')
    expect(i).toBeGreaterThan(-1)
    const body = src.slice(i, src.indexOf('\nexport ', i + 10))
    const call = body.indexOf('ensureTelegramCopyGate(name)')
    expect(call).toBeGreaterThan(-1)
    expect(body.indexOf('settings.json.template')).toBeGreaterThan(-1)
    expect(body.indexOf('settings.json.template')).toBeLessThan(call)
  })
})

describe('delivery: the command WRITTEN into settings reaches the gate', () => {
  function runWritten(text: string) {
    writeFileSync(SETTINGS(), JSON.stringify({}))
    ensureTelegramCopyGate('probe')
    const cmd = ours()[0].hooks[0].command as string
    const rules = join(agentRoot, 'rules.json') // hermetic: the gate log lands in the temp dir
    return spawnSync('bash', ['-c', cmd], {
      input: JSON.stringify({ tool_name: 'mcp__plugin_telegram_telegram__reply', tool_input: { chat_id: '1', text }, hook_event_name: 'PreToolUse' }),
      encoding: 'utf-8',
      env: { ...process.env, OUTGOING_COPY_GATE_RULES: rules },
    })
  }

  it('8. an em dash is BLOCKED (2) through the written command; a clean text passes (0)', () => {
    const dash = String.fromCodePoint(0x2014)
    const bad = runWritten(`Szia, a jelentés kész ${dash} kérlek nézd meg, és szólj, ha valami nem stimmel.`)
    expect(bad.status).toBe(2)
    expect(bad.stderr).toContain('GONDOLATJEL')
    const good = runWritten('Szia, a jelentés kész, kérlek nézd meg, és szólj, ha valami nem stimmel.')
    expect(good.status).toBe(0)
  })
})
