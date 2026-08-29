// Contract tests for formatStuckSessionAlert: a session continuously not-ready
// past the escalation threshold must produce an ALERT the main agent receives,
// not only a warn log.
//
// Root cause (2026-07-27 incident, card 0a641b52): two messages to prisma sat
// pending for 2.5h while its session was wedged at 100% context. The router
// logged 'session STUCK' at warn level every escalation window -- but the log
// reaches nobody, so the stall was found by hand. The fix routes the same
// escalation into the main agent's inbox as a [session-stuck] message; the
// escalation-window reset in the tick doubles as the notification cooldown.
// formatStuckSessionAlert is the pure decision extracted from the notifier;
// these tests pin it.

import { describe, it, expect } from 'vitest'
import { formatStuckSessionAlert, shouldEscalateStuckSession,
  quietAgentsToCheck, isDeliberatelyParked, declaresNoQueue,
  quietSweepDue } from '../web/message-router.js'
import { detectPaneState } from '../pane-state.js'

const MAIN = 'marveen'

const SEP = '─'.repeat(80)
const MIN = 60 * 1000

// Real pane shapes, run through detectPaneState rather than passing the
// 'busy' literal directly -- the escalation is only as good as the detection
// that feeds it, and a test that hands in the answer would pass even if the
// pane were read wrong.
const BUSY_PANE = [
  '✢ Combobulating… (52s · ↓ 2.6k tokens · thinking some more)',
  '',
  SEP,
  '❯ ',
  SEP,
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt',
].join('\n')

const IDLE_PANE = [
  '',
  SEP,
  '❯ ',
  SEP,
  '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
].join('\n')

describe('formatStuckSessionAlert: silent stall becomes a main-agent alert', () => {
  it('produces a [session-stuck] alert naming agent, session, duration and queue depth', () => {
    const alert = formatStuckSessionAlert('prisma', MAIN, 'agent-prisma', 150 * 60 * 1000, 2)
    expect(alert).not.toBeNull()
    // The marker the main agent's triage keys on.
    expect(alert).toContain('[session-stuck]')
    // Enough to act without a second lookup: who, where, how long, how much is blocked.
    expect(alert).toContain("'prisma'")
    expect(alert).toContain('agent-prisma')
    expect(alert).toContain('150 min')
    expect(alert).toContain('2 pending message(s)')
    // Points at the runbook step rather than leaving "now what".
    expect(alert).toContain('delivery-stall diagnosis')
  })

  it('never alerts the main agent about itself (no self-loop)', () => {
    // Messages TO the main agent use the pull model and never enter the stuck
    // branch; this guards the invariant if that ever changes.
    expect(formatStuckSessionAlert(MAIN, MAIN, 'marveen-channels', 20 * 60 * 1000, 5)).toBeNull()
  })

  it('rounds the stall duration to whole minutes', () => {
    // 11 min 29 s -> 11 min; the alert is triage, not telemetry.
    expect(formatStuckSessionAlert('edina1', MAIN, 'agent-edina1', 689_000, 1)).toContain('11 min')
  })

  it('says "working, do not restart" when the pane was busy', () => {
    // A busy-pane alert that reads like the wedged one gets acted on like the
    // wedged one. It has to name what it actually saw.
    const alert = formatStuckSessionAlert('prisma', MAIN, 'agent-prisma', 35 * MIN, 2, 'busy')!
    expect(alert).toContain('BUSY')
    expect(alert).toContain('Do NOT restart on this alert alone')
    expect(alert).not.toContain('restart the agent if it is wedged')
  })
})

