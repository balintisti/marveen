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
import {
  openVerdicts, openLeftovers, hasDoneProof, DONE_PROOF_KINDS, itemMarkState, ITEM_MARK_KINDS,
  type OpenVerdict, type OpenLeftover, type ItemMarkState, type InvalidItemMark,
} from '../kanban-verdict.js'

export {
  openVerdicts, openLeftovers, hasDoneProof, DONE_PROOF_KINDS, itemMarkState, ITEM_MARK_KINDS,
  type OpenVerdict, type OpenLeftover, type ItemMarkState,
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

/**
 * The 409 body: who still has an open item, in their own words, and the way out.
 * `leftovers` (card 0a787690) are the open `MARADEK:` lines; the verdicts part of
 * the body is unchanged when there are none.
 */
export function closeRefusal(
  open: OpenVerdict[],
  leftovers: OpenLeftover[] = [],
): { error: string; open_verdicts: OpenVerdict[]; open_leftovers: OpenLeftover[] } {
  const parts: string[] = []
  if (open.length > 0) {
    const who = open.map((v) => `${v.author}: "${v.line}"`).join('; ')
    parts.push(
      `${open.length} ellenorzo utolso verdiktje NYITOTT TETEL (${who}). `
      + 'Zard le a tetelt (az ellenorzo uj VERDIKT-sora)',
    )
  }
  if (leftovers.length > 0) {
    const what = leftovers.map((l) => `komment ${l.commentId}, ${l.author}: "${l.line}"`).join('; ')
    parts.push(
      `${leftovers.length} nyitott MARADEK-sor (${what}). `
      + 'Ugyanaz a szerzo zarja a sajatjat egy ujabb `MARADEK: NINCS | <hova kerult>` sorral '
      + '(0. oszlopban, a `|` utan a hely kotelezo)',
    )
  }
  return {
    error:
      `A kartya nem zarhato le: ${parts.join(' -- ')}; vagy kuldd a lezarast `
      + '`override_reason` mezovel, kimondott indokkal -- az indok a kartya esemenynaplojaba kerul.',
    open_verdicts: open,
    open_leftovers: leftovers,
  }
}

/** How to write the proof line, named the same way in every refusal that asks for it. */
const PROOF_HOW =
  'egy komment, aminek egy sora (0. oszlopban) igy kezdodik: '
  + `"KESZ-IGAZOLAS: <${DONE_PROOF_KINDS.join('|')}>", utana a merese vagy a helye`

/**
 * The 409 body when a card would go to done without its proof -- card 3c7be3c4.
 * It names what is missing and the five kinds. `override_reason` does not stand
 * in for the proof: the way out is the comment itself, which is always possible
 * (TARGYTALAN covers a card whose subject went away). Open verdicts or leftovers,
 * if any, are named in the same body so the closer learns everything in one call.
 */
export function proofRefusal(
  open: OpenVerdict[],
  leftovers: OpenLeftover[] = [],
): { error: string; missing_proof: true; proof_kinds: readonly string[]; open_verdicts: OpenVerdict[]; open_leftovers: OpenLeftover[] } {
  let error =
    `A kartya nem mehet done-ba: nincs rajta KESZ-IGAZOLAS sor. Elobb ${PROOF_HOW}; `
    + 'aztan ismeteld a lezarast. Az `override_reason` ezt nem helyettesiti.'
  if (open.length > 0 || leftovers.length > 0) error += ` Emellett: ${closeRefusal(open, leftovers).error}`
  return { error, missing_proof: true, proof_kinds: DONE_PROOF_KINDS, open_verdicts: open, open_leftovers: leftovers }
}

/**
 * The 409 body when a multi-item card would go to done with an item unmarked -- card
 * bb9f4673. It names the unmarked items, the mark that closes one, and every line that
 * looked like a mark but did not count (with why). A missing proof, open verdicts or
 * leftovers are named in the same body, so one call tells the closer everything.
 * `override_reason` does not stand in for the marks: `TETEL <n>: HAMIS <reason>` is
 * always possible and stays on the card.
 */
export function itemsRefusal(
  items: ItemMarkState,
  proofMissing: boolean,
  open: OpenVerdict[],
  leftovers: OpenLeftover[] = [],
): {
  error: string; declared_items: number; unmarked_items: number[]; invalid_item_marks: InvalidItemMark[]
  item_mark_kinds: readonly string[]; missing_proof: boolean; open_verdicts: OpenVerdict[]; open_leftovers: OpenLeftover[]
} {
  let error =
    `A kartya nem mehet done-ba: a cime ${items.declared} tetelt jelent be, `
    + `es ${items.missing.length} nincs jelolve (${items.missing.join(', ')}). `
    + 'Tetelenkent egy komment-sor (0. oszlopban): '
    + `"TETEL <szam>: <${ITEM_MARK_KINDS.join('|')}> <commit-sha | indok | masik kartya azonositoja>"; `
    + 'a <szam> lehet lista vagy tartomany (1,3 vagy 2-5). Az `override_reason` ezt nem helyettesiti.'
  if (items.invalid.length > 0) {
    error += ` Nem szamitott jelolesnek: ${items.invalid.map((i) => `komment ${i.commentId}, ${i.author}: "${i.line}" (${i.why})`).join('; ')}.`
  }
  if (proofMissing) error += ` Emellett: ${proofRefusal(open, leftovers).error}`
  else if (open.length > 0 || leftovers.length > 0) error += ` Emellett: ${closeRefusal(open, leftovers).error}`
  return {
    error,
    declared_items: items.declared,
    unmarked_items: items.missing,
    invalid_item_marks: items.invalid,
    item_mark_kinds: ITEM_MARK_KINDS,
    missing_proof: proofMissing,
    open_verdicts: open,
    open_leftovers: leftovers,
  }
}

/** The 409 body for a card created straight into done: it cannot carry a proof yet. */
export function createDoneRefusal(): { error: string; missing_proof: true; proof_kinds: readonly string[] } {
  return {
    error:
      'Kartya nem hozhato letre done statusszal: igazolas meg nem lehet rajta. Hozd letre mas statusszal, '
      + `ird meg a bizonyitekot (${PROOF_HOW}), aztan mozgasd done-ba.`,
    missing_proof: true,
    proof_kinds: DONE_PROOF_KINDS,
  }
}
