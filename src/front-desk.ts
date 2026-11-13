// FRONT DESK: WHO READS A MACHINE NOTICE (card 074149c2, stage 2; marveen's decision 2026-11-10).
//
// Every notice the guards write went to the constant MAIN_AGENT_ID, and every one of them starts a
// coordinator turn that re-reads the coordinator's whole context. Measured on the card: 70% of the
// coordinator's inbox was machine notices, and 9 of 10 restart notices on the measured morning
// needed nothing. A configured front-desk agent reads them instead.
//
// FAIL-OPEN, BY CONSTRUCTION: this module only ever answers "the front desk" when every check
// passed. Any doubt -- not configured, unknown id, not running, backed up, the front desk or the
// coordinator is what the notice is ABOUT, a probe that threw -- answers "the coordinator", which
// is the behaviour before this card. A notice that reaches the more expensive reader is a cost; a
// notice that reaches nobody is the failure.
//
// Pure: the probes are passed in, so every branch is testable without tmux or a database.

/** The settings key that names the front-desk agent. Empty = off. */
export const FRONT_DESK_SETTING = 'FRONT_DESK_AGENT_ID'

/** This many waking rows already pending for the front desk means it is behind, and the notice
 *  goes to the coordinator. Same unit as the fleet's "3 messages waiting" sender warning. */
export const FRONT_DESK_QUEUE_LIMIT = 3

export type FrontDeskWhy =
  | 'front-desk'
  | 'not-configured'
  | 'malformed-id'
  | 'is-coordinator'
  | 'no-subject'
  | 'coordinator-is-subject'
  | 'is-subject'
  | 'unknown-agent'
  | 'not-running'
  | 'queue-full'
  | 'probe-failed'

export interface FrontDeskProbe {
  isKnown: (agent: string) => boolean
  isRunning: (agent: string) => boolean
  /** Waking rows pending for the agent right now. */
  pendingDepth: (agent: string) => number
}

export interface MachineNoticeRoute {
  to: string
  rerouted: boolean
  why: FrontDeskWhy
}

/** Why a configured value cannot be a front desk at all, or null when it can. The router below and
 *  the rule-file section (reportDesk) both ask this, so they cannot disagree about "configured". */
export function frontDeskIdProblem(
  coordinator: string,
  desk: string,
): 'not-configured' | 'malformed-id' | 'is-coordinator' | null {
  if (desk === '') return 'not-configured'
  // An id is used as written or not at all: stripping characters could turn a typo into the id of
  // a different, real agent.
  if (!/^[a-zA-Z0-9_-]+$/.test(desk)) return 'malformed-id'
  if (desk === coordinator) return 'is-coordinator'
  return null
}

/** The front desk the RULE FILES name (stage 3): the configured id when it can be one and is an
 *  agent of this fleet, else null. Running or not is NOT asked: a rule file is written when an
 *  agent starts and is read for hours, and the rule itself says what to do when the desk is down. */
export function reportDesk(
  coordinator: string,
  configured: string | null | undefined,
  isKnown: (agent: string) => boolean,
): string | null {
  const desk = String(configured ?? '').trim()
  if (frontDeskIdProblem(coordinator, desk) !== null) return null
  try {
    return isKnown(desk) ? desk : null
  } catch {
    return null
  }
}

/** Who gets a machine notice about `subjects`: the front desk, or (on any doubt) the coordinator. */
export function machineNoticeRecipient(
  coordinator: string,
  configured: string | null | undefined,
  subjects: readonly string[],
  probe: FrontDeskProbe,
): MachineNoticeRoute {
  const stay = (why: FrontDeskWhy): MachineNoticeRoute => ({ to: coordinator, rerouted: false, why })
  const desk = String(configured ?? '').trim()
  const problem = frontDeskIdProblem(coordinator, desk)
  if (problem !== null) return stay(problem)
  if (subjects.length === 0) return stay('no-subject')
  // A notice about the coordinator itself is not front-desk work: the front desk cannot restart
  // it or hand it a card, so it would only come back as an escalation.
  if (subjects.includes(coordinator)) return stay('coordinator-is-subject')
  // The front desk cannot be the judge of a notice about itself (its own restart, its own idling).
  if (subjects.includes(desk)) return stay('is-subject')
  try {
    if (!probe.isKnown(desk)) return stay('unknown-agent')
    if (!probe.isRunning(desk)) return stay('not-running')
    const depth = probe.pendingDepth(desk)
    // A depth that is not a number is a failed measurement, not an empty queue.
    if (typeof depth !== 'number' || !Number.isFinite(depth)) return stay('probe-failed')
    if (depth >= FRONT_DESK_QUEUE_LIMIT) return stay('queue-full')
  } catch {
    return stay('probe-failed')
  }
  return { to: desk, rerouted: true, why: 'front-desk' }
}

