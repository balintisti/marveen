import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isPreCheckHit,
  mergeRetryPrefix,
  quotaWorkClass,
  shouldDropBusyTick,
} from '../web/schedule-runner.js'
import { decideQuotaAction, type QuotaSnapshot } from '../quota-gate.js'

// Card 22d7f41e. A pre-check HIT is owner-facing work, and it could still be
// thrown away in three places, because the ledger-live-drain pre-check CONSUMES
// what it surfaces (the message id goes into a dedup statefile):
//
//   1. the quota gate ran BEFORE the pre-check, so the free check never looked
//      (2026-09-12 .. 09-24, every tick);
//   2. skipIfBusy dropped the tick after the hit was consumed, on the premise
//      that "the next tick is on the way" -- the next tick's dedup says SKIP.
//      Live instance 2026-09-24: message 3368 surfaced at 08:28:10, and the same
//      second's tick is `skipped / busy` in task_runs;
//   3. the retry loop re-ran the pre-check instead of carrying the prefix, so
//      queueing the hit only moved the drop one step later.
//
// The decision (marveen, 2026-09-24) is shape (a): a hit escapes the gate AND
// skipIfBusy, and the retry carries the prefix. Shape (b) -- mark "surfaced"
// only after delivery -- is structurally better and was NOT taken: it needs a
// definition of delivery the drain does not have, and getting it wrong fails
// toward re-surfacing an answered message into the owner's channel. If (a)
// leaks, (b) is the next step.

const SRC = readFileSync(join(__dirname, '../web/schedule-runner.ts'), 'utf-8')
const NOW = Date.UTC(2026, 8, 20, 16, 20, 0)

/** The snapshot on disk on 2026-09-20: seven_day at 98, fresh, authoritative. */
function pressured(usedPercent = 98): QuotaSnapshot {
  return {
    source: 'authoritative',
    generatedAtMs: NOW - 60_000,
    windows: { seven_day: { used_percent: usedPercent, resets_at: null } },
  }
}

// Synthetic ids and text: this repo is public, and a real chat id or a real message has no place in it.
const HIT = { skip: false, prefix: 'OPEN_QUESTION chat_id=100000001 message_id=42\na synthetic open question' }

describe('isPreCheckHit', () => {
  it('a surfaced question is a hit', () => {
    expect(isPreCheckHit(HIT)).toBe(true)
  })

  it('NEGATIVE: SKIP, an empty run and a failed-open run are not hits', () => {
    // runPreCheck returns { skip: false } with no prefix for empty stdout AND for
    // a non-zero exit. Neither proves anyone is waiting, so neither may escape
    // the gate -- otherwise a broken pre-check would buy a free pass.
    expect(isPreCheckHit({ skip: true })).toBe(false)
    expect(isPreCheckHit({ skip: false })).toBe(false)
    expect(isPreCheckHit({ skip: false, prefix: '   \n ' })).toBe(false)
  })
})

describe('a hit escapes the quota gate at real pressure', () => {
  it('the same heartbeat is deferred without a hit and runs with one, at 98 percent', () => {
    // Through the REAL gate, not the class label alone: the class could be right
    // and the gate could still defer, and only the pair proves the tick runs.
    const without = decideQuotaAction({ snapshot: pressured(), nowMs: NOW, workClass: quotaWorkClass({ type: 'heartbeat' }) })
    const withHit = decideQuotaAction({ snapshot: pressured(), nowMs: NOW, workClass: quotaWorkClass({ type: 'heartbeat' }, true) })
    expect(without.action).toBe('defer')
    expect(withHit.action).toBe('run')
  })

  it('NEGATIVE: the default is unchanged -- no hit means background, as before', () => {
    expect(quotaWorkClass({ type: 'heartbeat' })).toBe('background')
    expect(quotaWorkClass({ type: 'heartbeat' }, false)).toBe('background')
  })

  it('a hit cannot reclassify a free command task', () => {
    // A shell command costs no tokens; calling it owner-facing would only make
    // the gate's reason string lie.
    expect(quotaWorkClass({ type: 'command' }, true)).toBe('free')
  })
})

