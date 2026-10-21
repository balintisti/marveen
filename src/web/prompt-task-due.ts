import { CronExpressionParser } from 'cron-parser'
import type { ScheduledTask } from './scheduled-tasks-io.js'
import { TURES_MS } from './command-health-age.js'

/**
 * Missed-run alert for prompt-type scheduled tasks (card 997515c0, option A of
 * 02f336c3).
 *
 * THE GAP. A `command` task carries a failure streak and a Telegram alert
 * (command-task.ts), and `/api/schedules` derives a staleness verdict for it
 * (command-health-age.ts). A prompt task (type `task`, `heartbeat`,
 * `dream-engine`) had neither: the runner injects text into a pane and records
 * `last_skipped_at` -- the LAST skip only. Measured 2026-10-20: the bug-hunt
 * round's hourly stepper was held back three times by the quota gate and nobody
 * heard about it; `varakozo-alagens-meres` had been quota-skipped since 10-10
 * with the history of 10-11..10-14 unrecoverable because only the last skip was
 * kept.
 *
 * TWO SIGNALS, ONE ALERT.
 *  - DUE-CHECK (derived at read time, like assessCommandHealth): how many
 *    scheduled slots lie between the last real firing and now, beyond the
 *    tolerance? That catches every way a run can fail to happen, including the
 *    ones nothing records (delivery stuck, scheduler path never reached).
 *  - SKIP STREAK (stored by the runner, schedule-runner.ts recordScheduleOutcome):
 *    consecutive held-back ticks, reset by a real firing. It names the REASON.
 *
 * PRECHECK-CRON EXCLUSION. A task with a pre-check legitimately does not fire
 * on a quiet tick (`precheck-cron` skip, nothing to do). Counting slots for it
 * would alarm on every healthy quiet period, so for those the count is the
 * recorded streak of work that was HELD BACK (quota), which a precheck-cron
 * skip never increments.
 *
 * ALERT SHAPE mirrors the command path: once when the count first reaches the
 * threshold (`failThreshold`, default 2 -- the same default as command tasks),
 * once on recovery. The "already alerted" mark lives with the stored outcome so
 * a dashboard restart does not alert twice.
 */

export const DUE_CHECK_INTERVAL_MS = 60_000
export const DEFAULT_DUE_THRESHOLD = 2
/** Counting stops here: past it the exact number adds nothing and costs a tick. */
const SLOT_COUNT_CAP = 200

export interface DueOutcome {
  lastFiredAt?: number
  lastSkippedAt?: number
  lastSkipReason?: string
  /** Consecutive held-back ticks since the last real firing (not precheck-cron). */
  skipStreak?: number
  /** When the missed-run alert for the current episode was sent. */
  dueAlertedAt?: number
}

export type DueVerdict = 'not-applicable' | 'ok' | 'overdue' | 'unknown'

export interface DueAssessment {
  verdict: DueVerdict
  /** Runs that did not happen (slots for plain tasks, recorded skips for precheck tasks). */
  count: number
  threshold: number
  /** Human reason, in Hungarian: it goes to the owner. */
  reason: string
}

function slotsMissed(schedule: string, sinceMs: number, untilMs: number, tz?: string): number | null {
  try {
    const it = CronExpressionParser.parse(schedule, { currentDate: new Date(sinceMs), ...(tz ? { tz } : {}) })
    let n = 0
    while (n < SLOT_COUNT_CAP) {
      const next = it.next().getTime()
      if (next > untilMs) break
      n++
    }
    return n
  } catch {
    return null
  }
}

const SKIP_REASON_HU: Record<string, string> = {
  quota: 'keret-kapu (quota)',
}

/**
 * The skip streak after one more tick outcome. A real firing ends it. A
 * precheck-cron skip also ends it: nothing was due, so nothing is held back any
 * more (and it must never EXTEND a streak -- that is the exclusion). Any other
 * skip reason (the quota gate) is due work deliberately not done: it counts.
 */
export function nextSkipStreak(
  prev: number | undefined,
  kind: 'fired' | 'skipped',
  reason?: string,
): number | undefined {
  if (kind === 'fired' || reason === 'precheck-cron') return undefined
  return (prev ?? 0) + 1
}