// A session mid-turn is not ready for a prompt for the same reason a wedged one
// is not, so the queue side alone cannot tell them apart. On 2026-07-31 that
// cost three false alarms in one day, each one a main-agent diagnosis round
// whose answer was "it is working".
describe('shouldEscalateStuckSession: a busy pane is work, not a stall', () => {
  it('does NOT escalate the 2026-07-31 18:56 atlas case (busy pane, 1 pending)', () => {
    // atlas: pane busy with `esc to interrupt` visible, one message queued,
    // not-ready past the 10 min threshold. Alerted; should not have.
    expect(shouldEscalateStuckSession(detectPaneState(BUSY_PANE), 12 * MIN)).toBe(false)
  })

  it('does NOT escalate the 2026-07-31 19:27 prisma case (10 min orientation, 2 pending)', () => {
    // prisma: ten minutes into a long orientation turn, two messages queued.
    expect(shouldEscalateStuckSession(detectPaneState(BUSY_PANE), 10 * MIN + 30_000)).toBe(false)
  })

  it('still escalates a busy pane once the long watchdog passes', () => {
    // A tool call can wedge with the spinner up. Half an hour of busy with mail
    // queued behind it is worth a look either way.
    expect(shouldEscalateStuckSession(detectPaneState(BUSY_PANE), 31 * MIN)).toBe(true)
    expect(shouldEscalateStuckSession(detectPaneState(BUSY_PANE), 29 * MIN)).toBe(false)
  })

  it('keeps the normal threshold for a pane that is not busy', () => {
    // The 2026-07-27 case this alert exists for: not-ready while NOT working
    // (wedged at 100% context, idle-looking or unreadable pane).
    expect(shouldEscalateStuckSession(detectPaneState(IDLE_PANE), 11 * MIN)).toBe(true)
    expect(shouldEscalateStuckSession(detectPaneState(IDLE_PANE), 9 * MIN)).toBe(false)
  })

  it('treats an unreadable pane as a reason to look sooner, not later', () => {
    // capturePane returns null when the host is down or tmux is gone. Silence
    // is not evidence of work.
    expect(shouldEscalateStuckSession(null, 11 * MIN)).toBe(true)
  })

  it('does not let a quoted "esc to interrupt" in scrollback mute the alert', () => {
    // A watchdog report pasted into the pane must not read as busy -- that
    // would mute the alert on exactly the session discussing stalls.
    const quoted = [
      'The runbook says: "esc to interrupt" means the agent is still working.',
      '',
      SEP,
      '❯ ',
      SEP,
      '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
    ].join('\n')
    expect(shouldEscalateStuckSession(detectPaneState(quoted), 11 * MIN)).toBe(true)
  })
})

// THE POPULATION, WHICH IS WHAT WAS WRONG (card bd7de2ba).
//
// The busy-stuck check lived inside the delivery loop, keyed on msg.to_agent, so
// it only ever asked about agents that had mail waiting. Confirmed live on
// 2026-08-28 20:01: the alert fired on computress BECAUSE she had three queued
// messages. With an empty inbox the same 30-minute stall is silent -- and from
// outside a working pane and a wedged pane are the same picture, so nothing else
// would have said anything.
//
// The mechanism was never wrong. `receiversInTick` is the right set for
// DELIVERY, where only an agent with something to hand over matters; it was
// reused as the denominator of a different question.
describe('busy-stuck population: the quiet agents are the ones nobody asks about', () => {
  it('an agent with an EMPTY inbox is IN the set -- the whole finding', () => {
    const quiet = quietAgentsToCheck(['dexter', 'didi', 'friday'], new Set(['dexter']), MAIN)
    expect(quiet).toContain('didi')
    expect(quiet).toContain('friday')
  })

  it('an agent already handled by the delivery loop is NOT re-checked', () => {
    // Excluded rather than merged: evaluating it in both places in one tick
    // doubles the alert instead of widening the net.
    const quiet = quietAgentsToCheck(['dexter', 'didi'], new Set(['dexter']), MAIN)
    expect(quiet).not.toContain('dexter')
  })

  it('the main agent is never in the sweep', () => {
    expect(quietAgentsToCheck([MAIN, 'didi'], new Set(), MAIN)).toEqual(['didi'])
  })
})

