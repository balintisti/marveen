import type { KanbanComment } from '../db.js'

/**
 * Archiving a card takes its LAST comment out of sight with it -- and on this
 * board that last comment is very often a CONDITIONAL sentence: "reopen if X",
 * "remeasure when Y". The rule that produced those sentences is a good one
 * (every handed-over measurement carries what would invalidate it), but nothing
 * ever measures the condition afterwards. The condition is written down, the
 * card is archived, and the event it waits for is exactly the event nobody is
 * watching for. Same silent shape as everywhere else on this board: the
 * mechanism runs, reports green, and does not protect.
 *
 * MEASURED (jarvis, 2026-08-27, card ade4260a): 1271 comments across 411 live
 * cards match the patterns below. The denominator is not the strongest argument
 * though -- these four came from ONE day: marveen 2, dexter 1, friday 1, each
 * leaving a conditional sentence with no card of its own. A habit that the
 * coordinator and the two most disciplined writers on the board all miss is not
 * a habit question, it is a mechanism question.
 *
 * WHY A WARNING AND NOT A BLOCK: the archive is nearly always right, and a
 * blocked archive would be paid for on every single card to catch a few. A
 * warning costs one line in a response the caller already reads.
 *
 * WHAT THIS IS NOT ABLE TO DO, said out loud because the log in
 * reopen-condition-log.ts exists precisely to settle it: "unanswered" here is a
 * HEURISTIC. It cannot tell an ANSWER from someone simply carrying on talking
 * on the card. Only live use decides whether it fires usefully, which is why
 * every firing is counted.
 */

/** NFD + combining-mark strip + lowercase, so `újranyitási` and `ujranyitasi` match. */
export function foldAccents(raw: string): string {
  return raw.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase()
}

/**
 * The three shapes jarvis measured. Kept as accent-folded literals: they are
 * matched against folded text, so an accented comment matches the same entry.
 */
export const CONDITION_PATTERNS = [
  'ujranyitasi feltetel',
  'ujramerendo',
  'mi tenne ervenytelenne',
] as const

/** The single word that marks a duplicate merge in the comment fallback. */
const DUPLICATE_MARKER = 'duplikatum'

export interface ConditionScan {
  /** How many comments on the card carry a condition sentence. */
  matches: number
  /** The id of the LAST such comment -- the one the warning points at. */
  lastConditionCommentId: number
  /** The id of the last comment overall, so the log can tell later what changed. */
  lastCommentId: number
}

function carriesCondition(c: KanbanComment): boolean {
  const folded = foldAccents(c.content)
  return CONDITION_PATTERNS.some(p => folded.includes(p))
}

/**
 * Returns the scan only when the card carries an UNANSWERED condition, i.e. the
 * last condition-bearing comment is also the last comment on the card. If
 * anyone posted after it, the condition counts as discussed and we stay silent.
 * Comments arrive ordered by created_at (getKanbanComments), so "last" is the
 * final element.
 */
export function scanUnansweredCondition(comments: KanbanComment[]): ConditionScan | null {
  if (comments.length === 0) return null
  const matching = comments.filter(carriesCondition)
  if (matching.length === 0) return null
  const last = comments[comments.length - 1]
  const lastMatching = matching[matching.length - 1]
  if (lastMatching.id !== last.id) return null
  return {
    matches: matching.length,
    lastConditionCommentId: lastMatching.id,
    lastCommentId: last.id,
  }
}

/**
 * The duplicate-merge exception. Two ways to recognise it, and the order
 * matters: the CALLER saying so is the real signal, the comment text is the
 * same text-heuristic one level down. So `reason` wins whenever it is present,
 * and the text fallback only runs when the caller said nothing.
 */
export function isDuplicateArchive(reason: unknown, comments: KanbanComment[]): boolean {
  if (typeof reason === 'string' && reason.trim() !== '') {
    return foldAccents(reason.trim()) === 'duplicate'
  }
  const last = comments[comments.length - 1]
  return last ? foldAccents(last.content).includes(DUPLICATE_MARKER) : false
}

export function conditionWarningText(scan: ConditionScan): string {
  const db = scan.matches === 1 ? '1 feltetel-mondat' : `${scan.matches} feltetel-mondat`
  return `${db} all ezen a kartyan, es az utolso (komment ${scan.lastConditionCommentId}) utan `
    + 'nem szolt hozza senki. Az archivalassal a feltetel is eltunik: ha meg all, nyiss ra '
    + 'sajat kartyat, mielott lezarod.'
}
