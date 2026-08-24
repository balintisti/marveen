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
  /** How long the four conditions must hold together before acting. Guards against
   *  the gap between two turns, which is idle-but-fine for a few seconds. */
  sustainedMs: number
  /** Minimum gap between two alerts for the same agent, so a genuinely stuck agent
   *  is reported once in a while rather than every tick. */
  realertMs: number
  /** How long the wake is given to take effect before a human is told. If the agent
   *  picks the work up, it goes busy and the spell ends on its own -- so this window
   *  only ever elapses when the wake genuinely did not work. */
  wakeGraceMs: number
  /** Floor between two wakes of the same agent, across spells. Without it, an agent
   *  that keeps finishing short turns would be woken every few minutes: each spell
   *  looks new, because going busy is exactly what ends the previous one. */
  wakeCooldownMs: number
}

export interface IdleAgentState {
  /** When the agent was first seen idle-with-work in the current spell; null = not in one. */
  idleSinceMs: number | null
  lastAlertAt: number | null
  /** When this agent was last WOKEN (stage 1). Deliberately survives the spell reset:
   *  it is the only thing that stops a wake-per-spell drumbeat, and a spell ends every
   *  time the agent takes a turn. */
  lastWakeAt: number | null
  /** When the COORDINATOR was last told this agent is idle with nothing assigned.
   *  Survives the spell reset for the same reason lastWakeAt does. */
  lastNoWorkNoticeAt?: number | null
  /** The work items named by the LAST wake. An unchanged list is not news: the agent
   *  has already been handed exactly these and either could not act on them or chose
   *  not to, and repeating them costs a whole turn to learn nothing. Survives the spell
   *  reset, like lastWakeAt -- a spell ends every time the agent takes a turn, so a
   *  per-spell record would reset precisely when the repetition starts. */
  lastWakeWorkIds?: readonly string[] | null
}

export interface IdleAgentInput {
  agent: string
  /** The IDs of the work items behind `ownWorkCount`. Optional: when it is absent the
   *  guard behaves exactly as before, so a caller that does not supply it loses nothing
   *  except the repeat-suppression. */
  ownWorkIds?: readonly string[]
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
  /** True when the pane's only busy evidence is a leftover spinner / token-counter
   *  line -- weaker than the footer's `esc to interrupt`, which exists only during a
   *  live turn. Used ONLY by the no-work notice: there a false BUSY costs silence,
   *  possibly forever, while a false IDLE costs one unnecessary notice to the
   *  coordinator. See busyEvidence() in pane-state.ts for the measurement. */
  staleCounterOnly?: boolean
  /** The KIND the agent declared. `'none'` means "this agent has no queue in this
   *  system" -- an on-call agent whose empty board is the correct state, not a leak.
   *  Absent is treated as 'not none': an agent that declared a real check and has zero
   *  cards is the case worth telling the coordinator about. */
  workCheckKind?: string | null
  /** Whether the agent process is running at all. A stopped agent is a different
   *  failure with its own watchers; this guard stays out of it. */
  running: boolean
}

export type IdleDecision =
  | {
      alert: false
      reason:
        | 'not-running' | 'busy' | 'waiting-on-router' | 'no-work' | 'not-sustained'
        | 'recently-alerted'
        // Woken already; the wake is still inside its grace window. Not a fault.
        | 'wake-pending'
        // Idle with work, but this agent was woken too recently to wake again.
        | 'wake-cooling-down'
        // Idle with work, but it is the SAME work the last wake already named. Silence
        // here is the point: a repeated identical list costs a turn and teaches nothing.
        | 'unchanged-since-wake'
    }
  /** Stage 1: tell the AGENT, not a human. The agent is awake, its queue is empty and
   *  the condition is about itself -- it is the only party that can both be reached and
   *  act. A human woken at 22:49 can do nothing here that the agent cannot do faster. */
  | { alert: true; reason: 'wake-agent'; workCount: number; idleForMs: number }
  /** Stage 2: the wake did not take. NOW it is news, because "I woke it and it did not
   *  move" is a fault, while "someone is idle" is not. */
  | { alert: true; reason: 'idle-with-work'; workCount: number; idleForMs: number }
  /** Idle AND nothing assigned. Goes to the COORDINATOR, not the agent and not a human:
   *  waking an agent that has no work only makes it say so, and assigning work is the
   *  coordinator's job. This case used to be silent -- see the note at the call site. */
  | { alert: true; reason: 'idle-no-work'; idleForMs: number }
  | { alert: true; reason: 'no-work-check-declared' }
  | { alert: true; reason: 'pane-unreadable' }

