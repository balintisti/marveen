import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decideIdleAlert,
  parseWorkCheck,
  buildNoWorkNotice,
  buildWakeMessage,
  selectDeclaredWork,
  selectCoordinatorTriage,
  WAITING_ON_ASSIGNEE_LABEL,
  buildFleetAlert,
  NO_IDLE_STATE,
  type IdleAgentInput,
  type IdleAgentState,
  type IdleAgentThresholds,

  orphanPullList,
  topOfPullList,
  buildPullNotice,
  stalePendingBySender,
  buildPendingStillWaitingNotice,
  type RecipientPaneState,
  PENDING_NOTICE_AFTER_MS,
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
  it('THE AGROTECH CASE: a declared `none` check stays silent forever', () => {
    // The distinction added 2026-08-22: silence is owed to an agent that DECLARED it has
    // no queue here, not to every agent that happens to have zero cards. An on-call agent
    // nagged every half hour is a guard that gets muted -- and then protects nothing.
    let state = NO_IDLE_STATE
    for (const hour of [0, 6, 12, 24, 48]) {
      const r = decideIdleAlert({ ...base, ownWorkCount: 0, workCheckKind: 'none' }, state, TH, at(hour * 60))
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
  opts: { archived?: boolean; updatedAt?: number | null; labels?: { name: string }[] } = {},
): Row => ({
  id,
  status,
  assignee,
  archived_at: opts.archived ? 1 : null,
  updated_at: opts.updatedAt === undefined ? 100 : opts.updatedAt,
  labels: opts.labels ?? [],
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
  // 'c' also carries the mark: since 2026-08-24 the reviewer's last word is no longer
  // enough on its own -- see the block below on why the author stopped being the signal.
  const marked = cards.map((c) => (c.id === 'c' ? { ...c, labels: [{ name: WAITING_ON_ASSIGNEE_LABEL }] } : c))

  it('assigned_open_cards skips done, archived and waiting, and testing only while it awaits review', () => {
    // 'a' and 'b' are plain open work. 'c' is in testing with didi's comment as the
    // last word -- an unanswered finding, so it counts as dexter's. 'g' is in testing
    // with only dexter's own comment, so the ball is still with the reviewer.
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', marked, comments)).toBe(3)
  })

  // The gap Didi measured between the two rules: a card in testing whose last comment
  // is the reviewer's finding is waiting on the ASSIGNEE, but it used to fall out of
  // both queues -- hers because she had commented, his because testing was excluded
  // wholesale. 34 of 70 cards were in that state; 63 of 70 were in no queue at all.
  // REWRITTEN 2026-08-24, and the history matters more than the assertion (card
  // 0fe791fb). This test used to read: "a testing card whose last word came from
  // someone else IS my work" -- with no label, purely on the comment author. That rule
  // closed a real gap (the paragraph above) and then over-fired: measured over friday's
  // 11 such items, ZERO were questions to the assignee. Three were verifiers saying the
  // card was closable, five were stale-hash bookkeeping that states the card's claim is
  // UNCHANGED, three were confirmations. The guard woke him five times over that list.
  //
  // The author is not the signal; WHO IT WAITS ON is, and it is now a label.
  it('a testing card MARKED for the assignee is his work when a reviewer spoke last', () => {
    const rows: Row[] = [card('t', 'testing', 'dexter', { labels: [{ name: WAITING_ON_ASSIGNEE_LABEL }] })]
    const reviewerSpokeLast = commentsAt([['t', 'didi', 200]])
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', rows, reviewerSpokeLast)).toBe(1)
  })

  it('...and the SAME card WITHOUT the mark also stays his, while the narrowing is off', () => {
    // The triage selection is ready and correct -- and has no consumer, so nothing is
    // taken away yet. Both halves asserted together, because the pair is the decision:
    // a producer with no consumer must not narrow anything (marveen, 2026-08-24).
    const rows: Row[] = [card('t', 'testing', 'dexter')]
    const reviewerSpokeLast = commentsAt([['t', 'didi', 200]])
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', rows, reviewerSpokeLast)).toBe(1)
    expect(selectCoordinatorTriage(rows)).toHaveLength(1)
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
      // marked for the assignee: since 2026-08-24 the mark is what puts it in his queue
      card('r', 'testing', 'dexter', { updatedAt: 200, labels: [{ name: WAITING_ON_ASSIGNEE_LABEL }] }),
      card('a', 'testing', 'dexter', { updatedAt: 250 }),   // assignee answered last -> reviewer's
      // UNTRIAGED, and this is the row the invariant grew a third queue for: nobody
      // marked it, so it is neither the assignee's nor (necessarily) the reviewer's --
      // and it must still land somewhere. It lands on the coordinator's triage list.
      card('u', 'testing', 'dexter', { updatedAt: 300 })
    ]
    const cmts = commentsAt([
      ['r', 'didi', 200],
      ['a', 'didi', 200], ['a', 'dexter', 250],
      ['u', 'didi', 300],
    ])
    const mine = countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', rows, cmts)
    const hers = countDeclaredWork({ kind: 'testing_without_my_comment' }, 'didi', rows, cmts)
    // 'r' (marked) and 'u' (reviewer spoke last, unmarked) -- the second one only while
    // the narrowing is off; when the triage gains a consumer this becomes 1 again, in
    // the same commit that wires it.
    expect(mine).toBe(2)
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
      // THE THIRD QUEUE (2026-08-24). When the assignee's rule stopped firing on the
      // comment author, an UNTRIAGED card fell out of both of the original two -- and
      // this invariant is what said so, immediately and by name. It is the whole reason
      // "nobody's" was rejected as the resting place for an unmarked card: the guarantee
      // here is not "exactly one queue", it is NOTHING MAY BE INVISIBLE.
      const inTriage = selectCoordinatorTriage([c]).length
      expect(inMine + inHers + inTriage, `card ${c.id} (assignee ${c.assignee}) is in no queue`).toBeGreaterThan(0)
    }
  })

  // The other live shape, pinned so the overlap is a decision and not an accident:
  // when a THIRD party (the coordinator) had the last word, both rules fire and the
  // card sits in both queues. 17 of the 18 overlaps on the board were this. Left as is
  // on purpose -- with a third party talking, nobody can say from the data alone whose
  // move it is, and nudging both is the safe answer. Telling them apart would mean
  // reading what the comment SAYS, which is judgement, not mechanics.
  // REWRITTEN 2026-08-24 (card 0fe791fb). This used to assert that a third party
  // speaking last puts the card in BOTH queues -- and the reasoning above it says why:
  // "nobody can say from the data alone whose move it is, and nudging both is the safe
  // answer. Telling them apart would mean reading what the comment SAYS."
  //
  // That was right about the DATA and it is no longer true of it: the card can now carry
  // who it waits on, so nobody has to read the comment or nudge two people to be safe.
  // Nudging both was never free -- it is what put five identical wakes in front of an
  // agent who could not act on any of them.
  it('a third party speaking last still nudges BOTH -- and that is now a KNOWN cost, not a shrug', () => {
    // The original reasoning above stands while the narrowing is off. What changed is
    // that we can now say what it costs: nudging both is what put five identical wakes
    // in front of an agent who could not act on any of them. The label family is the
    // way out, and it takes effect the day the triage list has somewhere to go.
    const rows: Row[] = [card('x', 'testing', 'dexter', { updatedAt: 300 })]
    const coordinatorLast = commentsAt([['x', 'didi', 200], ['x', 'marveen', 300]])
    expect(countDeclaredWork({ kind: 'assigned_open_cards' }, 'dexter', rows, coordinatorLast)).toBe(1)
    expect(countDeclaredWork({ kind: 'testing_without_my_comment' }, 'didi', rows, coordinatorLast)).toBe(1)
    // Ready, and deliberately not yet consumed.
    expect(selectCoordinatorTriage(rows)).toHaveLength(1)
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

  // NO label here on purpose: these cases are about the comment-author rule, which is
  // what still decides while the narrowing is off (see idle-triage-coupling.test.ts).
  // A `varakozik:assignee` mark would short-circuit every one of them and they would
  // pass for the wrong reason.
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
  it('EVERY work-selection call site hands MAIN_AGENT_ID to it', () => {
    const src = readFileSync(
      new URL('../web/idle-agent-watcher.ts', import.meta.url),
      'utf8',
    )
    // NOT anchored to the closing paren: the first version was
    // `countDeclaredWork\([^)]*MAIN_AGENT_ID\)`, which asserted that the coordinator is
    // the LAST argument. Adding a `now` parameter after it broke the test while the
    // behaviour it guards was untouched (2026-08-22). A source-reading control should
    // pin WHAT is passed, not the argument order -- otherwise every later parameter
    // costs a false red, and the third one gets "fixed" by deleting the assertion.
    //
    // AND NOT ANCHORED TO THE NUMBER OF CALL SITES EITHER (2026-08-24). This used to say
    // "both call sites", naming countDeclaredWork and selectDeclaredWork separately. The
    // watcher now selects ONCE and takes the count from that same list -- a deliberate
    // change, because two calls were two chances to disagree -- and the old wording went
    // red for a shape change while the property it guards was untouched. Same lesson as
    // the paragraph above, one level up: pin the PROPERTY (every call passes it), not the
    // arrangement that happens to satisfy it today.
    const sites = [...src.matchAll(/(?:select|count)DeclaredWork\(/g)]
    expect(sites.length).toBeGreaterThan(0)
    for (const m of sites) {
      const args = src.slice(m.index ?? 0, (m.index ?? 0) + 240)
      expect(args, `call site at ${m.index} omits the coordinator`).toContain('MAIN_AGENT_ID')
    }
    // And that the id is imported, not a stray local that happens to share the name.
    expect(src).toMatch(/import \{ MAIN_AGENT_ID \} from '\.\.\/config\.js'/)
  })
})

// The guard above pins ONE argument by name. Measured 2026-08-22 (jarvis, card b5bff340
// and its twin 3b722cb5): the same file grew two more inputs -- `staleCounterOnly` and
// the `kind` argument -- and cutting either at the call site left the whole suite green,
// 3803 tests, because the guard only knew about MAIN_AGENT_ID. Knowing the principle and
// applying it a second time are two different steps, and it is the second that is missed:
// the first is deliberate (you are writing it down), the second is invisible precisely
// because "we already have that".
//
// So this control does not add one more assertion; it DERIVES its population from the
// input type. A field added to IdleAgentInput tomorrow is covered without anyone
// remembering this file exists.
describe('the watcher passes EVERY field the decision declares', () => {
  /** Comments stripped, line count kept. Not cosmetic: every field name below also
   *  appears in the JSDoc of IdleAgentInput, so a check that reads comments would find
   *  each one "present" no matter what the call site actually passes -- a guard that
   *  greps its own explanation. Blank-filling instead of deleting keeps line numbers
   *  honest for anything that reports positions. */
  const codeOnly = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  const idleSrc = readFileSync(new URL('../idle-agent.ts', import.meta.url), 'utf8')
  const watcherSrc = readFileSync(new URL('../web/idle-agent-watcher.ts', import.meta.url), 'utf8')

  /** Field names declared by the input type -- the population, taken from the source of
   *  truth rather than from a list somebody has to maintain here. */
  function declaredInputFields(src: string): string[] {
    const body = /export interface IdleAgentInput \{([\s\S]*?)\n\}/.exec(codeOnly(src))
    if (!body) throw new Error('IdleAgentInput not found in idle-agent.ts -- this control cannot report a pass')
    return [...body[1].matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1])
  }

  /** The object literal handed to decideIdleAlert, by brace matching rather than by a
   *  line-shaped regex: reformatting the call must not silently empty this control. */
  function callSiteObject(src: string): string {
    const code = codeOnly(src)
    const at = code.indexOf('decideIdleAlert(')
    if (at < 0) throw new Error('no decideIdleAlert( call in idle-agent-watcher.ts')
    const open = code.indexOf('{', at)
    let depth = 0
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') depth++
      else if (code[i] === '}' && --depth === 0) return code.slice(open, i + 1)
    }
    throw new Error('unbalanced braces in the decideIdleAlert call')
  }

  it('the population is read from the type, and the parse itself is controlled', () => {
    // A parser that quietly returned nothing would make the assertion below pass while
    // asserting about no fields at all -- success indistinguishable from total failure.
    // These seven are what the type declares today; the point of the check is not the
    // list but that the extraction produced a real one.
    // Deliberately NOT an exact-list equality: adding a legitimate field to the type
    // would then land two reds, one of them saying "now edit this list" -- and a control
    // that reports the correct solution as an error is the kind that gets deleted rather
    // than answered. Anchors plus a floor catch the failure that matters (a parse that
    // returned nothing or garbage) without punishing growth.
    const fields = declaredInputFields(idleSrc)
    expect(fields).toEqual(expect.arrayContaining(['agent', 'paneIdle', 'ownWorkCount', 'running']))
    expect(fields.length).toBeGreaterThanOrEqual(7)
    // Same control for the other extraction: brace matching that fell off the end would
    // return the rest of the file, and one that found nothing would return '{}'.
    const obj = callSiteObject(watcherSrc)
    expect(obj.length).toBeGreaterThan(80)
    expect(obj.length).toBeLessThan(1200)
  })

  it('every declared field appears at the call site -- shorthand or explicit', () => {
    const obj = callSiteObject(watcherSrc)
    for (const field of declaredInputFields(idleSrc)) {
      expect(obj, `IdleAgentInput.${field} is declared but never passed by the watcher`).toMatch(
        new RegExp(`(^|[\\s{,])${field}\\s*[:,}\\n]`),
      )
    }
  })

  // Presence is not correspondence. Both halves stay in the file when someone decouples
  // them -- `staleCounterOnly: false` at the call site still reads as "the field is
  // passed", and the pure function keeps its own tests green because the decision itself
  // was never wrong. What this pins is where the VALUE comes from.
  it('the evidence fields are BOUND to the pane read, not merely present', () => {
    const code = codeOnly(watcherSrc)
    // readPane: the flag is computed from the pane capture, and from the WEAK evidence
    // ('counter'), not the strong one. An inverted comparison here would flip the guard's
    // meaning while every assertion about presence stayed green.
    expect(code).toMatch(/staleCounterOnly:\s*busyEvidence\([^)]*\)\s*===\s*'counter'/)
    // call site: forwards that read instead of a literal
    expect(code).toMatch(/staleCounterOnly:\s*[^,]*paneRead\.staleCounterOnly/)
    expect(code).toMatch(/paneIdle:\s*[^,]*paneRead\.idle/)
  })

  // WHAT THIS CONTROL DOES NOT SEE, said out loud so nobody reads more into a green:
  //  - it reads source text, so renaming `paneRead` turns it red without any behaviour
  //    changing. That is the price of a structural control, not a defect -- but it is
  //    the reason the assertions pin WHAT is passed, never the argument order.
  //  - it says nothing about readPane's three early returns (no session, capture failed,
  //    unknown pane), which all report staleCounterOnly: false. Covering those means
  //    measuring readPane's BEHAVIOUR, which needs the tmux and db boundaries injected --
  //    a change to the coordination core, not to its tests. Card b5bff340 carries it.
})

