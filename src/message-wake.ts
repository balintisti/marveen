// Wake class of an inter-agent message (card a85a9acd).
//
// A machine notice may WAKE a pane only when its recipient has a decision or an action to take.
// Every other notice still lands in the queue, but it is delivered together with the next
// delivery that happens for another reason; nothing nudges, alarms or ages on its account.
//
// THE SENDER MARKS THIS (`wake` on the row, written by createAgentMessage). This module never
// guesses from the text: a classifier that reads wording breaks the day somebody rewords the
// notice, and it breaks in the direction that silences a real alert.
//
// Pure on purpose (no db, no tmux), so the decisions are testable on fixtures and every reader
// that must ignore quiet rows shares ONE definition of "quiet".

/** A row as the wake rules need it. `wake` is absent on rows from before the column existed
 *  and on test fixtures; absent means WAKING, because the failure to avoid is silence. */
export interface WakeClassed {
  wake?: number | null
}

/** How long a quiet (wake=0) row may sit pending before it is closed as expired. A sub-agent
 *  that rarely receives a waking message would otherwise collect notices forever, and every
 *  reader that counts pending rows would count them (coordinator decision, 2026-10-16). */
export const UNWOKEN_EXPIRY_S = 24 * 3600

/** The `result` an expired quiet row is closed with. */
export const UNWOKEN_EXPIRED_RESULT = 'unwoken-expired'

/** True for a row that may wake its recipient. Only an explicit 0 is quiet. */
export function isWakeRow(row: WakeClassed): boolean {
  return row.wake !== 0
}

/** The waking subset, order preserved. What every ALARM, NUDGE and AGE rule reads. */
export function wakeRows<T extends WakeClassed>(rows: readonly T[]): T[] {
  return rows.filter(isWakeRow)
}

/** Which rows the router may inject this tick.
 *
 *  A quiet row is delivered only in the company of a waking row for the SAME recipient: a
 *  recipient with nothing but quiet rows gets nothing. Delivering IS the wake for a sub-agent
 *  (the router types the text into its pane), so this is the whole sub-agent half of the rule. */
export function deliverableRows<T extends WakeClassed & { to_agent: string }>(rows: readonly T[]): T[] {
  const awake = new Set<string>()
  for (const r of rows) if (isWakeRow(r)) awake.add(r.to_agent)
  return rows.filter((r) => isWakeRow(r) || awake.has(r.to_agent))
}

/** Is a still-pending quiet row old enough to close? `created_at` is epoch SECONDS.
 *  Waking rows are never expired: their age is a signal somebody acts on, not clutter. */
export function isUnwokenExpired(row: WakeClassed & { created_at: number }, nowSec: number): boolean {
  return !isWakeRow(row) && nowSec - row.created_at >= UNWOKEN_EXPIRY_S
}
