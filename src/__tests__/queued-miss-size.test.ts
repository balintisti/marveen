import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { initDatabase, appendTaskRun, listTaskRunHistory } from '../db.js'

// A QUEUED miss lost its SIZE at the moment it finally succeeded (card 0518d542).
//
// The scheduler has TWO ways to not fire, and only one of them was leaky:
//
//   DROPPED (skipIfBusy=true) .. writes a 'skipped' row immediately. NOT the
//                                hole -- 7041 such rows existed on 2026-09-10.
//   QUEUED  (skipIfBusy=false) . goes into pending_task_retries, retries, and
//                                on success calls deletePendingTaskRetry().
//                                attempt_count, first_attempt and last_attempt
//                                are destroyed. THIS is the hole.
//
// Measured on `sentry-or`, 2026-09-05 (marveen): 628 attempts between 15:23:04
// and 17:59:59, and once it delivered, the history held ONE 'fired' row --
// byte-identical to a tick that fired on time. The card's earlier, broader
// wording ("a missed slot writes no row") was measurably too wide; the fix
// aimed at the dropping path would not have touched this one.
//
// WHY 'fired_late' AND NOT A NEW STATUS: its docblock in schedule-runner.ts
// already argues that a catch-up must not be folded into 'fired', so that the
// existing run-history view surfaces it without a new alert path. A retry-queue
// delivery is exactly that. Keeping it one row also means a fire count never
// double-counts, which a second row would have caused.
//
// STATED LIMIT: these are a DB round-trip and a WIRING census. They pin that
// the call site passes the size along; they do NOT drive the real retry loop
// (that needs live tmux sessions). A behavioural test would be a stronger
// claim, and this is not it.

beforeAll(() => { initDatabase(':memory:') })

describe('a queued miss keeps its size', () => {
  it('stores the held count and hands it back through the history API', () => {
    appendTaskRun('q-sentry', 'marveen', 'fired_late', 'retry-queue:628')
    const [row] = listTaskRunHistory('q-sentry', 1)
    expect(row.status).toBe('fired_late')
    expect(row.reason).toBe('retry-queue:628')
  })

  it('stays distinguishable from a tick that fired on time -- the case that was lost', () => {
    appendTaskRun('q-mixed', 'friday', 'fired')
    appendTaskRun('q-mixed', 'friday', 'fired_late', 'retry-queue:12')
    const rows = listTaskRunHistory('q-mixed', 2)
    // DESC: newest first
    expect(rows.map((r) => r.status)).toEqual(['fired_late', 'fired'])
    expect(rows.map((r) => r.reason)).toEqual(['retry-queue:12', null])
  })

  it('NEGATIVE CONTROL: the restart catch-up keeps a NULL reason, not a fabricated one', () => {
    // fired_late has a SECOND producer (the restart catch-up window), which
    // genuinely has no count to report. If it came back as a string, the two
    // producers would be indistinguishable -- in the direction that invents.
    appendTaskRun('q-restart', 'didi', 'fired_late')
    expect(listTaskRunHistory('q-restart', 1)[0].reason).toBeNull()
  })
})

describe('the retry-queue delivery declares its lateness at the call site', () => {
  const SRC = readFileSync(join(__dirname, '../web/schedule-runner.ts'), 'utf-8')

  // Anchored on the CALL, not on the words: a source search for 'retry-queue'
  // would pass on a file that only mentions it in a comment -- and this file
  // mentions it in comments several times.
  const retryCall = SRC.match(/const result = await attemptFireTask\(taskDef,[^\n]*\)/)

  it('finds the retry-path call site at all (positive control)', () => {
    expect(retryCall, 'call site not found -- the meter is broken, not the code').not.toBeNull()
  })

  it('passes BOTH the held duration and the held count', () => {
    expect(retryCall![0]).toContain('heldMs')
    expect(retryCall![0]).toContain('heldReason')
  })

  it('derives the count from the row rather than a literal', () => {
    expect(SRC).toMatch(/heldReason\s*=\s*`retry-queue:\$\{row\.attempt_count\}`/)
  })

  it('fired_late forwards the reason instead of dropping it on the floor', () => {
    expect(SRC).toMatch(/appendTaskRun\(task\.name,\s*agentName,\s*'fired_late',\s*lateReason\)/)
  })
})