// Measured 2026-08-22: the watcher sent one Telegram message PER AGENT from inside its
// sweep loop, so four standing agents produced four notifications -- and four more at
// the next re-alert window. Eight messages for one situation, at 05:00, while the owner
// slept. The escalation itself was right; the fan-out was not, and per-agent rate
// limiting cannot fix it because the limit is per agent.
// A card deliberately deferred to a future date is not work for today. Measured
// 2026-08-22: the guard offered jarvis his own card, due 2026-09-05, with a written
// reopening condition on it. The count was right; the input was incomplete.
//
// The unit trap is the reason `now` is injected rather than read from the clock: the
// column is epoch SECONDS and the watcher's loop clock is milliseconds. Pass the wrong
// one and the filter never fires -- silently, which is the only failure mode that
// would not show up in a green suite.
describe('selectDeclaredWork -- deferred cards', () => {
  const NOW_SEC = 1_800_000_000
  const card = (id: string, extra: Record<string, unknown> = {}) => ({
    id, status: 'planned', assignee: 'jarvis', ...extra,
  })
  const pick = (cards: ReturnType<typeof card>[], now?: number) =>
    selectDeclaredWork({ kind: 'assigned_open_cards' }, 'jarvis', cards, new Map(), 'marveen', now)
      .map((c) => c.id)

  it('hides a card whose due_date is in the future', () => {
    const cards = [card('sleeping', { due_date: NOW_SEC + 86_400 }), card('todo')]
    expect(pick(cards, NOW_SEC)).toEqual(['todo'])
  })

  it('KEEPS a card whose due_date has arrived -- the deferral expires on its own', () => {
    // The half that makes the test above mean something: a filter that hid every dated
    // card would satisfy the first assertion and quietly bury work forever.
    const cards = [card('due-today', { due_date: NOW_SEC - 60 }), card('todo')]
    expect(pick(cards, NOW_SEC).sort()).toEqual(['due-today', 'todo'])
  })

  it('keeps undated cards, which is nearly all of them', () => {
    expect(pick([card('a'), card('b')], NOW_SEC).sort()).toEqual(['a', 'b'])
  })

  it('without a clock it hides nothing -- an absent `now` must not silently filter', () => {
    // Callers that never pass a clock keep the old behaviour instead of losing cards
    // for a reason they were never told about.
    const cards = [card('sleeping', { due_date: NOW_SEC + 86_400 })]
    expect(pick(cards, undefined)).toEqual(['sleeping'])
  })
})