/** First token of a rerouted notice. One line of JSON follows it; the original text starts on the
 *  next line, unchanged. */
export const FRONT_DESK_TAG = '[FRONT-DESK]'

export type FrontDeskNoticeType =
  | 'context-guard-restart'
  | 'idle-no-work'
  | 'idle-still-idle'
  | 'restart-window-receipt'
  | 'fleet-page-guard'

/** What the header carries. `null` always means NOT MEASURED for this notice, never "none": an
 *  empty list is a measured zero. */
export interface FrontDeskNotice {
  type: FrontDeskNoticeType
  subjects: readonly string[]
  /** The restart loss window in epoch SECONDS, the unit of agent_messages.delivered_at. */
  windowSec?: readonly [number, number] | null
  reason?: string | null
  /** Ids of the rows delivered into the old session inside the window (sender-written only). */
  delivered?: readonly number[] | null
  pending?: readonly number[] | null
  failed?: readonly number[] | null
  /** PATH of the pane snapshot taken before the restart; the snapshot itself is not embedded. */
  snapshot?: string | null
  /** Stage 1, only on a restart notice that was held and delivered late: the ids of `delivered`
   *  that had no id-bearing trace when it was sent. The key is absent on every other notice. */
  untraced?: readonly number[] | null
}

/** The machine-readable first line of a rerouted notice (jarvis's requirement on the card).
 *  JSON, because a restart reason carries spaces, quotes and dashes; JSON.stringify also escapes
 *  any newline, so the header is one line whatever the reason holds. */
export function frontDeskHeader(n: FrontDeskNotice): string {
  return `${FRONT_DESK_TAG} ${JSON.stringify({
    v: 1,
    type: n.type,
    subjects: [...n.subjects],
    window_sec: n.windowSec ? [n.windowSec[0], n.windowSec[1]] : null,
    reason: n.reason ?? null,
    delivered: n.delivered ? [...n.delivered] : null,
    pending: n.pending ? [...n.pending] : null,
    failed: n.failed ? [...n.failed] : null,
    snapshot: n.snapshot ?? null,
    ...(n.untraced !== undefined ? { untraced: n.untraced ? [...n.untraced] : null } : {}),
  })}`
}

/** The text as it is stored: with the header when rerouted, EXACTLY as before when not. */
export function withFrontDeskHeader(route: MachineNoticeRoute, notice: FrontDeskNotice, text: string): string {
  return route.rerouted ? `${frontDeskHeader(notice)}\n${text}` : text
}

