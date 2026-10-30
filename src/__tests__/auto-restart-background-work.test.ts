// Card c8a9bcff (didi 49709, 2026-10-30): batch 5b4af8b6 taught pane-state that a footer ending on
// the background count ("⏵⏵ bypass permissions on · 1 shell") is the idle footer. The scheduled
// auto-restart gated only on paneLooksIdle + an open question, so a due restart had waited for a
// running shell by accident (the footer read 'unknown'), and after the batch it would kill it.
// The gate now counts background work with the context-guard's own measurement
// (measureBackgroundWork: footer shells / monitors / sub-agents + live heavy-run jobs), defers on
// it, and the deferral is capped like the open-question one.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import {
  restartBlockedBy,
  deferralOverride,
  softBlocksHolding,
  BACKGROUND_WORK_DEFERRAL_CAP_MS,
  OPEN_QUESTION_DEFERRAL_CAP_MS,
  DEFAULT_AUTO_RESTART,
  type AutoRestartConfig,
} from '../auto-restart.js'
import { paneLooksIdle, runningBackgroundWork } from '../pane-state.js'

const mkTmp = tmpDirs()
const HEAVY = mkTmp('autorestart-bg-')
process.env.HEAVY_RUN_DIR = HEAVY

const h = vi.hoisted(() => ({
  pane: '' as string | null,
  openQuestion: false,
  cfg: null as unknown,
  restartAgentProcess: vi.fn(async () => {}),
  warn: vi.fn(),
  spawned: [] as string[],
}))

// NO PROCESS LEAVES THIS TEST. The runner's restart paths are real: for the main agent it is
// `launchctl kickstart -k com.<service>.channels`. On 2026-10-30 19:25 the first version of this
// file stubbed restartAgentProcess but not that path, and its sweeps restarted the LIVE main
// session. Every child_process entry point is therefore replaced by one that records and throws,
// and the last test asserts nothing got here. A tmux read (localPaneTree) fails the same way and
// is measured as "pane link not measured", the safe side.
vi.mock('node:child_process', () => {
  const refuse = (cmd: unknown) => { h.spawned.push(String(cmd)); throw new Error(`test must not run ${String(cmd)}`) }
  return { execFileSync: refuse, execSync: refuse, execFile: refuse, exec: refuse, spawn: refuse, spawnSync: refuse, fork: refuse }
})

vi.mock('../config.js', async (orig) => ({ ...(await orig<typeof import('../config.js')>()), MAIN_AGENT_ID: 'marveen' }))
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: h.warn, debug: vi.fn(), error: vi.fn() } }))
vi.mock('../db.js', () => ({ createAgentMessage: vi.fn(), hasOpenInboundQuestion: () => h.openQuestion }))
vi.mock('../web/agent-config.js', () => ({ listAgentNames: () => ['deeper'], readAgentRemoteHost: () => null }))
vi.mock('../web/agent-process.js', () => ({
  agentRunState: () => 'running',
  restartAgentProcess: h.restartAgentProcess,
  capturePane: () => h.pane,
}))
vi.mock('../web/channel-monitor.js', () => ({ respawnMainSessionFresh: vi.fn() }))
// Only deeper is scheduled, like the live store/auto-restart.json; the main agent stays disabled.
vi.mock('../web/auto-restart-store.js', () => ({
  readAutoRestartConfig: (name: string) => (name === 'deeper' ? h.cfg : DEFAULT_AUTO_RESTART),
}))
vi.mock('../web/fleet-freeze.js', () => ({ whileNotFrozen: (_l: string, f: () => unknown) => f }))
vi.mock('../web/context-guard-runner.js', async (orig) => ({
  ...(await orig<typeof import('../web/context-guard-runner.js')>()),
  getHardGuardPhase: () => null,
}))

const SEP = '─'.repeat(80)
// The shape of didi's probe P1 (the frames card 53521828 measured); the text is synthetic.
const pane = (footer: string): string => [
  '  A 08:45-ös ébresztő be van állítva.',
  '✻ Sautéed for 31s · done 7:34 · 1 shell still running',
  `${'─'.repeat(70)} deeper ─`,
  '❯ ',
  SEP,
  '  Opus 5.5 | ctx 11% | 5h 4% | 7d 53%',
  footer,
].join('\n')
const WITH_SHELL = pane('  ⏵⏵ bypass permissions on · 1 shell')
const WITH_TWO_AND_MONITOR = pane('  ⏵⏵ bypass permissions on · 2 shells, 1 monitor')
const NOTHING_RUNNING = pane('  ⏵⏵ bypass permissions on (shift+tab to cycle)')

describe('the pane facts the gate builds on (positive control)', () => {
  it('a footer with a running shell reads idle AND counts the shell', () => {
    // If this stops holding, the gate test below proves nothing: it would defer on busy-pane.
    expect(paneLooksIdle(WITH_SHELL)).toBe(true)
    expect(runningBackgroundWork(WITH_SHELL)).toBe(1)
    expect(runningBackgroundWork(WITH_TWO_AND_MONITOR)).toBe(3)
    expect(paneLooksIdle(NOTHING_RUNNING)).toBe(true)
    expect(runningBackgroundWork(NOTHING_RUNNING)).toBe(0)
  })
})

describe('restartBlockedBy: background work (card c8a9bcff)', () => {
  it('running background work defers an idle pane', () => {
    expect(restartBlockedBy({ paneIdle: true, backgroundWork: 1, openQuestion: false })).toBe('background-work')
  })
  it('ordering: busy pane, then background work, then an open question', () => {
    expect(restartBlockedBy({ paneIdle: false, backgroundWork: 2, openQuestion: true })).toBe('busy-pane')
    expect(restartBlockedBy({ paneIdle: true, backgroundWork: 2, openQuestion: true })).toBe('background-work')
    expect(restartBlockedBy({ paneIdle: true, backgroundWork: 0, openQuestion: true })).toBe('open-question')
    expect(restartBlockedBy({ paneIdle: true, backgroundWork: 0, openQuestion: false })).toBeNull()
  })
})