describe('buildFleetAlert', () => {
  const idle = (agent: string, minutes = 27, workCount = 40) =>
    ({ kind: 'still-idle', agent, minutes, workCount }) as const

  it('says nothing when there is nothing to say', () => {
    expect(buildFleetAlert([])).toBe('')
  })

  it('keeps the ORIGINAL single-agent wording, so the common case does not get worse', () => {
    const msg = buildFleetAlert([idle('didi', 27, 40)])
    expect(msg).toContain('"didi" 27 perce tetlen, 40 tetellel a soraban')
    expect(msg).toContain('MAR FELEBRESZTETTEM')
    // The fleet framing must NOT appear for one agent.
    expect(msg).not.toMatch(/EGY uzenetben/)
  })

  it('collapses four standing agents into ONE message that names all four', () => {
    const msg = buildFleetAlert([idle('dexter', 27, 234), idle('didi', 27, 40), idle('jarvis', 27, 1), idle('mandark', 27, 16)])
    for (const a of ['dexter', 'didi', 'jarvis', 'mandark']) expect(msg).toContain(a)
    expect(msg).toContain('4 agensrol szolok EGY uzenetben')
    // The counts survive the collapse -- an aggregate that drops the numbers would
    // trade eight useful messages for one useless one.
    expect(msg).toContain('234')
    expect(msg).toContain('16')
  })

  it('groups by KIND, because the kinds ask the reader for different things', () => {
    const msg = buildFleetAlert([
      idle('didi'),
      { kind: 'pane-unreadable', agent: 'mandark' },
      { kind: 'no-work-check', agent: 'newbie' },
    ])
    expect(msg).toMatch(/EBRESZTES UTAN IS ALL/)
    expect(msg).toMatch(/A PANEL NEM OLVASHATO/)
    expect(msg).toMatch(/NINCS workcheck\.json/)
    // An unreadable pane is the guard being BLIND -- it must not read as idleness.
    expect(msg).toMatch(/VAK/)
    // ...and mandark must be under the blind header, not the standing one.
    expect(msg.indexOf('mandark')).toBeGreaterThan(msg.indexOf('A PANEL NEM OLVASHATO'))
  })

  it('does not invent a group that has no members', () => {
    const msg = buildFleetAlert([idle('didi'), idle('dexter')])
    expect(msg).not.toMatch(/NINCS workcheck/)
    expect(msg).not.toMatch(/A PANEL NEM OLVASHATO/)
  })
})

