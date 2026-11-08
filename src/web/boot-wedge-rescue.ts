/**
 * Boot-wedge rescue: restart a freshly guard-restarted SUB-AGENT pane ONCE when
 * its input box cannot be emptied (card b1f0011b, marveen msg 10011703).
 *
 * The case, measured on didi 2026-11-08 22:01: the context guard restarted the
 * pane, the TUI read the resume directive into its box (+5.8 s) and from then on
 * ignored every key -- the guard's Enter, two rounds of the stuck-input clear
 * ("could not be emptied" 3/3 each) and the coordinator's own Enter -- while it
 * kept rendering. Only a restart cured it. That session never wrote a transcript
 * (no .jsonl was born between its start at 22:01:27 and the restart at 22:02:34;
 * a healthy session's file is born with its first prompt), so the restart lost
 * nothing.
 *
 * What may trigger it is deliberately narrow:
 *  - never the main agent: its box is never auto-cleared and may hold a reply;
 *  - only within BOOT_WEDGE_WINDOW_MS of a context-guard restart, the moment
 *    this wedge was seen in, and the moment the guard knows was fresh;
 *  - only while the current session has written no transcript: a session that
 *    has, has work a restart would drop;
 *  - once per guard restart: a session the rescue started that wedges again
 *    keeps today's path (the stuck-input escalation notifies a human).
 * The record of guard restarts lives in memory, so a dashboard restart forgets
 * it and the rescue does not fire -- the safe direction.
 *
 * The signal comes from clearInputBuffer (agent-process.ts), the action from the
 * context-guard runner. This module only joins them, so neither has to import the
 * other (the runner already imports channel-monitor, which imports agent-process).
 */

export const BOOT_WEDGE_WINDOW_MS = 120_000

export interface GuardRestartRecord {
  /** When the guard's restart of this agent returned (epoch ms). */
  atMs: number
  /** True when that restart was itself a boot-wedge rescue. */
  rescue: boolean
}

export interface BootWedgeFacts {
  isMainAgent: boolean
  /** The last guard restart of this agent since the dashboard started; null = none on record. */
  lastGuardRestart: GuardRestartRecord | null
  nowMs: number
  /** Has the CURRENT session written a transcript? null = could not tell. */
  sessionHasTranscript: boolean | null
}

export type BootWedgeRefusal =
  | 'main-agent'
  | 'no-guard-restart'
  | 'outside-window'
  | 'already-rescued'
  | 'transcript-unknown'
  | 'transcript-exists'

export type BootWedgeDecision = { rescue: true } | { rescue: false; reason: BootWedgeRefusal }

export function decideBootWedgeRescue(f: BootWedgeFacts): BootWedgeDecision {
  if (f.isMainAgent) return { rescue: false, reason: 'main-agent' }
  if (f.lastGuardRestart == null) return { rescue: false, reason: 'no-guard-restart' }
  const age = f.nowMs - f.lastGuardRestart.atMs
  if (!(age >= 0 && age <= BOOT_WEDGE_WINDOW_MS)) return { rescue: false, reason: 'outside-window' }
  if (f.lastGuardRestart.rescue) return { rescue: false, reason: 'already-rescued' }
  if (f.sessionHasTranscript == null) return { rescue: false, reason: 'transcript-unknown' }
  if (f.sessionHasTranscript) return { rescue: false, reason: 'transcript-exists' }
  return { rescue: true }
}

type InputNotEmptiedHandler = (agent: string) => void
let handler: InputNotEmptiedHandler | null = null

/** The context-guard runner registers here at start; null unregisters (tests). */
export function setInputNotEmptiedHandler(h: InputNotEmptiedHandler | null): void {
  handler = h
}

/**
 * Called where "Input buffer could not be emptied" is logged. Local agent panes
 * only (`agent-<name>`); the handler runs on a later tick, so the recovery that
 * hit the wall finishes its own unwinding before anything restarts the pane.
 */
export function reportInputNotEmptied(session: string, host: string | null): void {
  if (host != null || handler == null) return
  const m = /^agent-(.+)$/.exec(session)
  if (!m) return
  const h = handler
  const agent = m[1]
  setImmediate(() => {
    try { h(agent) } catch { /* the handler logs its own failures */ }
  })
}
