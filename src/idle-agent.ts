// Idle-agent detection: the guard for the agent that has work and is not doing it.
//
// WHY THIS IS NOT A TIMER
// -----------------------
// The obvious design is "no message for N minutes -> alert". Isti killed that one
// with a single question: what happens when an AgroTech-style agent has nothing to
// call anyone about today? It would alarm every single day while behaving perfectly.
//
// Silence is not the signal, because two opposite states look identical from outside:
//
//     nothing to do + silent  -> CORRECT. Alerting here is noise.
//     something to do + silent -> the actual failure.
//
// So the guard is never allowed to GUESS whether an agent should be busy. Each agent
// declares what counts as work for it, as a number. The guard only fires when that
// number is above zero and the agent is demonstrably not working on it.
//
// The undeclared case is deliberately NOT treated as "assume idle is fine": that would
// let an agent silently opt out of the guard forever. It reports a distinct,
// config-gap reason instead, so the caller can nag about the missing declaration
// without ever claiming the agent is slacking.

export type WorkCheckKind =
  // Cards assigned to this agent that are not finished. The default for a worker.
  | 'assigned_open_cards'
  // Cards sitting in testing that this agent has not commented on yet. The reviewer's
  // real queue -- "in testing" alone is not it, because a card stays there after review.
  | 'testing_without_my_comment'
  // The agent genuinely has no queue in this system (an outbound/on-call agent).
  // Declared silence: never alerted about idleness. This is the AgroTech case.
  | 'none'

export interface WorkCheck {
  kind: WorkCheckKind
}

export interface IdleAgentThresholds {
  /** How long the four conditions must hold together before alerting. Guards against
   *  the gap between two turns, which is idle-but-fine for a few seconds. */
  sustainedMs: number
  /** Minimum gap between two alerts for the same agent, so a genuinely stuck agent
   *  is reported once in a while rather than every tick. */
  realertMs: number
}

export interface IdleAgentState {
  /** When the agent was first seen idle-with-work in the current spell; null = not in one. */
  idleSinceMs: number | null
  lastAlertAt: number | null
}

export interface IdleAgentInput {
  agent: string
  /** detectPaneState says the pane is idle (prompt waiting, no spinner).
   *  `null` = could not tell (no session, capture failed, unknown pane). Deliberately
   *  NOT folded into `false`: an unreadable pane is not evidence of work, and treating
   *  it as such silently switches the guard off for that agent. */
  paneIdle: boolean | null
  /** Undelivered inbound messages. If the agent is waiting on the router, that is the
   *  router's problem, not idleness -- alerting here would blame the wrong component. */
  pendingMessages: number
  /** Result of the agent's own declared work check. null = the agent declared nothing. */
  ownWorkCount: number | null
  /** Whether the agent process is running at all. A stopped agent is a different
   *  failure with its own watchers; this guard stays out of it. */
  running: boolean
}

export type IdleDecision =
  | { alert: false; reason: 'not-running' | 'busy' | 'waiting-on-router' | 'no-work' | 'not-sustained' | 'recently-alerted' }
  | { alert: true; reason: 'idle-with-work'; workCount: number; idleForMs: number }
  | { alert: true; reason: 'no-work-check-declared' }
  | { alert: true; reason: 'pane-unreadable' }

export const NO_IDLE_STATE: IdleAgentState = { idleSinceMs: null, lastAlertAt: null }

/**
 * Pure decision. Returns the next state alongside the verdict so the caller owns
 * no logic at all -- the whole point is that this is unit-testable without tmux,
 * a database, or a clock.
 */
export function decideIdleAlert(
  input: IdleAgentInput,
  state: IdleAgentState,
  thresholds: IdleAgentThresholds,
  now: number,
): { decision: IdleDecision; next: IdleAgentState } {
  const clear = (reason: Extract<IdleDecision, { alert: false }>['reason']) => ({
    decision: { alert: false, reason } as IdleDecision,
    next: { ...state, idleSinceMs: null },
  })

  if (!input.running) return clear('not-running')

  // An unreadable pane is NOT "busy". Reported on its own rail, rate-limited like the
  // undeclared case: a pane we cannot read means the guard is blind for that agent, and
  // a blind guard that says nothing is indistinguishable from a healthy fleet.
  if (input.paneIdle === null) {
    if (state.lastAlertAt !== null && now - state.lastAlertAt < thresholds.realertMs) {
      return clear('recently-alerted')
    }
    return {
      decision: { alert: true, reason: 'pane-unreadable' },
      next: { idleSinceMs: null, lastAlertAt: now },
    }
  }

  if (!input.paneIdle) return clear('busy')
  if (input.pendingMessages > 0) return clear('waiting-on-router')

  // Undeclared is a configuration gap, not an idleness verdict. Reported on its own
  // rail, rate-limited by the same realert window so it cannot become a drumbeat.
  if (input.ownWorkCount === null) {
    if (state.lastAlertAt !== null && now - state.lastAlertAt < thresholds.realertMs) {
      return clear('recently-alerted')
    }
    return {
      decision: { alert: true, reason: 'no-work-check-declared' },
      next: { idleSinceMs: null, lastAlertAt: now },
    }
  }

  // Declared "I have nothing to do" -> silence. This is correct behaviour, not a fault.
  if (input.ownWorkCount <= 0) return clear('no-work')

  const idleSinceMs = state.idleSinceMs ?? now
  const idleForMs = now - idleSinceMs
  if (idleForMs < thresholds.sustainedMs) {
    return { decision: { alert: false, reason: 'not-sustained' }, next: { ...state, idleSinceMs } }
  }
  if (state.lastAlertAt !== null && now - state.lastAlertAt < thresholds.realertMs) {
    return { decision: { alert: false, reason: 'recently-alerted' }, next: { ...state, idleSinceMs } }
  }
  return {
    decision: { alert: true, reason: 'idle-with-work', workCount: input.ownWorkCount, idleForMs },
    next: { idleSinceMs, lastAlertAt: now },
  }
}

