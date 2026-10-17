// Card c8852bba (Isti TG 6875, 2026-10-15): "ha van futó folyamat, akkor ne legyen újraindítás, mert
// akkor dupla munka van". The context guard restarted sessions whose turn had ended but whose
// background work (test gates, watcher shells, sub-agents) was still running, and every restart
// killed that work: 4/4 on 2026-10-07, 6 in ~70 minutes on 10-08. A ROUTINE restart now waits for
// the work (bounded by BACKGROUND_DEFER_MAX_MS); a HARD one still fires and names what it kills.
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'
import {
  BACKGROUND_DEFER_MAX_MS,
  DAILY_HANDOFF_REASON_PREFIX,
  DEFAULT_CONTEXT_GUARD,
  IDLE_FLUSH_REASON_PREFIX,
  STALE_REFRESH_REASON_PREFIX,
  INITIAL_GUARD_STATE,
  SATURATION_CONFIRM_SWEEPS,
  decideGuard,
  type ContextGuardConfig,
  type GuardInputs,
  type GuardState,
} from '../context-guard.js'
import { detectPaneState } from '../pane-state.js'
import { descendsFrom, liveHeavyRunJobs } from '../heavy-run-jobs.js'

const mkTmp = tmpDirs()
const SANDBOX = mkTmp('guardbg-')

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../db.js', () => ({ createAgentMessage: vi.fn() }))
vi.mock('../web/channel-monitor.js', () => ({
  hardRestartMarveenChannels: vi.fn(() => ({ ok: true })),
  lastMainRespawnAt: () => null,
  MARVEEN_POST_RESPAWN_GRACE_MS: 0,
}))
vi.mock('../web/stuck-tool-call-watcher.js', () => ({ shouldDeferForRecentRespawn: () => false }))
vi.mock('../web/agent-process.js', () => ({
  clearFeedbackModalAndRecheck: () => false,
  agentRunState: () => 'stopped',
  agentSessionName: (n: string) => `agent-${n}`,
  restartAgentProcess: vi.fn(),
  capturePane: () => null,
  sendPromptToSession: vi.fn(),
  isSessionReadyForPrompt: async () => false,
}))
vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'marveen-channels' }))

const { measureBackgroundWork, readParentTable } = await import('../web/context-guard-runner.js')

const HERE = dirname(fileURLToPath(import.meta.url))
// A live pane, 80 columns, captured 2026-10-15 22:51 (computress; the first line's card id replaced):
// the turn is over ("done 22:51 · 2 shells still running"), the prompt is free, two shells run.
const TURN_ENDED_2_SHELLS = readFileSync(join(HERE, 'fixtures', 'pane', 'turn-ended-2-shells-still-running.txt'), 'utf8')

const CFG: ContextGuardConfig = { ...DEFAULT_CONTEXT_GUARD, enabled: true }
const NOW = 1_000_000_000
const MIN = 60_000

function inputs(overrides: Partial<GuardInputs> = {}): GuardInputs {
  return {
    nowMs: NOW,
    pct: 0.8,
    running: true,
    paneIdle: true,
    paneBusy: false,
    sessionReady: false,
    handoffMtime: null,
    paneSaturated: false,
    dailyHandoffDue: false,
    contextTokens: null,
    idleMs: null,
    ...overrides,
  }
}

const awaiting: GuardState = {
  phase: 'await-handoff',
  handoffMtimeAtRequest: 100,
  deadlineMs: NOW + 10 * MIN,
  cooldownUntilMs: 0,
  saturatedStreak: 0,
  staleRefreshCount: 0,
  handoffStaleMinutes: null,
}
const BG = { backgroundWork: 2, backgroundWorkDetail: '2 in the pane (shells / monitors / sub-agents)' }


