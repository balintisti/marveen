// Card c1e00b12: the idle-flush reason names WHEN the quiet spell started, not only its rounded
// length, with a date and a UTC offset so nobody has to derive it back from a dateless log time.
import { describe, it, expect } from 'vitest'
import {
  decideGuard, DEFAULT_CONTEXT_GUARD, INITIAL_GUARD_STATE, quietSinceStamp,
  type ContextGuardConfig, type GuardInputs,
} from '../context-guard.js'

const STAMP = /quiet since (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})/
const parseStamp = (text: string): number => {
  const m = STAMP.exec(text)
  if (!m) throw new Error(`no quiet-since stamp in: ${text}`)
  return Date.parse(`${m[1]}T${m[2]}${m[3]}`)
}

describe('quietSinceStamp', () => {
  // Read back, the stamp must name the exact second the spell started, whatever the process TZ:
  // the offset is what makes it unambiguous, and a wrong sign or a missing date breaks this.
  it('round-trips to the start of the spell, across a year of instants', () => {
    const base = Date.UTC(2026, 0, 1, 0, 0, 0)
    for (let i = 0; i < 365; i++) {
      const nowMs = base + i * 86_400_000 + (i * 7919_000) % 86_400_000 + 123
      const idleMs = ((i * 104_729) % 7200) * 1000 + 456
      expect(parseStamp(`quiet since ${quietSinceStamp(nowMs, idleMs)}`))
        .toBe(Math.floor((nowMs - idleMs) / 1000) * 1000)
    }
  })
})

describe('the idle-flush reason carries the stamp (c1e00b12)', () => {
  const CFG: ContextGuardConfig = {
    ...DEFAULT_CONTEXT_GUARD, enabled: false, idleFlushEnabled: true, idleFlushTokens: 400_000, idleMinutes: 20,
  }
  const NOW = Date.UTC(2026, 9, 14, 11, 30, 0)
  const base = (over: Partial<GuardInputs>): GuardInputs => ({
    nowMs: NOW, pct: null, running: true, paneIdle: true, paneBusy: false, sessionReady: true,
    handoffMtime: null, paneSaturated: false, contextTokens: 600_000, idleMs: 21 * 60_000,
    dailyHandoffDue: false, ...over,
  })

  it('when it fires', () => {
    const d = decideGuard(INITIAL_GUARD_STATE, base({}), CFG)
    expect(d.action).toBe('request-handoff')
    expect(parseStamp(d.reason)).toBe(NOW - 21 * 60_000)
  })

  it('when it is not quiet long enough yet, and when the pane is not idle', () => {
    const early = decideGuard(INITIAL_GUARD_STATE, base({ idleMs: 4 * 60_000 }), CFG)
    expect(early.action).toBe('none')
    expect(parseStamp(early.reason)).toBe(NOW - 4 * 60_000)
    const busy = decideGuard(INITIAL_GUARD_STATE, base({ paneIdle: false, paneBusy: true }), CFG)
    expect(busy.action).toBe('none')
    expect(parseStamp(busy.reason)).toBe(NOW - 21 * 60_000)
  })
})
