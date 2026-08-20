import { describe, it, expect } from 'vitest'
import {
  decideIdleAlert,
  parseWorkCheck,
  NO_IDLE_STATE,
  type IdleAgentInput,
  type IdleAgentState,
  type IdleAgentThresholds,
} from '../idle-agent.js'

const TH: IdleAgentThresholds = { sustainedMs: 10 * 60_000, realertMs: 30 * 60_000 }

const base: IdleAgentInput = {
  agent: 'didi',
  running: true,
  paneIdle: true,
  pendingMessages: 0,
  ownWorkCount: 66,
}

const at = (t: number) => t * 60_000

describe('decideIdleAlert -- the four conditions, each on its own', () => {
  it('a stopped agent is not an idleness problem', () => {
    const { decision } = decideIdleAlert({ ...base, running: false }, NO_IDLE_STATE, TH, at(0))
    expect(decision.alert).toBe(false)
    expect(decision.reason).toBe('not-running')
  })

  it('a working agent never alerts, however much work is queued', () => {
    const { decision } = decideIdleAlert({ ...base, paneIdle: false }, NO_IDLE_STATE, TH, at(0))
    expect(decision).toEqual({ alert: false, reason: 'busy' })
  })

  it('an agent with undelivered mail is the router’s problem, not idle', () => {
    const { decision } = decideIdleAlert({ ...base, pendingMessages: 2 }, NO_IDLE_STATE, TH, at(0))
    expect(decision).toEqual({ alert: false, reason: 'waiting-on-router' })
  })

  // The one that killed the timer design. An on-call agent with an empty queue is
  // behaving correctly; a guard that nags it every day gets muted, and then it
  // protects nothing at all.
  it('THE AGROTECH CASE: declared zero work stays silent forever', () => {
    let state = NO_IDLE_STATE
    for (const hour of [0, 6, 12, 24, 48]) {
      const r = decideIdleAlert({ ...base, ownWorkCount: 0 }, state, TH, at(hour * 60))
      expect(r.decision).toEqual({ alert: false, reason: 'no-work' })
      state = r.next
    }
  })

  it('idle WITH work alerts once the spell is sustained', () => {
    const first = decideIdleAlert(base, NO_IDLE_STATE, TH, at(0))
    expect(first.decision).toEqual({ alert: false, reason: 'not-sustained' })
    expect(first.next.idleSinceMs).toBe(at(0))

    const tooSoon = decideIdleAlert(base, first.next, TH, at(9))
    expect(tooSoon.decision.alert).toBe(false)

    const fires = decideIdleAlert(base, tooSoon.next, TH, at(10))
    expect(fires.decision).toEqual({
      alert: true,
      reason: 'idle-with-work',
      workCount: 66,
      idleForMs: at(10),
    })
    expect(fires.next.lastAlertAt).toBe(at(10))
  })
})

describe('decideIdleAlert -- spell bookkeeping', () => {
  it('any non-idle tick resets the spell, so a short pause never accumulates', () => {
    const started = decideIdleAlert(base, NO_IDLE_STATE, TH, at(0))
    const worked = decideIdleAlert({ ...base, paneIdle: false }, started.next, TH, at(5))
    expect(worked.next.idleSinceMs).toBeNull()

    // Back to idle at minute 6: the clock restarts, so minute 11 is only 5 minutes in.
    const again = decideIdleAlert(base, worked.next, TH, at(6))
    const stillQuiet = decideIdleAlert(base, again.next, TH, at(11))
    expect(stillQuiet.decision).toEqual({ alert: false, reason: 'not-sustained' })
  })

  it('does not re-alert inside the re-alert window, and does again after it', () => {
    const fired = decideIdleAlert(base, { idleSinceMs: at(0), lastAlertAt: null }, TH, at(10))
    expect(fired.decision.alert).toBe(true)

    const muted = decideIdleAlert(base, fired.next, TH, at(20))
    expect(muted.decision).toEqual({ alert: false, reason: 'recently-alerted' })

    const again = decideIdleAlert(base, muted.next, TH, at(41))
    expect(again.decision.alert).toBe(true)
  })
})

