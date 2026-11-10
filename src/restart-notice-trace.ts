// Card 074149c2, stage 1: which "Ujrainditottam" notices need no reader.
//
// A restart notice asks its reader one question: did the rows injected into the destroyed session
// get processed? Measured 2026-11-10 over 7 days and 674 notices: for 298 the only such row was the
// guard's own handoff request and the handoff was written; for 220 more every row had, within 20
// minutes, a trace that carries the row's id. The reader ran the same check by hand every time.
//
// This module is the check, pure: the rows and the evidence come from the caller. It decides
// nothing about delivery on its own; src/web/restart-notice-hold.ts does, and every doubt there
// delivers the notice.
import { RESTART_LOSS_WINDOW_MS, type HandoffStaleness } from './context-guard.js'
import { detectsThinkingBlockError, midTurnApiErrorAtTail } from './pane-state.js'

export const RESTART_NOTICE_SWALLOW_SETTING = 'RESTART_NOTICE_SWALLOW_MODE'

export type RestartNoticeSwallowMode = 'off' | 'dry-run' | 'live'

/** Only the two exact words turn anything on. A typo, an empty value or a failed read is OFF:
 *  a setting that cannot be read must not close a message. */
export function parseRestartNoticeSwallowMode(raw: unknown): RestartNoticeSwallowMode {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'live' || v === 'dry-run' ? v : 'off'
}

/** How long a notice waits for the traces of its rows. Measured on the 7-day replay: at 15 minutes
 *  the id-bearing trace existed for 220 of the 260 notices that had a sender-written row. */
export const RESTART_NOTICE_HOLD_MS = 15 * 60_000

/** `origin_note` of the guard's restart notice. The notice is written in the restarted agent's NAME
 *  and lists the ids of its window, so it would be a trace of every row it reports on. */
export const RESTART_NOTICE_ORIGIN = 'context-guard restart notice'

/** Every message the guard writes in an agent's name carries an origin note that starts like this. */
const GUARD_ORIGIN_PREFIX = 'context-guard '

export const RESTART_NOTICE_HELD = '[held] routine restart: waiting for the id-bearing traces of the rows delivered in the window'
export const RESTART_NOTICE_SWALLOWED = '[auto-closed] routine restart: every row delivered in the window has a trace that carries its id'
export const RESTART_NOTICE_DELIVERED_LATE = '[delivered-late] a row of the window had no trace at the deadline; delivered as message'

/** A restart nobody has to look at for its own sake: the handoff was written, it is fresh, and no
 *  running work was killed. Everything else (forced, hard threshold, deadline, stale or unmeasurable
 *  handoff, killed background work) is a notice for a reader, as before. */
export function restartIsRoutine(reason: string, handoffStaleMinutes: HandoffStaleness | undefined): boolean {
  if (typeof handoffStaleMinutes === 'number' || handoffStaleMinutes === 'unknown') return false
  if (!reason.startsWith('handoff written')) return false
  if (reason.startsWith('handoff written but STALE')) return false
  return !reason.includes('KILLS running background work')
}

/** What the pane the restart destroyed ended in. 'unreadable': there is no capture, or the live
 *  input box is not in it, so its last block cannot be located. */
export type RestartPaneTail = 'clean' | 'api-error' | 'unreadable'

/** The third condition of a clean restart (card 074149c2 OUTCOME 1; didi 57938, marveen 57937): the
 *  pane did not end in an API error. A turn that died that way can leave finished work nowhere but
 *  on that screen, and the trace of a ROW says nothing about it. The recognisers are the two the
 *  fleet already acts on (src/pane-state.ts): the error as the last block above the input box, and
 *  the persistent thinking-block error in the live tail. Only a pane that was read and shows
 *  neither is 'clean'. */
export function restartPaneTail(pane: string | null | undefined): RestartPaneTail {
  if (typeof pane !== 'string') return 'unreadable'
  const atTail = midTurnApiErrorAtTail(pane)
  if (atTail === null) return 'unreadable'
  return atTail || detectsThinkingBlockError(pane) ? 'api-error' : 'clean'
}