/**
 * Is this the SAME work list as last time? Compared as a SET, deliberately -- not as a
 * count, and not as an ordered list.
 *
 * A COUNT would be the wrong question, and that is measured rather than assumed: on
 * 2026-08-24 a census of uncovered endpoints read 18 both before and after a change,
 * while the population grew by one and the covered set grew by one. The total was
 * stable and the content had moved. A guard that compares totals reports "nothing new"
 * in exactly that case.
 *
 * ORDER is not signal either: the same cards re-sorted by a priority edit are the same
 * news. So: deduplicated, sorted, compared element by element.
 */
export function sameWorkSet(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  if (a == null || b == null) return false
  const norm = (xs: readonly string[]) => [...new Set(xs)].sort()
  const x = norm(a)
  const y = norm(b)
  return x.length === y.length && x.every((v, i) => v === y[i])
}

export const NO_IDLE_STATE: IdleAgentState = { idleSinceMs: null, lastAlertAt: null, lastWakeAt: null }

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
      next: { ...state, idleSinceMs: null, lastAlertAt: now },
    }
  }

  // The no-work notice reads a counter-only 'busy' as idle, and NOTHING ELSE does.
  //
  // Measured end to end by jarvis 2026-08-22: after the busy pattern was widened to
  // minute-form counters, a stale counter above an idle footer silenced the notice --
  // in exactly the state the notice was built for. The two consumers of this detector
  // have opposite cost profiles, so they get different thresholds rather than one
  // boolean tuned as a compromise:
  //   injection / wake     -> a false BUSY costs a wait cycle, a false IDLE interrupts
  //                           a live turn. Strict: any busy is busy.
  //   idle-with-no-work    -> a false BUSY costs SILENCE, a false IDLE costs one notice.
  //                           Lenient: leftover render is not evidence of work.
  // This is NOT a narrowing of the pattern. Narrowing would bring back dd3fec50 (long
  // turns read as idle); the pattern stays wide, only the WEIGHT of its verdict differs
  // per question.
  const countsAsIdleForNoWork = input.paneIdle || input.staleCounterOnly === true
  if (!input.paneIdle && !countsAsIdleForNoWork) return clear('busy')
  if (!input.paneIdle && (input.ownWorkCount ?? 0) > 0) return clear('busy')
  if (input.pendingMessages > 0) return clear('waiting-on-router')

  // Undeclared is a configuration gap, not an idleness verdict. Reported on its own
  // rail, rate-limited by the same realert window so it cannot become a drumbeat.
  if (input.ownWorkCount === null) {
    if (state.lastAlertAt !== null && now - state.lastAlertAt < thresholds.realertMs) {
      return clear('recently-alerted')
    }
    return {
      decision: { alert: true, reason: 'no-work-check-declared' },
      next: { ...state, idleSinceMs: null, lastAlertAt: now },
    }
  }

  // THE AGROTECH CASE, and it short-circuits BEFORE the spell even starts. An agent
  // whose declared check is `none` has no queue in this system at all: its empty board
  // is the correct state, and a guard that reports it every half hour is the guard that
  // gets muted -- after which it protects nothing. The distinction is what the agent
  // DECLARED, not how many cards it happens to have: `none` means on-call, any other
  // kind means "I am supposed to have work, and I have none".
  if ((input.ownWorkCount ?? 0) <= 0 && (input.workCheckKind ?? '') === 'none') {
    return clear('no-work')
  }

  const idleSinceMs = state.idleSinceMs ?? now
  const idleForMs = now - idleSinceMs
  if (idleForMs < thresholds.sustainedMs) {
    return { decision: { alert: false, reason: 'not-sustained' }, next: { ...state, idleSinceMs } }
  }

  // Idle AND nothing assigned. This used to return silently, with the comment
  // "declared 'I have nothing to do' -> silence. This is correct behaviour, not a
  // fault." That was right about the AGENT and wrong about the FLEET.
  //
  // An agent standing at an empty prompt with zero assigned cards is the most
  // expensive state there is: it is not blocked, not thinking, and nobody is going to
  // notice, because the guard was built to catch the opposite case. Measured
  // 2026-08-22 20:43: three of four agents stood idle with empty queues and no
  // assigned work while the five-hour window ran down, and the guard said nothing
  // about any of them -- correctly, by its own rule.
  //
  // The notice goes to the COORDINATOR, not to the agent and not to the owner. Waking
  // the agent would only make it answer "I have nothing"; the owner cannot assign
  // cards at 22:00 and should not be asked to. Assigning work is the coordinator's job,
  // so the coordinator is the only party that can both be reached and act -- the same
  // argument the stage-1 wake makes for the agent itself.
  if (input.ownWorkCount <= 0) {
    const lastNotice = state.lastNoWorkNoticeAt ?? null
    if (lastNotice !== null && now - lastNotice < thresholds.realertMs) {
      return { decision: { alert: false, reason: 'recently-alerted' }, next: { ...state, idleSinceMs } }
    }
    return {
      decision: { alert: true, reason: 'idle-no-work', idleForMs },
      next: { ...state, idleSinceMs, lastNoWorkNoticeAt: now },
    }
  }

  // ---- stage 1: wake the agent -------------------------------------------------
  //
  // Measured 2026-08-21, and this is the whole reason the guard has two stages. Didi
  // ended a turn with the words "azt veszem kovetkezonek" -- naming the next card --
  // and then stood at an empty prompt for 13.5 minutes with 48 items waiting. Nothing
  // was broken and no rule was disobeyed: AN AGENT CANNOT START ITS OWN TURN. The
  // intention lives inside a turn and dies with it. The only thing that starts one is
  // an inbound message, so the fix is not a louder alarm -- it is a message.
  const lastWakeAt = state.lastWakeAt
  // Written as an explicit null-or-older test rather than a `wokeThisSpell` boolean so
  // the compiler can narrow lastWakeAt to a number below; a boolean flag would not.
  if (lastWakeAt === null || lastWakeAt < idleSinceMs) {
    if (lastWakeAt !== null && now - lastWakeAt < thresholds.wakeCooldownMs) {
      return { decision: { alert: false, reason: 'wake-cooling-down' }, next: { ...state, idleSinceMs } }
    }
    // THE SAME LIST IS NOT NEWS. Measured 2026-08-24 on friday: five wakes in two and a
    // half hours, every one naming the identical set, every one a no-op -- and each
    // costs a full turn, which during a fleet-wide API outage was one of the few turns
    // anyone could still spend. The cooldown alone cannot stop this, because a spell
    // ends every time the agent takes a turn: answering the wake re-arms it.
    //
    // A CHANGE re-arms immediately, including a REMOVAL -- the set is compared, not the
    // count, so "one closed, one opened" is news rather than silence.
    if (input.ownWorkIds !== undefined && sameWorkSet(input.ownWorkIds, state.lastWakeWorkIds)) {
      return { decision: { alert: false, reason: 'unchanged-since-wake' }, next: { ...state, idleSinceMs } }
    }
    return {
      decision: { alert: true, reason: 'wake-agent', workCount: input.ownWorkCount, idleForMs },
      next: { ...state, idleSinceMs, lastWakeAt: now, lastWakeWorkIds: input.ownWorkIds ?? null },
    }
  }

  // ---- stage 2: the wake did not take, so tell a human -------------------------
  //
  // No extra bookkeeping decides "did it help": if it helped, the agent went busy, the
  // spell was cleared, and this line is never reached. Reaching it IS the evidence.
  if (now - lastWakeAt < thresholds.wakeGraceMs) {
    return { decision: { alert: false, reason: 'wake-pending' }, next: { ...state, idleSinceMs } }
  }
  if (state.lastAlertAt !== null && now - state.lastAlertAt < thresholds.realertMs) {
    return { decision: { alert: false, reason: 'recently-alerted' }, next: { ...state, idleSinceMs } }
  }
  return {
    decision: { alert: true, reason: 'idle-with-work', workCount: input.ownWorkCount, idleForMs },
    next: { ...state, idleSinceMs, lastAlertAt: now },
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
  /** A date the card was deliberately deferred TO. Distinct from `waiting`, and the
   *  distinction matters: `waiting` means we are blocked on someone ELSE, a future
   *  due_date means WE decided to do it later. Conflating them makes `waiting` mean
   *  two things again. (jarvis, 2026-08-22) */
  due_date?: number | null
  /** The card's labels, as the LIST endpoint returns them. Optional, and that is a trap
   *  worth naming: `GET /api/kanban` includes this field, `GET /api/kanban/<id>` does
   *  NOT (measured 2026-08-24). A caller that fills these cards from the detail endpoint
   *  sees no labels at all -- and the failure is silent, because "no labels" and "field
   *  absent" look identical from here. Use the list endpoint. */
  labels?: readonly { name?: string | null }[] | null
}

