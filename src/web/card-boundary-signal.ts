import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from '../config.js'
import { atomicWriteFileSync } from './atomic-write.js'
import { CARD_RESTART_REASON_PREFIX, type CardRestartFacts, type ContextGuardConfig } from '../context-guard.js'
import { CARD_BOUNDARY_TARGETS } from './card-restart-facts.js'

// THE ACTIVE HALF OF THE CARD-ALIGNED RESTART (card 00262e3f, marveen's decision, comment 58608).
//
// The passive half waits for an agent that happens to stop right after handing a card over. Measured
// on the trial agent, that is rare: it moves the card and takes the next one in the same turn. The
// active half says so at the move: "put what lives only in your head on the card, then end your
// turn". From there the passive half does the restart on the next sweep.
//
// Telling an agent to stop is the dangerous part, so three things hold it:
//   - the signal is issued only when everything the restart needs was READ and true at the move;
//     anything unknown is no signal, with the reason in the log (decideSignalAtMove);
//   - an agent that stopped is never left standing: the sweep that finds it idle either restarts it
//     or tells it to carry on in the same session (decideSignalAnswer);
//   - one event where the agent stood longer than STAND_LIMIT_MS switches the active half off for
//     that agent (judgeStand); switching it back on is the coordinator's.
//
// HOW THE TEXT REACHES THE AGENT: not through the move's HTTP response (the agent reads the whole
// body in about a quarter of its move calls) and not typed into the pane mid-turn. The dashboard
// writes store/card-boundary-signals/<agent>.json during the move request; the PostToolUse(Bash)
// hook scripts/hooks/card-boundary-signal.py of the SAME call prints its text to the model and
// leaves <agent>.shown beside it. The text opens with the system-directive envelope, and the row it
// names exists (from "system", to the agent), so the agent can verify it like any other directive.

export const CARD_BOUNDARY_SIGNAL_DIR = join(PROJECT_ROOT, 'store', 'card-boundary-signals')

/** Longer than this between the end of the agent's turn and the next session's first tool call is
 *  the trial's stop condition (decision 58608, point 4). */
export const STAND_LIMIT_MS = 10 * 60_000

/** The hook shows a signal only this long after it was issued. It runs on the very call that made
 *  the move, so a signal still unshown later was missed, and by then the facts it rested on are old.
 *  The same number lives in scripts/hooks/card-boundary-signal.py (SHOW_WINDOW_S). */
export const SHOW_WINDOW_MS = 120_000

/** How long the stand of an answered event is followed before the record is dropped. */
export const STAND_FOLLOW_MS = 60 * 60_000

export interface CardBoundarySignal {
  agent: string
  cardId: string
  toStatus: string
  movedAtMs: number
  issuedAtMs: number
  /** The anchor row in agent_messages (from "system", to the agent). */
  msgId: number
  /** What the hook prints: the directive envelope and the body. */
  text: string
}

export type CardRestartHalf = 'passive' | 'active'

/** One answered boundary, kept until the next session's first tool call is seen (the stand). */
export interface AnsweredBoundary {
  agent: string
  cardId: string
  toStatus: string
  half: CardRestartHalf
  how: 'restart' | 'continue'
  atMs: number
  /** When the agent's turn ended, and where that number comes from. */
  turnEndMs: number
  turnEndSource: 'transcript' | 'signal-shown' | 'answer-time'
  /** Set once the over-limit stand was reported, so it is reported once. */
  limitReported?: boolean
}

// ---------------------------------------------------------------------------------------------
// The decision at the move
// ---------------------------------------------------------------------------------------------

export interface MoveFacts {
  cfg: ContextGuardConfig
  cardId: string
  fromStatus: string | undefined
  toStatus: string
  /** A fleet freeze pauses the sweep, and with it the answer to an agent that stopped. */
  frozen: boolean
  running: boolean
  /** The guard's phase for the agent; a sequence under way answers the agent itself. */
  guardPhase: string
  sessionStartSec: number | undefined
  contextTokens: number | null
  /** Background work the restart would kill, or null when it could not be measured. */
  backgroundWork: number | null
  /** Read AFTER the move was written. */
  facts: CardRestartFacts | null
}

/** `reason: null` = not this mechanism's case at all (not armed, or not a hand-over move): no log. */
export type SignalAtMove = { issue: true } | { issue: false; reason: string | null }

