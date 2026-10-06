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