/**
 * The one canonical label meaning "this card is blocked on the OWNER's decision".
 *
 * WHY A LABEL AND NOT THE TEXT (card 0fe791fb, measured 2026-08-24). The question is
 * "who is this waiting on RIGHT NOW", and a comment cannot answer it: comments are
 * append-only, so "waiting on Isti's decision" stays written after Isti has decided.
 * Measured on the 64 waiting cards: a title keyword filter found 18 and missed real
 * ones; widening it to description and last comment found 33 and swept in cards that
 * were already settled -- including 0a15a0ea, whose last comment says the owner
 * approved it that same morning. THE TEXT RECORDS THE HISTORY, NOT THE STATE.
 *
 * A label is a state because it can be TAKEN OFF when the answer arrives. That is the
 * whole argument, and it is why `assignee` was not chosen instead: it already carries a
 * contested meaning (card 2b9d69a9) and would carry two.
 */
export const WAITING_LABEL_PREFIX = 'varakozik:'
/** One scheme, three values, and each NAMES WHO IT WAITS ON rather than what happened.
 *  A reader does not have to remember which word means what -- the label says it. */
export const WAITING_ON_OWNER_LABEL = 'varakozik:isti'
export const WAITING_ON_COORDINATOR_LABEL = 'varakozik:koordinator'
export const WAITING_ON_ASSIGNEE_LABEL = 'varakozik:assignee'

