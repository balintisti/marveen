// Card 074149c2, stage 1: the live wiring behind src/restart-notice-trace.ts.
//
// A routine restart's notice asks its reader to check that the rows injected into the destroyed
// session were processed. Here the check runs without a reader: the notice is PARKED (its row is
// closed, nobody is woken), a ledger row answers for it, and every minute the ledger is asked
// again. Every row traced -> the notice stays closed. A row still untraced at the deadline -> a
// message that names that row goes to the reader the notice would have had.
//
// FAIL-OPEN, BY CONSTRUCTION: parking happens AFTER the notice row was written the way it always
// was, in the same synchronous step. Anything that goes wrong before the ledger row is committed
// leaves that row pending, so it is delivered as before; anything that goes wrong after it
// delivers the parked notice. Nothing here throws.
import { logger } from '../logger.js'
import { MAIN_AGENT_ID } from '../config.js'
import { getEffectiveSettingValue } from '../settings-store.js'
import {
  getAgentMessage,
  getHeldRestartNotices,
  getRestartHeldRowSources,
  getRestartTraceEvidence,
  recordRestartNoticeHold,
  settleRestartNoticeHold,
  type RestartNoticeHold,
} from '../db.js'
import type { HandoffStaleness } from '../context-guard.js'
import { FRONT_DESK_TAG, frontDeskHeader, parseFrontDeskHeader } from '../front-desk.js'
import { resolveMachineNoticeRecipient } from './front-desk-route.js'
import {
  HOLD_RELEASED_LINE,
  RESTART_NOTICE_DELIVERED_LATE,
  RESTART_NOTICE_HELD,
  RESTART_NOTICE_HOLD_MS,
  RESTART_NOTICE_ORIGIN,
  RESTART_NOTICE_SWALLOWED,
  RESTART_NOTICE_SWALLOW_SETTING,
  TRACE_UNMEASURED_LINE,
  holdVerdict,
  isHandoffRequest,
  paneTailLine,
  parseRestartNoticeSwallowMode,
  readRestartPaneTail,
  restartIsRoutine,
  untracedLine,
  type HeldRow,
  type HoldVerdict,
  type RestartNoticeSwallowMode,
  type RestartPaneTail,
} from '../restart-notice-trace.js'

/** How often the held notices are asked again. */
export const RESTART_NOTICE_RESOLVE_MS = 60_000

/** The switch, read on every call so a change needs no restart. A read that fails is 'off'. */
export function restartNoticeSwallowMode(): RestartNoticeSwallowMode {
  try {
    return parseRestartNoticeSwallowMode(getEffectiveSettingValue(RESTART_NOTICE_SWALLOW_SETTING))
  } catch {
    return 'off'
  }
}

/** The loss window as the guard measured it at the restart (restartLossWindowIds). */
export interface RestartLossWindow {
  windowSec: readonly [number, number]
  delivered: readonly number[]
  pending: readonly number[]
  failed: readonly number[]
}

export interface RoutineRestartNotice {
  agent: string
  noticeId: number
  reason: string
  handoffStaleMinutes: HandoffStaleness | undefined
  lossWindow: RestartLossWindow | null
  snapshotPath: string | null
  /** The pane as the guard captured it right before the restart; null when it could not. The text
   *  itself, not the snapshot file: that file is one per agent and every restart overwrites it. */
  finalPane: string | null
}

/** What the ledger keeps of a notice: the rows it reports on and the fields of its header. */
interface HoldPayload {
  rows: HeldRow[]
  windowSec: [number, number]
  reason: string
  delivered: number[]
  pending: number[]
  failed: number[]
  snapshot: string | null
}

export type HoldOutcome = 'untouched' | 'swallowed' | 'held' | 'would-swallow' | 'would-hold'

function verdictDetail(v: HoldVerdict, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ traced: v.traced, untraced: v.untraced, ...extra })
}

/** The stored notice with the reason in front (review finding 2): the first line of the text names
 *  what the pane ended in, and a front-desk header, which stays the first line of the row, carries
 *  the same word under `pane_tail`. Everything the runner wrote follows unchanged. */