describe('decideIdleAlert -- the undeclared agent', () => {
  // Undeclared must not read as "fine". An agent could otherwise dodge the guard
  // forever simply by never declaring, which is exactly the hole being closed.
  it('reports a config gap rather than assuming either answer', () => {
    const { decision, next } = decideIdleAlert(
      { ...base, ownWorkCount: null },
      NO_IDLE_STATE,
      TH,
      at(0),
    )
    expect(decision).toEqual({ alert: true, reason: 'no-work-check-declared' })
    expect(next.lastAlertAt).toBe(at(0))
  })

  it('does not alert immediately, so a missing declaration is not a drumbeat', () => {
    const first = decideIdleAlert({ ...base, ownWorkCount: null }, NO_IDLE_STATE, TH, at(0))
    const second = decideIdleAlert({ ...base, ownWorkCount: null }, first.next, TH, at(5))
    expect(second.decision).toEqual({ alert: false, reason: 'recently-alerted' })
  })

  it('a busy undeclared agent is still not reported -- the gap only shows when idle', () => {
    const { decision } = decideIdleAlert(
      { ...base, ownWorkCount: null, paneIdle: false },
      NO_IDLE_STATE,
      TH,
      at(0),
    )
    expect(decision).toEqual({ alert: false, reason: 'busy' })
  })
})

describe('parseWorkCheck', () => {
  it('accepts the three declared kinds', () => {
    expect(parseWorkCheck('{"kind":"assigned_open_cards"}')).toEqual({ kind: 'assigned_open_cards' })
    expect(parseWorkCheck('{"kind":"testing_without_my_comment"}')).toEqual({
      kind: 'testing_without_my_comment',
    })
    expect(parseWorkCheck('{"kind":"none"}')).toEqual({ kind: 'none' })
  })

  // A typo must not silently become a working default in EITHER direction: inventing
  // a queue slanders the agent, silencing the guard hides the failure it exists for.
  it('treats malformed or unknown declarations as undeclared, never as a default', () => {
    expect(parseWorkCheck('{"kind":"assigned_open_card"}')).toBeNull()
    expect(parseWorkCheck('{"kind":42}')).toBeNull()
    expect(parseWorkCheck('not json')).toBeNull()
    expect(parseWorkCheck('[]')).toBeNull()
    expect(parseWorkCheck('null')).toBeNull()
    expect(parseWorkCheck('')).toBeNull()
    expect(parseWorkCheck(null)).toBeNull()
    expect(parseWorkCheck(undefined)).toBeNull()
  })

  it('distinguishes declared-none from undeclared', () => {
    expect(parseWorkCheck('{"kind":"none"}')).not.toBeNull()
    expect(parseWorkCheck(null)).toBeNull()
  })
})

import { countDeclaredWork, type WorkCountCard } from '../idle-agent.js'

type Row = WorkCountCard & { id: string }
const card = (id: string, status: string, assignee: string | null, archived = false): Row => ({
  id,
  status,
  assignee,
  archived_at: archived ? 1 : null,
})

describe('countDeclaredWork', () => {
  const cards: Row[] = [
    card('a', 'planned', 'dexter'),
    card('b', 'in_progress', 'dexter'),
    card('c', 'testing', 'dexter'),
    card('d', 'done', 'dexter'),
    card('e', 'planned', 'didi'),
    card('f', 'testing', 'didi'),
    card('g', 'testing', 'dexter'),
    card('h', 'planned', 'dexter', true),
  ]
  const comments = new Map<string, Set<string>>([
    ['c', new Set(['didi'])],
    ['g', new Set(['dexter'])],
  ])

  it('assigned_open_cards skips done, archived, and testing', () => {
    // testing is excluded on purpose: that card is with the reviewer, not the assignee.
    // Counting it would leave a worker permanently "with work" and nag them forever.
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', cards, comments)).toBe(2)
  })

  it('testing_without_my_comment is the reviewer queue, not the testing column', () => {
    // didi already reviewed 'c'; 'f' and 'g' still need her. 'g' has a dexter comment,
    // which must NOT count as hers -- otherwise an author could clear their own queue.
    expect(countDeclaredWork({ kind: 'testing_without_my_comment' }, 'didi', cards, comments)).toBe(2)
  })

  it('none is always zero, whatever the board looks like', () => {
    expect(countDeclaredWork({ kind: 'none' }, 'dexter', cards, comments)).toBe(0)
    expect(countDeclaredWork({ kind: 'none' }, 'didi', cards, comments)).toBe(0)
  })

  it('archived cards never count', () => {
    const onlyArchived: Row[] = [card('z', 'planned', 'dexter', true)]
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', onlyArchived, new Map())).toBe(0)
  })
})