/** Armed for this agent, and the move hands a card over. Cheap, so the caller asks it before it measures anything. */
export function signalApplies(cfg: ContextGuardConfig, fromStatus: string | undefined, toStatus: string): boolean {
  if (!cfg.cardRestartEnabled || !cfg.cardRestartSignal) return false
  return fromStatus === 'in_progress' && CARD_BOUNDARY_TARGETS.includes(toStatus)
}

export function decideSignalAtMove(m: MoveFacts): SignalAtMove {
  if (!signalApplies(m.cfg, m.fromStatus, m.toStatus)) return { issue: false, reason: null }
  const no = (reason: string): SignalAtMove => ({ issue: false, reason })
  if (m.frozen) return no('the fleet is frozen: no sweep would answer an agent that stopped')
  if (!m.running) return no('the agent has no running session')
  if (m.guardPhase !== 'idle') return no(`the guard is in phase ${m.guardPhase}`)
  if (m.sessionStartSec === undefined) return no('the session start is not known')
  if (m.contextTokens === null) return no('context size unmeasurable')
  if (m.contextTokens < m.cfg.cardRestartTokens) {
    return no(`context ${Math.round(m.contextTokens / 1000)}k is below ${Math.round(m.cfg.cardRestartTokens / 1000)}k`)
  }
  if (m.backgroundWork === null) return no('background work could not be measured')
  if (m.backgroundWork > 0) return no('background work is running, a restart would be refused')
  if (!m.facts || m.facts.boundary === 'unknown') return no('the agent\'s last card move could not be read')
  if (m.facts.boundary === null || m.facts.boundary.cardId !== m.cardId) return no('the agent\'s last board event is not this move')
  if (m.facts.blockers.length > 0) return no(m.facts.blockers.join('; '))
  return { issue: true }
}

/** The signal's own words. Hungarian: the agent's sheet and the decision it cites are. */
export function cardBoundarySignalBody(cardId: string, toStatus: string, contextTokens: number, thresholdTokens: number): string {
  return (
    `[KARTYAHATAR] A(z) ${cardId} kártyát most tetted át in_progress-ből ${toStatus} állapotba, a munkameneted kontextusa ` +
    `~${Math.round(contextTokens / 1000)}k token (a küszöb ${Math.round(thresholdTokens / 1000)}k), és nincs más saját kártyád in_progress-ben. ` +
    `Ez a kártyahatáros újraindítás próbájának megállója: a koordinátor rendelte el (kártya 00262e3f, marveen döntése a 58608-as kommentben; ` +
    `a szabály sora a lapodon áll). Két dolgod van, ebben a sorrendben: ` +
    `(1) ami csak a fejedben él erről a munkáról (félbehagyott gondolat, meg nem írt lelet, amit a következő lépésnek szántál), azt írd fel ` +
    `MOST a kártyára kommentként; ha nincs ilyen, nem kell komment. ` +
    `(2) Utána FEJEZD BE a kört: ne vegyél fel új kártyát, és NE írj HANDOFF.md-t. ` +
    `A következő ellenőrző kör friss munkamenetet indít, és az a tábláról folytatja. ` +
    `Ha az újraindítás valamiért nem történhet meg, folytatás-jelzést kapsz, és ebben a munkamenetben mész tovább.`
  )
}

/** What an agent that stopped on the signal is told when no restart follows. */
export function cardBoundaryContinueText(cardId: string, reason: string): string {
  return (
    `[KARTYAHATAR] Az újraindítás NEM történt meg a(z) ${cardId} kártya után: ${reason}. ` +
    `Folytasd ebben a munkamenetben: nézd meg a tábládat és a sorodat, és vedd fel a következő kártyádat. ` +
    `A megálló ezzel lezárult, nincs mire várnod.`
  )
}

// ---------------------------------------------------------------------------------------------
// The answer on a sweep
// ---------------------------------------------------------------------------------------------

export interface AnswerFacts {
  signal: CardBoundarySignal | null
  /** When the hook showed the text, or null: not shown (or the mark is unreadable). */
  shownAtMs: number | null
  nowMs: number
  running: boolean
  sessionStartSec: number | undefined
  paneIdle: boolean
  decision: { action: string; reason: string; cardRestart?: { cardId: string; movedAtMs: number } }
  /** The board facts of this sweep, when the guard gathered them. */
  facts?: CardRestartFacts
}