function withPaneTailReason(content: string, agent: string, tail: Exclude<RestartPaneTail, 'clean'>): string {
  const line = paneTailLine(agent, tail)
  if (!content.startsWith(`${FRONT_DESK_TAG} `)) return `${line}\n${content}`
  const nl = content.indexOf('\n')
  const headerLine = nl === -1 ? content : content.slice(0, nl)
  const parsed = parseFrontDeskHeader(headerLine)
  return (parsed ? `${FRONT_DESK_TAG} ${JSON.stringify({ ...parsed, pane_tail: tail })}` : headerLine)
    + `\n${line}\n`
    + (nl === -1 ? '' : content.slice(nl + 1))
}

const PANE_TAIL_LOG: Record<Exclude<RestartPaneTail, 'clean'>, string> = {
  'api-error': 'restart notice: the pane ended in an API error before the restart -- the notice is delivered as before',
  unknown: 'restart notice: the pane before the restart did not end in a recognised finished reply -- the notice is delivered as before',
  unreadable: 'restart notice: the pane before the restart could not be read -- the notice is delivered as before',
}

/** Called right after the guard wrote its restart notice. Parks the notice when the restart was
 *  routine, the window holds nothing but delivered rows this module can follow, and the pane the
 *  restart destroyed was read and ends in a finished reply; otherwise the notice is delivered as
 *  before (in live mode with a first line that names what the pane ended in). Never throws. */
export function holdRoutineRestartNotice(n: RoutineRestartNotice, nowMs: number = Date.now()): HoldOutcome {
  try {
    const mode = restartNoticeSwallowMode()
    if (mode === 'off') return 'untouched'
    // A notice ABOUT the coordinator always has a reader (marveen, card comment 57937). The trace
    // rule reads "a message in the agent's name that carries the id" as the agent having seen the
    // row, and in the coordinator's name machines write too, without an origin note (the kanban
    // dispatch, custom commands): there that sentence proves nothing.
    if (n.agent === MAIN_AGENT_ID) return 'untouched'
    const w = n.lossWindow
    // Not measured, a failed row (already dead, somebody has to resend it), or nothing delivered
    // (that notice closes itself or is log-only): none of these is a question a trace answers.
    if (!w || w.failed.length > 0 || w.delivered.length === 0) return 'untouched'
    if (!restartIsRoutine(n.reason, n.handoffStaleMinutes)) return 'untouched'
    // Only a notice that is still waiting for its reader can be parked.
    if (getAgentMessage(n.noticeId)?.status !== 'pending') return 'untouched'

    const sources = new Map(getRestartHeldRowSources(w.delivered).map((s) => [s.id, s]))
    const rows: HeldRow[] = []
    for (const id of w.delivered) {
      const s = sources.get(id)
      // A row that is gone, or has no delivery time, cannot be followed.
      if (!s || typeof s.delivered_at !== 'number') return 'untouched'
      rows.push({ id, from: s.from_agent, deliveredAt: s.delivered_at, handoffRequest: isHandoffRequest(s.from_agent, s.head) })
    }

    const deadlineMs = w.windowSec[1] * 1000 + RESTART_NOTICE_HOLD_MS
    const verdict = holdVerdict(rows, getRestartTraceEvidence(n.agent, rows), nowMs, deadlineMs)
    // The deadline is already behind us (a clock jump, a restart that took a quarter of an hour).
    if (verdict.verdict === 'deliver') return 'untouched'

    const payload: HoldPayload = {
      rows,
      windowSec: [w.windowSec[0], w.windowSec[1]],
      reason: n.reason,
      delivered: [...w.delivered],
      pending: [...w.pending],
      failed: [...w.failed],
      snapshot: n.snapshotPath,
    }
    // The rows would let this notice go unread; the pane decides whether it may. Only a pane that
    // was read and ends in a finished reply lets it: one that ended in an API error, one that ends
    // in anything the walk does not know, and one that cannot be read keep the notice for its
    // reader. The ledger row (nothing is closed with it) is what makes the share of such restarts
    // countable later, which is the condition this rule can be reopened on.
    const reading = readRestartPaneTail(n.finalPane)
    if (reading.tail !== 'clean') {
      const tail = reading.tail
      const why = `pane-tail-${tail}` as const
      // live: the text says why this notice is not held, in the transaction of the ledger row.
      // dry-run closes nothing and changes nothing: there every notice is delivered as written.
      const stored = mode === 'live' ? getAgentMessage(n.noticeId)?.content : undefined
      const holdId = recordRestartNoticeHold(
        {
          agent: n.agent,
          noticeId: n.noticeId,
          mode,
          restartAt: w.windowSec[1],
          deadlineAt: Math.floor(deadlineMs / 1000),
          payload: JSON.stringify(payload),
          state: 'delivered',
          detail: verdictDetail(verdict, { at: 'restart', why, tail_why: reading.why, tail_line: reading.line }),
        },
        null,
        typeof stored === 'string' ? withPaneTailReason(stored, n.agent, tail) : null,
      )
      logger.info({ agent: n.agent, noticeId: n.noticeId, holdId, mode, why, tailWhy: reading.why }, PANE_TAIL_LOG[tail])
      return 'untouched'
    }

    const state = verdict.verdict === 'swallow' ? 'swallowed' : 'held'
    const holdId = recordRestartNoticeHold(
      {
        agent: n.agent,
        noticeId: n.noticeId,
        mode,
        restartAt: w.windowSec[1],
        deadlineAt: Math.floor(deadlineMs / 1000),
        payload: JSON.stringify(payload),
        state,
        detail: state === 'swallowed' ? verdictDetail(verdict, { at: 'restart' }) : null,
      },
      // dry-run: the ledger row only. The notice stays pending and is delivered as before.
      mode === 'live' ? (state === 'swallowed' ? RESTART_NOTICE_SWALLOWED : RESTART_NOTICE_HELD) : null,
    )
    logger.info(
      { agent: n.agent, noticeId: n.noticeId, holdId, mode, traced: verdict.traced, untraced: verdict.untraced },
      mode === 'live'
        ? (state === 'swallowed'
          ? 'restart notice: swallowed, every row of the window has its trace'
          : 'restart notice: held, waiting for the traces of its rows')
        : (state === 'swallowed'
          ? 'restart notice (dry-run): would swallow, the notice is delivered as before'
          : 'restart notice (dry-run): would hold, the notice is delivered as before'),
    )
    if (mode === 'live') return state
    return state === 'swallowed' ? 'would-swallow' : 'would-hold'
  } catch (err) {
    try {
      logger.warn({ err, agent: n.agent, noticeId: n.noticeId }, 'restart notice: the hold step failed -- the notice is delivered as before')
    } catch { /* the notice matters more than the log line */ }
    return 'untouched'
  }
}

