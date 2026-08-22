import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  decideIdleAlert,
  parseWorkCheck,
  buildWakeMessage,
  NO_IDLE_STATE,
  type IdleAgentInput,
  type IdleAgentState,
  type IdleAgentThresholds,
} from '../idle-agent.js'

const TH: IdleAgentThresholds = {
  sustainedMs: 10 * 60_000,
  realertMs: 30 * 60_000,
  wakeGraceMs: 15 * 60_000,
  wakeCooldownMs: 30 * 60_000,
}

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

  it('idle WITH work acts once the spell is sustained -- by WAKING, not alerting', () => {
    const first = decideIdleAlert(base, NO_IDLE_STATE, TH, at(0))
    expect(first.decision).toEqual({ alert: false, reason: 'not-sustained' })
    expect(first.next.idleSinceMs).toBe(at(0))

    const tooSoon = decideIdleAlert(base, first.next, TH, at(9))
    expect(tooSoon.decision.alert).toBe(false)

    const fires = decideIdleAlert(base, tooSoon.next, TH, at(10))
    expect(fires.decision).toEqual({
      alert: true,
      reason: 'wake-agent',
      workCount: 66,
      idleForMs: at(10),
    })
    expect(fires.next.lastWakeAt).toBe(at(10))
    // The half that matters: nobody has been told a human-facing thing yet.
    expect(fires.next.lastAlertAt).toBeNull()
  })
})

