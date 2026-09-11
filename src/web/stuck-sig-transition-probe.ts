import { createHash } from 'node:crypto'
import { logger } from '../logger.js'

/** DIAGNOSTIC ONLY (card 7406eb1f). This module NEVER acts on a pane and never
 *  influences a decision. It exists to settle ONE ambiguity that the existing
 *  logs structurally cannot.
 *
 *  THE QUESTION. Across a measured 10-hour park of the main channel pane, the
 *  hard-restart deferral logged `attempts: 0` on all 41 ticks. `attempts` is
 *  what gates the restart (decideStuckInputRestart returns 'skip' while
 *  attempts < maxAttempts), so the deadlock carve-out below it was never even
 *  consulted. But the counter alone cannot say WHY it stayed at zero:
 *
 *    (a) the parked SIGNATURE kept changing -- decideStuckInputRecovery resets
 *        attempts to 0 and restarts the confirm window on every change
 *    (b) the CONFIRM WINDOW never elapsed -- the signature was stable but each
 *        tick still fell inside confirmMs
 *
 *  Both produce `attempts: 0` forever, and they call for opposite fixes. If (a)
 *  holds it is the more serious finding: across that whole park the soft
 *  recovery would never have fired once.
 *
 *  WHY THIS LOGS FACTS AND NOT A VERDICT. The obvious shape is a classifier that
 *  mirrors decideStuckInputRecovery's branch order and names the blocking gate.
 *  That is a SECOND implementation of the same logic: it would agree today and
 *  drift the moment either side is edited, and a drifted classifier is worse
 *  than none because its output still looks authoritative. So this emits the raw
 *  transition facts and leaves the classification to analysis time, where the
 *  real function's source is available to read alongside the numbers.
 *
 *  WHY THE SIGNATURE IS HASHED. The signature is derived from the parked text,
 *  which is message content. A raw signature in a log file is message content in
 *  a log file. The question only needs to know whether it CHANGED, and a short
 *  digest answers that without carrying the text. */

function shortDigest(sig: string | null): string | null {
  if (sig === null) return null
  return createHash('sha256').update(sig).digest('hex').slice(0, 10)
}

export interface SigTransitionFacts {
  /** Did the parked signature change since the previous tick? The (a) axis. */
  sigChanged: boolean
  /** Is anything parked right now? */
  sigPresent: boolean
  /** Digest of the current signature -- identity without content. */
  sigHash: string | null
  /** Digest of the previous signature, for reading a run of ticks in sequence. */
  prevSigHash: string | null
  /** attempts as the recovery saw it on ENTRY, i.e. before this tick's decision. */
  attemptsBefore: number
  /** How long the CURRENT spell has been observed, or null if none is open.
   *  Compared against confirmMs at analysis time -- the (b) axis. */
  spellAgeMs: number | null
  /** Did the recovery actually fire this tick? */
  recovered: boolean
}

/** Build the facts. Pure, so it is testable without tmux or a clock. */
export function sigTransitionFacts(
  sig: string | null,
  prevSig: string | null,
  prevFirstSeenAt: number | null,
  prevAttempts: number,
  recovered: boolean,
  now: number,
): SigTransitionFacts {
  return {
    sigChanged: sig !== prevSig,
    sigPresent: sig !== null,
    sigHash: shortDigest(sig),
    prevSigHash: shortDigest(prevSig),
    attemptsBefore: prevAttempts,
    spellAgeMs: prevFirstSeenAt === null ? null : now - prevFirstSeenAt,
    recovered,
  }
}

/** Emit one line per tick that has parked input, or that just ended a spell.
 *
 *  Deliberately silent when nothing is parked and nothing was: that is the
 *  overwhelming majority of ticks across every session, and logging it would
 *  bury the population this exists to measure. */
export function probeSigTransition(
  session: string,
  agent: string | null,
  facts: SigTransitionFacts,
): void {
  if (!facts.sigPresent && facts.prevSigHash === null) return
  logger.info({ session, agent, ...facts }, 'parked-sig transition (diagnostic, card 7406eb1f)')
}