/** How the stored text of each of the guard's five handoff requests starts (the builders are in
 *  src/web/context-guard-runner.ts; restart-notice-trace.test.ts runs every one against this list). */
const HANDOFF_REQUEST_HEADS: readonly string[] = [
  '[CONTEXT-GUARD] A munkakontextusod ',
  '[CONTEXT-GUARD] Rutin karbantartás, nem vészhelyzet.',
  '[CONTEXT-GUARD] Ütemezett napi újraindítás (',
  '[CONTEXT-GUARD] A sub-agent kapu megtagadott ',
  '[CONTEXT-GUARD] A HANDOFF.md-d megvan, ',
]

/** Is this row the guard's own request for the handoff? On a routine restart the handoff it asked
 *  for exists, which is the proof that the row was processed. */
export function isHandoffRequest(from: string, content: string): boolean {
  return from === 'system' && HANDOFF_REQUEST_HEADS.some((h) => content.startsWith(h))
}

/** One row that was injected into the session the restart destroyed. `deliveredAt` in epoch seconds. */
export interface HeldRow {
  id: number
  from: string
  deliveredAt: number
  handoffRequest: boolean
}

/** What the database knows about the held rows right now. The readers prefilter on the id as text;
 *  the rules are here. */
export interface TraceEvidence {
  /** Current state of the held rows by id. A row that is gone is simply absent. */
  states: ReadonlyMap<number, { status: string; completed_at: number | null }>
  /** Rows the restarted agent SENT. */
  messages: readonly { created_at: number; content: string; origin_note: string | null }[]
  /** Card comments the restarted agent wrote. */
  comments: readonly { created_at: number; content: string; automated: number }[]
}

export type RowTrace = 'handoff-request' | 'closed' | 'message-names-id' | 'comment-names-id'

/** Does the text name this message id? Bounded on both sides by something that is neither a digit
 *  nor a letter, so 10012798 is not found inside 110012798, 100127985 or a commit hash. */
export function namesId(text: string, id: number): boolean {
  return new RegExp(`(?<![0-9A-Za-z])${id}(?![0-9A-Za-z])`).test(text)
}

/** The trace of one row, or null. A trace carries the row's id and is later than its delivery:
 *  the row closed, or the agent naming the id in a message or in a card comment. Any other sign of
 *  life (an outgoing message, a commit) does not show that THIS row was seen.
 *
 *  A row closed as FAILED is not a trace by its state. The receipt the PUT route then sends to the
 *  row's sender by default (COMPLETION_REPORT_PREFIX + " msg_id:<id> status:failed", written in
 *  the agent's name, src/web/routes/messages.ts) names the id, so it IS one: the sender has been
 *  told, and the sender is the reader a failed row needs. Failed with notify:false tells nobody,
 *  and that row stays untraced (didi 57938, note 3). */
export function rowTrace(row: HeldRow, ev: TraceEvidence): RowTrace | null {
  if (row.handoffRequest) return 'handoff-request'
  const st = ev.states.get(row.id)
  if (st && st.status === 'done' && typeof st.completed_at === 'number' && st.completed_at > row.deliveredAt) return 'closed'
  const named = ev.messages.some(
    (m) => m.created_at > row.deliveredAt
      && !(m.origin_note ?? '').startsWith(GUARD_ORIGIN_PREFIX)
      && namesId(m.content, row.id),
  )
  if (named) return 'message-names-id'
  const commented = ev.comments.some(
    (c) => c.created_at > row.deliveredAt && c.automated === 0 && namesId(c.content, row.id),
  )
  return commented ? 'comment-names-id' : null
}

export interface HoldVerdict {
  verdict: 'swallow' | 'hold' | 'deliver'
  traced: { id: number; by: RowTrace }[]
  untraced: number[]
}

/** swallow: every row has its trace. hold: some do not and the deadline has not come. deliver: the
 *  deadline came with a row still untraced. A hold over no rows is not a clean hold, it is a bug in
 *  the caller, and a bug delivers. */
