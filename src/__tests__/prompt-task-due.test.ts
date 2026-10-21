import { describe, expect, it, vi } from 'vitest'
import {
  assessPromptTaskDue,
  formatDueAlert,
  nextSkipStreak,
  runPromptTaskDueCheck,
  type DueOutcome,
} from '../web/prompt-task-due.js'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'

// Card 997515c0 (option A of 02f336c3): prompt-type scheduled tasks get the
// missed-run signal command tasks already had. Explicit zone on every case: a
// cron is read in local wall-clock time, so a test that leans on the host zone
// asserts something different on another machine.
const TZ = 'Europe/Budapest'
const T = (s: string) => new Date(s).getTime()

function task(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    name: 'bug-hunt-stepper',
    description: 'stepper',
    prompt: 'go',
    schedule: '0 * * * *', // hourly
    agent: 'marveen',
    enabled: true,
    createdAt: 0,
    type: 'heartbeat',
    ...over,
  }
}

// 2026-10-20 12:30 CEST. Hourly slots: 10:00, 11:00, 12:00 are behind us.
const NOW = T('2026-10-20T12:30:00+02:00')
const FLOOR = T('2026-10-20T00:00:00+02:00')

describe('nextSkipStreak', () => {
  it('counts quota skips and resets on a real firing', () => {
    let s = nextSkipStreak(undefined, 'skipped', 'quota')
    s = nextSkipStreak(s, 'skipped', 'quota')
    s = nextSkipStreak(s, 'skipped', 'quota')
    expect(s).toBe(3)
    expect(nextSkipStreak(s, 'fired')).toBeUndefined()
  })

  it('a precheck-cron skip never increments, and ends the streak', () => {
    expect(nextSkipStreak(undefined, 'skipped', 'precheck-cron')).toBeUndefined()
    expect(nextSkipStreak(2, 'skipped', 'precheck-cron')).toBeUndefined()
  })
})

describe('assessPromptTaskDue', () => {
  it('overdue: two hourly slots passed since the last firing, and the alert names task, count and reason', () => {
    const outcome: DueOutcome = {
      lastFiredAt: T('2026-10-20T09:00:05+02:00'),
      lastSkippedAt: T('2026-10-20T12:00:05+02:00'),
      lastSkipReason: 'quota',
      skipStreak: 3,
    }
    const a = assessPromptTaskDue(task(), outcome, NOW, FLOOR, TZ)
    expect(a.verdict).toBe('overdue')
    expect(a.count).toBe(3) // 10:00, 11:00, 12:00
    const text = formatDueAlert(task(), a, outcome.lastFiredAt, () => '2026-10-20 09:00')
    expect(text).toContain('bug-hunt-stepper')
    expect(text).toContain('3 menetrend szerinti futás')
    expect(text).toContain('3 egymás utáni kihagyás')
    expect(text).toContain('quota')
    expect(text).toContain('2026-10-20 09:00')
  })

  it('overdue with NO recorded skip: names the unexplained gap instead of a reason it cannot know', () => {
    const a = assessPromptTaskDue(task(), { lastFiredAt: T('2026-10-20T09:00:05+02:00') }, NOW, FLOOR, TZ)
    expect(a.verdict).toBe('overdue')
    expect(a.reason).toContain('nincs rögzített kihagyás')
  })

  it('ok: the last slot is inside the tolerance, and one missed slot is below the default threshold', () => {
    // Fired at 11:00; 12:00 slot is 30 min old -> 1 missed < 2.
    expect(assessPromptTaskDue(task(), { lastFiredAt: T('2026-10-20T11:00:05+02:00') }, NOW, FLOOR, TZ).verdict).toBe('ok')
    // Fired at 10:00, the 12:00 slot is only 5 min old (inside tolerance): 11:00 alone is 1.
    const early = T('2026-10-20T12:05:00+02:00')
    const a = assessPromptTaskDue(task(), { lastFiredAt: T('2026-10-20T10:00:05+02:00') }, early, FLOOR, TZ)
    expect(a.verdict).toBe('ok')
    expect(a.count).toBe(1)
  })

  it('a task-level failThreshold overrides the default, like a command task', () => {
    const o: DueOutcome = { lastFiredAt: T('2026-10-20T11:00:05+02:00') }
    expect(assessPromptTaskDue(task({ failThreshold: 1 }), o, NOW, FLOOR, TZ).verdict).toBe('overdue')
  })

  it('slots before the scheduler floor or before the task existed are not counted', () => {
    const o: DueOutcome = { lastFiredAt: T('2026-10-19T09:00:05+02:00') }
    expect(assessPromptTaskDue(task(), o, NOW, T('2026-10-20T12:10:00+02:00'), TZ).verdict).toBe('ok')
    const young = task({ createdAt: Math.floor(T('2026-10-20T12:10:00+02:00') / 1000) })
    expect(assessPromptTaskDue(young, undefined, NOW, FLOOR, TZ).verdict).toBe('ok')
  })

  it('never-fired task is judged from its creation, not reported as fine', () => {
    const born = task({ createdAt: Math.floor(T('2026-10-20T08:30:00+02:00') / 1000) })
    expect(assessPromptTaskDue(born, undefined, NOW, FLOOR, TZ).verdict).toBe('overdue')
  })

  it('PRECHECK-CRON EXCLUSION: a pre-check task that only skipped on precheck-cron is never overdue', () => {
    const pc = task({ preCheck: 'check.sh' })
    // Same stale firing that makes the plain task overdue.
    const o: DueOutcome = {
      lastFiredAt: T('2026-10-20T01:00:05+02:00'),
      lastSkippedAt: T('2026-10-20T12:00:05+02:00'),
      lastSkipReason: 'precheck-cron',
    }
    expect(assessPromptTaskDue(task(), o, NOW, FLOOR, TZ).verdict).toBe('overdue') // positive control
    expect(assessPromptTaskDue(pc, o, NOW, FLOOR, TZ).verdict).toBe('ok')
  })

  it('a pre-check task whose real work is held back by quota IS overdue, by its recorded streak', () => {
    const pc = task({ preCheck: 'check.sh' })
    const o: DueOutcome = { lastSkippedAt: NOW - 60_000, lastSkipReason: 'quota', skipStreak: 2 }
    const a = assessPromptTaskDue(pc, o, NOW, FLOOR, TZ)
    expect(a.verdict).toBe('overdue')
    expect(a.count).toBe(2)
    expect(a.reason).toContain('quota')
  })

  it('command-type behaviour is untouched: not applicable, never overdue; disabled likewise', () => {
    const stale: DueOutcome = { lastFiredAt: T('2026-10-01T00:00:00+02:00') }
    expect(assessPromptTaskDue(task({ type: 'command' }), stale, NOW, FLOOR, TZ).verdict).toBe('not-applicable')
    expect(assessPromptTaskDue(task({ enabled: false }), stale, NOW, FLOOR, TZ).verdict).toBe('not-applicable')
  })

  it('an unparseable cron is unknown, not ok', () => {
    expect(assessPromptTaskDue(task({ schedule: 'not a cron' }), undefined, NOW, FLOOR, TZ).verdict).toBe('unknown')
  })
})

