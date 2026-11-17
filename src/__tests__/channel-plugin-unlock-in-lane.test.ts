// Behaviour tests for the channel-plugin unlock probe after card e71b2b51.
//
// scripts/channels.sh used to probe /mcp from its own process, outside the
// dashboard's per-pane send lane, ~15s after a restart: the window in which the
// context-guard directive is typed into the same pane (didi 49996 F4). The probe
// now lives only here, and it carries the MCPDUP806 empty-input proof the shell
// probe had. These tests drive the real probe against a fake tmux: every
// keystroke must happen while the send lane is held, nothing is typed into
// parked text, and only our own "/mcp" residue is ever cleared. The shell
// probe's row gate (classify_mcp_plugin_row: fire on the plugin's own failed
// row, never on a connected one) is ported too, with its fixtures (didi 50251 G1).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SESSION = 'orin-channels'
const SEP = '──────────────────────────────'
const FOOTER = '  ⏵⏵ bypass permissions on (shift+tab to cycle)'
const box = (input: string) => `scrollback text\n${SEP}\n ❯ ${input}\n${SEP}\n${FOOTER}`
const IDLE = box('')
const MCP_LIST = `Manage MCP servers\n  google-workspace · ✔ connected\n❯ plugin:telegram:telegram · ✘ failed\n${FOOTER}`