// ---------------------------------------------------------------------------
// Idle with NOTHING ASSIGNED -- the state the guard used to be blind to
// ---------------------------------------------------------------------------
//
// `ownWorkCount <= 0` returned silently, with the comment "declared 'I have nothing
// to do' -> silence. This is correct behaviour, not a fault." Right about the AGENT,
// wrong about the FLEET: an agent at an empty prompt with zero assigned cards is the
// most expensive state there is, and nobody notices, because the guard was built to
// catch the opposite case. Measured 2026-08-22 20:43: three of four agents stood idle
// with empty queues and no assigned work while the window ran down, and the guard said
// nothing about any of them -- correctly, by its own rule.
describe('idle with no assigned work reaches the coordinator', () => {
  const base = {
    agent: 'nobody-assigned-me',
    running: true,
    paneIdle: true,
    pendingMessages: 0,
    ownWorkCount: 0,
    // A REAL declared check with zero cards -- that is the leak. `none` is the on-call
    // case and stays silent; see THE AGROTECH CASE above.
    workCheckKind: 'assigned_open_cards',
  }

  it('stays quiet until the idle spell is sustained', () => {
    const t0 = 1_000_000
    const first = decideIdleAlert(base, NO_IDLE_STATE, TH, t0)
    expect(first.decision.alert).toBe(false)
    expect(first.decision.reason).toBe('not-sustained')
  })

  it('tells the coordinator once the spell is sustained', () => {
    const t0 = 1_000_000
    const first = decideIdleAlert(base, NO_IDLE_STATE, TH, t0)
    const later = decideIdleAlert(base, first.next, TH, t0 + TH.sustainedMs + 1)
    expect(later.decision.alert).toBe(true)
    expect(later.decision.reason).toBe('idle-no-work')
  })

  it('does not repeat every sweep', () => {
    const t0 = 1_000_000
    const s1 = decideIdleAlert(base, NO_IDLE_STATE, TH, t0)
    const s2 = decideIdleAlert(base, s1.next, TH, t0 + TH.sustainedMs + 1)
    const s3 = decideIdleAlert(base, s2.next, TH, t0 + TH.sustainedMs + 60_000)
    expect(s2.decision.alert).toBe(true)
    expect(s3.decision.alert).toBe(false)
  })

  // The busy/blocked cases must NOT be swallowed by the new branch: an agent that is
  // working, or waiting on the router, is not idle-with-no-work no matter what its
  // board says.
  it('never fires for a busy agent', () => {
    const t = 1_000_000 + TH.sustainedMs * 3
    const r = decideIdleAlert({ ...base, paneIdle: false }, NO_IDLE_STATE, TH, t)
    expect(r.decision.alert).toBe(false)
  })

  it('never fires while messages are queued for the agent', () => {
    const t0 = 1_000_000
    const s1 = decideIdleAlert({ ...base, pendingMessages: 2 }, NO_IDLE_STATE, TH, t0)
    const s2 = decideIdleAlert({ ...base, pendingMessages: 2 }, s1.next, TH, t0 + TH.sustainedMs + 1)
    expect(s2.decision.alert).toBe(false)
  })

  it('an agent WITH work still gets the wake, not the coordinator notice', () => {
    const t0 = 1_000_000
    const withWork = { ...base, ownWorkCount: 5 }
    const s1 = decideIdleAlert(withWork, NO_IDLE_STATE, TH, t0)
    const s2 = decideIdleAlert(withWork, s1.next, TH, t0 + TH.sustainedMs + 1)
    expect(s2.decision.reason).toBe('wake-agent')
  })
})