describe('a ROUTINE restart waits for background work', () => {
  it('handoff written, pane idle, two shells running: holds, and records when the hold began', () => {
    const d = decideGuard(awaiting, inputs({ handoffMtime: 200, ...BG }), CFG)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('background work is running: 2 (2 in the pane')
    expect(d.nextState.phase).toBe('await-handoff')
    expect(d.nextState.backgroundDeferSinceMs).toBe(NOW)
  })

  it('keeps holding inside the bound, without moving the start of the hold', () => {
    const since = NOW - 30 * MIN
    const d = decideGuard({ ...awaiting, backgroundDeferSinceMs: since }, inputs({ handoffMtime: 200, ...BG }), CFG)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('(30m of 45m)')
    expect(d.nextState.backgroundDeferSinceMs).toBe(since)
  })

  it('restarts once the work is done, and says how long it waited', () => {
    const d = decideGuard({ ...awaiting, backgroundDeferSinceMs: NOW - 20 * MIN }, inputs({ handoffMtime: 200 }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toBe('handoff written -- held 20m until the background work finished')
    expect(d.nextState.backgroundDeferSinceMs ?? null).toBeNull()
  })

  it('at the bound it restarts as before, and names the work it kills', () => {
    const d = decideGuard(
      { ...awaiting, backgroundDeferSinceMs: NOW - BACKGROUND_DEFER_MAX_MS },
      inputs({ handoffMtime: 200, ...BG }),
      CFG,
    )
    expect(d.action).toBe('restart')
    expect(d.reason).toContain('held 45m for background work, the 45m bound is reached')
    expect(d.reason).toContain('KILLS running background work: 2 (2 in the pane')
  })

  it('the handoff timeout waits too, and is bounded the same way', () => {
    const late = { ...awaiting, deadlineMs: NOW - 1 }
    const held = decideGuard(late, inputs({ ...BG }), CFG)
    expect(held.action).toBe('none')
    expect(held.reason).toContain('handoff timeout, but background work is running')
    const bound = decideGuard({ ...late, backgroundDeferSinceMs: NOW - BACKGROUND_DEFER_MAX_MS }, inputs({ ...BG }), CFG)
    expect(bound.action).toBe('restart')
    expect(bound.reason).toMatch(/^handoff timeout -- force restart -- held 45m .*KILLS running background work/)
  })

  it('a stale-handoff refresh inside the hold keeps the hold\'s start, so the bound stays one (didi 35937 M2)', () => {
    const since = NOW - 20 * MIN
    // idleMs 0: the agent was active just now, long after the handoff (mtime 200) -- stale.
    const d = decideGuard({ ...awaiting, backgroundDeferSinceMs: since }, inputs({ handoffMtime: 200, idleMs: 0, ...BG }), CFG)
    expect(d.action).toBe('request-handoff')
    expect(d.reason.startsWith(STALE_REFRESH_REASON_PREFIX)).toBe(true)
    expect(d.nextState.backgroundDeferSinceMs).toBe(since)
  })

  it('with nothing running the restart is exactly what it was', () => {
    expect(decideGuard(awaiting, inputs({ handoffMtime: 200 }), CFG).reason).toBe('handoff written')
    expect(decideGuard(awaiting, inputs({ handoffMtime: 200, backgroundWork: 0 }), CFG).action).toBe('restart')
    expect(decideGuard({ ...awaiting, deadlineMs: NOW - 1 }, inputs(), CFG).reason).toBe('handoff timeout -- force restart')
  })
})

describe('the tiers with no context pressure do not START while background work runs (didi 35937)', () => {
  // An agent waiting for its own gate is quiet BECAUSE it waits: without this rule the idle flush
  // asked for a handoff, held 45m and killed the gate (didi's probe: restart at m=47).
  const IDLE_CFG: ContextGuardConfig = { ...CFG, idleFlushEnabled: true, idleFlushTokens: 150_000, idleMinutes: 60 }
  const quietHeavy = { pct: 0.3, contextTokens: 160_000, idleMs: 70 * MIN }

  it('idle-flush: no handoff request while the gate runs, for as long as it runs', () => {
    let state: GuardState = INITIAL_GUARD_STATE
    for (let m = 0; m <= 180; m += 1) {
      const d = decideGuard(state, inputs({ ...quietHeavy, nowMs: NOW + m * MIN, idleMs: (70 + m) * MIN, ...BG }), IDLE_CFG)
      expect(d.action, `minute ${m}: ${d.reason}`).toBe('none')
      state = d.nextState
    }
    expect(state.phase).toBe('idle')
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ ...quietHeavy, ...BG }), IDLE_CFG)
    expect(d.reason).toBe('idle-flush: heavy and quiet, but background work is running: 2 (2 in the pane (shells / monitors / sub-agents)) -- not starting a handoff')
  })

  it('CONTROL: the same quiet, heavy session with nothing running gets its idle flush', () => {
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ ...quietHeavy }), IDLE_CFG)
    expect(d.action).toBe('request-handoff')
    expect(d.reason.startsWith(IDLE_FLUSH_REASON_PREFIX)).toBe(true)
  })

  it('daily: not requested while work runs, and the slot is not marked served (the reason lacks its prefix)', () => {
    const cfg = { ...CFG, dailyHandoffEnabled: true }
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ pct: 0.3, dailyHandoffDue: true, ...BG }), cfg)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('daily handoff due, but background work is running')
    expect(d.reason.startsWith(DAILY_HANDOFF_REASON_PREFIX)).toBe(false)
    // CONTROL: once the work is done, the still-due slot is served.
    const after = decideGuard(INITIAL_GUARD_STATE, inputs({ pct: 0.3, dailyHandoffDue: true }), cfg)
    expect(after.action).toBe('request-handoff')
    expect(after.reason.startsWith(DAILY_HANDOFF_REASON_PREFIX)).toBe(true)
  })

  it('the act tier still starts a sequence (its growth is real), and that one is bounded', () => {
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ pct: 0.92, ...BG }), CFG)
    expect(d.action).toBe('request-handoff')
  })

  // A sequence such a tier started while nothing ran, with work starting during the wait (marveen
  // on didi 35937: no 45m bound for them). The bound returns once the context reaches actPct.
  const NP_CFG: ContextGuardConfig = { ...CFG, idleFlushEnabled: true, idleFlushTokens: 150_000, idleMinutes: 60, actPct: 0.75, hardPct: 0.95 }

  it('the sequence remembers which kind of tier started it', () => {
    const flush = decideGuard(INITIAL_GUARD_STATE, inputs({ ...quietHeavy }), NP_CFG)
    expect(flush.nextState.noPressure).toBe(true)
    const daily = decideGuard(INITIAL_GUARD_STATE, inputs({ pct: 0.3, dailyHandoffDue: true }), { ...CFG, dailyHandoffEnabled: true })
    expect(daily.nextState.noPressure).toBe(true)
    const act = decideGuard(INITIAL_GUARD_STATE, inputs({ pct: 0.8 }), NP_CFG)
    expect(act.action).toBe('request-handoff')
    expect(act.nextState.noPressure ?? false).toBe(false)
  })

  it('below actPct its hold has no bound: written handoff and timeout both hold for 3 hours, then restart when the work ends', () => {
    const start = decideGuard(INITIAL_GUARD_STATE, inputs({ ...quietHeavy }), NP_CFG).nextState
    let state: GuardState = start
    for (let m = 1; m <= 180; m += 1) {
      // handoff written at once; the deadline passes at handoffTimeoutMinutes -- neither may kill the work
      const d = decideGuard(state, inputs({ pct: 0.3, nowMs: NOW + m * MIN, handoffMtime: 200, ...BG }), NP_CFG)
      expect(d.action, `minute ${m}: ${d.reason}`).toBe('none')
      state = d.nextState
    }
    const held = decideGuard(state, inputs({ pct: 0.3, nowMs: NOW + 181 * MIN, handoffMtime: 200, ...BG }), NP_CFG)
    expect(held.reason).toContain('(180m, no bound below 75%: no context pressure behind this handoff)')
    const timedOut = decideGuard({ ...start, backgroundDeferSinceMs: NOW }, inputs({ pct: 0.3, nowMs: NOW + 180 * MIN, ...BG }), NP_CFG)
    expect(timedOut.action).toBe('none')
    expect(timedOut.reason).toContain('handoff timeout, but background work is running')
    const done = decideGuard(state, inputs({ pct: 0.3, nowMs: NOW + 181 * MIN, handoffMtime: 200 }), NP_CFG)
    expect(done.action).toBe('restart')
    expect(done.reason).toBe('handoff written -- held 180m until the background work finished')
  })

  it('once the context reaches actPct the 45m bound applies, counted from then, not from the hold start', () => {
    const start = decideGuard(INITIAL_GUARD_STATE, inputs({ ...quietHeavy }), NP_CFG).nextState
    const longHold = { ...start, backgroundDeferSinceMs: NOW - 120 * MIN }
    const first = decideGuard(longHold, inputs({ pct: 0.8, handoffMtime: 200, ...BG }), NP_CFG)
    expect(first.action).toBe('none')
    expect(first.nextState.backgroundPressureSinceMs).toBe(NOW)
    expect(first.reason).toContain('(120m, at 75% for 0m of 45m)')
    const inside = decideGuard(first.nextState, inputs({ pct: 0.8, nowMs: NOW + 44 * MIN, handoffMtime: 200, ...BG }), NP_CFG)
    expect(inside.action).toBe('none')
    expect(inside.nextState.backgroundPressureSinceMs).toBe(NOW)
    const bound = decideGuard(inside.nextState, inputs({ pct: 0.8, nowMs: NOW + 45 * MIN, handoffMtime: 200, ...BG }), NP_CFG)
    expect(bound.action).toBe('restart')
    expect(bound.reason).toContain('held 165m for background work, the 45m bound is reached -- KILLS running background work')
  })

  it('the hard threshold still does not wait for it', () => {
    const start = decideGuard(INITIAL_GUARD_STATE, inputs({ ...quietHeavy }), NP_CFG).nextState
    const d = decideGuard({ ...start, backgroundDeferSinceMs: NOW - 10 * MIN }, inputs({ pct: 0.96, handoffMtime: 200, ...BG }), NP_CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toContain('KILLS running background work')
  })
})

