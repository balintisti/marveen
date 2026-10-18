/**
 * `POST /api/kanban` answered EVERY bad field with the same bare 500.
 *
 * MEASURED by deeper, 2026-09-11 03:15, three probes and a non-zero control --
 * reproduced unchanged by friday at 02:0x on 09-12 (2127 cards before and after,
 * so nothing was created; a valid body in the same round returned an id, so the
 * endpoint was alive):
 *
 *     {"title":"...","priority":"medium"}   -> 500 {"error":"Szerver hiba"}
 *     {"priority":"normal"}                 -> 500 {"error":"Szerver hiba"}   (no title)
 *     {"title":"probe","status":"backlog"}  -> 500 {"error":"Szerver hiba"}
 *
 * Byte-identical, none naming the field. The route called `createKanbanCard`
 * with no validation; SQLite's CHECK threw; only the global handler caught it,
 * logging the precise message and returning an anonymous 500. So the useful
 * error EXISTED -- in `store/dashboard.log`, where the caller never looks.
 *
 * WHY THIS COSTS A ROUND RATHER THAN A MINUTE: `medium` is the natural guess in
 * most systems and carries ZERO cards on this board (low/normal/high/urgent).
 * The caller gets their own typo back as a server error, in the same words a
 * real crash would produce -- so the one thing they cannot do is tell the two
 * apart. deeper lost a round to exactly this.
 *
 * WHY A 400 HERE AND A WARNING IN `kanban-project-warning.ts`: an empty
 * `project` has no safe default and the documented examples omit it, so
 * rejecting would break most callers. A `priority` of "medium" is different --
 * the row CANNOT be created either way. The write already fails; the only
 * question is whether the caller is told why.
 *
 * SCOPE, RULED BY marveen ON THE CARD: this is part (a), the validator. Part (b)
 * -- one constant feeding BOTH the CHECK constraint and this validator -- is a
 * SEPARATE card, because it touches existing installs. Until then the allowed
 * values are written down twice, and `kanban-create-validation.test.ts` asserts
 * the two copies agree by reading the CHECK text out of `db.ts`. That does not
 * make them one source; it makes divergence LOUD instead of silent, which is the
 * part that was actually dangerous.
 */

/** The values `kanban_cards.status` accepts. Must equal the schema CHECK --
 *  asserted by the spec, not by memory. */
export const KANBAN_STATUSES = ['planned', 'in_progress', 'testing', 'waiting', 'done'] as const

/** The values `kanban_cards.priority` accepts. Same contract as above. */
export const KANBAN_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

/** The nullable TEXT columns `createKanbanCard` writes from the body. `due_date`
 *  is not here: kanban-due-date.ts owns it. */
export const KANBAN_TEXT_FIELDS = ['description', 'assignee', 'project', 'parent_id'] as const

function listFor(allowed: readonly string[]): string {
  return allowed.join(', ')
}

/**
 * Returns a caller-facing message naming the offending field and what it
 * accepts, or `undefined` when the body can be inserted.
 *
 * Only fields the DATABASE would reject are checked. A field this does not know
 * about is not rejected here: inventing a rule the schema does not enforce would
 * turn a working call into a 400, which is the more expensive direction for a
 * fleet whose agents all write to this endpoint.
 *
 * The TEXT columns are the one widening (card dd7f1165, sirius 2026-10-14): a
 * boolean, object or array there is refused by the DRIVER, not the schema --
 * better-sqlite3 throws on the bind, and the caller got the same anonymous 500
 * this file exists to remove. A number is bound and silently stored as text,
 * which for `assignee`/`parent_id` is an owner or a parent nobody has: an
 * `{ok:true}` card no dispatcher routes. Both are refused by name. Whether a
 * `parent_id` POINTS at a card needs the database, so the route asks that.
 */
export function kanbanCreateError(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return 'A keres torzse egy JSON OBJEKTUM legyen, pl. {"title":"...","project":"marveen"}.'
  }
  const d = data as Record<string, unknown>

  // NOT NULL, and the one field with no possible default: a card without a
  // title cannot be identified afterwards by anyone.
  if (!('title' in d) || typeof d.title !== 'string' || d.title.trim() === '') {
    return 'A `title` mezo kotelezo es nem lehet ures.'
  }

  if ('status' in d && d.status !== undefined && d.status !== null) {
    if (typeof d.status !== 'string' || !(KANBAN_STATUSES as readonly string[]).includes(d.status)) {
      return `Ervenytelen \`status\`: ${JSON.stringify(d.status)}. Engedett ertekek: ${listFor(KANBAN_STATUSES)}.`
    }
  }

  if ('priority' in d && d.priority !== undefined && d.priority !== null) {
    if (typeof d.priority !== 'string' || !(KANBAN_PRIORITIES as readonly string[]).includes(d.priority)) {
      return `Ervenytelen \`priority\`: ${JSON.stringify(d.priority)}. Engedett ertekek: ${listFor(KANBAN_PRIORITIES)}.`
    }
  }

  for (const field of KANBAN_TEXT_FIELDS) {
    if (field in d && d[field] !== undefined && d[field] !== null && typeof d[field] !== 'string') {
      return `Ervenytelen \`${field}\`: ${JSON.stringify(d[field])}. Szoveg (string) vagy null lehet.`
    }
  }

  return undefined
}