describe('buildNoWorkNotice', () => {
  it('names the agent, the duration, and what it wants from the coordinator', () => {
    const msg = buildNoWorkNotice('jarvis', 14)
    expect(msg).toContain('jarvis')
    expect(msg).toContain('14 perce')
    expect(msg).toContain('NINCS RA KIOSZTVA SEMMI')
    expect(msg.toLowerCase()).toContain('adj neki kartyat')
  })

  // It must NOT name cards: choosing them needs the board and the fleet's shape, which
  // the coordinator has and this function does not. A guessed card list would look
  // authoritative and be wrong.
  // AZ UZENET AZT A CSATORNAT NEVEZZE MEG, AMIT AZ OR TENYLEGESEN OLVAS (kartya dc81d2af).
  //
  // A regi szoveg azt kerte: "mondd ki a KARTYAN, hogy miert all". Az or viszont kartyat SOSEM
  // olvas -- a dontese a `workcheck.json`-on all. jarvis merte 2026-08-28: 10 ertesites 4h48m
  // alatt UGYANARROL az agensrol, mikozben a koordinator KETSZER is kartyara irta, hogy
  // szandekosan all. A kartya-komment helyes szokas; csak nem az a csatorna, amit ez az or nez.
  // Egy uzenet, ami olyan valaszt ker, amit a KERO fel sem tud olvasni, minden korben ujra megy.
  it('a `workcheck.json`-t nevezi meg, a konkret ertekkel', () => {
    const msg = buildNoWorkNotice('mandark', 42)
    expect(msg).toContain('workcheck.json')
    expect(msg).toContain('{"kind":"none"}')
  })

  it('NEM keri, hogy a KARTYAN magyarazza el -- azt az or nem latja', () => {
    // NEGATIV KONTROLL: a kartya mint MUNKA-forras tovabbra is helyes ker, es meg is marad.
    const msg = buildNoWorkNotice('mandark', 42)
    expect(msg).not.toMatch(/mondd ki a kartyan/i)
    expect(msg.toLowerCase()).toContain('adj neki kartyat')
  })

  it('does not pretend to know which cards to hand over', () => {
    const msg = buildNoWorkNotice('jarvis', 14)
    expect(msg).not.toMatch(/\b[0-9a-f]{8}\b/)
  })
})

// ---------------------------------------------------------------------------
// The two consumers of the pane detector have OPPOSITE cost profiles
// ---------------------------------------------------------------------------
//
// jarvis measured end to end 2026-08-22: after the busy pattern was widened to
// minute-form counters, a stale counter above an idle footer silenced the brand-new
// "idle with nothing assigned" notice -- in exactly the state the notice was built for.
// Not a new hole; before the widening the same gap existed for second-form counters.
//
// His structural point is why the fix is a WEIGHT and not a narrower pattern: the guard
// that must catch "nobody notices an agent" was built on the detector whose failure mode
// is "reads a quiet agent as working". Guard and danger shared a dependency, so the
// error did not add up -- it hid itself. Narrowing the pattern would bring back the
// long-turn bug (dd3fec50); the two errors pull in opposite directions.
describe('counter-only busy evidence is weak enough for the no-work notice', () => {
  const idleNoWork = {
    agent: 'stale-counter-agent',
    running: true,
    paneIdle: false,
    staleCounterOnly: true,
    pendingMessages: 0,
    ownWorkCount: 0,
    workCheckKind: 'assigned_open_cards',
  }

  it('still tells the coordinator when the only busy evidence is a leftover counter', () => {
    const s1 = decideIdleAlert(idleNoWork, NO_IDLE_STATE, TH, at(0))
    const s2 = decideIdleAlert(idleNoWork, s1.next, TH, at(11))
    expect(s2.decision.alert).toBe(true)
    expect(s2.decision.reason).toBe('idle-no-work')
  })

  it('a footer-backed busy still silences it -- that evidence is strong', () => {
    const footerBusy = { ...idleNoWork, staleCounterOnly: false }
    const r = decideIdleAlert(footerBusy, NO_IDLE_STATE, TH, at(0))
    expect(r.decision).toEqual({ alert: false, reason: 'busy' })
  })

  // The lenient reading must NOT leak into the wake path: there a false idle interrupts
  // a live turn, which is the expensive direction. An agent WITH work and a counter-only
  // busy stays busy.
  it('does not make an agent WITH work wakeable on weak evidence', () => {
    const withWork = { ...idleNoWork, ownWorkCount: 7 }
    const s1 = decideIdleAlert(withWork, NO_IDLE_STATE, TH, at(0))
    const s2 = decideIdleAlert(withWork, s1.next, TH, at(11))
    expect(s2.decision.reason).toBe('busy')
  })

  it('an on-call agent stays silent however weak the busy evidence is', () => {
    const onCall = { ...idleNoWork, workCheckKind: 'none' }
    const s1 = decideIdleAlert(onCall, NO_IDLE_STATE, TH, at(0))
    const s2 = decideIdleAlert(onCall, s1.next, TH, at(11))
    expect(s2.decision.alert).toBe(false)
  })
})

