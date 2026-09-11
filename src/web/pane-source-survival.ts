/**
 * PER-PANE LAST-INJECTION SURVIVAL RECORD (card c4b99fa7).
 *
 * WHAT THIS ANSWERS, AND WHY IT IS NOT THE INJECTED-PROMPT REGISTRY.
 *
 *   injected-prompt-registry ... many entries, short life (10 min TTL), answers MATCHING
 *                               ("is the text in the box one we just injected?")
 *   THIS module ................ one entry per pane, no expiry, answers SURVIVAL
 *                               ("if we drop what is parked, does its producer bring it back?")
 *
 * Keeping them apart is deliberate. The registry's 10-minute TTL is CORRECT for its own
 * question; stretching it to answer "what did we put in this pane hours ago" would change
 * what that module is for, against a retention policy never designed for it. The survival
 * question is bounded -- one entry per pane, roughly seven of them -- so it does not need
 * the registry's eviction pressure at all.
 *
 * WHY THE ANSWER CANNOT BE READ OUT OF THE TEXT. This is the finding the whole design rests
 * on, and it is recorded here rather than only on the card so that a later reader cannot
 * "simplify" the declaration back into a detector:
 *
 *     [tetlen-or]        a periodic idle notice -- the router rebuilds it from live state
 *                        every tick, so dropping one costs a single cycle of delay
 *     [handoff-failure]  fired AFTER markMessageFailed, then `continue`; the row stays
 *                        FAILED and is never queued again -- dropping it loses the only trace
 *
 * Both are `[word]`-prefixed system notices. They are BYTE-IDENTICAL IN SHAPE and have
 * OPPOSITE answers. No prefix list, no name convention and no cleverer pattern can separate
 * them, because the information is not in the text -- it is in what the PRODUCER does with
 * its source in the lines after the send. Hence a declaration, not a detector.
 *
 * FAILURE DIRECTION IS FAIL-SAFE, and that is what makes an in-memory map acceptable here.
 * The record is lost on a dashboard restart. A missing record means the recovery stack falls
 * back to the behaviour it has today (conservative `hold`), never to something less safe --
 * so being wrong about process lifetimes costs exactly zero against the status quo. Measured
 * separately: the 10-hour anchor incident ran entirely inside ONE dashboard process, but that
 * is n=1 and is NOT the argument; the fail-safe direction is.
 */

/**
 * What happens to a prompt's SOURCE if the prompt never lands.
 *
 * Three arms, because two would force a FALSE statement about a live code path:
 * `degrades` filed as 'redelivered' asserts the prompt comes back (it does not), and filed
 * as 'lost' asserts there is no fallback (there is one).
 *
 * There is deliberately NO 'unknown' arm. An unknown would be consumed as "treat
 * conservatively" -- which is today's behaviour -- so the call site would gain nothing while
 * appearing covered. That is a default returning under another name. A site that genuinely
 * cannot answer is a FINDING about that call path, not a new enum value.
 */
export type SourceSurvival =
  /** The producer re-derives this from live state; dropping it costs one cycle of delay. */
  | 'redelivered'
  /** Never re-issued, but a WORSE and non-silent fallback fires (e.g. a deadline forces a
   *  restart). Distinct from both other arms: the prompt does not return, yet the system
   *  does not go quiet either. */
  | 'degrades'
  /** Nothing re-delivers it and nothing escalates. Dropping it destroys the only copy.
   *
   *  A declaration must be true WITHOUT relying on the mechanism that reads it: a path that
   *  survives only because the injection funnel happens to record it first declares 'lost',
   *  because when that record is absent -- a restart -- it genuinely is. The record saving it
   *  anyway is a bonus, not a claim. */
  | 'lost'

interface PaneSourceRecord {
  survival: SourceSurvival
  /** Why the caller declared what it did -- carried for diagnosis, never branched on. */
  reason: string
  at: number
}

/** One entry per pane. Bounded by the number of live panes (~7), so no eviction policy. */
const records = new Map<string, PaneSourceRecord>()

/**
 * Record what the CALLER declared about the prompt it is about to inject.
 *
 * Called from the single injection choke point, so scheduled ticks, inter-agent messages,
 * context-guard prompts and recovery re-injections are all covered by construction rather
 * than by each caller remembering.
 */
export function recordPaneSource(
  session: string,
  survival: SourceSurvival,
  reason: string,
  now: number = Date.now(),
): void {
  if (session.length === 0) return
  records.set(session, { survival, reason, at: now })
}

/** What was last injected into this pane, or null if this process never injected into it. */
export function getPaneSource(session: string): PaneSourceRecord | null {
  return records.get(session) ?? null
}

/**
 * Does the parked text in this pane have a producer that will bring it back?
 *
 * Returns FALSE when nothing is on record. That is the fail-safe direction: with no record
 * we must assume dropping the text destroys it, which keeps the recovery stack on the
 * conservative path it already takes today.
 */
export function paneSourceSurvivesDrop(session: string): boolean {
  return records.get(session)?.survival === 'redelivered'
}

/** Test-only: drop all state so cases cannot leak into each other. */
export function resetPaneSourcesForTest(): void {
  records.clear()
}