/** Normalised label names on a card: trimmed and lower-cased, for the reason given at
 *  `isWaitingOnOwner` -- an exact match fails SILENTLY, and silence is the expensive
 *  direction here. */
function labelNames(card: WorkCountCard): string[] {
  return (card.labels ?? []).map((l) => (l?.name ?? '').trim().toLowerCase()).filter(Boolean)
}

/** Does the card carry ANY label from the waiting family? Distinct from "waits on X":
 *  a card with no such label has not been triaged at all, which is its own state. */
export function hasWaitingLabel(card: WorkCountCard): boolean {
  return labelNames(card).some((n) => n.startsWith(WAITING_LABEL_PREFIX))
}

/**
 * Matched case-insensitively and trimmed, on purpose. An exact match would be stricter,
 * but its failure is SILENT: a card labelled `Varakozik:Isti` would simply never appear,
 * and "no cards await the owner" is exactly the reassuring answer nobody re-checks.
 * A visible duplicate in the label list is the cheaper problem.
 */
export function isWaitingOnOwner(card: WorkCountCard): boolean {
  if (card.status !== 'waiting') return false
  return labelNames(card).includes(WAITING_ON_OWNER_LABEL)
}

/**
 * What the COORDINATOR has to look at: every `testing` card that is either explicitly
 * his (`varakozik:koordinator`) or has NOT BEEN TRIAGED AT ALL.
 *
 * The untriaged half is the deliberate part. Whoever did not mark the card did not
 * decide, and an undecided item is triage -- which is the coordinator's job. Routing it
 * to him means NOTHING falls silent, the assignee is not charged for someone else's
 * bookkeeping, and the cost lands where the convention was declared.
 *
 * Measured on friday's board (2026-08-24): of 11 such items, zero were questions to the
 * assignee and three had already been closed by hand by the coordinator that morning --
 * so the untriaged ones were his in practice before they were his by rule.
 */