export type SignalAnswer =
  | { kind: 'none' }
  | { kind: 'wait' }
  | { kind: 'restart'; half: CardRestartHalf }
  | { kind: 'continue'; reason: string }
  | { kind: 'clear'; why: string; warn: boolean }

/**
 * What the guard does about an outstanding signal on this sweep.
 *
 * The one rule everything else serves: an agent that was SHOWN the signal and is now idle gets an
 * answer on this sweep, a restart or a "carry on". No branch below lets that case fall through to a
 * silent clear.
 */
export function decideSignalAnswer(a: AnswerFacts): SignalAnswer {
  const sig = a.signal
  const restartsOnCard = a.decision.action === 'restart' && a.decision.cardRestart !== undefined
  if (!sig) return restartsOnCard ? { kind: 'restart', half: 'passive' } : { kind: 'none' }
  if (restartsOnCard) {
    const same = a.decision.cardRestart!.cardId === sig.cardId && a.decision.cardRestart!.movedAtMs === sig.movedAtMs
    return { kind: 'restart', half: same && a.shownAtMs !== null ? 'active' : 'passive' }
  }
  if (!a.running) return { kind: 'clear', why: 'the session is not running', warn: false }
  if (a.sessionStartSec !== undefined && a.sessionStartSec * 1000 > sig.issuedAtMs) {
    return { kind: 'clear', why: 'the session was replaced after the signal', warn: false }
  }
  // Another sequence owns the agent now, and it speaks to the agent itself.
  if (a.decision.action === 'restart' || a.decision.action === 'request-handoff') {
    return { kind: 'clear', why: `superseded by ${a.decision.action}: ${a.decision.reason}`, warn: false }
  }
  // The other actions belong to a sequence that is already talking to the agent.
  if (a.decision.action !== 'none') return { kind: 'wait' }
  if (a.shownAtMs === null) {
    if (a.nowMs - sig.issuedAtMs <= SHOW_WINDOW_MS) return { kind: 'wait' }
    // Nobody was told to stop, so nobody stands: there is nothing to answer.
    return { kind: 'clear', why: 'issued but never shown to the agent (is the hook registered?)', warn: true }
  }
  if (!a.paneIdle) {
    const b = a.facts?.boundary
    const moved = b !== undefined && b !== 'unknown' && (b === null || b.cardId !== sig.cardId || b.movedAtMs !== sig.movedAtMs)
    return moved
      ? { kind: 'clear', why: 'not followed: the agent is working and its last board event is a later one', warn: false }
      : { kind: 'wait' }
  }
  return {
    kind: 'continue',
    reason: a.decision.reason.startsWith(CARD_RESTART_REASON_PREFIX)
      ? a.decision.reason
      : `the guard did not decide a restart on this check (${a.decision.reason})`,
  }
}

// ---------------------------------------------------------------------------------------------
// The stand
// ---------------------------------------------------------------------------------------------

export type StandJudgement =
  /** The next session worked: the stand is known. `switchOff` = it was over the limit on an active event. */
  | { kind: 'measured'; standMs: number; switchOff: boolean }
  /** Still no tool call. `switchOff` = the limit has just been passed on an active event. */
  | { kind: 'standing'; standMs: number; overLimit: boolean; switchOff: boolean }
  /** Followed for STAND_FOLLOW_MS with no tool call: the record is dropped, the line says so. */
  | { kind: 'gave-up'; standMs: number }

export function judgeStand(answered: AnsweredBoundary, firstToolUseMs: number | null, nowMs: number): StandJudgement {
  if (firstToolUseMs !== null) {
    const standMs = Math.max(0, firstToolUseMs - answered.turnEndMs)
    return { kind: 'measured', standMs, switchOff: answered.half === 'active' && standMs > STAND_LIMIT_MS && !answered.limitReported }
  }
  const standMs = Math.max(0, nowMs - answered.turnEndMs)
  if (nowMs - answered.atMs > STAND_FOLLOW_MS) return { kind: 'gave-up', standMs }
  const overLimit = standMs > STAND_LIMIT_MS
  return { kind: 'standing', standMs, overLimit, switchOff: overLimit && answered.half === 'active' && !answered.limitReported }
}

// ---------------------------------------------------------------------------------------------
// The files
// ---------------------------------------------------------------------------------------------

const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** A kanban `actor` is free text; only a plain id can be an agent, and only that becomes a file name. */
export const isSignalAgentId = (agent: string): boolean => AGENT_NAME.test(agent)