// THE PULL-LIST THE GUARD COULD NOT SEE (card 4cbc8af9).
//
// The work counter asks `assignee === agent`. Correct for "what is on my plate",
// wrong for "is there anything to do" -- and the rulebook's third rule sends an
// agent with an empty plate to exactly the cards that question excludes.
// Measured 2026-08-28 21:02: a high-priority ownerless card had existed for
// twelve minutes and the notice still said NINCS RA KIOSZTVA SEMMI. The rule and
// the tool disagreed, and everyone reads the tool.
describe('the ownerless pull-list (card 4cbc8af9)', () => {
  const card = (o: Partial<{ id: string; status: string; assignee: string | null; priority: string; archived_at: number | null; due_date: number | null; title: string }>) => ({
    id: 'x', status: 'planned', assignee: null, priority: 'normal',
    archived_at: null, due_date: null, title: 't', ...o,
  })

  it('an unassigned planned card IS pickable -- the whole finding', () => {
    expect(orphanPullList([card({ id: 'a' })]).map((c) => c.id)).toEqual(['a'])
  })

  it('an empty-string assignee counts as unassigned', () => {
    // Both forms exist on the live board: 4 rows with null and 3 with ''.
    // A filter that catches only one is silently short.
    expect(orphanPullList([card({ id: 'b', assignee: '' })]).map((c) => c.id)).toEqual(['b'])
  })

  it("someone else's card is NOT in the pull-list", () => {
    // The negative direction: without it, "return everything" would pass.
    expect(orphanPullList([card({ id: 'c', assignee: 'dexter' })])).toEqual([])
  })

  it('and neither is a done, waiting, testing or archived one', () => {
    expect(orphanPullList([
      card({ id: 'd', status: 'done' }),
      card({ id: 'e', status: 'waiting' }),
      card({ id: 'f', status: 'testing' }),
      card({ id: 'g', archived_at: 1 }),
    ])).toEqual([])
  })

  it('a card deferred to a future date is not pickable today', () => {
    // Same rule the assigned count already applies: a future due_date means WE
    // decided to do it later, and offering it back spends the guard's credit.
    const now = 1_000_000
    expect(orphanPullList([card({ id: 'h', due_date: now + 60_000 })], now)).toEqual([])
    expect(orphanPullList([card({ id: 'i', due_date: now - 60_000 })], now).map((c) => c.id)).toEqual(['i'])
  })

  it('orders by priority so the message can name ONE card and be right', () => {
    const out = topOfPullList([
      card({ id: 'low', priority: 'low' }),
      card({ id: 'urgent', priority: 'urgent' }),
      card({ id: 'normal', priority: 'normal' }),
      card({ id: 'high', priority: 'high' }),
    ])
    expect(out.map((c) => c.id)).toEqual(['urgent', 'high', 'normal', 'low'])
  })
})

describe('the notice an idle agent gets when the board has ownerless work', () => {
  const items = [
    { id: 'aaaaaaaa11', title: 'egy magas prioritasu tetel', priority: 'high' },
    { id: 'bbbbbbbb22', title: 'egy masik', priority: 'normal' },
  ]

  it('NAMES the cards -- a count alone is what the old notice already was', () => {
    const msg = buildPullNotice('jarvis', 20, items)
    expect(msg).toContain('aaaaaaaa')
    expect(msg).toContain('egy magas prioritasu tetel')
  })

  it('and tells the reader to LOCK first', () => {
    // Two agents took the same card 19 seconds apart on the day the rule was
    // written. Naming a card without saying this invites exactly that.
    const msg = buildPullNotice('jarvis', 20, items)
    expect(msg).toMatch(/assignee/)
    expect(msg).toMatch(/in_progress/)
  })

  it('does NOT claim there is nothing assigned -- that was the false sentence', () => {
    expect(buildPullNotice('jarvis', 20, items)).not.toContain('NINCS RA KIOSZTVA SEMMI')
  })
})

// AND THAT THE WATCHER ACTUALLY ASKS (card 4cbc8af9).
//
// The cases above prove the pull-list is computed correctly. They do not prove
// it is CONSULTED: measured by mutation -- disabling the branch in
// idle-agent-watcher.ts left all 83 green. That is the third time today the same
// gap appeared (skipIfBusy, the busy-stuck population, and here): a unit test
// pins the function, and nothing pins its use.
//
// Source-reading is the weaker kind of test, so this asks the CORRESPONDENCE
// question rather than the presence one: not "does the name appear in the
// watcher" -- it would, in the import -- but "is the pull-list consulted inside
// the idle-no-work branch, BEFORE the notice that tells the coordinator to push
// a card". Order matters: after it, the agent is never told.
describe('the watcher consults the pull-list before asking for a push', () => {
  const SRC = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'idle-agent-watcher.ts'), 'utf-8')

  it('the idle-no-work branch calls orphanPullList', () => {
    const branch = SRC.slice(SRC.indexOf("decision.reason === 'idle-no-work'"))
    const upToNext = branch.slice(0, branch.indexOf('continue\n      }'))
    expect(upToNext, 'nem talaltam az idle-no-work agat').toBeTruthy()
    expect(upToNext).toContain('orphanPullList')
    expect(upToNext).toContain('buildPullNotice')
  })

  it('and it does so BEFORE buildNoWorkNotice, not after', () => {
    const branchAt = SRC.indexOf("decision.reason === 'idle-no-work'")
    const pullAt = SRC.indexOf('orphanPullList', branchAt)
    const pushAt = SRC.indexOf('buildNoWorkNotice(agent', branchAt)
    expect(pullAt).toBeGreaterThan(-1)
    expect(pushAt).toBeGreaterThan(-1)
    expect(pullAt).toBeLessThan(pushAt)
  })

  it('and the pull message goes to the AGENT, not to the coordinator', () => {
    // The whole point of rule 3: the agent pulls. Sending the named list to the
    // coordinator would reproduce the push it exists to replace.
    const branch = SRC.slice(SRC.indexOf("decision.reason === 'idle-no-work'"))
    const call = branch.slice(branch.indexOf('buildPullNotice') - 120, branch.indexOf('buildPullNotice'))
    expect(call).toContain("createAgentMessage('system', agent")
  })
})