export function selectCoordinatorTriage<T extends WorkCountCard>(cards: readonly T[]): T[] {
  return cards.filter((c) => {
    if (c.archived_at || c.status !== 'testing') return false
    const names = labelNames(c)
    if (names.includes(WAITING_ON_ASSIGNEE_LABEL)) return false
    return names.includes(WAITING_ON_COORDINATOR_LABEL) || !hasWaitingLabel(c)
  })
}

/** The subset requirement: from every open card, the ones blocked on the owner. */
export function selectWaitingOnOwner<T extends WorkCountCard>(cards: readonly T[]): T[] {
  return cards.filter((c) => !c.archived_at && isWaitingOnOwner(c))
}

/**
 * The work a declared check refers to, from already-loaded rows. Kept pure and
 * separate from the database so the counting rules are testable on fixtures -- the
 * rules are where the judgement lives, and the SQL is not.
 *
 * Returns the ITEMS, not a count: the wake message has to name concrete cards. A wake
 * that only says "you have work" is the one thing measured NOT to work -- what moved
 * Didi at 22:30 was six cards named in priority order.
 *
 * `commentAuthorsByCard` maps card id -> the set of authors who have commented.
 */
export function selectDeclaredWork<T extends WorkCountCard & { id: string }>(
  check: WorkCheck,
  agent: string,
  cards: T[],
  lastCommentAtByCard: Map<string, Map<string, number>>,
  /** The coordinator's id. Its comments are COORDINATION (acknowledgement, a decision,
   *  a hand-off), not review -- and it comments on nearly every card, so counting its
   *  last word as "an unanswered finding" permanently colonises the top of every
   *  agent's queue. Measured 2026-08-22: of the six cards the wake put in front of
   *  dexter, FOUR had marveen as the last commenter, all of them acknowledgements.
   *  Omit it only where there is no coordinator to speak of. */
  coordinator?: string,
  /** Now, in epoch SECONDS (the column's unit). Injected rather than read from the
   *  clock so this function stays pure and testable on fixtures. */
  now?: number,
): T[] {
  const live = cards.filter((c) => !c.archived_at)
  switch (check.kind) {
    case 'none':
      return []
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
      // A card with a FUTURE due_date is not pickable today: someone deliberately
      // deferred it, usually with a written reopening condition. Measured 2026-08-22:
      // the guard offered jarvis his own card, dated to 2026-09-05 -- the count was
      // right and the input was incomplete. An idle guard that offers unpickable work
      // spends the only thing it has, which is being believed; that is the same failure
      // as telling a reviewer she has no work while 40 items wait.
      //
      // Today this hides exactly ONE card of the whole board -- I measured before
      // writing it, and it is not the reason. The reason is that the guard must not
      // teach anyone to skim its list.
      const isMine = (c: WorkCountCard) => c.assignee === agent
      const deferred = (c: WorkCountCard) =>
        now !== undefined && c.due_date != null && c.due_date > now
      const open = live.filter(
        (c) => isMine(c) && c.status !== 'done' && c.status !== 'waiting' && !deferred(c),
      )
      return open.filter((c) => {
        if (c.status !== 'testing') return true
        // THE RULE THAT USED TO BE HERE, AND WHY IT IS GONE (card 0fe791fb, 2026-08-24).
        //
        // It read: "if someone else spoke last, the assignee owes an answer" -- and the
        // comment below it still explains the gap it was built to close, which was real.
        // What it could not see is WHAT the other person said. Measured over friday's 11
        // such items: ZERO were questions. Three were verifiers saying the card was
        // closable (the coordinator's business, not the assignee's), five were jarvis
        // resolving stale commit hashes -- bookkeeping that says "the card's claim is
        // UNCHANGED" -- and three were confirmations. The guard woke the assignee five
        // times over that list, every time a no-op.
        //
        // The author of the last comment is not the signal. WHO IT WAITS ON is, and that
        // now has a label. A card the assignee genuinely owes an answer on carries
        // `varakozik:assignee`; anything else is not his queue.
        //
        // AND THE ABSENT LABEL IS NOT SILENCE: an untriaged card goes to the COORDINATOR
        // (see selectCoordinatorTriage). "Nobody's" was the tempting rule and it is the
        // wrong one -- a missing `varakozik:assignee` would leave a real question waiting
        // mutely, and the cost of that lands on whoever forgot, which is never a design.
        if (!labelNames(c).includes(WAITING_ON_ASSIGNEE_LABEL)) return false
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
        // A REVIEWER had the last word -> an unanswered finding is waiting on me.
        // "Someone else" was too wide: it swept in the coordinator, whose comment is
        // the opposite signal -- it usually means the card is settled, not open.
        return latestAuthor !== null && latestAuthor !== agent && latestAuthor !== coordinator
      })
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
      })
  }
}