// The two stages exist because of a measured mechanism, not a preference: an agent
// cannot start its own turn, so the party that can fix "idle with work" is the agent,
// and the only thing that reaches it is a message. A human is worth interrupting only
// for the case the message did NOT fix.
describe('decideIdleAlert -- wake first, tell a human only if the wake fails', () => {
  const spell = (lastWakeAt: number | null = null): IdleAgentState => ({
    idleSinceMs: at(0),
    lastAlertAt: null,
    lastWakeAt,
  })

  it('WHEN THE WAKE WORKS, NO HUMAN IS EVER TOLD', () => {
    const woke = decideIdleAlert(base, spell(), TH, at(10))
    expect(woke.decision.reason).toBe('wake-agent')

    // The agent picks the work up. That is what going busy MEANS here, and it is the
    // entire "did the wake help" signal -- no extra bookkeeping decides it.
    const busy = decideIdleAlert({ ...base, paneIdle: false }, woke.next, TH, at(12))
    expect(busy.next.idleSinceMs).toBeNull()
    expect(busy.next.lastAlertAt).toBeNull()
  })

  it('a wake still inside its grace window is not yet news', () => {
    const woke = decideIdleAlert(base, spell(), TH, at(10))
    const waiting = decideIdleAlert(base, woke.next, TH, at(20))
    expect(waiting.decision).toEqual({ alert: false, reason: 'wake-pending' })
    expect(waiting.next.lastAlertAt).toBeNull()
  })

  it('a wake that did NOT take escalates to a human after the grace window', () => {
    const woke = decideIdleAlert(base, spell(), TH, at(10))
    const escalates = decideIdleAlert(base, woke.next, TH, at(26))
    expect(escalates.decision).toEqual({
      alert: true,
      reason: 'idle-with-work',
      workCount: 66,
      idleForMs: at(26),
    })
    expect(escalates.next.lastAlertAt).toBe(at(26))
  })

  // Without the cooldown this is a drumbeat, and the reason is subtle: going busy is
  // exactly what ends a spell, so an agent finishing short turns starts a NEW spell
  // every time it works -- and every new spell would earn a fresh wake.
  it('does not wake again on every new spell -- the cooldown spans spells', () => {
    const woke = decideIdleAlert(base, spell(), TH, at(10))
    const busy = decideIdleAlert({ ...base, paneIdle: false }, woke.next, TH, at(12))
    const backIdle = decideIdleAlert(base, busy.next, TH, at(13))

    const cooling = decideIdleAlert(base, backIdle.next, TH, at(23))
    expect(cooling.decision).toEqual({ alert: false, reason: 'wake-cooling-down' })

    const allowed = decideIdleAlert(base, cooling.next, TH, at(45))
    expect(allowed.decision.reason).toBe('wake-agent')
  })

  // Mutation guard for the exact line that makes the cooldown real. Drop lastWakeAt in
  // clear() and every test above still passes, because each of them stays inside one
  // spell -- this is the only one that crosses a busy tick.
  it('a busy tick does NOT forget that the agent was already woken', () => {
    const woke = decideIdleAlert(base, spell(), TH, at(10))
    const busy = decideIdleAlert({ ...base, paneIdle: false }, woke.next, TH, at(12))
    expect(busy.next.lastWakeAt).toBe(at(10))
  })

  // Same shape, different rail: these two branches rebuild the state object instead of
  // spreading it, so they are where lastWakeAt is most likely to be dropped silently.
  it('the unreadable-pane and undeclared rails preserve the wake record too', () => {
    const blind = decideIdleAlert({ ...base, paneIdle: null }, spell(at(3)), TH, at(10))
    expect(blind.next.lastWakeAt).toBe(at(3))

    const undeclared = decideIdleAlert({ ...base, ownWorkCount: null }, spell(at(3)), TH, at(10))
    expect(undeclared.next.lastWakeAt).toBe(at(3))
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
    // Starts with the wake already spent in this spell, so the tick under test is the
    // stage-2 alert rather than the stage-1 wake.
    const woken: IdleAgentState = { idleSinceMs: at(0), lastAlertAt: null, lastWakeAt: at(0) }
    const fired = decideIdleAlert(base, woken, TH, at(16))
    expect(fired.decision).toMatchObject({ alert: true, reason: 'idle-with-work' })

    const worked = decideIdleAlert({ ...base, paneIdle: false }, fired.next, TH, at(18))
    expect(worked.next.lastAlertAt).toBe(at(16))

    const backIdle = decideIdleAlert(base, worked.next, TH, at(19))
    const later = decideIdleAlert(base, backIdle.next, TH, at(31))
    // The guarantee is about the HUMAN, not about doing nothing: a new spell may well
    // earn another wake (it does here, 31 minutes after the last one), and that is the
    // guard working. What must not happen is a second alert inside the re-alert window.
    expect(later.decision.reason).not.toBe('idle-with-work')
    expect(later.next.lastAlertAt).toBe(at(16))
  })

  it('does not re-alert inside the re-alert window, and does again after it', () => {
    const woken: IdleAgentState = { idleSinceMs: at(0), lastAlertAt: null, lastWakeAt: at(0) }
    const fired = decideIdleAlert(base, woken, TH, at(16))
    expect(fired.decision).toMatchObject({ alert: true, reason: 'idle-with-work' })

    const muted = decideIdleAlert(base, fired.next, TH, at(30))
    expect(muted.decision).toEqual({ alert: false, reason: 'recently-alerted' })

    const again = decideIdleAlert(base, muted.next, TH, at(47))
    expect(again.decision).toMatchObject({ alert: true, reason: 'idle-with-work' })
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
      // Ask the card's OWN assignee, not a hard-coded one. Didi's catch: with 'dexter'
      // pinned here, a fixture card belonging to anyone else would fail with 0+0 --
      // reading as "invisible" when in truth we asked the wrong agent. A test that
      // fails for the right reason with the wrong message costs an hour to diagnose.
      const inMine = countDeclaredWork({ kind: 'assigned_open_cards' }, c.assignee ?? '', [c], cmts)
      const inHers = countDeclaredWork({ kind: 'testing_without_my_comment' }, 'didi', [c], cmts)
      expect(inMine + inHers, `card ${c.id} (assignee ${c.assignee}) is in no queue`).toBeGreaterThan(0)
    }
  })

  // The other live shape, pinned so the overlap is a decision and not an accident:
  // when a THIRD party (the coordinator) had the last word, both rules fire and the
  // card sits in both queues. 17 of the 18 overlaps on the board were this. Left as is
  // on purpose -- with a third party talking, nobody can say from the data alone whose
  // move it is, and nudging both is the safe answer. Telling them apart would mean
  // reading what the comment SAYS, which is judgement, not mechanics.
  it('a third party speaking last puts the card in BOTH queues, deliberately', () => {
    const rows: Row[] = [card('x', 'testing', 'dexter', { updatedAt: 300 })]
    const coordinatorLast = commentsAt([['x', 'didi', 200], ['x', 'marveen', 300]])
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', rows, coordinatorLast)).toBe(1)
    expect(countDeclaredWork({ kind: 'testing_without_my_comment' }, 'didi', rows, coordinatorLast)).toBe(1)
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

// The wake is the ACTION this guard takes, so its text is not cosmetic: the measured
// difference between a wake that moves an agent and one that does not is whether it
// names concrete items. Testing it here (rather than in the watcher) is why it lives in
// this module -- the watcher is I/O, and I/O is not where a decision belongs.
describe('buildWakeMessage', () => {
  const card = (id: string, priority: string, title: string) => ({
    id,
    priority,
    title,
    status: 'testing',
    assignee: 'didi',
  })

  it('names items, most urgent first, so the agent has something to pick up', () => {
    const msg = buildWakeMessage('didi', 13, 48, [
      card('cccccccc1', 'low', 'a low one'),
      card('aaaaaaaa1', 'urgent', 'the urgent one'),
      card('bbbbbbbb1', 'normal', 'a normal one'),
    ])
    const lines = msg.split('\n').filter((l) => l.startsWith('  '))
    expect(lines[0]).toContain('aaaaaaaa')
    expect(lines[0]).toContain('the urgent one')
    expect(lines[2]).toContain('cccccccc')
  })

  it('never dumps the whole board into a pane', () => {
    const many = Array.from({ length: 40 }, (_, i) => card(`id${i}`.padEnd(9, 'x'), 'normal', `t${i}`))
    const lines = buildWakeMessage('didi', 13, 40, many).split('\n').filter((l) => l.startsWith('  '))
    // All 40 are `testing`, so they land in the review section, which is capped tighter
    // than the work section: a reviewer's queue is not what the reader can act on.
    expect(lines.length).toBeLessThanOrEqual(3)
  })

  // Measured 2026-08-22 on Dexter's own board: all six cards the wake put in front of
  // him were `testing` -- reviews, not work. A plain priority sort does this every time,
  // because reviews carry the high priorities. He could not see a single pickable card.
  it('PUTS PICKABLE WORK FIRST, even when a review outranks it', () => {
    const msg = buildWakeMessage('dexter', 13, 4, [
      { ...card('rev11111', 'high', 'a review waiting for an answer'), status: 'testing' },
      { ...card('rev22222', 'urgent', 'another review'), status: 'testing' },
      { ...card('work1111', 'low', 'something I can actually start'), status: 'planned' },
    ])
    const lines = msg.split('\n').filter((l) => l.startsWith('  '))
    expect(lines[0]).toContain('work1111')
    expect(msg.indexOf('work1111')).toBeLessThan(msg.indexOf('rev22222'))
  })

  it('labels each line with its status, so a review cannot read as work', () => {
    const msg = buildWakeMessage('dexter', 13, 2, [
      { ...card('work1111', 'normal', 'w'), status: 'planned' },
      { ...card('rev11111', 'normal', 'r'), status: 'testing' },
    ])
    expect(msg).toMatch(/FELVEHETO MUNKA \(1\)/)
    expect(msg).toMatch(/VALASZRA VARO ELLENORZES \(1\)/)
    expect(msg).toContain('planned')
    expect(msg).toContain('testing')
  })

  it('says so plainly when there is nothing pickable, only reviews', () => {
    const msg = buildWakeMessage('dexter', 13, 1, [{ ...card('rev11111', 'high', 'r'), status: 'testing' }])
    expect(msg).toMatch(/Nincs felveheto munkad/)
  })

  it('says the count and the idle time, because the agent cannot see either', () => {
    const msg = buildWakeMessage('didi', 13, 48, [card('aaaaaaaa1', 'high', 'x')])
    expect(msg).toContain('13')
    expect(msg).toContain('48')
  })

  // The contradiction that would otherwise reach an agent as a silent lie: the guard
  // fires on a count above zero, so an empty item list means the count and the list
  // disagree. Saying so is the only honest option -- "you have 48 things" followed by
  // nothing at all is exactly the shape this fleet keeps getting burned by.
  it('when it can name nothing, it SAYS so instead of pretending', () => {
    const msg = buildWakeMessage('didi', 13, 48, [])
    expect(msg).toMatch(/nem tudtam megnevezni/)
  })

  // Measured 2026-08-22 on Didi's own wake: ONE message said "40 tetel var rád" and
  // "Nincs felveheto munkad" at the same time. Her check is `testing_without_my_comment`
  // -- for a reviewer the `testing` column IS the work, so the assignee-shaped rule
  // (`status !== 'testing'`) classified every single item as "not work". A reviewer told
  // she has no work is a reviewer who stops, which is the exact failure this guard exists
  // to prevent. The positive control below is the point: the SAME items must still read as
  // "no pickable work" for an assignee-kind check, or this test proves nothing.
  it('for a REVIEW queue, the testing column IS the pickable work', () => {
    const items = [
      { ...card('rev11111', 'high', 'a card waiting for my review'), status: 'testing' },
      { ...card('rev22222', 'urgent', 'another one'), status: 'testing' },
    ]
    const msg = buildWakeMessage('didi', 13, 40, items, 'testing_without_my_comment')
    expect(msg).not.toMatch(/Nincs felveheto munkad/)
    expect(msg).toMatch(/FELVEHETO ELLENORZES \(2\)/)
    expect(msg).toContain('rev22222')

    // POSITIVE CONTROL -- same items, assignee-shaped check: still nothing to pick up.
    const asAssignee = buildWakeMessage('didi', 13, 40, items, 'assigned_open_cards')
    expect(asAssignee).toMatch(/Nincs felveheto munkad/)
  })

  it('a review queue names more than three items, because they are the work', () => {
    const many = Array.from({ length: 40 }, (_, i) => card(`id${i}`.padEnd(9, 'x'), 'normal', `t${i}`))
    const lines = buildWakeMessage('didi', 13, 40, many, 'testing_without_my_comment')
      .split('\n')
      .filter((l) => l.startsWith('  '))
    expect(lines.length).toBe(5)
  })

  it('tells the agent that no human was alerted, so it does not go looking', () => {
    const msg = buildWakeMessage('didi', 13, 48, [card('aaaaaaaa1', 'high', 'x')])
    expect(msg).toContain('Isti NEM lett ertesitve')
  })
})

// The coordinator comments on nearly every card, and its comment means the opposite of a
// reviewer's: usually "settled", not "answer me". Counting it as an unanswered finding
// colonised the top of every queue -- measured on Dexter's board, four of six.
describe('assigned_open_cards -- the coordinator is not a reviewer', () => {
  const comments = (m: Record<string, Record<string, number>>) =>
    new Map(Object.entries(m).map(([k, v]) => [k, new Map(Object.entries(v))]))

  const testingCard = (id: string) => ({ id, status: 'testing', assignee: 'dexter', updated_at: 100 })

  it('a testing card where the COORDINATOR spoke last is NOT the assignee’s work', () => {
    const n = countDeclaredWork(
      { kind: 'assigned_open_cards' },
      'dexter',
      [testingCard('c1')],
      comments({ c1: { dexter: 1, marveen: 2 } }),
      'marveen',
    )
    expect(n).toBe(0)
  })

  it('a testing card where a REVIEWER spoke last still IS -- the original case survives', () => {
    const n = countDeclaredWork(
      { kind: 'assigned_open_cards' },
      'dexter',
      [testingCard('c1')],
      comments({ c1: { dexter: 1, didi: 2 } }),
      'marveen',
    )
    expect(n).toBe(1)
  })

  // The guard against "fixing" this by dropping testing wholesale: Didi measured 34 of 70
  // testing cards where her comment was the last word, and those are real work.
  it('the coordinator speaking EARLIER does not disqualify a reviewer’s last word', () => {
    const n = countDeclaredWork(
      { kind: 'assigned_open_cards' },
      'dexter',
      [testingCard('c1')],
      comments({ c1: { marveen: 1, didi: 5 } }),
      'marveen',
    )
    expect(n).toBe(1)
  })

  it('planned cards are unaffected -- they are work whoever commented', () => {
    const n = countDeclaredWork(
      { kind: 'assigned_open_cards' },
      'dexter',
      [{ id: 'p1', status: 'planned', assignee: 'dexter', updated_at: 100 }],
      comments({ p1: { marveen: 9 } }),
      'marveen',
    )
    expect(n).toBe(1)
  })
})

// The decision above is worthless if the watcher forgets to pass the coordinator: the
// pure function would silently fall back to the old, wrong behaviour and every test
// here would still be green. So the control reads the REAL source file, not a copy of
// the call -- a fixture built from our own assumption cannot fail.
describe('the watcher actually passes the coordinator id', () => {
  it('both call sites hand MAIN_AGENT_ID to the work-selection', () => {
    const src = readFileSync(
      new URL('../web/idle-agent-watcher.ts', import.meta.url),
      'utf8',
    )
    expect(src).toMatch(/countDeclaredWork\([^)]*MAIN_AGENT_ID\)/)
    expect(src).toMatch(/selectDeclaredWork\([^)]*MAIN_AGENT_ID\)/)
    // And that the id is imported, not a stray local that happens to share the name.
    expect(src).toMatch(/import \{ MAIN_AGENT_ID \} from '\.\.\/config\.js'/)
  })
})