describe('runPromptTaskDueCheck', () => {
  function harness(t: ScheduledTask, outcome: DueOutcome | undefined, pending = false) {
    const store = new Map<string, DueOutcome>()
    if (outcome) store.set(t.name, { ...outcome })
    const send = vi.fn()
    const deps = (now: number, floorMs: number) => ({
      tasks: [t], now, floorMs, tz: TZ,
      hasPendingRetry: () => pending,
      readOutcome: (n: string) => store.get(n),
      setAlerted: (n: string, at: number | null) => {
        const e = { ...(store.get(n) ?? {}) }
        if (at === null) delete e.dueAlertedAt
        else e.dueAlertedAt = at
        store.set(n, e)
      },
      send,
      fmt: (ms: number) => new Date(ms).toISOString(),
    })
    return { store, send, run: (now: number, floorMs: number = FLOOR) => runPromptTaskDueCheck(deps(now, floorMs)) }
  }
  const stale: DueOutcome = {
    lastFiredAt: T('2026-10-20T09:00:05+02:00'), lastSkippedAt: T('2026-10-20T12:00:05+02:00'),
    lastSkipReason: 'quota', skipStreak: 3,
  }

  it('alerts once per episode, then stays quiet while the state is unchanged', () => {
    const h = harness(task(), stale)
    expect(h.run(NOW)).toEqual([{ task: 'bug-hunt-stepper', action: 'alert', count: 3 }])
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send.mock.calls[0][0]).toContain('bug-hunt-stepper')
    expect(h.run(NOW + 60_000)).toEqual([])
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('sends exactly one recovery once a real firing follows the alert, and clears the mark', () => {
    const h = harness(task(), stale)
    h.run(NOW)
    const alertedAt = h.store.get('bug-hunt-stepper')!.dueAlertedAt!
    h.store.set('bug-hunt-stepper', { ...h.store.get('bug-hunt-stepper')!, lastFiredAt: alertedAt + 1000, skipStreak: undefined })
    expect(h.run(NOW + 60_000)).toEqual([{ task: 'bug-hunt-stepper', action: 'recover', count: 0 }])
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.send.mock.calls[1][0]).toContain('Helyreállt')
    expect(h.store.get('bug-hunt-stepper')!.dueAlertedAt).toBeUndefined()
    expect(h.run(NOW + 120_000)).toEqual([])
    expect(h.send).toHaveBeenCalledTimes(2)
  })

  // The measured bug (trillian probe on 684865c5e): after a restart the floor is
  // "now", the missed-slot count drops to 0, and the old code read that as recovery.
  it('RESTART REGRESSION: alerted, still not firing, floor reset -> no recovery, no second alert, mark kept', () => {
    const h = harness(task(), stale)
    h.run(NOW) // the one alert
    const mark = h.store.get('bug-hunt-stepper')!.dueAlertedAt
    expect(mark).toBe(NOW)
    const restartFloor = NOW + 60_000
    // Right after the restart: 0 slots counted (verdict would be ok).
    expect(assessPromptTaskDue(task(), h.store.get('bug-hunt-stepper'), NOW + 120_000, restartFloor, TZ).verdict).toBe('ok')
    expect(h.run(NOW + 120_000, restartFloor)).toEqual([])
    // Hours later the slots count again (verdict overdue) -- still no second alert.
    expect(assessPromptTaskDue(task(), h.store.get('bug-hunt-stepper'), NOW + 4 * 3_600_000, restartFloor, TZ).verdict).toBe('overdue')
    expect(h.run(NOW + 4 * 3_600_000, restartFloor)).toEqual([])
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.store.get('bug-hunt-stepper')!.dueAlertedAt).toBe(mark)
  })

  it('a firing that predates the alert is not recovery evidence', () => {
    const h = harness(task(), { ...stale, dueAlertedAt: NOW })
    expect(h.run(NOW + 60_000)).toEqual([])
    expect(h.send).not.toHaveBeenCalled()
  })

  // trillian probe on be871c84e: for a pre-check task only a real firing cleared
  // the mark, so a second quota episode after a quiet spell was never alerted.
  describe('pre-check task: a precheck-cron skip after the alert ends the episode', () => {
    const pcStale: DueOutcome = { ...stale, skipStreak: 4 }
    const quiet = (o: DueOutcome, at: number): DueOutcome =>
      ({ ...o, lastSkippedAt: at, lastSkipReason: 'precheck-cron', skipStreak: undefined })

    it('recovers on the quiet skip, then alerts the SECOND quota episode', () => {
      const pc = task({ preCheck: 'check.sh' })
      const h = harness(pc, pcStale)
      expect(h.run(NOW)).toEqual([{ task: 'bug-hunt-stepper', action: 'alert', count: 4 }])
      h.store.set(pc.name, quiet(h.store.get(pc.name)!, NOW + 30_000))
      expect(h.run(NOW + 60_000)).toEqual([{ task: 'bug-hunt-stepper', action: 'recover', count: 0 }])
      expect(h.send.mock.calls[1][0]).toContain('Helyreállt')
      expect(h.send.mock.calls[1][0]).toContain('nincs több visszatartott futás')
      expect(h.store.get(pc.name)!.dueAlertedAt).toBeUndefined()
      // A new quota episode, no firing in between: alerted again.
      h.store.set(pc.name, { ...h.store.get(pc.name)!, lastSkippedAt: NOW + 3_600_000, lastSkipReason: 'quota', skipStreak: 2 })
      expect(h.run(NOW + 3_600_000 + 60_000)).toEqual([{ task: 'bug-hunt-stepper', action: 'alert', count: 2 }])
      expect(h.send).toHaveBeenCalledTimes(3)
    })

    it('a streak still running is no evidence: mark kept, nothing sent', () => {
      const pc = task({ preCheck: 'check.sh' })
      const h = harness(pc, { ...pcStale, dueAlertedAt: NOW, lastSkippedAt: NOW + 30_000, skipStreak: 5 })
      expect(h.run(NOW + 60_000)).toEqual([])
      expect(h.send).not.toHaveBeenCalled()
      expect(h.store.get(pc.name)!.dueAlertedAt).toBe(NOW)
    })

    it('a quiet skip that predates the alert is no evidence', () => {
      const pc = task({ preCheck: 'check.sh' })
      const h = harness(pc, { ...quiet(pcStale, NOW - 60_000), dueAlertedAt: NOW })
      expect(h.run(NOW + 60_000)).toEqual([])
      expect(h.send).not.toHaveBeenCalled()
    })

    it('a plain task is not cleared by a skip without a streak (its count is floor-relative)', () => {
      const h = harness(task(), { ...quiet(stale, NOW + 30_000), dueAlertedAt: NOW })
      expect(h.run(NOW + 60_000)).toEqual([])
      expect(h.send).not.toHaveBeenCalled()
      expect(h.store.get('bug-hunt-stepper')!.dueAlertedAt).toBe(NOW)
    })
  })

  it('a task with a queued retry is left to the retry path', () => {
    const h = harness(task(), stale, true)
    expect(h.run(NOW)).toEqual([])
    expect(h.send).not.toHaveBeenCalled()
  })

  it('command tasks are never alerted here', () => {
    const h = harness(task({ type: 'command' }), stale)
    expect(h.run(NOW)).toEqual([])
    expect(h.send).not.toHaveBeenCalled()
  })
})
