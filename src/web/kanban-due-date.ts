/**
 * `due_date` on a kanban card: what the write path accepts, and what it stores.
 * Cards a8dff303 (the write path) and ad4ee45a (the edit modal).
 *
 * THE DEFECT THIS CLOSES: POST and PUT stored whatever arrived. A string such
 * as '2026-09-26' went in as TEXT, the 200 and the read-back both looked right,
 * and the offering predicate (`isDeferred`, src/idle-agent.ts) compared it as a
 * number, got NaN, and said "not deferred" -- the floor was silently inert.
 * `true` and `{}` reached SQLite and came back as a 500.
 *
 * THE RULE, decided on the measured population (mandark, a8dff303 comment 1):
 * of 43 due_date writes, 31 were integer seconds, 9 were 'YYYY-MM-DD' (all one
 * sender, who then corrected them BY HAND to Budapest midnight), 0 anything else.
 * So: normalise that one shape narrowly, reject everything else LOUDLY.
 *
 *   accepted, stored as integer epoch SECONDS
 *     a positive integer below 1e11 ........ as is
 *     the same as a digit string ........... parsed
 *     'YYYY-MM-DD', a real calendar day .... 00:00 of that day in DUE_DATE_ZONE
 *     null ................................. clears the floor
 *   rejected with 400, stored value untouched
 *     "", "holnap", 0, -1, "2026-02-31", ISO with a time, milliseconds (>= 1e11),
 *     fractions, booleans, objects -- anything else
 *
 * WHY MILLISECONDS ARE REJECTED rather than divided: the stored population holds
 * none, the web view multiplies by 1000 to draw, and `isDeferred` has its own
 * `< 1e11` guess. A second guess here would make two readers disagree about the
 * same number the day one of them changes.
 *
 * WHY A BAD VALUE MUST FAIL AND NOT BE DROPPED: a version that quietly ignores
 * an uninterpretable due_date leaves the card with NO floor while the caller
 * believes it set one -- the same defect, moved one step (marveen's close
 * condition on a8dff303).
 */

/**
 * THE ONE PLACE the day of a due date is interpreted. The edit modal reads it
 * from GET /api/kanban/due-date-rules rather than carrying a copy, so changing
 * it here changes both the write path and what the form shows.
 *
 * Europe/Budapest, not Belgrade, although Isti lives in Serbia: the fleet's
 * time rule is Budapest, and the only sender of the day form corrected its own
 * writes to Budapest midnight. The two zones agree today; that is a
 * coincidence, not the reason.
 *
 * REOPEN: a sender that means a different zone's day, the UI starting to send
 * ISO with a time, or `isDeferred` changing its unit (src/idle-agent.ts).
 */
export const DUE_DATE_ZONE = 'Europe/Budapest'

export const DUE_DATE_ACCEPTED =
  'positive integer epoch SECONDS (also as a digit string), a calendar day as '
  + `'YYYY-MM-DD' (stored as 00:00 ${DUE_DATE_ZONE}), or null to clear`

/** Seconds at or above this are milliseconds, in the same sense as isDeferred. */
const MS_THRESHOLD = 1e11

export type DueDateResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string }

function reject(raw: unknown): DueDateResult {
  let shown: string
  try { shown = JSON.stringify(raw) ?? String(raw) } catch { shown = String(raw) }
  if (shown.length > 60) shown = shown.slice(0, 57) + '...'
  return {
    ok: false,
    error: `Ervenytelen \`due_date\`: ${shown}. Elfogadott alakok: ${DUE_DATE_ACCEPTED}. `
      + 'A kartya NEM valtozott. (GET /api/kanban/due-date-rules)',
  }
}

/** Offset of `zone` from UTC at the instant `utcMs`, in milliseconds. */
function zoneOffsetMs(utcMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - utcMs
}

/**
 * Epoch seconds of 00:00 on the given calendar day in `zone`. Two passes: the
 * first offset is taken at UTC midnight, which can sit on the other side of a
 * DST change from local midnight; the second is taken at the corrected instant.
 * (Budapest changes clocks at 02:00/03:00, so its midnight always exists.)
 */
export function zoneMidnightSeconds(y: number, m: number, d: number, zone = DUE_DATE_ZONE): number {
  const guess = Date.UTC(y, m - 1, d)
  const first = guess - zoneOffsetMs(guess, zone)
  return (guess - zoneOffsetMs(first, zone)) / 1000
}

/** 'YYYY-MM-DD' of the given epoch seconds in `zone` -- the inverse, for tests and the rules route. */
export function zoneDay(seconds: number, zone = DUE_DATE_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(seconds * 1000))
}

function fromSeconds(n: number, raw: unknown): DueDateResult {
  if (!Number.isSafeInteger(n) || n <= 0 || n >= MS_THRESHOLD) return reject(raw)
  return { ok: true, value: n }
}

export function normalizeDueDate(raw: unknown): DueDateResult {
  if (raw === null) return { ok: true, value: null }
  if (typeof raw === 'number') return fromSeconds(raw, raw)
  if (typeof raw !== 'string') return reject(raw)

  if (/^\d+$/.test(raw)) return fromSeconds(Number(raw), raw)

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!m) return reject(raw)
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
  // A real calendar day: Date.UTC rolls 2026-02-31 over to March, so the round
  // trip is what rejects it, not a table of month lengths.
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return reject(raw)
  return { ok: true, value: zoneMidnightSeconds(y, mo, d) }
}