describe('shouldDropBusyTick', () => {
  const short = { skipIfBusy: true, forceSend: false, schedule: '*/2 * * * *' }

  it('CONTROL: a short-cadence busy tick WITHOUT a hit is still dropped', () => {
    // The flag exists for exactly this (spurious "60 perce varakozik" alerts on
    // 2-minute heartbeats). The fix must not quietly turn it off.
    expect(shouldDropBusyTick(short, NOW, false)).toBe(true)
  })

  it('a busy tick WITH a hit is never dropped', () => {
    expect(shouldDropBusyTick(short, NOW, true)).toBe(false)
  })

  it('keeps the existing exemptions', () => {
    expect(shouldDropBusyTick({ ...short, forceSend: true }, NOW, false)).toBe(false)
    expect(shouldDropBusyTick({ ...short, skipIfBusy: false }, NOW, false)).toBe(false)
  })
})

describe('mergeRetryPrefix', () => {
  it('stores the first hit as-is', () => {
    expect(mergeRetryPrefix(undefined, 'A')).toBe('A')
  })

  it('a second question while the first waits keeps BOTH, oldest first', () => {
    // The drain surfaces only the LATEST open inbound. If the retry still holds
    // the earlier one, overwriting it would lose it -- the dedup already spent it.
    expect(mergeRetryPrefix('A', 'B')).toBe('A\n\nB')
  })

  it('re-surfacing something already held is a no-op', () => {
    expect(mergeRetryPrefix('A', 'A')).toBe('A')
    expect(mergeRetryPrefix('A\n\nB', 'A')).toBe('A\n\nB')
  })
})

// Wiring. ORDER, not presence: every name below already exists somewhere in the
// file, so a presence check would pass on the old code too. Each assertion is
// scoped to one loop and compares positions inside it.
describe('schedule-runner wiring (order inside each loop)', () => {
  const cronStart = SRC.indexOf('for (const task of tasks)')
  const retryStart = SRC.indexOf('for (const row of pendingRows)')
  const cron = SRC.slice(cronStart)
  const retry = SRC.slice(retryStart, cronStart)

  it('finds both loops (positive control)', () => {
    expect(cronStart).toBeGreaterThan(0)
    expect(retryStart).toBeGreaterThan(0)
    expect(retryStart).toBeLessThan(cronStart)
  })

  it('cron: the pre-check runs BEFORE the quota gate, and the hit reaches the gate', () => {
    expect(cron.indexOf('const cronPc = runPreCheck(task)')).toBeLessThan(cron.indexOf("if (quota.action === 'defer')"))
    expect(cron.indexOf('const preCheckHit = isPreCheckHit(cronPc)')).toBeLessThan(cron.indexOf('workClass: quotaWorkClass(task, preCheckHit)'))
    expect(cron).toContain('workClass: quotaWorkClass(task, preCheckHit)')
  })

  it('cron: the hit is remembered BEFORE the pending-key shortcut and before firing', () => {
    const remember = cron.indexOf('if (preCheckHit) rememberRetryPrefix(key, cronPc.prefix as string)')
    expect(remember).toBeGreaterThan(0)
    expect(remember).toBeLessThan(cron.indexOf('if (pendingKeys.has(key))'))
    expect(remember).toBeLessThan(cron.indexOf('attemptFireTask(task,'))
  })

  it('cron: the busy drop goes through shouldDropBusyTick with the hit', () => {
    expect(cron).toContain('if (shouldDropBusyTick(task, now, preCheckHit))')
    expect(cron).not.toContain('if (task.skipIfBusy && !task.forceSend && skipIfBusyIsSafe(task.schedule, now))')
  })

  it('cron: a hit that did not fire always gets a row to ride on', () => {
    expect(cron).toContain("if (preCheckHit && result !== 'fired') insertPendingTaskRetryIfNew(task.name, agentName, now, result)")
  })

  it('retry: a stored hit is used INSTEAD of re-running the pre-check', () => {
    const stored = retry.indexOf('const storedHit = retryPrefix.get(key)')
    expect(stored).toBeGreaterThan(0)
    expect(stored).toBeLessThan(retry.indexOf('runPreCheck(taskDef)'))
    expect(retry).toContain('storedHit !== undefined ? { skip: false, prefix: storedHit } : runPreCheck(taskDef)')
  })

  it('both loops clear the stored hit when it is delivered', () => {
    const retryFired = retry.slice(retry.indexOf("if (result === 'fired')"))
    expect(retryFired.slice(0, retryFired.indexOf('continue'))).toContain('clearRetryPrefix(key)')
    const cronFired = cron.slice(cron.indexOf("if (result === 'fired')"))
    expect(cronFired.slice(0, cronFired.indexOf("else if (result === 'starting')"))).toContain('clearRetryPrefix(key)')
  })
})