describe('a HARD restart does not wait, and names what it kills', () => {
  it('hard threshold in the idle phase', () => {
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ pct: 0.99, ...BG }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toMatch(/^hard threshold \(99% >= 97%\) -- KILLS running background work: 2 \(/)
  })

  it('hard threshold during await-handoff, handoff not written', () => {
    const d = decideGuard(awaiting, inputs({ pct: 0.99, ...BG }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toContain('hard threshold during await-handoff -- KILLS running background work')
  })

  it('hard threshold during await-handoff, handoff written: no hold either', () => {
    const d = decideGuard(awaiting, inputs({ pct: 0.99, handoffMtime: 200, ...BG }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toBe('handoff written -- KILLS running background work: 2 (2 in the pane (shells / monitors / sub-agents))')
  })

  it('the saturation net, in both phases', () => {
    const sat = decideGuard(
      { ...INITIAL_GUARD_STATE, saturatedStreak: SATURATION_CONFIRM_SWEEPS - 1 },
      inputs({ paneSaturated: true, ...BG }),
      CFG,
    )
    expect(sat.action).toBe('restart')
    expect(sat.reason).toContain('KILLS running background work')
    const satAwait = decideGuard(awaiting, inputs({ paneSaturated: true, ...BG }), CFG)
    expect(satAwait.action).toBe('restart')
    expect(satAwait.reason).toBe('pane saturated during await-handoff -- KILLS running background work: 2 (2 in the pane (shells / monitors / sub-agents))')
  })
})

describe('the inputs come from the live pane and from heavy-run', () => {
  it('the real turn-ended pane reads idle AND counts its two shells; fed to the guard, it holds', () => {
    expect(detectPaneState(TURN_ENDED_2_SHELLS)).toBe('idle')
    const empty = mkTmp('heavy-empty-')
    const bg = measureBackgroundWork('computress', TURN_ENDED_2_SHELLS, empty)
    expect(bg).toEqual({
      backgroundWork: 2,
      backgroundWorkDetail: '2 in the pane (shells / monitors / sub-agents)',
      detachedWork: 0,
      detachedWorkDetail: '',
      killedWorkDetail: '2 in the pane (shells / monitors / sub-agents)',
    })
    const d = decideGuard(awaiting, inputs({ handoffMtime: 200, paneIdle: true, ...bg }), CFG)
    expect(d.action).toBe('none')
  })

  it('the same pane with the shells line and footer count gone reads as nothing running', () => {
    const quiet = TURN_ENDED_2_SHELLS.replace(' · 2 shells still running', '').replace('on · 2 shells · ↓ to manage', 'on (shift+tab to cycle)')
    expect(measureBackgroundWork('computress', quiet, mkTmp('heavy-empty2-'))).toEqual({
      backgroundWork: 0, backgroundWorkDetail: '', detachedWork: 0, detachedWorkDetail: '', killedWorkDetail: '',
    })
  })

  it('live heavy-run jobs of THIS agent count, held and queued; dead ones and other agents do not', () => {
    const dir = mkTmp('heavy-')
    mkdirSync(join(dir, 'tickets'), { recursive: true })
    const live = process.pid
    const dead = 2 ** 22 + 12345 // above macOS / Linux default pid_max
    writeFileSync(join(dir, 'slot-0'), JSON.stringify({ agent: 'dexter', pid: live, label: 'dexter-gate' }))
    writeFileSync(join(dir, 'slot-1'), JSON.stringify({ agent: 'dexter', pid: dead, label: 'finished-gate' }))
    writeFileSync(join(dir, 'light-0'), JSON.stringify({ agent: 'friday', pid: live, label: 'friday-gate' }))
    writeFileSync(join(dir, 'tickets', '0000000042'), JSON.stringify({ agent: 'dexter', pid: live, label: 'dexter-e2e', seq: 42 }))
    writeFileSync(join(dir, 'slot-2'), 'not json')
    expect(liveHeavyRunJobs('dexter', dir)).toEqual([
      { label: 'dexter-gate', waiting: false, pid: live },
      { label: 'dexter-e2e', waiting: true, pid: live },
    ])
    // The pane tree not measurable: every job stays with the killed, marked (the old wording).
    expect(measureBackgroundWork('dexter', null, dir, () => null)).toEqual({
      backgroundWork: 2,
      backgroundWorkDetail: 'heavy-run: dexter-gate, dexter-e2e (queued)',
      detachedWork: 0,
      detachedWorkDetail: '',
      killedWorkDetail: 'heavy-run: dexter-gate (pane link not measured), dexter-e2e (queued) (pane link not measured)',
    })
  })

  it('the light pool counts too: a light-<i> holder and a tickets-light waiter (didi 35937 M6)', () => {
    const dir = mkTmp('heavy-light-')
    mkdirSync(join(dir, 'tickets-light'), { recursive: true })
    writeFileSync(join(dir, 'light-1'), JSON.stringify({ agent: 'dexter', pid: process.pid, label: 'dexter-lint' }))
    writeFileSync(join(dir, 'tickets-light', '0000000007'), JSON.stringify({ agent: 'dexter', pid: process.pid, label: 'dexter-tsc' }))
    expect(liveHeavyRunJobs('dexter', dir)).toEqual([
      { label: 'dexter-lint', waiting: false, pid: process.pid },
      { label: 'dexter-tsc', waiting: true, pid: process.pid },
    ])
  })

  it('a missing heavy-run directory is no work, not an error', () => {
    expect(liveHeavyRunJobs('dexter', join(SANDBOX, 'no-such-dir'))).toEqual([])
  })

  it('checkAgent feeds the measurement into the guard inputs', () => {
    // checkAgent is private inside a module full of IO; pin the wiring at the source, brace-matched
    // to its own body (the same approach as context-guard-hidden-worker's performRestart check).
    const src = readFileSync(join(HERE, '..', 'web', 'context-guard-runner.ts'), 'utf8')
    const m = /async function checkAgent\s*\([^)]*\)[^{]*\{/.exec(src)
    expect(m, 'checkAgent not found').not.toBeNull()
    let depth = 0
    let end = src.length
    for (let i = src.indexOf('{', m!.index); i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) { end = i; break }
    }
    const body = src.slice(m!.index, end + 1)
    expect(body).toMatch(/const background = running && needPct \? measureBackgroundWork\(name, pane\)/)
    const inputsObj = body.slice(body.indexOf('const inputs: GuardInputs = {'), body.indexOf('const decision = decideGuard('))
    expect(inputsObj).toContain('...background,')
  })
})

// Card 3c3d8e43: "KILLS" named every heavy-run job, and the detached ones survive `tmux kill-session`
// (didi 10-16 08:43: three queued gates ran on; friday 09:13: shard 7/8 ran on). The fresh session
// was told to redo running work. A job is now placed by the pane's process tree.
describe('a heavy-run job is placed by the pane process tree: killed or detached (card 3c3d8e43)', () => {
  const PANE = 500
  // 500 = pane (claude); 510 its Bash shell; 520 heavy-run under it. 900 a detached launcher's
  // heavy-run: its launcher exited, so the parent is 1.
  const TABLE = new Map([[500, 400], [400, 1], [510, 500], [520, 510], [900, 1], [950, 900]])

  it('descendsFrom: in the tree, outside it, and not measurable', () => {
    expect(descendsFrom(520, PANE, TABLE)).toBe(true)
    expect(descendsFrom(950, PANE, TABLE)).toBe(false)
    expect(descendsFrom(900, PANE, TABLE)).toBe(false)
    expect(descendsFrom(777, PANE, TABLE)).toBeNull() // gone from the snapshot
    expect(descendsFrom(1, PANE, new Map([[2, 3], [3, 2]]))).toBeNull()
    expect(descendsFrom(2, PANE, new Map([[2, 3], [3, 2]]))).toBeNull() // a loop does not end
  })

  function jobsDir(): string {
    const dir = mkTmp('heavy-tree-')
    mkdirSync(join(dir, 'tickets'), { recursive: true })
    writeFileSync(join(dir, 'slot-0'), JSON.stringify({ agent: 'dexter', pid: process.pid, label: 'dexter-inpane' }))
    writeFileSync(join(dir, 'tickets', '0000000001'), JSON.stringify({ agent: 'dexter', pid: process.pid, label: 'dexter-detached' }))
    return dir
  }
  const probe = (parentOf: Map<number, number>) => () => ({ rootPid: PANE, parentOf })

  it('measureBackgroundWork: an in-pane gate is killed, a detached one is not; both still hold', () => {
    const dir = jobsDir()
    const inPane = new Map([[process.pid, 510], [510, PANE]])
    const detached = new Map([[process.pid, 1]])
    // Both job files name this live process; the table places it in the pane's tree or outside.
    const bgIn = measureBackgroundWork('dexter', null, dir, probe(inPane))
    expect(bgIn).toMatchObject({ backgroundWork: 2, detachedWork: 0 })
    expect(bgIn.killedWorkDetail).toBe('heavy-run: dexter-inpane, dexter-detached (queued)')
    const bgOut = measureBackgroundWork('dexter', TURN_ENDED_2_SHELLS, dir, probe(detached))
    expect(bgOut).toEqual({
      backgroundWork: 4,
      backgroundWorkDetail: '2 in the pane (shells / monitors / sub-agents); heavy-run: dexter-inpane, dexter-detached (queued)',
      detachedWork: 2,
      detachedWorkDetail: 'heavy-run: dexter-inpane, dexter-detached (queued)',
      killedWorkDetail: '2 in the pane (shells / monitors / sub-agents)',
    })
  })

  it('a HARD restart: KILLS names only the attached work, the detached part is a separate, checkable prediction', () => {
    const mixed = {
      backgroundWork: 3,
      backgroundWorkDetail: '2 in the pane (shells / monitors / sub-agents); heavy-run: friday-b24gate',
      detachedWork: 1,
      detachedWorkDetail: 'heavy-run: friday-b24gate',
      killedWorkDetail: '2 in the pane (shells / monitors / sub-agents)',
    }
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ pct: 0.99, ...mixed }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toBe(
      'hard threshold (99% >= 97%) -- KILLS running background work: 2 (2 in the pane (shells / monitors / sub-agents))' +
        ' -- detached from the pane, expected to SURVIVE the restart (check with ps before re-running): 1 (heavy-run: friday-b24gate)',
    )
  })

  it('only detached work: no KILLS at all, the prediction alone', () => {
    const only = { backgroundWork: 1, backgroundWorkDetail: 'heavy-run: didi-dd90 (queued)', detachedWork: 1, detachedWorkDetail: 'heavy-run: didi-dd90 (queued)', killedWorkDetail: '' }
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ pct: 0.99, ...only }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).not.toContain('KILLS')
    expect(d.reason).toContain('expected to SURVIVE the restart (check with ps before re-running): 1 (heavy-run: didi-dd90 (queued))')
  })

  it('CONTROL: a routine restart still HOLDS for detached work (the hold protects the gate, only the wording changed)', () => {
    const only = { backgroundWork: 1, backgroundWorkDetail: 'heavy-run: didi-dd90 (queued)', detachedWork: 1, detachedWorkDetail: 'heavy-run: didi-dd90 (queued)', killedWorkDetail: '' }
    const d = decideGuard(awaiting, inputs({ handoffMtime: 200, paneIdle: true, ...only }), CFG)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('background work is running: 1 (heavy-run: didi-dd90 (queued)) -- holding the restart')
  })

  it('REAL processes: a child of this process is in its tree, a double-forked one (parent gone, reparented) is not', async () => {
    const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' })
    // sh starts sleep in the background and exits at once: the orphan is reparented (to launchd/init
    // or a subreaper), like a gate whose launcher finished.
    const orphan = parseInt(execFileSync('/bin/sh', ['-c', '/bin/sleep 30 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' }).trim(), 10)
    try {
      const table = readParentTable()
      expect(table, 'ps snapshot').not.toBeNull()
      expect(table!.get(child.pid!)).toBe(process.pid) // positive control: the snapshot sees the link
      expect(descendsFrom(child.pid!, process.pid, table!)).toBe(true)
      expect(descendsFrom(orphan, process.pid, table!)).toBe(false)
    } finally {
      child.kill('SIGKILL')
      try { process.kill(orphan, 'SIGKILL') } catch { /* already gone */ }
    }
  })
})