function pathFor(agent: string, suffix: string, dir: string): string {
  // Refused, not sanitized: two different actors must never share a file.
  if (!AGENT_NAME.test(agent)) throw new Error(`card-boundary-signal: not an agent id: ${JSON.stringify(agent)}`)
  return join(dir, `${agent}${suffix}`)
}

export const signalPath = (agent: string, dir = CARD_BOUNDARY_SIGNAL_DIR): string => pathFor(agent, '.json', dir)
export const shownPath = (agent: string, dir = CARD_BOUNDARY_SIGNAL_DIR): string => pathFor(agent, '.shown', dir)
export const answeredPath = (agent: string, dir = CARD_BOUNDARY_SIGNAL_DIR): string => pathFor(agent, '.answered.json', dir)

function removeIfThere(path: string): void {
  try { unlinkSync(path) } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0

export function writeSignal(sig: CardBoundarySignal, dir = CARD_BOUNDARY_SIGNAL_DIR): void {
  mkdirSync(dir, { recursive: true })
  // The mark first: an old one left beside a new signal would keep the hook silent.
  removeIfThere(shownPath(sig.agent, dir))
  atomicWriteFileSync(signalPath(sig.agent, dir), JSON.stringify(sig))
}

/** The outstanding signal, or null. A file that does not hold a whole signal is no signal. */
export function readSignal(agent: string, dir = CARD_BOUNDARY_SIGNAL_DIR): CardBoundarySignal | null {
  let raw: unknown
  try { raw = JSON.parse(readFileSync(signalPath(agent, dir), 'utf8')) } catch { return null }
  const o = (raw ?? {}) as Record<string, unknown>
  if (o.agent !== agent || !isStr(o.cardId) || !isStr(o.toStatus) || !isStr(o.text)) return null
  if (!isNum(o.movedAtMs) || !isNum(o.issuedAtMs) || !isNum(o.msgId)) return null
  return { agent, cardId: o.cardId, toStatus: o.toStatus, movedAtMs: o.movedAtMs, issuedAtMs: o.issuedAtMs, msgId: o.msgId, text: o.text }
}

/** When the hook showed the signal (epoch ms), or null. The mark holds the hook's own clock reading. */
export function readShownMs(agent: string, dir = CARD_BOUNDARY_SIGNAL_DIR): number | null {
  let text: string
  try { text = readFileSync(shownPath(agent, dir), 'utf8') } catch { return null }
  const n = Number(text.trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

export function clearSignal(agent: string, dir = CARD_BOUNDARY_SIGNAL_DIR): void {
  removeIfThere(signalPath(agent, dir))
  removeIfThere(shownPath(agent, dir))
}

/** Asked for every agent on every sweep, so a name that cannot have a file is a plain "no". */
export function hasSignalFile(agent: string, dir = CARD_BOUNDARY_SIGNAL_DIR): boolean {
  return isSignalAgentId(agent) && existsSync(signalPath(agent, dir))
}

export function writeAnswered(rec: AnsweredBoundary, dir = CARD_BOUNDARY_SIGNAL_DIR): void {
  mkdirSync(dir, { recursive: true })
  atomicWriteFileSync(answeredPath(rec.agent, dir), JSON.stringify(rec))
}

export function readAnswered(agent: string, dir = CARD_BOUNDARY_SIGNAL_DIR): AnsweredBoundary | null {
  let raw: unknown
  try { raw = JSON.parse(readFileSync(answeredPath(agent, dir), 'utf8')) } catch { return null }
  const o = (raw ?? {}) as Record<string, unknown>
  if (o.agent !== agent || !isStr(o.cardId) || !isStr(o.toStatus) || !isNum(o.atMs) || !isNum(o.turnEndMs)) return null
  if (o.half !== 'passive' && o.half !== 'active') return null
  if (o.how !== 'restart' && o.how !== 'continue') return null
  if (o.turnEndSource !== 'transcript' && o.turnEndSource !== 'signal-shown' && o.turnEndSource !== 'answer-time') return null
  return {
    agent, cardId: o.cardId, toStatus: o.toStatus, half: o.half, how: o.how, atMs: o.atMs,
    turnEndMs: o.turnEndMs, turnEndSource: o.turnEndSource,
    ...(o.limitReported === true ? { limitReported: true } : {}),
  }
}

export function clearAnswered(agent: string, dir = CARD_BOUNDARY_SIGNAL_DIR): void {
  removeIfThere(answeredPath(agent, dir))
}