const VALID_KINDS: readonly WorkCheckKind[] = ['assigned_open_cards', 'testing_without_my_comment', 'none']

/**
 * Parse a declared work check. Returns null for "not declared" -- which is NOT the
 * same as `{kind:'none'}` and must never be silently coerced into it: 'none' is a
 * deliberate statement that the agent has no queue, while null means nobody has said.
 *
 * A malformed declaration also returns null rather than a default. Defaulting a typo
 * to 'assigned_open_cards' would invent a queue the agent never claimed; defaulting it
 * to 'none' would silence the guard on a typo. Both are worse than saying "undeclared".
 */
export function parseWorkCheck(raw: string | null | undefined): WorkCheck | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const kind = (parsed as { kind?: unknown }).kind
  if (typeof kind !== 'string') return null
  if (!VALID_KINDS.includes(kind as WorkCheckKind)) return null
  return { kind: kind as WorkCheckKind }
}

export interface WorkCountCard {
  status: string
  assignee: string | null
  archived_at?: number | null
  /** Last time anything happened on the card. Used to decide whether a reviewer's
   *  earlier comment still covers the card's current state. */
  updated_at?: number | null
}

/**
 * Count the work a declared check refers to, from already-loaded rows. Kept pure and
 * separate from the database so the counting rules are testable on fixtures -- the
 * rules are where the judgement lives, and the SQL is not.
 *
 * `commentAuthorsByCard` maps card id -> the set of authors who have commented.
 */
export function countDeclaredWork(
  check: WorkCheck,
  agent: string,
  cards: (WorkCountCard & { id: string })[],
  lastCommentAtByCard: Map<string, Map<string, number>>,
): number {
  const live = cards.filter((c) => !c.archived_at)
  switch (check.kind) {
    case 'none':
      return 0
    case 'assigned_open_cards': {
      // 'waiting' is excluded: on this board it means blocked on someone else's
      // decision. An agent whose whole queue is 'waiting' is behaving correctly by
      // doing nothing, and nagging them every half hour is the on-call false alarm
      // wearing a different hat. (Didi measured the gap: adding this filter left every
      // test green, so the decision had never actually been made -- 'testing' got a
      // paragraph of reasoning and 'waiting' got nothing.)
      //
      // 'testing' is excluded ONLY while the ball is with the reviewer -- and that is
      // the half the first version got wrong. Didi measured where the other half went:
      // of 70 cards in testing, 34 had her comment as the LAST word. There the finding
      // is written and the ball is back with the assignee, but the card stays in
      // testing (nobody moves it back, and nobody should -- it is still under review).
      // Those 34 fell out of HER queue because she had commented, and out of HIS
      // because testing was excluded wholesale. 63 of 70 cards sat in no counted queue
      // at all; the guard could see 7.
      //
      // The two rules were meant to be complementary and instead left a gap between
      // them, because 'testing' means two things at once -- "awaiting review" and
      // "awaiting fix" -- and the status cannot say which. The last comment can:
      // if someone else spoke last, the assignee owes an answer.
      const isMine = (c: WorkCountCard) => c.assignee === agent
      const open = live.filter((c) => isMine(c) && c.status !== 'done' && c.status !== 'waiting')
      return open.filter((c) => {
        if (c.status !== 'testing') return true
        const authors = lastCommentAtByCard.get(c.id)
        if (!authors || authors.size === 0) return false
        let latestAuthor: string | null = null
        let latestAt = -Infinity
        for (const [author, at] of authors) {
          if (at > latestAt) { latestAt = at; latestAuthor = author }
        }
        // NOT resolvable here: "assigned to X, only X has commented" looks identical
        // whether X is waiting for a separate reviewer (correct to exclude) or is the
        // reviewer themselves (a real hole -- Didi's four self-measured cards fell out
        // of both queues that way). Distinguishing them needs to know WHO reviews this
        // card, which this function is not told. Tried the broad fix -- count it as mine
        // whenever I am the only commenter -- and the existing tests caught it: it would
        // also claim cards that are genuinely waiting for someone else's first look.
        // Left as a known gap on card 52d94a9e; four cards today, all with the same
        // board-level anomaly behind them (a reviewer assigned cards she must review).
        //
        // Someone else had the last word -> an unanswered finding is waiting on me.
        return latestAuthor !== null && latestAuthor !== agent
      }).length
    }
    case 'testing_without_my_comment':
      // The reviewer's real queue -- and the question is whether the review covers the
      // card's CURRENT state, not whether one was ever done.
      //
      // The first version asked "have I ever commented", which permanently retired a
      // card on the reviewer's first comment. Didi measured what that costs on the live
      // board: 70 cards in testing, 61 already commented, and 28 of those had activity
      // AFTER her comment -- cards that came back from a fix. So the moment she cleared
      // her nine, the count would hit zero and the guard would fall silent forever,
      // with 28 cards waiting for a second look. It would switch off exactly when the
      // reviewer had caught up, which is precisely when it is needed.
      return live.filter((c) => {
        if (c.status !== 'testing') return false
        const mine = lastCommentAtByCard.get(c.id)?.get(agent)
        if (mine === undefined) return true
        // No timestamp on the card means we cannot show the comment is stale; leave it
        // out rather than nag on a guess.
        if (c.updated_at == null) return false
        return c.updated_at > mine
      }).length
  }
}
