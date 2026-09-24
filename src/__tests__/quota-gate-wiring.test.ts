import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { quotaWorkClass } from '../web/schedule-runner.js'
import { parseQuotaSnapshot } from '../quota-snapshot.js'
import { parseQuotaExempt } from '../web/scheduled-tasks-io.js'

// The gate itself is covered in quota-gate.test.ts. This file covers the two
// seams around it: how a scheduled task is classified, and how the collector's
// on-disk JSON becomes the gate's input.

const RUNNER_SRC = readFileSync(join(__dirname, '../web/schedule-runner.ts'), 'utf-8')

describe('quotaWorkClass', () => {
  it('exempts shell-command tasks -- they never call a model', () => {
    expect(quotaWorkClass({ type: 'command' })).toBe('free')
  })

  it('classifies heartbeats as background', () => {
    expect(quotaWorkClass({ type: 'heartbeat' })).toBe('background')
  })

  it('treats owner-visible and unknown future types as owner-facing', () => {
    expect(quotaWorkClass({ type: 'task' })).toBe('owner-facing')
    expect(quotaWorkClass({ type: 'dream-engine' } as never)).toBe('owner-facing')
    expect(quotaWorkClass({} as never)).toBe('owner-facing')
  })

  // Isti, 2026-09-21: "mehet a crm-smoke-teszt naponta". A DAILY heartbeat
  // deferred by the gate is not postponed, it is lost for a day -- eight days
  // of that left the CRM with no smoke test at all. The flag buys exactly one
  // thing: the task is no longer held back by quota pressure.
  it('lifts an owner-exempted heartbeat out of background', () => {
    expect(quotaWorkClass({ type: 'heartbeat', quotaExempt: true })).toBe('owner-facing')
  })

  // The two polarity controls the assertion above cannot make on its own: an
  // absent or explicitly-false flag must leave the classification untouched,
  // otherwise "exempt" would be the default and the gate would be decoration.
  it('leaves an unflagged heartbeat in background', () => {
    expect(quotaWorkClass({ type: 'heartbeat', quotaExempt: undefined })).toBe('background')
    expect(quotaWorkClass({ type: 'heartbeat', quotaExempt: false })).toBe('background')
  })

  // A shell command already costs nothing; the flag must not relabel it, or
  // the gate's reason string would claim a model cost that does not exist.
  it('does not relabel a free shell command', () => {
    expect(quotaWorkClass({ type: 'command', quotaExempt: true })).toBe('free')
  })
})

describe('parseQuotaExempt', () => {
  it('accepts only a real boolean true', () => {
    expect(parseQuotaExempt(true)).toBe(true)
  })

  // Every one of these is a plausible hand-edit typo, and every one of them
  // is truthy in JS. A cost guard must not open on a typo.
  it('rejects truthy look-alikes, so a typo cannot open the gate', () => {
    for (const raw of ['true', 1, 'yes', 'TRUE', {}, [], 'false']) {
      expect(parseQuotaExempt(raw)).toBeUndefined()
    }
  })

  it('reports an unset field as undefined, not false', () => {
    // undefined keeps the key out of the JSON the schedules API echoes back,
    // so only a real exemption is visible to a reader of that list.
    expect(parseQuotaExempt(undefined)).toBeUndefined()
    expect(parseQuotaExempt(false)).toBeUndefined()
    expect(parseQuotaExempt(null)).toBeUndefined()
  })
})

describe('schedule-runner wiring', () => {
  it('reads the snapshot once per tick, not once per task', () => {
    // A per-task read would re-parse the same file N times every 60s tick.
    expect(RUNNER_SRC).toContain('const quotaSnapshot = readQuotaSnapshot()')
    expect(RUNNER_SRC.match(/readQuotaSnapshot\(\)/g)?.length).toBe(1)
  })

  it('records a held-back occurrence so the catch-up window cannot re-fire it', () => {
    // Mirrors the pre-check skip: mark the tick as run, log a task-run row.
    const gate = RUNNER_SRC.slice(RUNNER_SRC.indexOf("if (quota.action === 'defer')"))
    // Bounded by the per-agent loop that FOLLOWS the gate. It used to be bounded
    // by `const cronPc`, which card 22d7f41e moved in front of the gate -- that
    // bound would now be missing, and a missing indexOf (-1) makes the slice run
    // to the end of the file, where every string below appears somewhere. The
    // bound is asserted so the block can never silently become the whole file.
    const end = gate.indexOf('for (const agentName of targetAgents) {')
    expect(end).toBeGreaterThan(0)
    const block = gate.slice(0, end)
    expect(block).toContain('scheduleLastRun.set(task.name, now)')
    expect(block).toContain('persistScheduleLastRun()')
    // 6c7f152 (card 34b2f8a3) gave this call site an explicit reason, so the
    // bare three-argument form pinned here no longer exists. Asserting the
    // REASON as well, because that is what the merge deliberately added.
    expect(block).toContain("appendTaskRun(task.name, agentName, 'skipped', 'quota')")
  })

  it('runs the pre-check BEFORE the gate, because the script it spares is free (card 22d7f41e)', () => {
    // This pinned the OPPOSITE order from 2026-08-17: "a deferred task never
    // spawns its script". The script is a pre-check -- model-free by design --
    // so sparing it saved nothing, and ledger-live-drain sat under the gate from
    // 2026-09-12 to 09-24 without once looking for an unanswered message. The
    // gate now sees the pre-check's verdict: SKIP never reaches it, a hit is
    // owner-facing.
    // Both positions FOUND first: -1 is less than anything, so a vanished
    // pre-check call would otherwise pass this order check vacuously.
    const pc = RUNNER_SRC.indexOf('const cronPc = runPreCheck(task)')
    const gate = RUNNER_SRC.indexOf("if (quota.action === 'defer')")
    expect(pc).toBeGreaterThan(0)
    expect(gate).toBeGreaterThan(0)
    expect(pc).toBeLessThan(gate)
  })
})

describe('parseQuotaSnapshot', () => {
  const onDisk = {
    generated_at: '2026-08-17T14:53:57.362898+00:00',
    generated_at_local: '2026-08-17 16:53:57 CEST',
    codex: { ok: false },
    claude: {
      provider: 'claude',
      source: 'authoritative',
      ok: true,
      windows: {
        five_hour: { used_percent: 10.0, resets_at: 1786990200.146628 },
        seven_day: { used_percent: 13.0, resets_at: 1787205600.146654 },
      },
    },
  }

  it('maps the collector output onto the gate input', () => {
    const s = parseQuotaSnapshot(onDisk)
    expect(s?.source).toBe('authoritative')
    expect(s?.generatedAtMs).toBe(Date.parse('2026-08-17T14:53:57.362898+00:00'))
    expect(s?.windows?.five_hour?.used_percent).toBe(10)
  })

  it('returns null for anything that is not a collector snapshot', () => {
    expect(parseQuotaSnapshot(null)).toBeNull()
    expect(parseQuotaSnapshot('nope')).toBeNull()
    expect(parseQuotaSnapshot({})).toBeNull()
    expect(parseQuotaSnapshot({ claude: 'not-an-object' })).toBeNull()
  })

  it('survives a snapshot with an unparseable timestamp', () => {
    const s = parseQuotaSnapshot({ ...onDisk, generated_at: 'yesterday-ish' })
    // Null timestamp -> the gate fails open rather than trusting stale numbers.
    expect(s?.generatedAtMs).toBeNull()
    expect(s?.source).toBe('authoritative')
  })
})
