import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { STORE_DIR } from '../config.js'

/**
 * Every firing of the archive-time condition warning writes one append-only
 * line here.
 *
 * WHY THE LOG IS THE MOST IMPORTANT HALF OF THIS FEATURE, not an extra: the
 * warning's own reopening condition was, in jarvis's words, "if it fires
 * repeatedly and nobody does anything, it became scenery". That sentence was
 * NOT DECIDABLE as written -- "nobody does anything" is recorded nowhere. With
 * this file the question becomes counting after thirty archives, instead of an
 * argument. A guard that cannot be measured is the very thing this card is
 * about.
 *
 * THE FOURTH FIELD ("did the caller do anything afterwards") IS DERIVED, NOT
 * STORED. The obvious design writes `pending` and back-fills it later, which
 * means mutating an append-only log -- and a log you rewrite is a log that can
 * disagree with itself. Instead each line stores the id of the card's last
 * comment AT FIRING TIME; whether anyone acted is then answered from the board
 * itself, at read time, by asking whether a newer comment exists. Nothing to
 * back-fill, and the answer never goes stale.
 *
 * WHAT IT DOES NOT MEASURE, said out loud: a new comment is the only signal it
 * counts. Someone who reacts by opening a NEW card, by unarchiving, or by
 * fixing the thing without writing anything, reads here as "silent". So the
 * silent count is an UPPER bound on indifference, not a headcount of it -- and
 * if the ratio ever gets used to retire this warning, that limit has to be said
 * with it.
 */

/**
 * Resolved per call, not at import time, so a test can point it somewhere
 * disposable (`MARVEEN_REOPEN_WARNING_LOG`) instead of appending to the live
 * store. Same override shape as MARVEEN_SSH_DIR / CLAUDECLAW_ENV_DIR elsewhere
 * in this repo.
 */
export function reopenWarningLogPath(): string {
  const override = process.env.MARVEEN_REOPEN_WARNING_LOG
  if (override && override.trim() !== '') return override
  return join(STORE_DIR, 'reopen-condition-warnings.jsonl')
}

export interface ReopenWarningEntry {
  /** Unix seconds. */
  ts: number
  card: string
  /** How many condition sentences stood on the card when it fired. */
  matches: number
  /** The condition comment the warning pointed at. */
  condition_comment_id: number
  /** Who archived. `ismeretlen` when the caller sent no actor. */
  actor: string
  /** Last comment id on the card at firing time -- the anchor the 4th field is derived from. */
  last_comment_id_at_fire: number
}

export function appendReopenWarning(entry: ReopenWarningEntry, file: string = reopenWarningLogPath()): void {
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
}

export interface ReopenWarningLog {
  entries: ReopenWarningEntry[]
  /** Lines that could not be parsed. Counted rather than dropped: a log that
   *  silently discards its own damage is the failure mode this file guards. */
  malformed: number
}

export function readReopenWarnings(file: string = reopenWarningLogPath()): ReopenWarningLog {
  if (!existsSync(file)) return { entries: [], malformed: 0 }
  const entries: ReopenWarningEntry[] = []
  let malformed = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line) as Partial<ReopenWarningEntry>
      if (typeof parsed.card === 'string' && typeof parsed.last_comment_id_at_fire === 'number') {
        entries.push(parsed as ReopenWarningEntry)
      } else {
        malformed++
      }
    } catch {
      malformed++
    }
  }
  return { entries, malformed }
}

export interface ReopenWarningSummary {
  fired: number
  /** A newer comment exists on the card than at firing time. */
  acted: number
  /** No newer comment. See the caveat in the file header: an UPPER bound. */
  silent: number
}

/**
 * `latestCommentId` answers, for a card id, the id of its newest comment today
 * (null when the card has none or is gone). Passed in rather than imported so
 * this stays a pure function over the log -- the caller owns the db.
 */
export function summarizeReopenWarnings(
  entries: ReopenWarningEntry[],
  latestCommentId: (card: string) => number | null,
): ReopenWarningSummary {
  let acted = 0
  for (const e of entries) {
    const now = latestCommentId(e.card)
    if (now !== null && now > e.last_comment_id_at_fire) acted++
  }
  return { fired: entries.length, acted, silent: entries.length - acted }
}