export function holdVerdict(rows: readonly HeldRow[], ev: TraceEvidence, nowMs: number, deadlineMs: number): HoldVerdict {
  const traced: { id: number; by: RowTrace }[] = []
  const untraced: number[] = []
  for (const row of rows) {
    const by = rowTrace(row, ev)
    if (by === null) untraced.push(row.id)
    else traced.push({ id: row.id, by })
  }
  if (rows.length === 0) return { verdict: 'deliver', traced, untraced }
  if (untraced.length === 0) return { verdict: 'swallow', traced, untraced }
  return { verdict: nowMs >= deadlineMs ? 'deliver' : 'hold', traced, untraced }
}

/** The RESTART-ABLAK part of the resume directive while the switch is 'live' (marveen's decision,
 *  card comment 57416). The fresh session CLOSES what it reads back instead of acknowledging it by
 *  message: the close is the trace rowTrace() looks for, and a sender reads nothing to learn that
 *  nothing was lost. The two numbers are the ones the check runs on, not the reader's guess: the
 *  window the notice measured and the deadline the hold waits for. */
export function restartWindowCloseDirective(name: string): string {
  const windowMin = Math.round(RESTART_LOSS_WINDOW_MS / 60_000)
  const holdMin = Math.round(RESTART_NOTICE_HOLD_MS / 60_000)
  return (
    `RESTART-ABLAK: az előző session utolsó ~${windowMin} percében kézbesített inter-agent üzenet elveszhetett. ` +
    `Olvasd vissza a saját sorodat erre az ablakra (GET /api/messages?agent=${name}, delivered_at szerint szűrve), ` +
    `és minden ott talált, még el nem intézett kérést kezelj újként. KÖTELEZŐ MEGFIGYELHETŐ NYOM: minden visszaolvasott ` +
    `sort ZÁRJ LE, a lezárás a nyoma; nyugta-üzenetet NE küldj. Jelentés vagy értesítés (a "system" feladóé is): ` +
    `PUT /api/messages/<id> {"status":"done","result":"[RESTART-ABLAK] felvéve a friss sessionben","notify":false}. ` +
    `Rád bízott feladat: akkor zárd le, amikor kész, az eredményével; addig írj a kártyájára egy sort, amely megnevezi az üzenet azonosítóját. ` +
    `Az állapotot, amit eddig a nyugtába írtál, a KÁRTYÁRA írd; üzenetet csak akkor küldj, ha DÖNTÉS kell a címzettől. ` +
    `Aminek a restart után ${holdMin} perccel sincs az azonosítóját hordozó nyoma (lezárás, vagy az azonosítót megnevező üzeneted vagy kártya-kommented), azt a rendszer név szerint jelenti. `
  )
}

/** The sentence a late notice adds: which rows, from whom, and what "no trace" means. */
export function untracedLine(rows: readonly HeldRow[], untraced: readonly number[], waitedMin: number): string {
  const from = new Map(rows.map((r) => [r.id, r.from]))
  const list = untraced.map((id) => `${id}<-${from.get(id) ?? '?'}`).join(', ')
  return ` NYOM NELKUL ${waitedMin} perc utan: ${untraced.length} (${list})`
    + ' -- ezeknek a soroknak a kezbesites ota nincs az azonositojukat hordozo nyoma'
    + ' (lezaras, az agens uzenete vagy kartya-kommentje). Az ablak tobbi soranak megvan.'
}

/** The sentence a notice gets when the trace check itself failed: it is delivered, and says why. */
export const TRACE_UNMEASURED_LINE = ' A NYOMOKAT NEM TUDTAM MEGMERNI (a lekerdezes hibazott), ezert ez az ertesito kezbesul: a triazs kezi.'

/** The sentence a held notice gets when the switch left `live` while it was waiting. */
export const HOLD_RELEASED_LINE = ' A visszatartas kozben a kapcsolo (RESTART_NOTICE_SWALLOW_MODE) elhagyta a live allast, ezert ez az ertesito nyom-ellenorzes nelkul kezbesul.'