/** Read a header back. Null when the content does not start with one or the line is not JSON. */
export function parseFrontDeskHeader(content: string): Record<string, unknown> | null {
  if (!content.startsWith(`${FRONT_DESK_TAG} `)) return null
  const nl = content.indexOf('\n')
  const line = content.slice(FRONT_DESK_TAG.length + 1, nl === -1 ? undefined : nl)
  try {
    const parsed: unknown = JSON.parse(line)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Is this agent-written line a restart-window receipt the front desk may read instead of the
 *  coordinator? The resume directive asks every fresh session for a "[RESTART-ABLAK] <id> felveve"
 *  line per message it reads back; measured over 7 days, 111 of them were addressed to the
 *  coordinator. A line that asks something is NOT a receipt: a question mark, or the fleet's
 *  DECISION: marker anywhere in it, keeps it with the coordinator. */
export function isReroutableWindowReceipt(content: string): boolean {
  const t = content.trimStart()
  if (!t.startsWith('[RESTART-ABLAK]')) return false
  if (t.includes('?')) return false
  return !/DECISION:/i.test(t)
}

/** The first line scripts/fleet-page-guard.sh puts on a DEFECT alarm: the pages it found
 *  incomplete, as agent ids. The script writes this line only from the checker's own
 *  machine-readable name line; a guard that could not measure (rc=4) and every hand-written text
 *  carry no such line. */
const PAGE_GUARD_HEAD_RE = /^\[fleet-page-guard\] LAPOK: ([a-z0-9_-]+(?:, [a-z0-9_-]+)*)$/

/** The agent pages a page-guard alarm is about, or null when the text is not that alarm. Only the
 *  FIRST line is read, and it must be the whole line: the names are the notice's subjects, so a
 *  line this cannot read in full names nobody and the alarm stays where it was sent. */
export function pageGuardNoticeSubjects(content: string): string[] | null {
  const nl = content.indexOf('\n')
  const m = PAGE_GUARD_HEAD_RE.exec(nl === -1 ? content : content.slice(0, nl))
  return m ? m[1].split(', ') : null
}

/** Which coordinator-bound sweep alerts the front desk may read: a sweep that holds NOTHING BUT
 *  'still-idle' rows. Every other kind is the guard reporting on itself or asking for an act only
 *  the coordinator has (a restart, a workcheck.json), and one sweep stays one message. */
export function fleetAlertsAreFrontDeskWork(kinds: readonly string[]): boolean {
  return kinds.length > 0 && kinds.every((k) => k === 'still-idle')
}

// ---- Reports TO the front desk (card f043d3f5) ----
//
// The rule files send every agent's report (done, status, FYI) to the front desk. When the front
// desk is not running, such a report waited in a queue nobody reads, and the sender only got a
// warning. When it runs but does not take its queue (a stuck session), the report waited forever.
// Either way the report reached nobody. This is the reverse of machineNoticeRecipient: the sender
// asked for the front desk, and only a MEASURED reason it cannot read moves the report to the
// coordinator. A failed probe is not such a reason: the report stays where it was sent, and the
// router's abandon path (failure notice to the coordinator) is still behind it.

/** The oldest waking row pending for a RUNNING front desk is this old: the desk is not taking its
 *  queue. Half the router's abandon window, so a report is moved before an absent session would
 *  have it abandoned. */
export const FRONT_DESK_STALL_SEC = 30 * 60

export type FrontDeskReportWhy =
  | 'not-to-desk'
  | 'sender-not-agent'
  | 'desk-ok'
  | 'desk-not-running'
  | 'desk-stalled'
  | 'probe-failed'

export interface FrontDeskReportProbe {
  isKnown: (agent: string) => boolean
  isRunning: (agent: string) => boolean
  /** Age in seconds of the oldest waking row pending for the agent, 0 when none. */
  oldestPendingSec: (agent: string) => number
}

export interface FrontDeskReportRoute {
  to: string
  rerouted: boolean
  why: FrontDeskReportWhy
  /** The measured age that made the desk 'stalled'; absent on every other answer. */
  oldestPendingSec?: number
}

/** Who reads a message `sender` addressed to `to`: `to` itself, or the coordinator when `to` is the
 *  configured front desk and the desk measurably cannot read it. */
export function frontDeskReportRecipient(
  coordinator: string,
  configured: string | null | undefined,
  sender: string,
  to: string,
  probe: FrontDeskReportProbe,
): FrontDeskReportRoute {
  const stay = (why: FrontDeskReportWhy): FrontDeskReportRoute => ({ to, rerouted: false, why })
  const desk = String(configured ?? '').trim()
  if (frontDeskIdProblem(coordinator, desk) !== null || to !== desk) return stay('not-to-desk')
  // Only an agent of this fleet reports. The owner, the voice channel, a neighbouring system and
  // the coordinator itself reach the recipient they named; so does the desk writing to itself.
  if (sender === coordinator || sender === desk) return stay('sender-not-agent')
  try {
    if (!probe.isKnown(sender) || !probe.isKnown(desk)) return stay('sender-not-agent')
    const move = (why: 'desk-not-running' | 'desk-stalled', age?: number): FrontDeskReportRoute =>
      ({ to: coordinator, rerouted: true, why, ...(age !== undefined ? { oldestPendingSec: age } : {}) })
    if (!probe.isRunning(desk)) return move('desk-not-running')
    const age = probe.oldestPendingSec(desk)
    // An age that is not a number is a failed measurement, not an empty queue.
    if (typeof age !== 'number' || !Number.isFinite(age)) return stay('probe-failed')
    if (age >= FRONT_DESK_STALL_SEC) return move('desk-stalled', age)
  } catch {
    return stay('probe-failed')
  }
  return stay('desk-ok')
}

/** First token of a report the front desk could not read and the coordinator got instead. */
export const FRONT_DESK_DOWN_TAG = '[FRONT-DESK-DOWN]'

/** One line of JSON after the tag; the original text starts on the next line, unchanged. */
export function frontDeskDownHeader(route: FrontDeskReportRoute, requested: string): string {
  return `${FRONT_DESK_DOWN_TAG} ${JSON.stringify({
    v: 1,
    requested,
    why: route.why,
    oldest_pending_sec: route.oldestPendingSec ?? null,
  })}`
}