interface Fake {
  input: string            // what sits in the input box
  mcpOpen: boolean
  bun: boolean
  residueAfterRound: string | null // parked text the /mcp round leaves behind
  mcpList: string          // what the open /mcp view shows
  captureThrows: boolean   // the coloured idle-box capture (-e) fails (tmux error)
  keys: string[]
  keysOutsideLane: string[]
}
const fake: Fake = { input: '', mcpOpen: false, bun: false, residueAfterRound: null, mcpList: MCP_LIST, captureThrows: false, keys: [], keysOutsideLane: [] }

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { tryAcquireSessionSendLane } = await import('../web/session-send-lock.js')
  const execFileSync = (cmd: string, args: string[] = []) => {
    if (cmd === '/bin/sleep') return ''
    if (cmd === '/usr/bin/pgrep') {
      if (fake.bun) return '4242\n'
      throw Object.assign(new Error('no match'), { status: 1 })
    }
    const sub = args[0]
    if (sub === 'list-panes') return '1234\n'
    if (sub === 'capture-pane') {
      if (!fake.mcpOpen && fake.captureThrows && args.includes('-e')) throw Object.assign(new Error('capture failed'), { status: 1 })
      return fake.mcpOpen ? fake.mcpList : box(fake.input)
    }
    if (sub === 'send-keys') {
      const key = args.slice(3).join(' ')
      fake.keys.push(key)
      // A free lane at keystroke time = the keystroke was typed OUTSIDE the lane.
      const probe = tryAcquireSessionSendLane(SESSION, null)
      if (probe) { probe(); fake.keysOutsideLane.push(key) }
      if (key === '/mcp Enter') {
        if (fake.input === '') fake.mcpOpen = true
        else fake.input += '/mcp'
      } else if (key === 'Escape') {
        if (fake.mcpOpen) {
          fake.mcpOpen = false
          if (fake.residueAfterRound != null) fake.input = fake.residueAfterRound
        }
      } else if (key === 'C-c') {
        fake.input = ''
      }
      return ''
    }
    throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`)
  }
  return { ...actual, execFileSync }
})

import { schedulePluginUnlockAfterRespawn, unlockInputState, isOwnProbeResidue, classifyMcpPluginRow, unlockRowFires, wasPluginConfirmedAbsent, clearPluginAbsent } from '../web/channel-plugin-unlock.js'
import { tryAcquireSessionSendLane, __resetSessionSendLocks } from '../web/session-send-lock.js'

beforeEach(() => {
  vi.useFakeTimers()
  __resetSessionSendLocks()
  Object.assign(fake, { input: '', mcpOpen: false, bun: false, residueAfterRound: null, mcpList: MCP_LIST, captureThrows: false, keys: [], keysOutsideLane: [] })
  clearPluginAbsent(SESSION)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('unlockInputState (MCPDUP806, ported from channels.sh --probe-input-state)', () => {
  it('an empty idle prompt is idle', () => {
    expect(unlockInputState(IDLE)).toBe('idle')
  })
  it('parked /mcp/mcp (the incident shape) is parked', () => {
    expect(unlockInputState(box('/mcp/mcp'))).toBe('parked:/mcp/mcp')
  })
  it('parked human or channel text is parked', () => {
    expect(unlockInputState(box('deploy the thing to production'))).toBe('parked:deploy the thing to production')
  })
  it('a busy turn is never idle', () => {
    const busy = `scrollback text\n✳ Deliberating… (12s · 4.2k tokens · esc to interrupt)\n${SEP}\n ❯ \n${SEP}\n${FOOTER}`
    expect(unlockInputState(busy)).toBe('busy')
  })
  it('a dim ghost suggestion inside an empty box is idle (coloured capture)', () => {
    expect(unlockInputState(box('\u001b[2mTry "refactor foo"\u001b[0m'))).toBe('idle')
  })
  it('a footer-less welcome screen is not certified idle', () => {
    expect(unlockInputState(' ▐▛███▜▌   Claude Code v2.1.x\n  Try "help" to get started')).not.toBe('idle')
  })
})

describe('isOwnProbeResidue (ported from channels.sh --classify-unlock-residue)', () => {
  it.each([
    ['/mcp', true],
    ['/mcp/mcp', true],
    ['  /mcp /mcp  ', true],
    ['/mcp deploy something', false],
    ['<channel source="plugin:telegram" chat_id="123">hello</channel>', false],
    ['', false],
  ])('%j -> %s', (text, own) => {
    expect(isOwnProbeResidue(text)).toBe(own)
  })
})

describe('classifyMcpPluginRow (ported from channels.sh --classify-mcp-pane)', () => {
  // Verbatim capture from the 2026-07-27 incident (Claude Code 2.1.220, #727).
  const PANE_2_1_220_FAILED = `   Manage MCP servers
   7 servers

     User MCPs (/home/ubuntu/.claude.json)
   ❯ gmail · ✔ connected · 14 tools
     google-calendar · ✔ connected · 13 tools

     Built-in MCPs (always available)
     plugin:telegram:telegram · ✘ failed

   ※ Run claude --debug to see error logs`
  it.each([
    ['2.1.220 failed row (✘ failed)', 'telegram', PANE_2_1_220_FAILED, 'failed'],
    ['2.1.159 failed row (✗ Failed)', 'telegram', '   Manage MCP servers\n\n     plugin:telegram@claude-plugins-official · ✗ Failed', 'failed'],
    ['connected row', 'telegram', '   Manage MCP servers\n\n     plugin:telegram:telegram · ✔ connected · 8 tools', 'connected'],
    ['disabled row', 'telegram', '   Manage MCP servers\n\n     plugin:telegram:telegram (disabled)', 'disabled'],
    ['no plugin row', 'telegram', '   Manage MCP servers\n   0 servers', 'absent'],
    ['empty pane', 'telegram', '', 'absent'],
    ['banner + unrelated error, plugin connected', 'telegram', '  Listening for channel messages from: plugin:telegram@claude-plugins-official\n  ⎿  Error: some unrelated tool call failed\n\n     plugin:telegram:telegram · ✔ connected · 8 tools', 'connected'],
    ['banner only (the plugin is not in the list)', 'telegram', '  Listening for channel messages from: plugin:telegram@claude-plugins-official\n   Manage MCP servers\n   ❯ gmail · ✔ connected', 'absent'],
    ['a channel message naming telegram is not the row', 'telegram', '<channel source="plugin:telegram" chat_id="1">telegram failed?</channel>\n   Manage MCP servers\n   ❯ gmail · ✔ connected', 'absent'],
    ['slack failed row', 'slack', '     plugin:slack-channel:marveen-marketplace · ✘ failed', 'failed'],
    ['discord failed row', 'discord', '     plugin:discord:discord · ✘ failed', 'failed'],
    ['telegram ignores a failed slack row', 'telegram', '     plugin:slack-channel:marveen-marketplace · ✘ failed', 'absent'],
    ['disconnected row', 'telegram', '     plugin:telegram:telegram · ✘ disconnected', 'failed'],
    // channel-health-monitor.ts PLUGIN_FAILED_RX: Claude Code also draws "✘ error" (didi 50263 M2b).
    ['error row (✘ error)', 'telegram', '     plugin:telegram:telegram · ✘ error', 'failed'],
  ] as const)('%s -> %s / %s', (_label, provider, pane, state) => {
    expect(classifyMcpPluginRow(pane, provider).state).toBe(state)
  })

  it('fires on a failed row under both policies, on a disabled row only for the respawn paths, never on connected or absent', () => {
    expect(unlockRowFires('failed', 'failed-only')).toBe(true)
    expect(unlockRowFires('failed', 'failed-or-disabled')).toBe(true)
    expect(unlockRowFires('disabled', 'failed-only')).toBe(false)
    expect(unlockRowFires('disabled', 'failed-or-disabled')).toBe(true)
    for (const p of ['failed-only', 'failed-or-disabled'] as const) {
      expect(unlockRowFires('connected', p)).toBe(false)
      expect(unlockRowFires('absent', p)).toBe(false)
    }
  })
})

describe('the row gate decides whether Up+Enter+Enter is sent', () => {
  const CONNECTED = `Manage MCP servers\n  google-workspace · ✔ connected\n❯ plugin:telegram:telegram · ✔ connected · 8 tools\n${FOOTER}`
  const DISABLED = `Manage MCP servers\n  google-workspace · ✔ connected\n❯ plugin:telegram:telegram ◯ disabled\n${FOOTER}`

  it('a connected row gets /mcp then Escape, never Up or Enter (the #232 "Disable" hazard)', () => {
    fake.mcpList = CONNECTED
    schedulePluginUnlockAfterRespawn(SESSION, 'telegram')
    vi.advanceTimersByTime(35_000)
    expect(fake.keys).toEqual(['/mcp Enter', 'Escape'])
    expect(wasPluginConfirmedAbsent(SESSION, 60_000)).toBe(false)
  })

  it('a disabled row on a cold launch (failed-only) is left alone', () => {
    fake.mcpList = DISABLED
    schedulePluginUnlockAfterRespawn(SESSION, 'telegram', 'failed-only')
    vi.advanceTimersByTime(35_000)
    expect(fake.keys).toEqual(['/mcp Enter', 'Escape'])
  })

  it('a disabled row after an in-process respawn (the default) is enabled', () => {
    fake.mcpList = DISABLED
    schedulePluginUnlockAfterRespawn(SESSION, 'telegram')
    vi.advanceTimersByTime(35_000)
    expect(fake.keys).toEqual(['/mcp Enter', 'Up', 'Enter', 'Enter', 'Escape', 'Escape'])
  })

  it('a failed row on a cold launch fires', () => {
    schedulePluginUnlockAfterRespawn(SESSION, 'telegram', 'failed-only')
    vi.advanceTimersByTime(35_000)
    expect(fake.keys).toEqual(['/mcp Enter', 'Up', 'Enter', 'Enter', 'Escape', 'Escape'])
  })

  // An absent row ends with one /reload-plugins (RELOADPLUGINSABSENT1032, card 09861207
  // slice 8): the line was just proven empty, and the reload is typed inside the lane.
  it('telegram only in the scrollback, not in the list: absent verdict, no Up, one reload in-lane', () => {
    fake.mcpList = `<channel source="plugin:telegram">hi</channel>\nManage MCP servers\n❯ gmail · ✔ connected\n${FOOTER}`
    schedulePluginUnlockAfterRespawn(SESSION, 'telegram')
    vi.advanceTimersByTime(35_000)
    expect(fake.keys).toEqual(['/mcp Enter', 'Escape', '/reload-plugins Enter'])
    expect(fake.keysOutsideLane).toEqual([])
    expect(wasPluginConfirmedAbsent(SESSION, 60_000)).toBe(true)
  })
})

describe('the probe types only inside the send lane, only into an empty box', () => {
  it('waits while a paste holds the lane, then unlocks with every keystroke in-lane', () => {
    const paste = tryAcquireSessionSendLane(SESSION, null)!
    schedulePluginUnlockAfterRespawn(SESSION, 'telegram')
    vi.advanceTimersByTime(35_000)
    expect(fake.keys).toEqual([]) // the paste is in flight: not one key

    paste()
    vi.advanceTimersByTime(15_000)
    expect(fake.keys).toEqual(['/mcp Enter', 'Up', 'Enter', 'Enter', 'Escape', 'Escape'])
    expect(fake.keysOutsideLane).toEqual([])
    expect(tryAcquireSessionSendLane(SESSION, null)).not.toBeNull() // released afterwards
  })

  // The old channels.sh fixture "missing pane-state.js -> unverifiable (fail closed)" (didi 50263 M10).
  it('an input box that cannot be read is unverifiable: not one key, fail closed', () => {
    fake.captureThrows = true
    schedulePluginUnlockAfterRespawn(SESSION, 'telegram')
    vi.advanceTimersByTime(35_000 + 3 * 15_000)
    expect(fake.keys).toEqual([])
  })

  it('never types /mcp into foreign parked text, and never clears it', () => {
    fake.input = 'a human draft'
    schedulePluginUnlockAfterRespawn(SESSION, 'telegram')
    vi.advanceTimersByTime(35_000 + 3 * 15_000)
    expect(fake.keys).toEqual([])
    expect(fake.input).toBe('a human draft')
  })

  it('clears its own parked /mcp residue with one Ctrl-C, then unlocks', () => {
    fake.input = '/mcp/mcp'
    schedulePluginUnlockAfterRespawn(SESSION, 'telegram')
    vi.advanceTimersByTime(35_000)
    expect(fake.keys[0]).toBe('C-c')
    expect(fake.keys.slice(1, 2)).toEqual(['/mcp Enter'])
    expect(fake.keysOutsideLane).toEqual([])
  })

  it('end of round: a /mcp left parked by the round is cleared, a foreign one is not', () => {
    fake.residueAfterRound = '/mcp'
    schedulePluginUnlockAfterRespawn(SESSION, 'telegram')
    vi.advanceTimersByTime(35_000)
    expect(fake.keys.at(-1)).toBe('C-c')
    expect(fake.input).toBe('')

    Object.assign(fake, { input: '', mcpOpen: false, residueAfterRound: 'someone typed this', keys: [] })
    schedulePluginUnlockAfterRespawn(SESSION, 'telegram')
    vi.advanceTimersByTime(35_000)
    expect(fake.keys).not.toContain('C-c')
    expect(fake.input).toBe('someone typed this')
  })

  it('a healthy plugin (bun child present) gets no keystroke at all', () => {
    fake.bun = true
    schedulePluginUnlockAfterRespawn(SESSION, 'telegram')
    vi.advanceTimersByTime(35_000 + 3 * 15_000)
    expect(fake.keys).toEqual([])
  })
})

describe('wiring: channels.sh no longer probes, the monitor probes after any restart', () => {
  const ROOT = join(__dirname, '../..')
  const channels = readFileSync(join(ROOT, 'scripts/channels.sh'), 'utf-8')
  const monitor = readFileSync(join(ROOT, 'src/web/channel-monitor.ts'), 'utf-8')

  it('channels.sh sends no /mcp, Up, Escape or Ctrl-C keystroke to the session', () => {
    const sends = channels.split('\n').filter((l) => /send-keys/.test(l) && !/^\s*#/.test(l))
    expect(sends.filter((l) => /\/mcp|\bUp\b|Escape|C-c/.test(l))).toEqual([])
  })

  // The tick itself has no behavioural harness in this repo (every tick-wiring spec reads the
  // source). So the call is pinned by its STATEMENT SHAPE, which a guard cannot hide behind:
  // unconditional, as the statement right after the identity check, at the same depth, inside
  // the monitor's check(). `if (false) try {...}` and `if (false)\n try {...}` both fail it
  // (didi 50263 M8: the old regex matched under both).
  it('the monitor tick runs the plugin-unlock restart check unconditionally', () => {
    const lines = monitor.split('\n')
    const at = lines.flatMap((l, i) => (l.includes('checkMainPluginUnlockAfterRestart()') && !/function /.test(l) ? [i] : []))
    expect(at).toHaveLength(1)
    const call = lines[at[0]]
    expect(call).toMatch(/^(\s*)try \{ checkMainPluginUnlockAfterRestart\(\) \} catch \(err\) \{[^\n]*\}$/)
    let prev = at[0] - 1
    while (/^\s*\/\//.test(lines[prev])) prev--
    expect(lines[prev]).toMatch(/^\s*try \{ checkMainIdentityAfterRestart\(\) \} catch \(err\) \{[^\n]*\}$/)
    expect(call.match(/^\s*/)![0]).toBe(lines[prev].match(/^\s*/)![0])
    const check = monitor.indexOf('  async function check() {', monitor.indexOf('export function startChannelPluginMonitor'))
    expect(check).toBeGreaterThan(0)
    const offset = lines.slice(0, at[0]).join('\n').length
    expect(offset).toBeGreaterThan(check)
    expect(monitor.slice(check, offset)).not.toMatch(/\n {2}\}\n/) // still inside check()
  })

  it('the agent-process respawn states its row rule (failed-or-disabled, #234)', () => {
    const agentProcess = readFileSync(join(ROOT, 'src/web/agent-process.ts'), 'utf-8')
    const calls = agentProcess.match(/schedulePluginUnlockAfterRespawn\([^)]*\)/g) ?? []
    expect(calls).toEqual(["schedulePluginUnlockAfterRespawn(session, provider.type, 'failed-or-disabled')"])
  })

  it('every direct main-session schedule goes through the factory (shared dedupe, rule per path)', () => {
    const direct = monitor.match(/schedulePluginUnlockAfterRespawn\(MAIN_CHANNELS_SESSION/g) ?? []
    expect(direct).toHaveLength(1)
    const factory = monitor.slice(monitor.indexOf('const mainPluginUnlock = createMainPluginUnlock('))
    expect(factory.slice(0, factory.indexOf('\n})'))).toMatch(/scheduleProbe: \(policy\) => \{ schedulePluginUnlockAfterRespawn\(MAIN_CHANNELS_SESSION, [^\n]*, policy\) \}/)
    expect(monitor).toMatch(/function scheduleMainPluginUnlock\(\): void \{\n\s*mainPluginUnlock\.fromRespawn\(\)\n\}/)
    expect(monitor).toMatch(/function checkMainPluginUnlockAfterRestart\(\): void \{\n\s*const r = mainPluginUnlock\.afterRestartCheck\(\)/)
    expect((monitor.match(/scheduleMainPluginUnlock\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4) // definition + 3 respawn paths
  })
})
