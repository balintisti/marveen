import { logger } from '../logger.js'
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

export type ParkedRecordProbeOutcome = ParkedRecordVerdict | 'unknown-agent'

/** THERE IS NO session -> agent INVERSION HERE, AND THAT IS THE DESIGN.
 *
 *  An earlier draft inverted the mapping by enumerating the forward resolver.
 *  Safe, but unnecessary: ALL THREE call sites of recoverStuckInputForSession
 *  already hold the agent id, and one of them derives the session FROM it
 *  (targets.push({ session: agentSessionName(a), agentName: a })). So the value
 *  is one frame up, already correct.
 *
 *  Threading it down instead of inverting deletes the failure class rather than
 *  making it loud: a wrong inverse yields a plausible name matching no
 *  from_agent row -> lastAgentSendAt null -> verdict 'act-on-record'. Silent AND
 *  toward acting. There is no safe version of that; there is a version where the
 *  question never arises. (marveen's ruling, card c29aaf14.)
 *
 *  `agent` is nullable only because Target.agentName is optional in the type --
 *  that is the CALLER not having the value, which is reported, never guessed. */

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
  agent: string | null,
  freshnessMs: number,
  now: number = Date.now(),
): ParkedRecordProbeOutcome {
  if (agent == null) {
    logger.warn({ session }, 'parked-record probe: caller passed no agent id (phase 1, no action)')
    return 'unknown-agent'
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
