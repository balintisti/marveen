// KILLSWITCH1022 follow-up (card 1befbdb3, didi F2): the freeze was checked at the
// START of a loop's tick only. A timer armed BEFORE the freeze still fired after
// it and typed into a session. Each delayed callback now checks the freeze
// itself, right before it types. Fake clock: arm, freeze, advance -> nothing is
// sent; the unfrozen control sends (so the silence is the freeze, not a wiring gap).
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const ROOT = mkTmp('fleet-freeze-delayed-')
mkdirSync(join(ROOT, 'store'), { recursive: true })

vi.mock('../config.js', async (orig) => ({
  ...(await orig<typeof import('../config.js')>()),
  PROJECT_ROOT: ROOT,
  STORE_DIR: join(ROOT, 'store'),
  MAIN_AGENT_ID: 'marveen',
}))
const directiveSpy = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => 'sent'))
vi.mock('../web/system-directive.js', () => ({ sendSystemDirective: directiveSpy }))
const tmuxSpy = vi.hoisted(() => vi.fn((..._a: unknown[]) => ''))
vi.mock('node:child_process', async (orig) => ({ ...(await orig<typeof import('node:child_process')>()), execFileSync: tmuxSpy }))
vi.mock('../web/session-send-lock.js', async (orig) => ({
  ...(await orig<typeof import('../web/session-send-lock.js')>()),
  withSessionSendLock: async (_s: string, _h: unknown, _m: string, fn: () => unknown) => ({ ran: true, value: await fn() }),
}))

const { performSoftClear } = await import('../web/context-restart-gate-runner.js')
const { readGateRunState } = await import('../web/context-restart-gate-store.js')
const { onMainTurnEnded, scheduleHoldExpiry, MODEL_HOLD_FILE, _resetMainModelForTest } = await import('../web/main-model.js')
const { PENDING_WRITE_FILE } = await import('../web/pending-write.js')
const { FLEET_FREEZE_PATH } = await import('../web/fleet-freeze.js')
const { logger } = await import('../logger.js')

const freezeNow = () => writeFileSync(FLEET_FREEZE_PATH, JSON.stringify({ mode: 'freeze', reason: 'test', by: 'test', at: '' }))

beforeAll(() => { process.env.NODE_ENV = 'test' })
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-29T12:00:00Z'))
  rmSync(FLEET_FREEZE_PATH, { force: true })
  directiveSpy.mockClear(); tmuxSpy.mockClear()
})
afterEach(() => {
  scheduleHoldExpiry(null)
  vi.useRealTimers()
  rmSync(FLEET_FREEZE_PATH, { force: true })
  rmSync(MODEL_HOLD_FILE, { force: true })
  rmSync(PENDING_WRITE_FILE, { force: true })
})

describe('context-restart-gate: the wake nudge ~25 s after /clear', () => {
  async function softClear(freezeAfterClear: boolean): Promise<void> {
    const p = performSoftClear('samu', 'sess-samu', Date.now(), 400_000)
    // The /clear is typed synchronously inside the call; the nudge waits WAKE_DELAY_MS.
    await vi.advanceTimersByTimeAsync(0)
    if (freezeAfterClear) freezeNow()
    await vi.advanceTimersByTimeAsync(26_000)
    await p
  }

  it('control (not frozen): the nudge is sent and the debt cleared', async () => {
    await softClear(false)
    expect(directiveSpy).toHaveBeenCalledTimes(1)
    expect(readGateRunState('samu').pendingWakeAt).toBeNull()
  })

  it('frozen after the /clear, before the timer fires: nothing is typed and the debt stays', async () => {
    await softClear(true)
    expect(directiveSpy).not.toHaveBeenCalled()
    expect(readGateRunState('samu').pendingWakeAt).not.toBeNull()
  })
})

describe('main-model: the timers armed before a freeze', () => {
  const warnSpy = () => vi.spyOn(logger, 'warn')

  it('hold expiry: the sweep runs unfrozen (control, a corrupt hold is named) and does not run once frozen', async () => {
    writeFileSync(MODEL_HOLD_FILE, '{not json')
    const w = warnSpy()
    scheduleHoldExpiry(Date.now() + 1000)
    await vi.advanceTimersByTimeAsync(3000)
    expect(w.mock.calls.some((c) => String(c[1]).includes('hold file unreadable'))).toBe(true)

    w.mockClear()
    _resetMainModelForTest() // the corrupt-hold line is logged once; re-arm it so the frozen case could log
    scheduleHoldExpiry(Date.now() + 1000)
    freezeNow()
    await vi.advanceTimersByTimeAsync(3000)
    expect(w.mock.calls.some((c) => String(c[1]).includes('hold file unreadable'))).toBe(false)
    w.mockRestore()
  })

  it('pending write after a turn end: runs unfrozen (control: the file is consumed), stays queued once frozen', async () => {
    const queue = () => writeFileSync(PENDING_WRITE_FILE, JSON.stringify({ text: '/model opus', ownerId: 'x', queuedAt: Date.now(), deadline: Date.now() + 600_000 }))
    queue()
    expect(onMainTurnEnded(Date.now(), join(ROOT, 'none.json'))).toBe(true)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(existsSync(PENDING_WRITE_FILE)).toBe(false)

    queue()
    expect(onMainTurnEnded(Date.now(), join(ROOT, 'none.json'))).toBe(true)
    freezeNow()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(existsSync(PENDING_WRITE_FILE)).toBe(true)
    expect(JSON.parse(readFileSync(PENDING_WRITE_FILE, 'utf-8')).text).toBe('/model opus')
  })
})

describe('schedule-runner: the post-send resubmit chain (detached timers)', () => {
  // attemptFireTask is not exported and needs a live pane, so this one is pinned on the
  // source, in the shape that has the effect: the first statement of resubmit().
  const SRC = readFileSync(join(__dirname, '../web/schedule-runner.ts'), 'utf-8')
  it('resubmit() returns before touching the pane when frozen, and queues a retry instead of losing the task', () => {
    expect(SRC).toMatch(
      /const resubmit = async \(attempt: number, laneBusySkips = 0\): Promise<void> => \{\s*(?:\/\/[^\n]*\n\s*)*if \(frozenSkip\('schedule-resubmit'\)\) \{\s*insertPendingTaskRetryIfNew\(task\.name, agentName, now, 'frozen'\)\s*endDelivery\(\)\s*return\s*\}/,
    )
  })
})
