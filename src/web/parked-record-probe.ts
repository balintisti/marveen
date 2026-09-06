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

/** RESOLUTION ORDER: THREAD FIRST, ENUMERATE AS FALLBACK, LOUD IF NEITHER.
 *
 *  Two rulings landed on this, and they crossed in flight rather than
 *  disagreeing. Both properties are real and this keeps both:
 *
 *    THREADED (marveen 13462): every call site today already holds the agent id,
 *      and one derives the session FROM it
 *      (targets.push({ session: agentSessionName(a), agentName: a })). Taking
 *      the value that is already in scope cannot be wrong.
 *    ENUMERATED (marveen 13468): a FUTURE caller that does not hold the name
 *      still gets an answer, instead of a loud null.
 *
 *  What is forbidden either way is PARSING the session string. That is the one
 *  that fails silently AND toward acting: a hand-rolled inverse yields a
 *  plausible name for the main agent that matches no from_agent row ->
 *  lastAgentSendAt null -> verdict 'act-on-record'. Enumeration is not parsing:
 *  it matches against the ONLY authoritative map (sessionNameForAgent), so it
 *  either finds the real name or finds nothing.
 *
 *  A session neither path can place returns null and is reported as
 *  'unknown-session' -- loud, never a null that flows into the verdict.
 *
 *  THE THREADED HALF IS A STRUCTURAL CHOICE AND IS NOT PINNED. Deleting the
 *  `agent ??` and enumerating unconditionally leaves EVERY TEST GREEN -- measured,
 *  not assumed (mutation: threading removed -> 9 passed, survives). At every call
 *  site that exists today the two paths AGREE, so no test can separate them;
 *  showing a difference would need a session name colliding across agents, which
 *  is pathological and was not manufactured.
 *
 *  It stays for a reason that is about the tree, not the code: fifteen unmerged
 *  fork branches touch channel-monitor.ts, so removing it buys an unmeasurable
 *  simplification at the price of a real merge conflict, N times over. Keeping it
 *  costs one `??`.
 *
 *  So: if you are here to simplify, this is the line to take -- and know that no
 *  test will stop you, because none can. That is known, not overlooked. */
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
  agent: string | null,
  freshnessMs: number,
  now: number = Date.now(),
): ParkedRecordProbeOutcome {
  const resolved = agent ?? agentForSession(session)
  if (resolved == null) {
    logger.warn({ session }, 'parked-record probe: session resolves to no agent (phase 1, no action)')
    return 'unknown-session'
  }
  const record = getInjectedPrompt(session, now)
  const verdict = parkedRecordVerdict({
    recordAt: record?.at ?? null,
    now,
    lastAgentSendAt: lastAgentSendAt(resolved),
    freshnessMs,
  })
  logger.info({ session, agent: resolved, verdict }, 'parked-record probe (phase 1, observe only)')
  return verdict
}