/**
 * The count the guard decides on. Kept as a thin wrapper over selectDeclaredWork so the
 * number the alert quotes and the items the wake message names can never disagree --
 * two separate implementations of "what counts as work" would drift, and the drift would
 * show up as a wake that names nothing while the alert claims 48 items.
 */
export function countDeclaredWork(
  check: WorkCheck,
  agent: string,
  cards: (WorkCountCard & { id: string })[],
  lastCommentAtByCard: Map<string, Map<string, number>>,
  coordinator?: string,
  now?: number,
): number {
  return selectDeclaredWork(check, agent, cards, lastCommentAtByCard, coordinator, now).length
}

/** What the COORDINATOR gets when an agent stands idle with nothing assigned.
 *
 *  Deliberately NOT sent to the agent: it already knows it has nothing, and telling it
 *  so produces a turn whose entire content is "I have nothing". And deliberately not to
 *  the owner: assigning cards is the coordinator's job, and a 22:00 notification cannot
 *  make it happen faster.
 *
 *  It names the agent and the duration, and asks for the one thing that ends the state.
 *  It does NOT name candidate cards -- picking them needs the board and the fleet's
 *  current shape, which is what the coordinator has and this function does not. */
export function buildNoWorkNotice(agent: string, minutes: number): string {
  return [
    `[tetlen-or] A(z) "${agent}" ${minutes} perce ures prompton all, ES NINCS RA KIOSZTVA SEMMI.`,
    '',
    'Ez nem az o hibaja es nem is akadaly: nincs mit felvennie. A tetlen-or eddig HALLGATOTT',
    'errol az esetrol -- azt figyelte, akinek VAN munkaja es megsem mozdul --, tehat epp a',
    'legdragabb allapot volt lathatatlan.',
    '',
    'Amit tolem var: adj neki kartyat, vagy ha tenyleg nincs neki valo, mondd ki a kartyan,',
    'hogy miert all -- kulonben a kovetkezo korben ugyanezt fogom kuldeni.',
  ].join('\n')
}

/** The wake an agent actually acts on.
 *
 *  Measured 2026-08-21: a wake that says "you have work" is the version that does not
 *  move anyone -- what moved Didi at 22:30 was six cards named in priority order, and
 *  she took the first one within two minutes. So the message names items, and it says
 *  WHY it arrived, because a session that cannot explain the gap in its own history
 *  will spend its first minutes investigating instead of working.
 *
 *  Measured again 2026-08-22, and this is why the ordering is not by priority alone:
 *  Dexter counted his own board (167 planned, 46 testing) and found ALL SIX cards the
 *  wake put in front of him were `testing` -- none of them work he could pick up. A
 *  plain priority sort floats every high-priority review to the top, so the pickable
 *  work never appears. The fix is not fewer items; it is ordering by what the reader
 *  can ACT on, and saying on each line which kind it is. */
