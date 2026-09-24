import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isPreCheckHit,
  mergeRetryPrefix,
  quotaWorkClass,
  shouldDropBusyTick,
  stillOpenHits,
  decideRetryPreCheck,
} from '../web/schedule-runner.js'
import { getDb, initDatabase, isLedgerInboundAnswered } from '../db.js'
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

  it('a question whose TEXT has blank lines is still recognised as held', () => {
    // A blank-line split would cut this one question into pieces and append it again.
    const q = 'OPEN_QUESTION chat_id=100000001 message_id=7\nfirst paragraph\n\nsecond paragraph'
    expect(mergeRetryPrefix(q, q)).toBe(q)
    expect(mergeRetryPrefix(`${q}\n\nOPEN_QUESTION chat_id=100000001 message_id=8\nx`, q)).toContain(q)
    expect(mergeRetryPrefix(`${q}\n\nOPEN_QUESTION chat_id=100000001 message_id=8\nx`, q).split(q).length).toBe(2)
  })
})

// THE STALE-DELIVERY HALF. Carrying a hit across a delay fixes the lost message
// and opens the opposite hole: measured 2026-09-24, 19 of 20 historical busy-hits
// were answered through the normal channel within 1-9 minutes, and the drain's
// prompt calls its block "still unanswered" and orders an immediate reply. So a
// carried hit is re-checked, read-only, at delivery time.
describe('stillOpenHits', () => {
  const q = (id: number, text = 'q') => `OPEN_QUESTION chat_id=100000001 message_id=${id}\n${text}`

  it('drops an answered question and keeps an open one', () => {
    const answered = (_c: string, m: string) => m === '1'
    expect(stillOpenHits(`${q(1)}\n\n${q(2)}`, answered)).toBe(q(2))
  })

  it('returns empty when everything was answered -- nothing to deliver', () => {
    expect(stillOpenHits(`${q(1)}\n\n${q(2)}`, () => true)).toBe('')
  })

  it('NEGATIVE: an UNKNOWN answer (not in the ledger) is kept, never dropped', () => {
    // Treating "could not tell" as "answered" would silently drop the message --
    // the very defect this card closes, one layer down.
    expect(stillOpenHits(q(1), () => null)).toBe(q(1))
  })

  it('a multi-paragraph question stays ONE entry', () => {
    const one = q(5, 'para one\n\npara two')
    const seen: string[] = []
    expect(stillOpenHits(one, (_c, m) => { seen.push(m); return false })).toBe(one)
    expect(seen).toEqual(['5'])
  })

  it('an ANSWERED multi-paragraph question disappears ENTIRELY -- no orphan paragraph', () => {
    // With a blank-line boundary the answered question's header is dropped but
    // its second paragraph has no header, is kept as "not a ledger question",
    // and goes out as if it were open. Only the answered case shows it: an open
    // question re-joins to the identical string either way.
    expect(stillOpenHits(q(5, 'para one\n\npara two'), () => true)).toBe('')
    expect(stillOpenHits(`${q(5, 'para one\n\npara two')}\n\n${q(6)}`, (_c, m) => m === '5')).toBe(q(6))
  })

  it('a prefix that is not a ledger question passes through untouched', () => {
    expect(stillOpenHits('3 actionable cards found', () => true)).toBe('3 actionable cards found')
  })
})

describe('decideRetryPreCheck -- the retry carries the hit, and never re-runs a consuming pre-check', () => {
  const q = (id: number) => `OPEN_QUESTION chat_id=100000001 message_id=${id}\nq`
  const counted = (result: { skip: boolean; prefix?: string }) => {
    let calls = 0
    return { run: () => { calls++; return result }, calls: () => calls }
  }

  it('a stored, still-open hit is delivered WITHOUT re-running the pre-check', () => {
    // The whole card in one assertion: re-running would hit the drain's dedup and SKIP.
    const fresh = counted({ skip: true })
    const d = decideRetryPreCheck(q(1), () => false, fresh.run)
    expect(fresh.calls()).toBe(0)
    expect(d.pc).toEqual({ skip: false, prefix: q(1) })
    expect(d.stored).toBeUndefined()
  })

  it('a stored hit that was answered meanwhile is NOT delivered, and the store is cleared', () => {
    const fresh = counted({ skip: true })
    const d = decideRetryPreCheck(q(1), () => true, fresh.run)
    expect(fresh.calls()).toBe(0)
    expect(d.pc.skip).toBe(true)
    expect(d.stored).toBeNull()
  })

  it('of two stored, only the still-open one goes out, and the store shrinks to it', () => {
    const d = decideRetryPreCheck(`${q(1)}\n\n${q(2)}`, (_c, m) => m === '1', counted({ skip: true }).run)
    expect(d.pc).toEqual({ skip: false, prefix: q(2) })
    expect(d.stored).toBe(q(2))
  })

  it('CONTROL: nothing stored -> the old behaviour, the pre-check IS re-run', () => {
    const fresh = counted({ skip: true })
    const d = decideRetryPreCheck(undefined, () => false, fresh.run)
    expect(fresh.calls()).toBe(1)
    expect(d.pc.skip).toBe(true)
    expect(d.stored).toBeUndefined()
  })

  it('nothing stored, and the fresh run is a hit -> it becomes the stored one', () => {
    const d = decideRetryPreCheck(undefined, () => false, counted({ skip: false, prefix: q(9) }).run)
    expect(d.pc).toEqual({ skip: false, prefix: q(9) })
    expect(d.stored).toBe(q(9))
  })
})

