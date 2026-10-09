/**
 * WHICH VERDICTS ON A CARD ARE STILL OPEN -- card 5a967042.
 *
 * One reading for both places that must not close a card over an open item:
 * the move/PUT/archive routes (web/kanban-verdict-gate.ts) and the hourly
 * archive sweep (db.ts sweepArchivedKanbanCards). Two copies would drift, and
 * the one that drifted would be the one nobody runs by hand -- the sweep.
 *
 * THE RULE, from rulebook/kanban-verdikt-konvencio.md:
 *   - a verdict is a line that STARTS with `VERDIKT:` (column 0); a quoted or
 *     indented one is somebody citing a verdict, not giving one;
 *   - "last wins" holds WITHIN an author, never across the card.
 *
 * THE TOKEN, widened after didi's audit (2026-09-29, 17 live lines) and
 * marveen's decision: it is what stands before the first `|` OR the first
 * ` -- `. The `|` form is the convention; the ` -- ` form is the older one
 * (32 lines in the convention's own 09-05 census) and still lives on the
 * board. A severity in parentheses right after it -- "NYITOTT TETEL (kozepes)
 * -- ..." -- is part of the same verdict. "NINCS NYITOTT TETEL -- ..." stays
 * closed: the token is compared whole, never searched for "NYITOTT".
 *
 * THE SECOND TOKEN, `MARADEK:` -- card 0a787690, Isti 5654 ("Nem mehet kesz
 * statuszba olyan kartya amin meg van nyitott teendo"). Measured 2026-10-07
 * 08:56: three done cards carried a prose "MARADEK-JELZES" comment and closed
 * clean, so the leftover went to the archive. Same parser style, a CLOSED token,
 * NOT a prose detector (the fleet measured five false-positive families of those):
 *   - `MARADEK: <what> | <where>` at column 0 opens a leftover for its author;
 *   - `MARADEK: NINCS | <where it went>` at column 0 closes EVERY leftover the
 *     SAME author opened before it (the destination after the `|` is required: a
 *     bare NINCS is a leftover vanishing without a trace, exactly the failure);
 *   - another author's NINCS closes nothing; a later MARADEK line re-opens;
 *   - the same ` -- ` / `|` separators and the same normalisation as VERDIKT;
 *     the prefix also takes the accented upper-case spelling `MARADÉK:`.
 * Prose ("MARADEK-JELZES: ...", "maradek: ..." mid-line, indented, quoted) is
 * somebody talking about a leftover, not declaring one, and is never read.
 */

/** The fields of a comment the reading needs; db.ts's KanbanComment has them. */
export interface VerdictComment {
  id: number
  author: string
  content: string | null
  created_at: number
}

export interface OpenVerdict {
  author: string
  /** The verdict line as written, for a refusal to quote. */
  line: string
  commentId: number
}

/** An open `MARADEK:` line; same shape as a verdict so a refusal quotes both alike. */
export type OpenLeftover = OpenVerdict

const VERDICT_PREFIX = 'VERDIKT:'

/** Upper case, accents off, spaces collapsed: "NYITOTT TÉTEL" == "NYITOTT TETEL". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** The verdict token: before the first `|` or ` -- `, whichever comes first. */
export function verdictToken(line: string): string {
  const rest = line.slice(VERDICT_PREFIX.length)
  const cut = [rest.indexOf('|'), rest.indexOf(' -- ')].filter((i) => i >= 0)
  return normalize(cut.length ? rest.slice(0, Math.min(...cut)) : rest)
}

/** NYITOTT TETEL, with or without a severity in parentheses after it. */
const OPEN_TOKEN = /^NYITOTT TETEL(?: \([^)]*\))?$/

/** Each author's last verdict line, when it says the author has an open item. */
export function openVerdicts(comments: VerdictComment[]): OpenVerdict[] {
  const ordered = [...comments].sort((a, b) => a.created_at - b.created_at || a.id - b.id)
  const lastByAuthor = new Map<string, { line: string; commentId: number }>()
  for (const comment of ordered) {
    for (const line of (comment.content ?? '').split(/\r?\n/)) {
      if (!line.startsWith(VERDICT_PREFIX)) continue
      lastByAuthor.set(comment.author, { line: line.trimEnd(), commentId: comment.id })
    }
  }
  const open: OpenVerdict[] = []
  for (const [author, verdict] of lastByAuthor) {
    if (OPEN_TOKEN.test(verdictToken(verdict.line))) {
      open.push({ author, line: verdict.line, commentId: verdict.commentId })
    }
  }
  return open
}

const LEFTOVER_PREFIX = 'MARADEK:'

/**
 * The text after a column-0 `MARADEK:` prefix, or null when the line does not
 * start with one. The prefix is compared accent-insensitively (accents off, case
 * kept; card 0a787690, didi 31731): the Hungarian spelling "MARADÉK:" is the same
 * token (otherwise it would silently open nothing), while "Maradék:" / "maradek:"
 * stay prose because the case is never folded. Only the prefix is normalised; the
 * rest of the line is returned as written.
 */
function leftoverRest(raw: string): string | null {
  const colon = raw.indexOf(':')
  // "MARADEK:" is 8 chars precomposed, up to 10 with a decomposed accent.
  if (colon < 0 || colon > 10) return null
  const prefix = raw.slice(0, colon + 1)
  const bare = prefix.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return bare === LEFTOVER_PREFIX ? raw.slice(colon + 1) : null
}

/**
 * The text before the first `|` or ` -- ` (the token) and what follows it (the
 * destination, empty when there is no separator).
 */
function splitLeftover(rest: string): { token: string; where: string } {
  const cut = [rest.indexOf('|'), rest.indexOf(' -- ')].filter((i) => i >= 0)
  if (cut.length === 0) return { token: normalize(rest), where: '' }
  const at = Math.min(...cut)
  const sepLen = rest.startsWith('|', at) ? 1 : 4
  return { token: normalize(rest.slice(0, at)), where: rest.slice(at + sepLen).trim() }
}

/**
 * Every leftover an author opened and has not closed with their own later
 * `MARADEK: NINCS | <where>`. Listed one by one (an author with two leftovers
 * gets both named), closed all at once by one NINCS of theirs.
 */
export function openLeftovers(comments: VerdictComment[]): OpenLeftover[] {
  const ordered = [...comments].sort((a, b) => a.created_at - b.created_at || a.id - b.id)
  const byAuthor = new Map<string, OpenLeftover[]>()
  for (const comment of ordered) {
    for (const raw of (comment.content ?? '').split(/\r?\n/)) {
      const rest = leftoverRest(raw)
      if (rest === null) continue
      const line = raw.trimEnd()
      const { token, where } = splitLeftover(rest)
      if (token === 'NINCS' && where !== '') {
        byAuthor.delete(comment.author)
        continue
      }
      const list = byAuthor.get(comment.author) ?? []
      list.push({ author: comment.author, line, commentId: comment.id })
      byAuthor.set(comment.author, list)
    }
  }
  return [...byAuthor.values()].flat()
}