function parsePayload(raw: string): HoldPayload | null {
  try {
    const p = JSON.parse(raw) as HoldPayload
    return p && Array.isArray(p.rows) && Array.isArray(p.windowSec) && p.windowSec.length === 2 ? p : null
  } catch {
    return null
  }
}

/** The parked notice's own text, without the front-desk header line it may have been stored with:
 *  the late message gets a header of its own, for the reader it has NOW. */
function parkedBody(hold: RestartNoticeHold, payload: HoldPayload | null): string {
  const content = getAgentMessage(hold.notice_id)?.content
  if (typeof content !== 'string') {
    return `[CONTEXT-GUARD] Ujrainditottam a(z) "${hold.agent}" agentet`
      + (payload ? ` -- ok: ${payload.reason}` : '')
      + '. (Az eredeti ertesito sora mar nincs meg, ez a visszatartas naplojabol keszult.)'
  }
  if (!content.startsWith(`${FRONT_DESK_TAG} `)) return content
  const nl = content.indexOf('\n')
  return nl === -1 ? content : content.slice(nl + 1)
}

/** Send the parked notice after all, with the sentence that says why. `untraced` is the list the
 *  check found, or null when the check did not run. A message that cannot be written rolls the
 *  hold back to 'held', so the next tick tries again. */
