/**
 * A CARD DOES NOT CLOSE OVER AN OPEN VERDICT -- card 5a967042.
 *
 * Isti (Telegram 4449, 2026-09-29): "hogy csuszhat at? Nem szabad
 * atcsusznia." Measured that day: of 323 cards moved to done or archived, two
 * closed over an open item -- one closer read didi's "lezarhato" and missed
 * computress's earlier NYITOTT TETEL, the other closed on an hour's
 * measurement before didi's full-day gate. The check lived in the closer's
 * reading, and the closer read the LAST verdict on the card, not each
 * checker's last one.
 *
 * THE RULE, from rulebook/kanban-verdikt-konvencio.md, not reinvented here:
 *   - a verdict is a line that STARTS with `VERDIKT:` (column 0). A quoted or
 *     indented one is somebody citing a verdict, not giving one;
 *   - the token is what stands between `VERDIKT:` and the first `|` -- never
 *     "the line contains NYITOTT", which also matches NINCS NYITOTT TETEL;
 *   - "last wins" holds WITHIN an author, never across the card: each
 *     checker speaks for their own check.
 * So a card has an open item when ANY author's last verdict is NYITOTT TETEL.
 *
 * What this does NOT decide: that a card with no open verdict is done. The
 * owner may not have spoken, and scopes can leave the card's subject
 * uncovered (the convention's "union of scopes" section). The gate only
 * refuses the one state that is certainly wrong.
 */
import type { KanbanComment } from '../db.js'

export interface OpenVerdict {
  author: string
  /** The verdict line as written, for the refusal to quote. */
  line: string
  commentId: number
}

const VERDICT_PREFIX = 'VERDIKT:'

/** Upper case, accents off, spaces collapsed: "NYITOTT TÉTEL" == "NYITOTT TETEL". */
function normalizeToken(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Each author's last verdict line, if it says NYITOTT TETEL. */
export function openVerdicts(comments: KanbanComment[]): OpenVerdict[] {
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
    const token = verdict.line.slice(VERDICT_PREFIX.length).split('|')[0]
    if (normalizeToken(token) === 'NYITOTT TETEL') {
      open.push({ author, line: verdict.line, commentId: verdict.commentId })
    }
  }
  return open
}

/**
 * The override the gate accepts: a stated reason, nothing less. An empty or
 * whitespace-only string is not a reason, and neither is a non-string.
 */
export function overrideReason(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const reason = (body as { override_reason?: unknown }).override_reason
  return typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null
}

/** The 409 body: who still has an open item, in their own words, and the way out. */
export function closeRefusal(open: OpenVerdict[]): { error: string; open_verdicts: OpenVerdict[] } {
  const who = open.map((v) => `${v.author}: "${v.line}"`).join('; ')
  return {
    error:
      `A kartya nem zarhato le: ${open.length} ellenorzo utolso verdiktje NYITOTT TETEL (${who}). `
      + 'Zard le a tetelt (az ellenorzo uj VERDIKT-sora), vagy kuldd a lezarast `override_reason` '
      + 'mezovel, kimondott indokkal -- az indok a kartya esemenynaplojaba kerul.',
    open_verdicts: open,
  }
}