// THE SENDER NEVER LOOKS AGAIN (card 979283a9).
//
// The `queue=<n>` figure the helper prints is produced at SEND time, and nothing
// re-reads it. Somebody who sent something forty minutes ago has no signal that
// it still has not landed -- which is how an agent ends up waiting for a reply
// that is sitting in a queue (measured 2026-08-18: dexter waited while the answer
// was pending).
//
// The threshold is measured, not chosen: over 7133 delivered messages the median
// is 0.8 minutes and the 95th percentile 31.6, so 60 minutes sits above the 97th
// and clears the fleet's documented 37- and 58-minute turns.
describe('a message still queued long after it was sent (card 979283a9)', () => {
  const MINUTE = 60_000
  const NOW = 10_000 * MINUTE
  const row = (o: Partial<{ id: number; from_agent: string; to_agent: string; agedMin: number }>) => ({
    id: o.id ?? 1,
    from_agent: o.from_agent ?? 'friday',
    to_agent: o.to_agent ?? 'dexter',
    created_at: Math.floor((NOW - (o.agedMin ?? 0) * MINUTE) / 1000),
  })

  it('reports one that has waited past the threshold', () => {
    const out = stalePendingBySender([row({ agedMin: 61 })], NOW, new Set())
    expect([...out.keys()]).toEqual(['friday'])
  })

  it('NEGATIVE CONTROL: a normally-delivered-speed message does NOT trigger it', () => {
    // The closing condition marveen named. Without it, a notice-on-everything
    // guard is indistinguishable from a working one -- and at the median of 0.8
    // minutes almost every message would qualify.
    expect(stalePendingBySender([row({ agedMin: 5 })], NOW, new Set()).size).toBe(0)
    expect(stalePendingBySender([row({ agedMin: 31 })], NOW, new Set()).size).toBe(0)
  })

  it('does not repeat itself: an id already reported is skipped', () => {
    // A message stuck two hours must not produce a notice every three minutes.
    // The guard would be loudest exactly when it is least useful.
    const rows = [row({ id: 7, agedMin: 90 })]
    expect(stalePendingBySender(rows, NOW, new Set()).size).toBe(1)
    expect(stalePendingBySender(rows, NOW, new Set([7])).size).toBe(0)
  })

  it('groups by sender, so nobody is told about someone else queue', () => {
    const out = stalePendingBySender([
      row({ id: 1, from_agent: 'friday', agedMin: 70 }),
      row({ id: 2, from_agent: 'didi', agedMin: 70 }),
      row({ id: 3, from_agent: 'friday', agedMin: 80 }),
    ], NOW, new Set())
    expect(out.get('friday')?.map((r) => r.id)).toEqual([1, 3])
    expect(out.get('didi')?.map((r) => r.id)).toEqual([2])
  })

  it('the threshold is above the measured 95th percentile', () => {
    // Pinned as a RELATION to the data that justified it: if someone lowers it to
    // 30 minutes, that is 5.4% of all traffic and this says so.
    expect(PENDING_NOTICE_AFTER_MS).toBeGreaterThan(32 * MINUTE)
  })
})

describe('the notice itself must not send anyone back to the queue', () => {
  const NOW = 600_000_000
  const rows = [{ to_agent: 'dexter', created_at: Math.floor((NOW - 70 * 60_000) / 1000) }]
  const BUSY = new Map<string, RecipientPaneState>([['dexter', 'busy']])

  it('names the recipient and how long it has waited', () => {
    const msg = buildPendingStillWaitingNotice('friday', rows, NOW, BUSY)
    expect(msg).toContain('dexter')
    expect(msg).toMatch(/70 perce/)
  })

  it('EXPLICITLY says not to resend -- a resend is a duplicate, not a retry', () => {
    // marveen measured this twice on 2026-08-28, once by accident: `pending`
    // lives in the database and survives a restart. Note the precondition:
    // this advice is only correct when the pane was MEASURED busy.
    const msg = buildPendingStillWaitingNotice('friday', rows, NOW, BUSY)
    expect(msg).toMatch(/ne kuldd ujra/i)
    expect(msg).toMatch(/duplikatum/i)
  })

  it('and points at the card, which does not queue', () => {
    expect(buildPendingStillWaitingNotice('friday', rows, NOW, BUSY)).toMatch(/KARTYARA/)
  })
})

