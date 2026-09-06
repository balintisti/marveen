/**
 * THE ORIGIN PROOF WITHOUT THE PANE -- card c29aaf14, half (b).
 *
 * Today the recorded-reinject path opens only when the SCRAPE matches the record
 * (matchesInjectedPrompt). That match is the proof that the text in the box is
 * ours. In the >=23-line band the box top has scrolled out of the capture window,
 * parkedInputText() returns null, and the match is false by construction -- so the
 * path never opens exactly where it was needed.
 *
 * This module is the replacement proof, and it is DELIBERATELY WEAKER: it is
 * evidence that we TYPED something into that pane recently and that the agent has
 * not spoken since. It does NOT prove the box still holds it. Named that way on
 * purpose, because the action it can unlock (clear + retype) would destroy a human
 * draft if the evidence is wrong.
 *
 * NOTHING HERE READS THE PANE, and that is the ruling it implements (c14): the gate
 * must not feed from the surface it exists to compensate for. Both inputs come from
 * the registry and from agent_messages.
 *
 * Every rejection has its OWN name rather than a boolean, so a log line says which
 * fact was missing and a test can pin each one separately.
 */

export interface ParkedRecordFacts {
  /** Registry: epoch ms of the last prompt WE injected into this session, or null. */
  recordAt: number | null
  /** Now, epoch ms. */
  now: number
  /** agent_messages: epoch ms of the newest message SENT BY that agent, or null. */
  lastAgentSendAt: number | null
  /** How old a record may be and still count as evidence. */
  freshnessMs: number
}

export type ParkedRecordVerdict =
  | 'act-on-record'
  | 'no-record'
  | 'record-stale'
  | 'agent-spoke-since'

export function parkedRecordVerdict(f: ParkedRecordFacts): ParkedRecordVerdict {
  if (f.recordAt == null) return 'no-record'
  if (f.now - f.recordAt > f.freshnessMs) return 'record-stale'
  // >= and not >: a send in the SAME millisecond is not evidence that our prompt
  // is still sitting there, and the conservative reading is the one that does not
  // act. Ties go to inaction everywhere in this module.
  if (f.lastAgentSendAt != null && f.lastAgentSendAt >= f.recordAt) return 'agent-spoke-since'
  return 'act-on-record'
}
