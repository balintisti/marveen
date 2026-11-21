// Card cb25d896: a WRITTEN handoff's restart waited up to BACKGROUND_DEFER_MAX_MS for any footer shell,
// because the footer only counts them. zara's idle `python3 -m http.server` held her restart 45-55
// minutes three times on 2026-11-18. Behind a written handoff a shell idle by CPU (the runner's verdict,
// BackgroundShellCpu) no longer holds; the restart names every such shell with its command line. A
// verdict that is missing or failed holds exactly as before, and so do sub-agent rows and heavy-run jobs.
import { describe, it, expect } from 'vitest'
import {
  BACKGROUND_DEFER_MAX_MS,
  DEFAULT_CONTEXT_GUARD,
  IDLE_SHELL_COMMAND_MAX_CHARS,
  INITIAL_GUARD_STATE,
  decideGuard,
  restartNoticeIsLogOnly,
  type ContextGuardConfig,
  type GuardInputs,
  type GuardState,
} from '../context-guard.js'

const CFG: ContextGuardConfig = { ...DEFAULT_CONTEXT_GUARD, enabled: true }
const NOW = 1_000_000_000
const MIN = 60_000
const SERVER = 'cd /Users/isti/zara-site && python3 -m http.server 8765'
const POLL = 'until [ -f /tmp/ci.done ]; do sleep 20; done; echo CI_DONE'

function inputs(overrides: Partial<GuardInputs> = {}): GuardInputs {
  return {
    nowMs: NOW, pct: 0.8, running: true, paneIdle: true, paneBusy: false, sessionReady: false,
    handoffMtime: 200, paneSaturated: false, dailyHandoffDue: false, contextTokens: null, idleMs: null,
    ...overrides,
  }
}

const awaiting: GuardState = {
  phase: 'await-handoff', handoffMtimeAtRequest: 100, deadlineMs: NOW + 10 * MIN, cooldownUntilMs: 0,
  saturatedStreak: 0, staleRefreshCount: 0, handoffStaleMinutes: null,
}
const ONE_SHELL = { backgroundWork: 1, backgroundWorkDetail: '1 in the pane (shells / monitors / sub-agents)' }
const TWO = { backgroundWork: 2, backgroundWorkDetail: '2 in the pane (shells / monitors / sub-agents)' }

