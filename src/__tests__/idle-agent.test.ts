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

  // Didi's mutant: setting lastAlertAt to null inside clear() left every test green.
  // With that mutant any productive tick forgets the window, and the guard could fire
  // every 12 minutes at an agent who is simply slow to finish.
  it('a busy tick does NOT forget the re-alert window', () => {
    const fired = decideIdleAlert(base, { idleSinceMs: at(0), lastAlertAt: null }, TH, at(10))
    expect(fired.decision.alert).toBe(true)

    const worked = decideIdleAlert({ ...base, paneIdle: false }, fired.next, TH, at(12))
    expect(worked.next.lastAlertAt).toBe(at(10))

    const backIdle = decideIdleAlert(base, worked.next, TH, at(13))
    const later = decideIdleAlert(base, backIdle.next, TH, at(25))
    expect(later.decision).toEqual({ alert: false, reason: 'recently-alerted' })
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

describe('decideIdleAlert -- an unreadable pane', () => {
  // The failure Didi found in my own code: capture errors returned false, which reads
  // as "busy", which silently switches the guard off for that agent. A blind guard that
  // says nothing looks exactly like a healthy fleet -- the shape this guard exists to
  // catch, turned on itself.
  it('reports that it cannot tell, instead of assuming the agent is busy', () => {
    const { decision } = decideIdleAlert({ ...base, paneIdle: null }, NO_IDLE_STATE, TH, at(0))
    expect(decision).toEqual({ alert: true, reason: 'pane-unreadable' })
  })

  it('never reports it as idleness, because idleness was not measured', () => {
    const { decision } = decideIdleAlert({ ...base, paneIdle: null }, NO_IDLE_STATE, TH, at(0))
    expect(decision.reason).not.toBe('idle-with-work')
  })

  it('is rate-limited like every other rail', () => {
    const first = decideIdleAlert({ ...base, paneIdle: null }, NO_IDLE_STATE, TH, at(0))
    const second = decideIdleAlert({ ...base, paneIdle: null }, first.next, TH, at(5))
    expect(second.decision).toEqual({ alert: false, reason: 'recently-alerted' })
  })

  it('a stopped agent is still not-running, not unreadable', () => {
    const { decision } = decideIdleAlert(
      { ...base, paneIdle: null, running: false },
      NO_IDLE_STATE,
      TH,
      at(0),
    )
    expect(decision).toEqual({ alert: false, reason: 'not-running' })
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

  it('rate-limits the config-gap report, so it is not a drumbeat', () => {
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
const card = (
  id: string,
  status: string,
  assignee: string | null,
  opts: { archived?: boolean; updatedAt?: number | null } = {},
): Row => ({
  id,
  status,
  assignee,
  archived_at: opts.archived ? 1 : null,
  updated_at: opts.updatedAt === undefined ? 100 : opts.updatedAt,
})

/** card id -> (author -> timestamp of their last comment) */
const commentsAt = (rows: [string, string, number][]): Map<string, Map<string, number>> => {
  const m = new Map<string, Map<string, number>>()
  for (const [cardId, author, at] of rows) {
    let inner = m.get(cardId)
    if (!inner) { inner = new Map(); m.set(cardId, inner) }
    inner.set(author, at)
  }
  return m
}

describe('countDeclaredWork', () => {
  const cards: Row[] = [
    card('a', 'planned', 'dexter'),
    card('b', 'in_progress', 'dexter'),
    card('c', 'testing', 'dexter'),
    card('d', 'done', 'dexter'),
    card('e', 'planned', 'didi'),
    card('f', 'testing', 'didi'),
    card('g', 'testing', 'dexter'),
    card('h', 'planned', 'dexter', { archived: true }),
    card('w', 'waiting', 'dexter'),
  ]
  // didi reviewed 'c' at 150 (after its last activity at 100) -- covered.
  // dexter commented on 'g' at 150, which must not count as didi's review.
  const comments = commentsAt([
    ['c', 'didi', 150],
    ['g', 'dexter', 150],
  ])

  it('assigned_open_cards skips done, archived and waiting, and testing only while it awaits review', () => {
    // 'a' and 'b' are plain open work. 'c' is in testing with didi's comment as the
    // last word -- an unanswered finding, so it counts as dexter's. 'g' is in testing
    // with only dexter's own comment, so the ball is still with the reviewer.
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', cards, comments)).toBe(3)
  })

  // The gap Didi measured between the two rules: a card in testing whose last comment
  // is the reviewer's finding is waiting on the ASSIGNEE, but it used to fall out of
  // both queues -- hers because she had commented, his because testing was excluded
  // wholesale. 34 of 70 cards were in that state; 63 of 70 were in no queue at all.
  it('a testing card whose last word came from someone else IS my work', () => {
    const rows: Row[] = [card('t', 'testing', 'dexter')]
    const reviewerSpokeLast = commentsAt([['t', 'didi', 200]])
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', rows, reviewerSpokeLast)).toBe(1)
  })

  it('a testing card where I answered last is NOT my work -- the ball is back with the reviewer', () => {
    const rows: Row[] = [card('t', 'testing', 'dexter')]
    const iAnsweredLast = commentsAt([['t', 'didi', 200], ['t', 'dexter', 300]])
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', rows, iAnsweredLast)).toBe(0)
  })

  it('a testing card nobody has commented on is NOT my work -- it awaits review', () => {
    const rows: Row[] = [card('t', 'testing', 'dexter')]
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', rows, new Map())).toBe(0)
  })

  it('every testing card lands in exactly one queue, never zero', () => {
    // The invariant the two rules were supposed to have and did not.
    // updated_at tracks the last activity, as it does on the real board -- an earlier
    // fixture set it out of step with the comments and put one card in both queues,
    // which is exactly the ambiguity this invariant is meant to rule out.
    const rows: Row[] = [
      card('n', 'testing', 'dexter', { updatedAt: 100 }),   // no comments -> reviewer's
      card('r', 'testing', 'dexter', { updatedAt: 200 }),   // reviewer spoke last -> assignee's
      card('a', 'testing', 'dexter', { updatedAt: 250 }),   // assignee answered last -> reviewer's
    ]
    const cmts = commentsAt([
      ['r', 'didi', 200],
      ['a', 'didi', 200], ['a', 'dexter', 250],
    ])
    const mine = countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', rows, cmts)
    const hers = countDeclaredWork({ kind: 'testing_without_my_comment' }, 'didi', rows, cmts)
    expect(mine).toBe(1)
    expect(hers).toBe(2)
    // NOT a sum. Didi's catch: `mine + hers === rows.length` is satisfied just as well
    // by one card counted twice and another counted zero times -- the two errors cancel,
    // and the assertion cannot see the very property its name claims. Checked per card
    // instead, and the claim narrowed to what actually holds: nothing may be invisible.
    // Overlap is tolerated on purpose (it errs toward more work, never toward silence).
    for (const c of rows) {
      const inMine = countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', [c], cmts)
      const inHers = countDeclaredWork({ kind: 'testing_without_my_comment' }, 'didi', [c], cmts)
      expect(inMine + inHers).toBeGreaterThan(0)
    }
  })

  // A KNOWN gap, asserted so it cannot change unnoticed: a card assigned to X where
  // only X has commented stays out of X's queue. That is right when X is waiting for a
  // reviewer, and wrong when X IS the reviewer -- and from assignee plus comments alone
  // the two are indistinguishable. Four cards were in that state on 2026-08-20, all of
  // them the reviewer's own measurement cards. Documented rather than guessed at.
  it('assignee-only comments stay out of the assignee queue (known gap, see 52d94a9e)', () => {
    const rows: Row[] = [card('s', 'testing', 'didi', { updatedAt: 200 })]
    const onlyMine = commentsAt([['s', 'didi', 200]])
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'didi', rows, onlyMine)).toBe(0)
  })

  it('a queue made only of waiting cards is not work', () => {
    // The AgroTech case again: silence is the correct behaviour here.
    const onlyWaiting: Row[] = [card('w1', 'waiting', 'dexter'), card('w2', 'waiting', 'dexter')]
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', onlyWaiting, new Map())).toBe(0)
  })

  it('testing_without_my_comment is the reviewer queue, not the testing column', () => {
    // 'f' has no comment at all; 'g' has one from dexter, which is not didi's review.
    expect(countDeclaredWork({ kind: 'testing_without_my_comment' }, 'didi', cards, comments)).toBe(2)
  })

  // The defect Didi measured: asking "did I ever comment" retires a card permanently,
  // so the guard falls silent exactly when the reviewer has caught up. On the live board
  // that was 28 cards with activity after her comment.
  it('a card that moved AFTER my comment is back in my queue', () => {
    const rows: Row[] = [card('x', 'testing', 'dexter', { updatedAt: 200 })]
    const reviewedEarlier = commentsAt([['x', 'didi', 150]])
    expect(countDeclaredWork({ kind: 'testing_without_my_comment' }, 'didi', rows, reviewedEarlier)).toBe(1)
  })

  it('a card untouched since my comment stays out of my queue', () => {
    const rows: Row[] = [card('x', 'testing', 'dexter', { updatedAt: 100 })]
    const reviewedAfter = commentsAt([['x', 'didi', 150]])
    expect(countDeclaredWork({ kind: 'testing_without_my_comment' }, 'didi', rows, reviewedAfter)).toBe(0)
  })

  it('without a card timestamp it stays out -- we do not nag on a guess', () => {
    const rows: Row[] = [card('x', 'testing', 'dexter', { updatedAt: null })]
    const reviewed = commentsAt([['x', 'didi', 150]])
    expect(countDeclaredWork({ kind: 'testing_without_my_comment' }, 'didi', rows, reviewed)).toBe(0)
  })

  it('none is always zero, whatever the board looks like', () => {
    expect(countDeclaredWork({ kind: 'none' }, 'dexter', cards, comments)).toBe(0)
    expect(countDeclaredWork({ kind: 'none' }, 'didi', cards, comments)).toBe(0)
  })

  it('archived cards never count', () => {
    const onlyArchived: Row[] = [card('z', 'planned', 'dexter', { archived: true })]
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', onlyArchived, new Map())).toBe(0)
  })
})