// THE NOTICE MUST REPORT WHAT IT MEASURED, NOT WHAT IT ASSUMES (card 1d800670).
//
// The old text said "a cimzett dolgozik" for every firing. friday's case had all
// three messages already failed with the target session absent, and the notice
// still forbade a resend. Measured twice on 2026-09-02 the claim happened to be
// TRUE (didi 1h18m, computress 58m) -- which is the danger, not the defence: a
// signal that is usually right earns the trust it spends on the case it cannot see.
describe('the pending notice measures the recipient pane instead of asserting it', () => {
  const NOW = 600_000_000
  const rows = [{ to_agent: 'dexter', created_at: Math.floor((NOW - 70 * 60_000) / 1000) }]
  const withState = (st: RecipientPaneState) =>
    buildPendingStillWaitingNotice('friday', rows, NOW, new Map([['dexter', st]]))

  it('says BUSY was measured, and only then forbids the resend', () => {
    const msg = withState('busy')
    expect(msg).toMatch(/BUSY \(merve\)/)
    expect(msg).toMatch(/ne kuldd ujra/i)
  })

  it('an UNKNOWN pane does NOT forbid the resend -- that is the case where the session may be gone', () => {
    const msg = withState('unknown')
    expect(msg).toMatch(/NEM MEGALLAPITHATO/)
    expect(msg).not.toMatch(/ne kuldd ujra/i)
  })

  it('an IDLE pane does NOT forbid the resend either -- the router should already have injected', () => {
    const msg = withState('idle')
    expect(msg).toMatch(/URES \(merve\)/)
    expect(msg).not.toMatch(/ne kuldd ujra/i)
  })

  it('a recipient MISSING from the map is UNKNOWN, never assumed busy', () => {
    // The default has to fail open: an absent measurement is not a measurement.
    const msg = buildPendingStillWaitingNotice('friday', rows, NOW, new Map())
    expect(msg).toMatch(/NEM MEGALLAPITHATO/)
    expect(msg).not.toMatch(/ne kuldd ujra/i)
  })

  it('STAMPS the reading and says the notice itself may be stale', () => {
    // Card 1d800670, didi 2026-09-02: notice 8164 sat 91 minutes in the very queue
    // it reports (12:17:28 -> 13:49:25), and the message it named had been delivered
    // 69 minutes before it arrived. Every line was true at birth and false on arrival.
    const msg = withState('busy')
    expect(msg).toMatch(/MERVE \d{2}:\d{2}:\d{2}-kor/)
    expect(msg).toMatch(/avult lehet/)
  })

  it('hands over a FRESH measurement instead of asking the reader to discount a stale one', () => {
    // The stamp alone would repeat the shape this board keeps rejecting: a fix that
    // works only if the reader remembers to compensate. The notice must name the
    // command that answers the question today.
    const msg = withState('busy')
    expect(msg).toMatch(/MERD UJRA/)
    expect(msg).toContain('agent_messages')

    // THE ASSERTION MUST LAND ON THE COMMAND, NOT ON THE PROSE (card e6685c94, friday).
    // `toContain('friday')` alone is satisfied by the notice's FIRST line, which names the
    // sender in prose -- so it stayed green while the emitted command carried a literal
    // `${sender}`. Pasted verbatim that query returns [] and exits 0 for a sender with 15
    // queued messages: a silent false negative, in the reassuring direction, in the one
    // line whose whole purpose is to hand over a fresh measurement.
    const cmd = msg.split('\n').find((l) => l.includes('agent_messages')) ?? ''
    expect(cmd).not.toContain('${sender}')
    expect(cmd).toContain("('friday',")
  })

  it('and the command interpolates the ACTUAL sender -- a different sender gives a different command', () => {
    // The negative control: without this, a hard-coded 'friday' in the command would pass
    // the assertion above. Two senders, two commands, and neither contains the other's name.
    const forDexter = buildPendingStillWaitingNotice('dexter', rows, NOW, new Map([['dexter', 'busy' as const]]))
    expect(forDexter).toContain("('dexter',")
    expect(forDexter).not.toContain("('friday',")
  })
})

// AND THAT THE WATCHER ACTUALLY MEASURES IT -- the function above can be perfect
// while the call site passes an empty map forever. Same shape the file already
// tests for elsewhere: unit tests pin a function, nothing pins its use.
describe('the watcher measures the pane before building the notice', () => {
  const SRC = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'idle-agent-watcher.ts'), 'utf-8')

  it('sweepStalePending calls detectPaneState before the notice', () => {
    const fn = SRC.slice(SRC.indexOf('function sweepStalePending'))
    const upToCall = fn.slice(0, fn.indexOf('buildPendingStillWaitingNotice'))
    expect(upToCall).toContain('detectPaneState')
    expect(upToCall).toContain('capturePane')
  })
})

// AND THAT THE TICK ACTUALLY CALLS IT (card 979283a9).
//
// Written BEFORE running the mutation this time. Three times today the same gap
// appeared -- skipIfBusy, the busy-stuck population, the pull-list -- where the
// unit tests pinned a function and nothing pinned its use, and each time the
// mutation found it rather than the review. The pattern is predictable enough to
// test for in advance.
describe('the watcher tick runs the sender-side queue sweep', () => {
  const SRC = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'idle-agent-watcher.ts'), 'utf-8')

  it('tick() calls sweepStalePending', () => {
    const tick = SRC.slice(SRC.indexOf('function tick()'))
    expect(tick.slice(0, tick.indexOf('listKanbanCards'))).toContain('sweepStalePending()')
  })

  it('and the notice is addressed to the SENDER, not the recipient', () => {
    // The recipient is by definition busy -- that is why the message is queued.
    // Telling them would be the one delivery guaranteed to wait as well.
    const fn = SRC.slice(SRC.indexOf('function sweepStalePending'))
    const call = fn.slice(0, fn.indexOf('buildPendingStillWaitingNotice'))
    expect(call).toContain("createAgentMessage('system', sender")
  })

  it('and an id is remembered only after the notice went out', () => {
    // Marking first would lose the notice on a throw and never retry it: the
    // sender would be told nothing, forever, about that message.
    const fn = SRC.slice(SRC.indexOf('function sweepStalePending'))
    const sendAt = fn.indexOf('createAgentMessage')
    const markAt = fn.indexOf('pendingNoticed.add')
    expect(sendAt).toBeGreaterThan(-1)
    expect(markAt).toBeGreaterThan(sendAt)
  })
})