function deliverHeld(
  hold: RestartNoticeHold,
  payload: HoldPayload | null,
  line: string,
  untraced: readonly number[] | null,
  why: string,
): void {
  const desk = resolveMachineNoticeRecipient([hold.agent])
  const header = desk.rerouted
    ? frontDeskHeader({
      type: 'context-guard-restart',
      subjects: [hold.agent],
      windowSec: payload ? payload.windowSec : null,
      reason: payload ? payload.reason : null,
      delivered: payload ? payload.delivered : null,
      pending: payload ? payload.pending : null,
      failed: payload ? payload.failed : null,
      snapshot: payload ? payload.snapshot : null,
      untraced,
    }) + '\n'
    : ''
  const res = settleRestartNoticeHold(
    hold.id,
    'delivered',
    JSON.stringify({ why, untraced, to: desk.to }),
    {
      noticeResult: RESTART_NOTICE_DELIVERED_LATE,
      deliver: { from: hold.agent, to: desk.to, content: header + parkedBody(hold, payload) + line, originNote: RESTART_NOTICE_ORIGIN },
    },
  )
  if (res.settled) {
    logger.info(
      { agent: hold.agent, holdId: hold.id, noticeId: hold.notice_id, deliveredId: res.deliveredId, to: desk.to, why, untraced },
      'restart notice: delivered after the hold',
    )
  }
}

function resolveOne(hold: RestartNoticeHold, nowMs: number): void {
  const payload = parsePayload(hold.payload)
  const dryRun = hold.mode !== 'live'

  let verdict: HoldVerdict | null = null
  let measureErr: unknown = null
  if (payload) {
    try {
      verdict = holdVerdict(payload.rows, getRestartTraceEvidence(hold.agent, payload.rows), nowMs, hold.deadline_at * 1000)
    } catch (err) {
      measureErr = err
    }
  }

  if (dryRun) {
    // A dry-run hold never closed its notice, so it has nothing to send: the ledger row and the
    // log line are the whole outcome.
    if (verdict?.verdict === 'hold') return
    const swallow = verdict?.verdict === 'swallow'
    const detail = verdict ? verdictDetail(verdict, { at: 'resolver' }) : JSON.stringify({ why: payload ? 'trace-unmeasured' : 'payload-unreadable' })
    if (settleRestartNoticeHold(hold.id, swallow ? 'swallowed' : 'delivered', detail).settled) {
      logger.info(
        { agent: hold.agent, holdId: hold.id, noticeId: hold.notice_id, traced: verdict?.traced, untraced: verdict?.untraced },
        swallow
          ? 'restart notice (dry-run): would have swallowed after the hold'
          : 'restart notice (dry-run): would have delivered after the hold',
      )
    }
    return
  }

  // The switch left 'live' while this notice waited: whoever turned it wants the old behaviour.
  if (restartNoticeSwallowMode() !== 'live') {
    deliverHeld(hold, payload, HOLD_RELEASED_LINE, null, 'switch-left-live')
    return
  }
  if (!verdict) {
    if (measureErr) logger.warn({ err: measureErr, agent: hold.agent, holdId: hold.id }, 'restart notice: could not read the traces -- delivering')
    deliverHeld(hold, payload, TRACE_UNMEASURED_LINE, null, payload ? 'trace-unmeasured' : 'payload-unreadable')
    return
  }
  if (verdict.verdict === 'hold') return
  if (verdict.verdict === 'swallow') {
    const res = settleRestartNoticeHold(hold.id, 'swallowed', verdictDetail(verdict, { at: 'resolver' }), { noticeResult: RESTART_NOTICE_SWALLOWED })
    if (res.settled) {
      logger.info(
        { agent: hold.agent, holdId: hold.id, noticeId: hold.notice_id, traced: verdict.traced },
        'restart notice: swallowed after the hold, every row of the window has its trace',
      )
    }
    return
  }
  const waitedMin = Math.max(0, Math.round((nowMs - hold.restart_at * 1000) / 60_000))
  deliverHeld(hold, payload, untracedLine(payload!.rows, verdict.untraced, waitedMin), verdict.untraced, 'untraced-at-deadline')
}

/** One tick over the held notices. One hold that fails does not stop the others, and a hold that
 *  could not be settled stays 'held' for the next tick. Never throws. */
export function resolveRestartNoticeHolds(nowMs: number = Date.now()): void {
  let holds: RestartNoticeHold[]
  try {
    holds = getHeldRestartNotices()
  } catch (err) {
    try { logger.warn({ err }, 'restart notice: could not read the held notices') } catch { /* nothing left to say it with */ }
    return
  }
  for (const hold of holds) {
    try {
      resolveOne(hold, nowMs)
    } catch (err) {
      try {
        logger.warn({ err, agent: hold.agent, holdId: hold.id }, 'restart notice: resolving a hold failed -- it stays held and is tried again')
      } catch { /* the next hold matters more than the log line */ }
    }
  }
}
