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
 *   - "last wins" holds WITHIN an author, never across the card;
 *   - the author's OWN measured-time stamp in front of it is not an indent
 *     (card 08832e26, OWN_STAMP below).
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

/**
 * A measured-time stamp the writer's OWN script puts in front of the line --
 * card 08832e26. `[didi, 2026-10-14 23:13 CEST, date] VERDIKT: NINCS NYITOTT TETEL`
 * (970be4b3, comment 34722) is a verdict given, not cited, but it does not start
 * at column 0, so the reading skipped it and didi's OLDER open line (26541) stayed
 * her last: the card could not close over a verdict she had already closed.
 * Measured 2026-10-17 15:58 on 2028 live cards: 5 stamped lines, all of this one
 * shape, all naming their own comment's author.
 *
 * Only that exact shape is taken off, and only when the name in it is the
 * comment's author: a line someone pastes from ANOTHER author's comment still
 * reads as a citation, which is what the column-0 rule is for.
 */
const OWN_STAMP = /^\[([^\],]+), \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? [A-Z]{3,5}, date\] /

/** The line without its author's own stamp, or the line as written. */
function withoutOwnStamp(line: string, author: string): string {
  const m = OWN_STAMP.exec(line)
  return m && m[1] === author ? line.slice(m[0].length) : line
}

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
    for (const raw of (comment.content ?? '').split(/\r?\n/)) {
      const line = withoutOwnStamp(raw, comment.author)
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

/** The token a reviewer closes with. Compared whole, like OPEN_TOKEN. */
const CLOSED_TOKEN = 'NINCS NYITOTT TETEL'

/**
 * Does this ONE comment end on a closing verdict -- is its last column-0 `VERDIKT:` line
 * `NINCS NYITOTT TETEL`? (card 860db8cd)
 *
 * The idle guard's question, not the close gate's: when a reviewer's comment is the last
 * word on a testing card, does the assignee owe it an answer? A closing verdict says no --
 * the card now waits on whoever closes or ships it. Measured 2026-10-30 05:30: ford had 146
 * testing cards, the guard woke him over ~111 of them, and on 102 the reviewer's last comment
 * said NINCS NYITOTT. Same column-0 and own-stamp rules as openVerdicts; a comment with no
 * verdict line, or whose last one is anything else (NYITOTT, RESZLEGES), is not closing.
 */
export function endsOnClosingVerdict(comment: Pick<VerdictComment, 'author' | 'content'>): boolean {
  let last: string | null = null
  for (const raw of (comment.content ?? '').split(/\r?\n/)) {
    const line = withoutOwnStamp(raw, comment.author)
    if (line.startsWith(VERDICT_PREFIX)) last = line
  }
  return last !== null && verdictToken(last) === CLOSED_TOKEN
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
    for (const written of (comment.content ?? '').split(/\r?\n/)) {
      const raw = withoutOwnStamp(written, comment.author)
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

/**
 * A CARD GOES TO DONE ONLY WITH ITS PROOF -- card 3c7be3c4.
 *
 * Isti (Telegram 5697, 2026-10-07; definition on card 08eed527): done needs a
 * comment line `KESZ-IGAZOLAS: <ELES|ATADVA|DONTES|DOKUMENTUM|TARGYTALAN>`
 * followed by its measured evidence. The rule lived in the closer's reading:
 * 29f0cd5c went to done on 2026-10-17 with move 200 and no such line, because
 * the closing script went on after the comment post had been refused.
 *
 * Read like `MARADEK:`: a line that STARTS with the prefix (column 0, after the
 * author's own stamp), accents off (the "KÉSZ-IGAZOLÁS: TÁRGYTALAN" spelling
 * is on the board once), case kept. Measured 2026-10-20 11:10 on the 1082 done
 * cards: 1116 lines of the exact shape, 1 accented, 0 stamped. The kind must be
 * one of the five; what follows it is the evidence and is not judged here.
 */
export const DONE_PROOF_KINDS = ['ELES', 'ATADVA', 'DONTES', 'DOKUMENTUM', 'TARGYTALAN'] as const

const DONE_PROOF = new RegExp(`^KESZ-IGAZOLAS:\\s*(?:${DONE_PROOF_KINDS.join('|')})(?![A-Z0-9])`)

/** Whether any comment carries a done-proof line. */
export function hasDoneProof(comments: VerdictComment[]): boolean {
  return comments.some((comment) =>
    (comment.content ?? '').split(/\r?\n/).some((written) => {
      const raw = withoutOwnStamp(written, comment.author)
      return DONE_PROOF.test(raw.normalize('NFD').replace(/[̀-ͯ]/g, ''))
    }),
  )
}