describe('isLedgerInboundAnswered (the drain\'s own definition, read-only)', () => {
  beforeAll(() => { initDatabase(':memory:') })
  const put = (agent: string, dir: 'in' | 'out', mid: string, createdAt: number) =>
    getDb()
      .prepare('INSERT INTO conversation_log (agent_id, chat_id, direction, message_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(agent, '100000001', dir, mid, 'x', createdAt)

  it('open when nothing went out after it', () => {
    put('a1', 'in', 'm1', 100)
    expect(isLedgerInboundAnswered('a1', '100000001', 'm1')).toBe(false)
  })

  it('answered by any later outbound of the same agent', () => {
    put('a2', 'in', 'm2', 100)
    put('a2', 'out', 'o2', 200)
    expect(isLedgerInboundAnswered('a2', '100000001', 'm2')).toBe(true)
  })

  it('ORDER matters: an outbound BEFORE the inbound does not answer it', () => {
    put('a3', 'out', 'o3', 50)
    put('a3', 'in', 'm3', 100)
    expect(isLedgerInboundAnswered('a3', '100000001', 'm3')).toBe(false)
  })

  it('a same-second outbound answers it only if it is the LATER row', () => {
    put('a4', 'in', 'm4', 100)
    put('a4', 'out', 'o4', 100)
    expect(isLedgerInboundAnswered('a4', '100000001', 'm4')).toBe(true)
  })

  it('CONTROL: another agent\'s outbound does not answer it', () => {
    put('a5', 'in', 'm5', 100)
    put('someone-else', 'out', 'o5', 200)
    expect(isLedgerInboundAnswered('a5', '100000001', 'm5')).toBe(false)
  })

  it('NEGATIVE: an inbound that is not in the ledger is null, not false', () => {
    expect(isLedgerInboundAnswered('a6', '100000001', 'nope')).toBeNull()
  })
})

// Wiring. ORDER, not presence: every name below already exists somewhere in the
// file, so a presence check would pass on the old code too. Each assertion is
// scoped to one loop and compares positions inside it.
describe('schedule-runner wiring (order inside each loop)', () => {
  // Every position is FOUND before it is compared. A missing anchor is -1, and
  // -1 is less than any position, so an unguarded "a before b" passes vacuously
  // exactly when a is gone -- measured on this file: replacing the retry's
  // stored-hit condition with `if (false)` left every order check green.
  const at = (hay: string, needle: string): number => {
    const i = hay.indexOf(needle)
    expect(i, `anchor not found: ${needle}`).toBeGreaterThanOrEqual(0)
    return i
  }
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
    expect(at(cron, 'const cronPc = runPreCheck(task)')).toBeLessThan(at(cron, "if (quota.action === 'defer')"))
    expect(at(cron, 'const preCheckHit = isPreCheckHit(cronPc)')).toBeLessThan(at(cron, 'workClass: quotaWorkClass(task, preCheckHit)'))
  })

  it('cron: the hit is remembered BEFORE the pending-key shortcut and before firing', () => {
    const remember = at(cron, 'if (preCheckHit) rememberRetryPrefix(key, cronPc.prefix as string)')
    expect(remember).toBeLessThan(at(cron, 'if (pendingKeys.has(key))'))
    expect(remember).toBeLessThan(at(cron, 'attemptFireTask(task,'))
  })

  it('cron: the busy drop goes through shouldDropBusyTick with the hit', () => {
    expect(cron).toContain('if (shouldDropBusyTick(task, now, preCheckHit))')
    expect(cron).not.toContain('if (task.skipIfBusy && !task.forceSend && skipIfBusyIsSafe(task.schedule, now))')
  })

  it('cron: a hit that did not fire always gets a row to ride on', () => {
    expect(cron).toContain("if (preCheckHit && result !== 'fired') insertPendingTaskRetryIfNew(task.name, agentName, now, result)")
  })

  it('retry: the loop decides through decideRetryPreCheck, fed the STORED hit, before firing', () => {
    // The decision itself is covered behaviourally above; this pins that the loop
    // actually hands it the stored hit and the ledger check, and obeys it.
    const call = at(retry, 'const decided = decideRetryPreCheck(')
    const block = retry.slice(call, at(retry, 'const retryPc = decided.pc'))
    expect(block).toContain('retryPrefix.get(key),')
    expect(block).toContain('isLedgerInboundAnswered(row.agent_name, chatId, messageId)')
    expect(block).toContain('() => runPreCheck(taskDef),')
    expect(block).toContain('if (decided.stored === null) clearRetryPrefix(key)')
    expect(block).toContain('else if (decided.stored !== undefined) replaceRetryPrefix(key, decided.stored)')
    expect(call).toBeLessThan(at(retry, 'attemptFireTask(taskDef,'))
  })

  it('retry: the decided prefix actually reaches the injection', () => {
    // Computing the right prefix and then firing without it would pass every
    // check above. The cron loop has this pin already; the retry loop had none.
    expect(retry).toContain('attemptFireTask(taskDef, row.agent_name, now, retryPc.prefix, heldMs, heldReason)')
  })

  it('both loops clear the stored hit when it is delivered', () => {
    const retryFired = retry.slice(at(retry, "if (result === 'fired')"))
    expect(retryFired.slice(0, at(retryFired, 'continue'))).toContain('clearRetryPrefix(key)')
    const cronFired = cron.slice(at(cron, "if (result === 'fired')"))
    expect(cronFired.slice(0, at(cronFired, "else if (result === 'starting')"))).toContain('clearRetryPrefix(key)')
  })
})