export function assessPromptTaskDue(
  task: ScheduledTask,
  outcome: DueOutcome | undefined,
  now: number,
  floorMs: number,
  tz?: string,
): DueAssessment {
  const threshold = task.failThreshold && task.failThreshold > 0 ? task.failThreshold : DEFAULT_DUE_THRESHOLD
  if (task.type === 'command' || !task.enabled) {
    return { verdict: 'not-applicable', count: 0, threshold, reason: 'nem prompt-tipusu vagy letiltott feladat' }
  }
  const streak = outcome?.skipStreak && outcome.skipStreak > 0 ? outcome.skipStreak : 0
  const skipReason = streak > 0 ? (outcome?.lastSkipReason ?? 'ismeretlen') : null

  let count: number
  if (task.preCheck) {
    count = streak
  } else {
    // Slots before the last real firing, before the task existed, or before
    // this scheduler process started scanning are not ours to count: the
    // catch-up path owns the gap a restart or a sleep leaves.
    const since = Math.max(outcome?.lastFiredAt ?? 0, (task.createdAt || 0) * 1000, floorMs)
    const missed = slotsMissed(task.schedule, since, now - TURES_MS, tz)
    if (missed === null) {
      return { verdict: 'unknown', count: 0, threshold, reason: `az utemezes nem ertelmezheto (${task.schedule})` }
    }
    count = missed
  }

  if (count < threshold) {
    return { verdict: 'ok', count, threshold, reason: 'nincs egymas utani kimaradt futas a kuszob felett' }
  }
  const why = skipReason
    ? `${streak} egymás utáni kihagyás, ok: ${SKIP_REASON_HU[skipReason] ?? skipReason}`
    : 'nincs rögzített kihagyás, a futás nem indult el (ütemező vagy kézbesítési hiba)'
  return { verdict: 'overdue', count, threshold, reason: why }
}

export function formatDueAlert(
  task: ScheduledTask,
  a: DueAssessment,
  lastFiredAt: number | undefined,
  fmt: (ms: number) => string,
): string {
  const last = lastFiredAt === undefined ? 'még soha' : fmt(lastFiredAt)
  return `\u{1F534} Kimaradt futás: ${task.name}: ${a.count} menetrend szerinti futás nem történt meg egymás után. `
    + `Ok: ${a.reason}. Utolsó tényleges futás: ${last}.`
}

export function formatDueRecovery(task: ScheduledTask): string {
  return `\u{1F7E2} Helyreállt: ${task.name} újra fut.`
}

export interface DueCheckDeps {
  tasks: ScheduledTask[]
  now: number
  floorMs: number
  tz?: string
  /** Tasks whose retry is queued are owned by the retry/aged-alert path. */
  hasPendingRetry: (taskName: string) => boolean
  readOutcome: (taskName: string) => DueOutcome | undefined
  setAlerted: (taskName: string, at: number | null) => void
  send: (text: string) => void
  fmt: (ms: number) => string
}

export type DueAction = { task: string; action: 'alert' | 'recover'; count: number }

/** One pass over the tasks. Edge-triggered: an unchanged state sends nothing. */
export function runPromptTaskDueCheck(d: DueCheckDeps): DueAction[] {
  const actions: DueAction[] = []
  for (const task of d.tasks) {
    if (task.type === 'command' || !task.enabled) continue
    if (d.hasPendingRetry(task.name)) continue
    const outcome = d.readOutcome(task.name)
    const a = assessPromptTaskDue(task, outcome, d.now, d.floorMs, d.tz)
    if (a.verdict === 'unknown') continue
    const alerted = outcome?.dueAlertedAt !== undefined
    if (a.verdict === 'overdue' && !alerted) {
      d.setAlerted(task.name, d.now)
      d.send(formatDueAlert(task, a, outcome?.lastFiredAt, d.fmt))
      actions.push({ task: task.name, action: 'alert', count: a.count })
    } else if (a.verdict === 'ok' && alerted) {
      d.setAlerted(task.name, null)
      d.send(formatDueRecovery(task))
      actions.push({ task: task.name, action: 'recover', count: a.count })
    }
  }
  return actions
}
