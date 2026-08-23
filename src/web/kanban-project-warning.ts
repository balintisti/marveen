/**
 * A card whose `project` is empty cannot be attributed to a repo later.
 *
 * MEASURED, 2026-08-23 13:2x CEST, on the live board (810 open cards):
 *   created in the last  1 day .... 168, empty project 81 (48%)
 *   created in the last  7 days ... 794, empty project 445 (56%)
 * The gap is not historical debt that stopped growing -- it is produced at
 * today's rate, which is why card e369adab could not backfill its way out of
 * it: the source keeps dripping while the backfill runs.
 *
 * WHERE IT LEAKS FROM (measured the same day): the documented example leaks it.
 * `CLAUDE.md` in the install root carries 7 `POST /api/kanban` examples and NOT
 * ONE sends `project`; jarvis's and mandark's agent docs send none either. So
 * the omission is not carelessness -- it is what the docs demonstrate.
 *
 * WHY A WARNING AND NOT A 400: there is no safe default. Guessing the repo from
 * the assignee would be exactly the failure this warning exists to prevent -- a
 * wrongly filled field is worse than an empty one, because the empty one is
 * VISIBLE and the wrong one is not. And a hard 400 would break every caller
 * that follows the current documented example, i.e. most of them.
 *
 * WHY IT IS RETURNED IN THE RESPONSE and not only logged: a log nobody reads is
 * the same silence in a different file. Callers already read this response --
 * the fleet rule is that a write counts as done only when the returned `id`
 * came back -- so the warning arrives in the one place the caller is already
 * looking, at the moment the card is created and still cheap to fix.
 */
export function kanbanProjectWarning(project: unknown): string | undefined {
  if (typeof project === 'string' && project.trim() !== '') return undefined
  return 'A `project` mezo uresen maradt: a kartyarol kesobb nem lehet megmondani, MELYIK repora vonatkozik. Add meg a letrehozaskor (pl. "marveen" vagy "delta-crm"), vagy pótold a kartya szerkesztesevel.'
}
