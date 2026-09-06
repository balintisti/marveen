import { logger } from '../logger.js'
import { MAIN_AGENT_ID } from '../config.js'
import { listAgentNames } from './agent-config.js'
import { sessionNameForAgent } from './session-names.js'
import { getDb } from '../db.js'
import { getInjectedPrompt } from './injected-prompt-registry.js'
import { parkedRecordVerdict, type ParkedRecordVerdict } from './parked-record-evidence.js'

/** PHASE 1 OF THE (b) DECISION: OBSERVE ONLY. This module NEVER acts on a pane.
 *
 *  It exists to turn one unmeasured quantity into a number: how often the
 *  record-freshness gate would fire on a parked pane, and -- the part that makes
 *  it a diagnosis rather than a rate -- WHICH of the four verdicts it lands on.
 *  If the bulk lands on 'record-stale' or 'agent-spoke-since', the registry is
 *  the weak input and phase 2 would be built on it.
 *
 *  Everything here is deliberately in OUR OWN module: the wiring into
 *  channel-monitor is one import and one call, so the intersection surface with
 *  the fifteen unmerged branches that touch that file stays two lines. Same
 *  shape as kanban-project-warning.ts. */

/** UNITS: agent_messages.created_at is EPOCH SECONDS (measured on the live db,
 *  typeof=integer, and 52 rows fall in the last hour when read as seconds).
 *  parkedRecordVerdict speaks MILLISECONDS, because the registry stores
 *  Date.now(). Mixing them silently makes every send look ~57 years old, which
 *  reads as 'the agent has not spoken' -- the eager direction. Convert here,
 *  once, and pin it. */
const SEC_TO_MS = 1000

/** The gate's freshness window, and it MUST be strictly under the registry's own
 *  RECORD_TTL_MS (10 min).
 *
 *  getInjectedPrompt applies that TTL itself and DELETES the expired record, so
 *  with a window >= the TTL the 'record-stale' verdict is UNREACHABLE: an old
 *  record comes back null and lands on 'no-record'. The breakdown would then
 *  report record-stale = 0 for every pane forever, and a bucket that is exactly
 *  zero is the meter's fault, not the world's.
 *
 *  STATED LIMIT that this does NOT fix: 'no-record' still merges "never typed"
 *  with "typed more than 10 minutes ago", because the registry drops the record
 *  at its own boundary. Reading past it would mean changing the registry. */
export const PROBE_FRESHNESS_MS = 2 * 60 * 1000

export type ParkedRecordProbeOutcome = ParkedRecordVerdict | 'unknown-session'

/** Session -> agent, by ENUMERATING the forward resolver -- never by parsing the
 *  session string.
 *
 *  session-names.ts exports only the forward direction, in TWO shapes, and its
 *  own docblock says a wrong name there is SILENT BY CONSTRUCTION. A hand-rolled
 *  inverse (strip 'agent-') would yield a plausible name for the main agent that
 *  matches no from_agent row -- lastAgentSendAt null -> verdict 'act-on-record'.
 *  That is the EAGER direction, on exactly the panes we would act on.
 *
 *  So we invert the only mapping that is authoritative, and a session we cannot
 *  place returns null and is reported as 'unknown-session' -- LOUD, not a null
 *  that flows into the verdict. */
export function agentForSession(session: string): string | null {
  for (const name of [MAIN_AGENT_ID, ...listAgentNames()]) {
    if (sessionNameForAgent(name) === session) return name
  }
  return null
}

/** Newest message SENT BY this agent, in ms, or null if it never sent one.
 *
 *  from_agent ONLY. The existing reader (db.ts, getAgentConversationThreads)
 *  matches `from_agent OR to_agent`, which answers a different question: with it
 *  'agent-spoke-since' would fire when somebody else wrote TO the agent. The two
 *  status-filtered readers ask about undelivered backlog, not about speaking. */
export function lastAgentSendAt(agent: string): number | null {
  const row = getDb()
    .prepare('SELECT created_at FROM agent_messages WHERE from_agent = ? ORDER BY created_at DESC, id DESC LIMIT 1')
    .get(agent) as { created_at?: number } | undefined
  const secs = row?.created_at
  return typeof secs === 'number' ? secs * SEC_TO_MS : null
}

/** Evaluate the gate and LOG the verdict. Returns it so a test can assert on it;
 *  no caller is expected to branch on the result in phase 1. */
export function probeParkedRecord(
  session: string,
  freshnessMs: number,
  now: number = Date.now(),
): ParkedRecordProbeOutcome {
  const agent = agentForSession(session)
  if (agent == null) {
    logger.warn({ session }, 'parked-record probe: session does not resolve to any agent (phase 1, no action)')
    return 'unknown-session'
  }
  const record = getInjectedPrompt(session, now)
  const verdict = parkedRecordVerdict({
    recordAt: record?.at ?? null,
    now,
    lastAgentSendAt: lastAgentSendAt(agent),
    freshnessMs,
  })
  logger.info({ session, agent, verdict }, 'parked-record probe (phase 1, observe only)')
  return verdict
}
