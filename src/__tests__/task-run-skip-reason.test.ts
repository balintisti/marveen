import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { initDatabase, appendTaskRun, listTaskRunHistory } from '../db.js'

// `skipped` had FOUR producers in the scheduler and the stored record named
// none of them (card 34b2f8a3, measured by jarvis 2026-08-27):
//
//   quota          the window was under pressure -- there WAS work and we
//                  deliberately did not do it        -> catch-up is CORRECT
//   precheck-cron  the pre-check found nothing to do -> catch-up is WRONG
//   precheck-retry same, on the retry path           -> catch-up is WRONG
//   busy           the agent was mid-turn and the tick was DROPPED, silently
//                  -> a third answer again
//
// The measured cost of collapsing them: one task, one day, one word --
// memoria-heartbeat on 2026-08-27 read `quota` from 02:25 to 08:00 and `busy`
// from 09:00 to 12:00, and the table showed ten identical `skipped` rows. The
// catch-up decision cannot be planned from that, because the four call for
// opposite actions.
//
// Two layers here, because "the column exists" and "the writer fills it" are
// different claims: a real round-trip through the DB, and a census over the
// call sites that fails when a FIFTH silent producer appears.

beforeAll(() => { initDatabase(':memory:') })

describe('task_runs carries WHY a tick was skipped', () => {
  it('stores the reason and hands it back through the history API', () => {
    appendTaskRun('t-quota', 'jarvis', 'skipped', 'quota')
    const [row] = listTaskRunHistory('t-quota', 1)
    expect(row.status).toBe('skipped')
    expect(row.reason).toBe('quota')
  })

  it('keeps the four reasons apart on one task, which is the case that was unreadable', () => {
    // memoria-heartbeat's day, compressed: same name, same status, different why.
    for (const r of ['quota', 'busy', 'precheck-cron', 'precheck-retry'] as const) {
      appendTaskRun('t-mixed', 'marveen', 'skipped', r)
    }
    const reasons = listTaskRunHistory('t-mixed', 10).map((r) => r.reason)
    expect(new Set(reasons).size).toBe(4)
    expect(new Set(reasons)).toEqual(new Set(['quota', 'busy', 'precheck-cron', 'precheck-retry']))
  })

  it('NEGATIVE CONTROL: a run written without a reason stores NULL, not a guess', () => {
    // Every row that predates this column is an honest unknown. If this came
    // back as a string, the two states would be indistinguishable again -- in
    // the direction that invents information.
    appendTaskRun('t-plain', 'friday', 'fired')
    expect(listTaskRunHistory('t-plain', 1)[0].reason).toBeNull()
  })

  it('CONTROL: the meter can tell two rows apart at all', () => {
    appendTaskRun('t-two', 'didi', 'skipped', 'busy')
    appendTaskRun('t-two', 'didi', 'skipped', 'quota')
    const reasons = listTaskRunHistory('t-two', 2).map((r) => r.reason)
    expect(reasons).toEqual(['quota', 'busy'])   // DESC: newest first
  })
})

describe('every `skipped` producer in the scheduler names itself', () => {
  const SRC = readFileSync(join(__dirname, '../web/schedule-runner.ts'), 'utf-8')
  // Deliberately anchored on the CALL, not on the reason strings: a source
  // search for the four words would pass on a file that merely mentions them
  // in a comment. This asks what is actually PASSED.
  const calls = [...SRC.matchAll(/appendTaskRun\([^)]*'skipped'(?:,\s*'([a-z-]+)')?\s*\)/g)]

  it('finds the call sites at all (positive control)', () => {
    expect(calls.length).toBeGreaterThan(0)
  })

  it('leaves no `skipped` write without a reason', () => {
    const anonymous = calls.filter((m) => m[1] === undefined)
    expect(anonymous).toEqual([])
  })

  it('uses exactly the four distinct reasons the catch-up decision needs', () => {
    // If a fifth producer appears, this fails and forces the same question
    // again: is it catch-up-able, and does the reader need to tell it apart?
    expect(new Set(calls.map((m) => m[1]))).toEqual(
      new Set(['quota', 'precheck-cron', 'precheck-retry', 'busy']),
    )
    expect(calls.length).toBe(4)
  })
})