export function buildWakeMessage(
  agent: string,
  minutes: number,
  workCount: number,
  items: { id: string; title?: string | null; priority?: string | null; status?: string }[],
  kind: WorkCheckKind = 'assigned_open_cards',
): string {
  const rank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
  // Pickable first, then priority within each group. WHICH cards are pickable depends on
  // WHY they were selected, and getting that backwards produced a self-contradicting wake:
  // Didi (2026-08-22) received one message that said "40 tetel var rád" and "Nincs felveheto
  // munkad" at the same time. Her check is `testing_without_my_comment` -- for a reviewer the
  // `testing` column IS the work, so a rule written for an assignee's own queue inverts on her.
  // A reviewer told "no pickable work" is a reviewer who stops, which is exactly what this
  // guard exists to prevent.
  const isReviewQueue = kind === 'testing_without_my_comment'
  const pickable = (c: { status?: string }) =>
    isReviewQueue ? c.status === 'testing' : c.status !== 'testing'
  const byPriority = (a: { priority?: string | null }, b: { priority?: string | null }) =>
    (rank[a.priority ?? 'normal'] ?? 2) - (rank[b.priority ?? 'normal'] ?? 2)
  const work = [...items].filter(pickable).sort(byPriority)
  const review = [...items].filter((c) => !pickable(c)).sort(byPriority)

  const line = (c: { id: string; title?: string | null; priority?: string | null; status?: string }) =>
    `  ${c.id.slice(0, 8)}  ${(c.status ?? '?').padEnd(11)} ${(c.priority ?? 'normal').padEnd(6)}  ${(c.title ?? '').slice(0, 60)}`

  const out = [
    `[tetlen-or] ${minutes} perce allsz ureses prompton, es ${workCount} tetel var rád.`,
    '',
    'EZ NEM SZEMREHANYAS, ES NEM A TE HIBAD. Egy agens nem tud maganak uj fordulot inditani:',
    'a szandek a fordulo belsejeben el, es a fordulo vegen meghal vele. Az egyetlen dolog, ami',
    'uj fordulot indit, egy beerkezo uzenet -- ezert kapod ezt. Isti NEM lett ertesitve.',
    '',
  ]
  if (work.length) {
    out.push(
      isReviewQueue
        ? `FELVEHETO ELLENORZES (${work.length}) -- ezek varnak a te valaszodra:`
        : `FELVEHETO MUNKA (${work.length}) -- ezekbe bele lehet kezdeni:`,
      ...work.slice(0, 5).map(line),
    )
  }
  if (review.length) {
    out.push(
      '',
      isReviewQueue
        ? `EGYEB TETEL (${review.length}) -- nem a testing oszlopbol, nezd meg mit kerol:`
        : `VALASZRA VARO ELLENORZES (${review.length}) -- ezeken egy ellenorzo szolt utoljara, nem munka:`,
      ...review.slice(0, 3).map(line),
    )
  }
  if (!work.length && !review.length) {
    out.push('A szamlalod nem nulla, de tetelt nem tudtam megnevezni -- nezd meg a tablat.')
  }
  out.push(
    '',
    work.length
      ? 'Vedd fel a legfelso FELVEHETO tetelt. Ha egyik sem a tied, ird meg egy sorban, hogy miert --'
      : isReviewQueue
        ? 'Nem tudtam megnevezni felveheto ellenorzest. Ha a szamlalod megsem nulla, ird meg egy sorban --'
        : 'Nincs felveheto munkad, csak valaszra varo ellenorzes. Ha ez sem a tied, ird meg egy sorban --',
    'akkor a workcheck.json-od hazudik, es azt kell javitani, nem teged ebreszteni.',
  )
  return out.join('\n')
}

/** One human-facing alert raised during a single sweep, before it is sent. */
export interface FleetAlert {
  kind: 'still-idle' | 'pane-unreadable' | 'no-work-check' | 'wake-enqueue-failed'
  agent: string
  minutes?: number
  workCount?: number
}

/** Collapse a sweep's alerts into ONE owner-facing message.
 *
 *  Measured 2026-08-22: the watcher called sendAlert() inside its per-agent loop, so
 *  four idle agents produced FOUR Telegram messages -- and again at the next re-alert
 *  window. The owner got eight notifications between 04:58 and 05:28 for one situation
 *  ("the fleet is standing"), while asleep. Nothing was wrong with the escalation; the
 *  fan-out was. Per-agent rate limiting cannot fix it, because the limit is per agent:
 *  the more agents there are, the more copies of the same news.
 *
 *  A single alert keeps its original single-agent wording -- the fleet case must not
 *  make the common case worse. Two or more are grouped by kind, because the kinds ask
 *  for different things: "still idle" is a look-at-the-pane, a missing work-check is a
 *  config gap, and an unreadable pane means the guard is BLIND, not that anyone is idle. */
