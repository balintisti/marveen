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
 * THE RULE -- which line is a verdict, what its token is, whose last one
 * counts -- is in kanban-verdict.ts, shared with the archive sweep.
 *
 * What this does NOT decide: that a card with no open verdict is done. The
 * owner may not have spoken, and scopes can leave the card's subject
 * uncovered (the convention's "union of scopes" section). The gate only
 * refuses the one state that is certainly wrong.
 */
// The reading itself is shared with the archive sweep (db.ts), so it lives
// outside web/: see kanban-verdict.ts for the rule and the token.
import { openVerdicts, type OpenVerdict } from '../kanban-verdict.js'

export { openVerdicts, type OpenVerdict }

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