describe('a deliberately parked agent must not alert (card bd7de2ba, marveen constraint)', () => {
  // The predicate is split in two on purpose: `declaresNoQueue` is the DECISION
  // and takes the raw text, `isDeliberatelyParked` only adds the file read.
  // PROJECT_ROOT is resolved at import time from the module's own location, so a
  // test cannot redirect the agents directory -- and a decision that can only be
  // exercised by writing into the LIVE tree is a decision nobody tests.
  it('kind "none" parks it', () => {
    expect(declaresNoQueue('{"kind":"none"}')).toBe(true)
  })

  it('any OTHER kind does not park it -- the guard still watches', () => {
    // Without this, the fix and "disable the check" are indistinguishable.
    expect(declaresNoQueue('{"kind":"assigned_open_cards"}')).toBe(false)
    expect(declaresNoQueue('{"kind":"testing_without_my_comment"}')).toBe(false)
  })

  it('a MISSING declaration is not a park -- "could not read" is not a decision', () => {
    // The idle guard reports an absent workcheck.json as a config gap. Here it
    // must not silence the check: an unreadable file and an operator's decision
    // to park are different answers, and only one of them was made by anyone.
    expect(declaresNoQueue(null)).toBe(false)
  })

  it('malformed JSON is not a park either', () => {
    expect(declaresNoQueue('{ this is not json')).toBe(false)
    expect(declaresNoQueue('')).toBe(false)
  })

  it('and the POPULATION applies it -- the predicate alone proves nothing', () => {
    // Measured before this test existed: deleting the parked filter from
    // quietAgentsToCheck left the whole file green. The predicate was pinned;
    // its USE was not. The stub is what makes the filter observable, since the
    // real one reads a path fixed at import time.
    const parked = (a: string) => a === 'napping'
    expect(quietAgentsToCheck(['napping', 'busy-one'], new Set(), MAIN, parked)).toEqual(['busy-one'])
  })

  it('and with nobody parked, everyone stays in', () => {
    // The other direction: a filter that removes everything would also pass the
    // assertion above.
    expect(quietAgentsToCheck(['napping', 'busy-one'], new Set(), MAIN, () => false))
      .toEqual(['napping', 'busy-one'])
  })
})

describe('the threshold still separates a long turn from a wedged one', () => {
  it('a busy pane under 30 min does NOT escalate -- the negative control', () => {
    // The fleet has genuinely long turns: 37 minutes is on record and a 58-minute
    // one was seen on 2026-08-23. A guard that fires on those is a guard nobody
    // reads by the third day.
    expect(shouldEscalateStuckSession(detectPaneState(BUSY_PANE), 29 * MIN)).toBe(false)
  })

  it('and past 30 min it does', () => {
    expect(shouldEscalateStuckSession(detectPaneState(BUSY_PANE), 31 * MIN)).toBe(true)
  })
})

describe('the sweep has its own cadence, not the router tick (card bd7de2ba)', () => {
  // The router ticks every 5 s. A readiness probe per quiet agent at that rate
  // is ~70 tmux calls a MINUTE for a question whose threshold is 30 MINUTES --
  // and the first version of this change did exactly that. Cost has to be
  // proportional to the question, or the fix for a blind spot becomes a load.
  it('does not run on every tick', () => {
    expect(quietSweepDue(1_000, 0, 60_000)).toBe(false)
    expect(quietSweepDue(59_999, 0, 60_000)).toBe(false)
  })

  it('runs once the interval has passed', () => {
    expect(quietSweepDue(60_000, 0, 60_000)).toBe(true)
    expect(quietSweepDue(120_000, 60_000, 60_000)).toBe(true)
  })

  it('and the interval is well under the escalation threshold', () => {
    // Pinned as a RELATION, not a number: if someone lowers the stuck threshold
    // toward the sweep interval, the guard starts missing windows and this says
    // so instead of the two constants drifting past each other silently.
    expect(shouldEscalateStuckSession('busy', 30 * MIN + 60_000)).toBe(true)
  })
})