describe('the background-work deferral is capped', () => {
  const now = 1_700_000_000_000
  it('overrides at the cap, not a millisecond before', () => {
    expect(deferralOverride('background-work', now - BACKGROUND_WORK_DEFERRAL_CAP_MS, now, BACKGROUND_WORK_DEFERRAL_CAP_MS)).toBe(true)
    expect(deferralOverride('background-work', now - BACKGROUND_WORK_DEFERRAL_CAP_MS + 1, now, BACKGROUND_WORK_DEFERRAL_CAP_MS)).toBe(false)
  })
  it('covers the longest measured gate run (~3.5 h)', () => {
    expect(BACKGROUND_WORK_DEFERRAL_CAP_MS).toBeGreaterThan(3.5 * 3_600_000)
  })
  it('every present soft block must be past its own cap', () => {
    const bgOld = { block: 'background-work' as const, sinceMs: now - BACKGROUND_WORK_DEFERRAL_CAP_MS, capMs: BACKGROUND_WORK_DEFERRAL_CAP_MS }
    const bgNew = { ...bgOld, sinceMs: now - 60_000 }
    const oqOld = { block: 'open-question' as const, sinceMs: now - OPEN_QUESTION_DEFERRAL_CAP_MS, capMs: OPEN_QUESTION_DEFERRAL_CAP_MS }
    const oqNew = { ...oqOld, sinceMs: now - 60_000 }
    expect(softBlocksHolding([bgNew, oqOld], now)).toEqual(['background-work'])
    expect(softBlocksHolding([bgOld, oqNew], now)).toEqual(['open-question'])
    expect(softBlocksHolding([bgOld, oqOld], now)).toEqual([])
    expect(softBlocksHolding([], now)).toEqual([])
  })
})

// The runner, end to end through the real pane-state and the real measureBackgroundWork: only the
// I/O edges (tmux capture, restart, config, ledger) are stubbed.
describe('the scheduled restart runner waits for running work', () => {
  // 2026-10-31 02:59 local: the first sweep (at +40 s) seeds, the 03:00 slot is due on a later one.
  const start = new Date(2026, 9, 31, 2, 59, 0).getTime()
  const cfg: AutoRestartConfig = { ...DEFAULT_AUTO_RESTART, enabled: true, mode: 'fresh', dailyTime: '03:00' }
  let timer: NodeJS.Timeout

  async function boot() {
    vi.resetModules()
    const { startAutoRestartRunner } = await import('../web/auto-restart-runner.js')
    timer = startAutoRestartRunner()
    await vi.advanceTimersByTimeAsync(40_000) // seed sweep
    expect(h.restartAgentProcess).not.toHaveBeenCalled()
  }
  const minutes = (n: number) => vi.advanceTimersByTimeAsync(n * 60_000)

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] })
    vi.setSystemTime(start)
    h.cfg = cfg
    h.openQuestion = false
    h.restartAgentProcess.mockClear()
    h.warn.mockClear()
    rmSync(HEAVY, { recursive: true, force: true })
    mkdirSync(HEAVY, { recursive: true })
  })
  afterEach(() => {
    clearInterval(timer)
    vi.useRealTimers()
  })

  it('a running shell in the footer defers the due restart; it runs once the shell is gone', async () => {
    h.pane = WITH_SHELL
    await boot()
    await minutes(5)
    expect(h.restartAgentProcess).not.toHaveBeenCalled()
    h.pane = NOTHING_RUNNING
    await minutes(1)
    expect(h.restartAgentProcess).toHaveBeenCalledTimes(1)
    expect(h.restartAgentProcess).toHaveBeenCalledWith('deeper', { fresh: true })
  })

  it('a live heavy-run job the pane does not show defers it too', async () => {
    h.pane = NOTHING_RUNNING
    writeFileSync(join(HEAVY, 'slot-0'), JSON.stringify({ agent: 'deeper', pid: process.pid, label: 'gate' }))
    await boot()
    await minutes(5)
    expect(h.restartAgentProcess).not.toHaveBeenCalled()
    rmSync(join(HEAVY, 'slot-0'))
    await minutes(1)
    expect(h.restartAgentProcess).toHaveBeenCalledTimes(1)
  })

  it('past the cap the restart runs anyway, and says what it kills', async () => {
    h.pane = WITH_SHELL
    await boot()
    await minutes(BACKGROUND_WORK_DEFERRAL_CAP_MS / 60_000 - 5)
    expect(h.restartAgentProcess).not.toHaveBeenCalled()
    await minutes(10)
    expect(h.restartAgentProcess).toHaveBeenCalledTimes(1)
    const override = h.warn.mock.calls.find((c) => String(c[1]).includes('background-work deferral exceeded cap'))
    expect(override?.[0]).toMatchObject({ name: 'deeper', block: 'background-work' })
    expect(String((override?.[0] as { killed?: string }).killed)).toContain('1 in the pane')
  })

  it('nothing running and no question: the slot fires as before (control)', async () => {
    h.pane = NOTHING_RUNNING
    await boot()
    await minutes(2)
    expect(h.restartAgentProcess).toHaveBeenCalledTimes(1)
  })

  it('no launchctl, tmux or any other process was run by these tests', () => {
    expect(h.spawned.filter((c) => !/tmux/.test(c))).toEqual([])
  })
})