export function buildFleetAlert(alerts: FleetAlert[]): string {
  if (alerts.length === 0) return ''

  const stillIdle = (a: FleetAlert) =>
    `A(z) "${a.agent}" ${a.minutes} perce tetlen, ${a.workCount} tetellel a soraban, ES MAR ` +
    `FELEBRESZTETTEM -- az ebreszto uzenetet megkapta, megsem mozdult. Ezert szolok: nem az a hir, ` +
    `hogy all valaki, hanem hogy egy ebresztes nem hatott. Nezd meg a panelt (elakadt turn, telitett ` +
    `kontextus), vagy ha tenyleg nincs mit tennie, az a workcheck.json-jaban latszodjon.`
  const paneUnreadable = (a: FleetAlert) =>
    `A(z) "${a.agent}" panelje NEM OLVASHATO (nincs session, vagy a capture elszallt), ezert nem ` +
    `tudom megmondani, dolgozik-e. Ez NEM azt jelenti, hogy dolgozik -- azt jelenti, hogy az or VAK ` +
    `erre az agensre. Nezd meg a tmux session-jet.`
  const noWorkCheck = (a: FleetAlert) =>
    `A(z) "${a.agent}" agensnek NINCS workcheck.json-ja, ezert nem tudom megmondani, van-e dolga. ` +
    `Ez konfiguracios hiany, NEM az agens hibaja -- amig nincs, a tetlenseg-or rá nem mukodik. ` +
    `Fajl: agents/${a.agent}/workcheck.json, tartalom pl. {"kind":"none"} ha ennek az agensnek ` +
    `nincs sora ebben a rendszerben.`
  const enqueueFailed = (a: FleetAlert) =>
    `A(z) "${a.agent}" ${a.minutes} perce tetlen, ${a.workCount} tetellel, es az EBRESZTO UZENETET ` +
    `SEM SIKERULT betenni a soraba. Ez nem tetlenseg-kerdes tobbe, hanem az uzenetsore. Nezd meg kezzel.`

  const single: Record<FleetAlert['kind'], (a: FleetAlert) => string> = {
    'still-idle': stillIdle,
    'pane-unreadable': paneUnreadable,
    'no-work-check': noWorkCheck,
    'wake-enqueue-failed': enqueueFailed,
  }

  if (alerts.length === 1) return `[tetlen-or] ${single[alerts[0].kind](alerts[0])}`

  // Group headers say what to DO, because that is what differs between the kinds.
  const groups: { kind: FleetAlert['kind']; header: string; line: (a: FleetAlert) => string }[] = [
    {
      kind: 'still-idle',
      header: 'EBRESZTES UTAN IS ALL (nezd meg a panelt: elakadt turn, telitett kontextus):',
      line: (a) => `  ${a.agent} -- ${a.minutes} perce, ${a.workCount} tetellel`,
    },
    {
      kind: 'wake-enqueue-failed',
      header: 'AZ EBRESZTOT BE SEM LEHETETT TENNI A SORBA (ez mar az uzenetsor baja):',
      line: (a) => `  ${a.agent} -- ${a.minutes} perce, ${a.workCount} tetellel`,
    },
    {
      kind: 'pane-unreadable',
      header: 'A PANEL NEM OLVASHATO -- az or VAK ezekre, nem azt mondja, hogy dolgoznak:',
      line: (a) => `  ${a.agent}`,
    },
    {
      kind: 'no-work-check',
      header: 'NINCS workcheck.json (konfiguracios hiany, nem az agens hibaja):',
      line: (a) => `  ${a.agent}`,
    },
  ]

  const out = [`[tetlen-or] ${alerts.length} agensrol szolok EGY uzenetben.`]
  for (const g of groups) {
    const mine = alerts.filter((a) => a.kind === g.kind)
    if (!mine.length) continue
    out.push('', g.header, ...mine.map(g.line))
  }
  return out.join('\n')
}