describe('behind a written handoff, a shell idle by CPU does not hold the restart', () => {
  it('CONTROL: the same shell without a CPU verdict holds, as before', () => {
    const d = decideGuard(awaiting, inputs({ ...ONE_SHELL }), CFG)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('holding the restart')
  })

  it('an idle http.server: the restart goes ahead and names it, command line and all', () => {
    const d = decideGuard(awaiting, inputs({ ...ONE_SHELL, backgroundShellCpu: { ok: true, idle: [SERVER] } }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toContain('did not wait for 1 background shell(s) idle by CPU')
    expect(d.reason).toContain(`idle shell \`${SERVER}\``)
    expect(d.reason).toContain('re-arm what is still needed')
  })

  it('a sleeping poll loop is released WITH its name, so the fresh session can re-arm it', () => {
    const d = decideGuard(awaiting, inputs({ ...TWO, backgroundShellCpu: { ok: true, idle: [SERVER, POLL] } }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toContain(`idle shell \`${SERVER}\``)
    expect(d.reason).toContain(`idle shell \`${POLL}\``)
    expect(d.reason).toContain('KILLS running background work: 2')
  })

  it('the release is not log-only: the restart notice reports the killed shells', () => {
    const d = decideGuard(awaiting, inputs({ ...ONE_SHELL, backgroundShellCpu: { ok: true, idle: [POLL] } }), CFG)
    expect(restartNoticeIsLogOnly(false, null, d.reason)).toBe(false)
  })

  it('after a hold for other work, the release says how long it held', () => {
    const d = decideGuard({ ...awaiting, backgroundDeferSinceMs: NOW - 12 * MIN }, inputs({ ...ONE_SHELL, backgroundShellCpu: { ok: true, idle: [SERVER] } }), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toContain('after holding 12m')
  })

  it('a multi-line command is named on one line, with its newlines marked; a long one is cut', () => {
    const long = 'x'.repeat(IDLE_SHELL_COMMAND_MAX_CHARS + 50)
    const d = decideGuard(awaiting, inputs({ ...TWO, backgroundShellCpu: { ok: true, idle: ['cd /a\nuntil false; do sleep 5; done', long] } }), CFG)
    expect(d.reason).toContain('cd /a ⏎ until false; do sleep 5; done')
    expect(d.reason).toContain(`${'x'.repeat(IDLE_SHELL_COMMAND_MAX_CHARS)}…`)
    expect(d.reason).not.toContain('x'.repeat(IDLE_SHELL_COMMAND_MAX_CHARS + 1))
  })
})

describe('what still holds', () => {
  it('a working shell next to an idle one: holds, and says the idle one is not waited for', () => {
    const d = decideGuard(awaiting, inputs({ ...TWO, backgroundShellCpu: { ok: true, idle: [SERVER] } }), CFG)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('1 of it idle by CPU, not waited for')
    expect(d.nextState.backgroundDeferSinceMs).toBe(NOW)
  })

  it('a running vitest (no idle shell in the verdict) holds', () => {
    const d = decideGuard(awaiting, inputs({ ...ONE_SHELL, backgroundShellCpu: { ok: true, idle: [] } }), CFG)
    expect(d.action).toBe('none')
  })

  it('a sub-agent row next to an idle shell holds: sub-agents are API-bound, their CPU says nothing', () => {
    const d = decideGuard(awaiting, inputs({
      backgroundWork: 2, backgroundWorkDetail: '2 in the pane (shells / monitors / sub-agents)',
      backgroundShellCpu: { ok: true, idle: [SERVER] },
    }), CFG)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('holding the restart')
  })

  it('a heavy-run job next to an idle shell holds (its CPU runs as a launchd job, outside the shell)', () => {
    const d = decideGuard(awaiting, inputs({
      backgroundWork: 2, backgroundWorkDetail: '1 in the pane (shells / monitors / sub-agents); heavy-run: dexter gate',
      backgroundShellCpu: { ok: true, idle: ['python3 /Users/isti/marveen/scripts/heavy-run.py --label "dexter gate" -- npx vitest run'] },
    }), CFG)
    expect(d.action).toBe('none')
  })

  it('a verdict that names more idle shells than there is work is inconsistent: holds', () => {
    const d = decideGuard(awaiting, inputs({ ...ONE_SHELL, backgroundShellCpu: { ok: true, idle: [SERVER, POLL] } }), CFG)
    expect(d.action).toBe('none')
  })
})

describe('a CPU measurement that failed holds as before (max BACKGROUND_DEFER_MAX_MS), never a silent release', () => {
  const failed = (why: string) => inputs({ ...ONE_SHELL, backgroundShellCpu: { ok: false, why } })
  it.each([
    ['ps failed'],
    ['pane process not found'],
    ['the footer counts 1 shell(s)/monitor(s), the process table has 0'],
    ['the footer counts 1 shell(s)/monitor(s), the process table has 2'],
    ['1 sub-agent(s) running, their shells look the same in ps'],
    ['no CPU verdict yet for 1 shell(s): the first sample is younger than 9m'],
  ])('%s: holds, and the reason says the CPU was not judged', (why) => {
    const d = decideGuard(awaiting, failed(why), CFG)
    expect(d.action).toBe('none')
    expect(d.reason).toContain(`shell CPU not judged (${why}), every shell holds`)
  })

  it('...and at the bound it restarts exactly as before, naming what it kills', () => {
    const d = decideGuard({ ...awaiting, backgroundDeferSinceMs: NOW - BACKGROUND_DEFER_MAX_MS }, failed('ps failed'), CFG)
    expect(d.action).toBe('restart')
    expect(d.reason).toContain('the 45m bound is reached')
    expect(d.reason).toContain('KILLS running background work: 1')
  })
})

describe('only a WRITTEN handoff reads the verdict', () => {
  it('handoff not written yet, timeout reached: an idle shell still holds (the timeout path is unchanged)', () => {
    const d = decideGuard({ ...awaiting, deadlineMs: NOW - 1 }, inputs({ handoffMtime: 100, ...ONE_SHELL, backgroundShellCpu: { ok: true, idle: [SERVER] } }), CFG)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('handoff timeout, but background work is running')
  })

  it('idle phase: idle-flush still does not START while an idle shell runs (CONTROL: with nothing running it does)', () => {
    const cfg: ContextGuardConfig = { ...CFG, idleFlushEnabled: true, idleFlushTokens: 150_000, idleMinutes: 60 }
    const quiet = { pct: 0.3, handoffMtime: null, contextTokens: 160_000, idleMs: 70 * MIN }
    expect(decideGuard(INITIAL_GUARD_STATE, inputs({ ...quiet }), cfg).action).toBe('request-handoff')
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ ...quiet, ...ONE_SHELL, backgroundShellCpu: { ok: true, idle: [SERVER] } }), cfg)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('not starting a handoff')
  })
})
