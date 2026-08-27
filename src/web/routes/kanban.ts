import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  listKanbanCards, createKanbanCard, updateKanbanCard,
  deleteKanbanCard, moveKanbanCard, archiveKanbanCard, unarchiveKanbanCard,
  getKanbanComments, addKanbanComment, getKanbanCardEvents, listKanbanProjects,
  getKanbanCard, getChildCards, getDb,
  createAgentMessage, markKanbanCardDispatched,
  getKanbanSeqByIdPrefix,
  listLabels, getLabel, createLabel, updateLabel, deleteLabel,
  addLabelToCard, removeLabelFromCard, getLabelsForAllCards, getLabelsForCard,
  listArchivedKanbanCards,
  revertIdeaFromKanban,
  getHeartbeatKanbanSummary,
  countNewHotMemories,
  countPlannedKanbanCards,
  getDbFileSizeMb,
} from '../../db.js'
import { normalizeKanbanRefs } from '../kanban-ref-normalize.js'
import { unknownQueryParams, unknownQueryParamError } from '../query-params.js'
import { kanbanProjectWarning } from '../kanban-project-warning.js'
import { scanUnansweredCondition, isDuplicateArchive, conditionWarningText } from '../reopen-condition-warning.js'
import { appendReopenWarning } from '../reopen-condition-log.js'
import { OWNER_NAME, BOT_NAME, MAIN_AGENT_ID, STORE_DIR, WEB_HOST, WEB_PORT, KANBAN_LABEL_COLORS } from '../../config.js'
import { listAgentNames, readAgentDisplayName } from '../agent-config.js'
import { isAgentRunning } from '../agent-process.js'
import { resolveKanbanDispatchTarget } from '../../kanban-dispatch.js'
import { generateBreakdown } from '../llm-breakdown.js'
import { logger } from '../../logger.js'
import { readBody, json, jsonMaybeGzip } from '../http-helpers.js'
import { getEffectiveSettingValue } from '../../settings-store.js'
import type { RouteContext } from './types.js'

// A headless agent cannot "drag" a card to done, so the dispatch hands it the
// exact curl commands to (1) post a short, human-readable result summary as a
// comment -- so the finished task's result lands on its OWN card, visible in the
// dashboard UI -- and (2) mark the card done. This is the lightweight
// alternative to spawning a separate per-session card for every agent run: the
// result goes where the work was asked for, with zero extra board clutter. The
// token is read from the store at call time (never embedded in the message).
export function kanbanMoveInstructions(id: string, target: string): string {
  const tokenPath = join(STORE_DIR, '.dashboard-token')
  const base = `http://${WEB_HOST}:${WEB_PORT}`
  const auth = `-H "Authorization: Bearer $(cat ${tokenPath})"`
  const moveUrl = `${base}/api/kanban/${id}/move`
  const commentUrl = `${base}/api/kanban/${id}/comments`
  const cardUrl = `${base}/api/kanban/${id}`
  // Escalation target when blocked: sub-agents hand back to the main agent
  // (their delegator), who triages and only escalates to the operator when
  // the block genuinely needs a human decision. Only the main agent itself
  // escalates directly to OWNER_NAME -- sub-agent completions/blocks route
  // through the main agent, not straight to the operator (operator feedback,
  // 2026-07-02: a finished/blocked delegated card goes back to the delegator,
  // not to the human).
  const isMainAgent = target === MAIN_AGENT_ID
  const escalateTo = isMainAgent ? OWNER_NAME : MAIN_AGENT_ID
  return [
    'A kártyát in_progress-re húzták. Amikor VÉGEZTÉL, két lépés (mindkettő a kártyára kerül, a web UI-ban látszik):',
    '',
    '1) Írj egy rövid eredmény-összefoglalót kommentként (1-2 mondat: mi lett a vége):',
    `  curl -s -X POST ${commentUrl} \\`,
    `    ${auth} \\`,
    `    -H 'Content-Type: application/json' \\`,
    `    -d '{"author":"${target}","content":"AZ EREDMENY ROVIDEN"}'`,
    '',
    '2) Állítsd a kártyát done-ra:',
    `  curl -s -X POST ${moveUrl} \\`,
    `    ${auth} \\`,
    `    -H 'Content-Type: application/json' \\`,
    `    -d '{"status":"done","actor":"${target}"}'`,
    '',
    // The "actor" field is not decoration: it is what tells the board WHO moved
    // the card. Without it a self-pickup (agent -> in_progress on its own card)
    // is indistinguishable from an assignment, and the dispatcher echoes the
    // task back at the agent that just started it.
    `Az "actor":"${target}" mezőt MINDEN mozgatásnál küldd el (ez mondja meg a táblának, hogy te mozgattad). Ha te magad veszed fel a kártyát in_progress-re, ott is:`,
    `  curl -s -X POST ${moveUrl} \\`,
    `    ${auth} \\`,
    `    -H 'Content-Type: application/json' \\`,
    `    -d '{"status":"in_progress","actor":"${target}"}'`,
    '',
    `Ha elakadtál / ${escalateTo} döntésére/lépésére vársz: NE csak status="waiting"-et állíts be. HÁROM lépés kell EGYÜTT:`,
    `  a) Írj egy kommentet ami KÖZVETLENÜL ${escalateTo}-hez szól, egyértelműen megfogalmazva mit kell eldöntenie/megtennie (NE a saját belső elemzésedet írd oda) -- ugyanaz a comments hívás mint fent, "content" mezőben.`,
    `  b) Told át a kártyát ${escalateTo}-re, hogy egyértelmű legyen a felelősség (a te neved NE maradjon rajta, ha nem te vagy a blokkoló):`,
    `     curl -s -X PUT ${cardUrl} \\`,
    `       ${auth} \\`,
    `       -H 'Content-Type: application/json' \\`,
    `       -d '{"assignee":"${escalateTo}"}'`,
    `  c) Csak EZUTÁN állítsd a kártyát status="waiting"-re (a fenti move-hívással, "waiting" értékkel "done" helyett).`,
    isMainAgent
      ? `Ez azért kritikus, mert ${OWNER_NAME} nem tudja kitalálni a dashboardon hogy egy nála maradt/rossz-assignee-jű, homályos kártya rá vár -- explicit átadás + explicit kérdés nélkül a felelősség-váltás elvész.`
      : `FONTOS: ${OWNER_NAME}-hez (az operátorhoz) EGYENESEN NE told át a kártyát, még ha a blokk végül tőle igényel is döntést -- ${MAIN_AGENT_ID} a delegálód, ő triázsol és ő dönti el, hogy tovább kell-e ${OWNER_NAME}-hez eszkalálnia. Ez azért kritikus, mert ${MAIN_AGENT_ID} nem tudja kitalálni a dashboardon hogy egy nála maradt/rossz-assignee-jű kártya rá vár -- explicit átadás + explicit kérdés nélkül a felelősség-váltás elvész.`,
    'A "done"-t mindenképp te jelezd — a dashboard csak az in_progress/waiting állapotot követi automatikusan a session aktivitásából. Az eredmény-kommentet (1) ne hagyd ki: az a kártyán a látható eredmény.',
  ].join('\n')
}

// Option D: kanban -> agent dispatch. When a card moves to in_progress, wake the
// assigned agent once via the inter-agent message router (createAgentMessage),
// which gives retry / dedup / trust-wrapping / busy-receiver handling for free.
// dispatched_at is the once-only guard; errors never block the card move.
// `actor` is the mover reported by the caller: an agent that moves its own card
// to in_progress must not be woken with an assignment for work it just started.
function fireKanbanDispatch(id: string, actor?: string | null): void {
  try {
    const card = getKanbanCard(id)
    if (!card || card.dispatched_at) return
    const target = resolveKanbanDispatchTarget(card.assignee, {
      ownerName: OWNER_NAME,
      botName: BOT_NAME,
      mainAgentId: MAIN_AGENT_ID,
      agentNames: listAgentNames(),
      isRunning: isAgentRunning,
      actor,
    })
    if (!target) return
    const desc = (card.description ?? '').trim()
    const content = `[Kanban feladat #${id}]: ${card.title}${desc ? ' — ' + desc : ''}\n\n${kanbanMoveInstructions(id, target)}`
    createAgentMessage(MAIN_AGENT_ID, target, content)
    markKanbanCardDispatched(id)
    logger.info({ id, target, assignee: card.assignee }, 'Kanban in_progress dispatch fired')
  } catch (err) {
    logger.warn({ err, id }, 'Kanban dispatch failed (card move still succeeded)')
  }
}

/** Query parameters `GET /api/kanban` accepts. Deliberately empty: it lists every live card. */
const KANBAN_LIST_PARAMS: readonly string[] = []

/** Query parameters `GET /api/kanban/archived` accepts. */
const KANBAN_ARCHIVED_PARAMS: readonly string[] = ['q', 'project', 'label', 'from', 'to', 'limit']

/** Literal sub-paths of /api/kanban that are NOT card ids. */
export const KANBAN_RESERVED_SEGMENTS = ['archived', 'labels', 'assignees', 'heartbeat-summary'] as const

/** Match `/api/kanban/<id>` -- and NEVER match a literal sub-path.
 *
 *  Measured 2026-08-22, minutes after the GET arm went live: `/api/kanban/archived`
 *  resolved as a card whose id is "archived", and the archive listing answered
 *  "Kártya nem található" -- on the exact endpoint the change existed to make usable.
 *  The suite was green; what caught it was a negative control against the running
 *  service (a search for a nonsense word returned one "hit", which was the error body).
 *
 *  PUT and DELETE carried the same collision from the start; nobody had ever aimed
 *  them at a literal, so it stayed invisible. Excluding the reserved segments fixes
 *  all three arms, and a literal route added later is covered by one entry here --
 *  not by remembering to order the handlers correctly.
 */
export function matchKanbanCardPath(path: string): RegExpMatchArray | null {
  const m = path.match(/^\/api\/kanban\/([^/]+)$/)
  if (!m) return null
  let seg: string
  try {
    seg = decodeURIComponent(m[1])
  } catch {
    // A malformed escape is not a reserved word, and it is not our job to reject it
    // here -- the id simply will not be found.
    seg = m[1]
  }
  return (KANBAN_RESERVED_SEGMENTS as readonly string[]).includes(seg) ? null : m
}

// HBKANBANDRIFT819: the heartbeat-summary payload, shaped so that TRUNCATED
// reads still carry the truth. Pure and exported so tests can pin all three
// properties without HTTP:
//   1. `counts` is the FIRST key -- JSON.stringify preserves insertion order,
//      so a reader that loses the tail loses list items, never the numbers;
//   2. every title is truncated server-side (board titles here run to 15KB);
//   3. the waiting LIST is capped to the most recently-updated few, while
//      counts.waiting always carries the FULL total -- the list names items,
//      the numbers only ever come from counts.
export const HEARTBEAT_SUMMARY_TITLE_MAX = 160
export const HEARTBEAT_SUMMARY_WAITING_CAP = 8

type HeartbeatSummaryCard = {
  id: string; title: string; status: string; priority: string;
  assignee?: string | null; updated_at?: number | null;
}

export function buildHeartbeatSummaryResponse(
  summary: { urgent: HeartbeatSummaryCard[]; in_progress: HeartbeatSummaryCard[]; waiting: HeartbeatSummaryCard[] },
  newHotMemories1h: number,
  plannedCount: number,
  dbSizeMb: number | null,
) {
  const trunc = (t: string) =>
    t.length > HEARTBEAT_SUMMARY_TITLE_MAX ? t.slice(0, HEARTBEAT_SUMMARY_TITLE_MAX) + '…' : t
  const slim = (c: HeartbeatSummaryCard) => ({
    id: c.id, title: trunc(c.title), status: c.status, priority: c.priority, assignee: c.assignee ?? null,
  })
  const waitingRecent = [...summary.waiting]
    .sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))
    .slice(0, HEARTBEAT_SUMMARY_WAITING_CAP)
  return {
    counts: {
      urgent: summary.urgent.length,
      in_progress: summary.in_progress.length,
      // The FULL total, never the capped list length -- the 2026-08-04 lesson
      // (waiting: 10 reported against 130 real) in endpoint form.
      waiting: summary.waiting.length,
      // The report format asks for a planned line; without a sanctioned
      // source here the agent manufactured the value (planned: 0 against a
      // real 305, measured 2026-08-19 17:00). Count only, no list.
      planned: plannedCount,
      // HBMEMBLIND819: computed server-side with the MAIN agent's id so the
      // heartbeat agent copies a number instead of running (and rewriting)
      // a query -- see HEARTBEAT_NEW_HOT_MEMORIES_SQL in db.ts.
      new_hot_memories_1h: newHotMemories1h,
      // HBDBMERET822: without a sanctioned source the agent re-invented this
      // measurement every session (format drift `158 MB` -> `160M`, then a
      // false `0.0 MB` against a real 159 MB, 2026-08-22 15:00). null means
      // "could not measure" and renders as "nincs adat" -- never 0, because
      // for a growth signal a false zero looks like calm, not like failure.
      db_size_mb: dbSizeMb,
    },
    urgent: summary.urgent.map(slim),
    waiting: waitingRecent.map(slim),
    waiting_shown: Math.min(summary.waiting.length, HEARTBEAT_SUMMARY_WAITING_CAP),
  }
}

export async function tryHandleKanban(ctx: RouteContext): Promise<boolean> {
  const { req, res, path, method } = ctx

  if (path === '/api/kanban' && method === 'GET') {
    // This endpoint takes no filters. Without the guard below, `?archived=1`
    // answered 200 with the LIVE cards -- a different population, wearing the
    // face of an honest empty result. See web/query-params.ts.
    const ismeretlen = unknownQueryParams(ctx.url, KANBAN_LIST_PARAMS)
    if (ismeretlen.length) {
      json(res, unknownQueryParamError(ismeretlen, KANBAN_LIST_PARAMS,
        'Archivalt kartyak: GET /api/kanban/archived. Heartbeat-osszegzo: GET /api/kanban/heartbeat-summary.'), 400)
      return true
    }
    // Embed each card's labels in one extra JOIN query (getLabelsForAllCards)
    // instead of an N+1 per-card lookup, so the footer-pill UI gets
    // everything it needs in a single round trip.
    const labelsByCard = getLabelsForAllCards()
    const cards = listKanbanCards().map((card) => ({ ...card, labels: labelsByCard.get(card.id) ?? [] }))
    jsonMaybeGzip(req, res, cards)
    return true
  }

  // The heartbeat agent's kanban source. It exists so the agent does not have to
  // COMPOSE the filter every hour: on 2026-08-04 the 09:00 report listed five
  // items of which three were already `done`, even though its instructions had
  // said to exclude them since #680. A rule the model must re-apply each hour is
  // not a mechanism; an endpoint that cannot return a closed card is. It also
  // removes the sqlite3 CLI from that path, which does not exist on a stock
  // Linux install (#870).
  //
  // HBKANBANDRIFT819 (2026-08-19): the 16:42 heartbeat reported waiting:12
  // against a real 280 -- the endpoint's counts were CORRECT, but the payload
  // was ~31KB (card titles on this board run to 15KB EACH) and `counts` was
  // serialized LAST, after the huge arrays. An agent reading truncated output
  // lost exactly the numbers and counted the visible list instead. Fixes here:
  // counts serialize FIRST (truncation-resilient ordering), titles are
  // truncated server-side, and the waiting list is capped to the most recent
  // few -- while counts.* always carries the FULL totals. The list is for
  // naming items; the numbers ONLY ever come from counts.
  if (path === '/api/kanban/heartbeat-summary' && method === 'GET') {
    json(res, buildHeartbeatSummaryResponse(getHeartbeatKanbanSummary(), countNewHotMemories(MAIN_AGENT_ID), countPlannedKanbanCards(), getDbFileSizeMb()))
    return true
  }

  if (path === '/api/kanban/labels' && method === 'GET') {
    json(res, listLabels())
    return true
  }

  if (path === '/api/kanban/labels' && method === 'POST') {
    const body = await readBody(req)
    const { name, color } = JSON.parse(body.toString()) as { name?: string; color?: string }
    if (!name || !name.trim()) { json(res, { error: 'Címke neve kötelező' }, 400); return true }
    // Colour is validated against the configured palette (KANBAN_LABEL_COLORS)
    // rather than accepted as free-text, so every label's colour traces back
    // to the single configurable source instead of an arbitrary per-request value.
    const resolvedColor = color && KANBAN_LABEL_COLORS.includes(color) ? color : KANBAN_LABEL_COLORS[0]
    const id = randomUUID().slice(0, 8)
    const label = createLabel({ id, name: name.trim(), color: resolvedColor })
    json(res, label)
    return true
  }

  const labelMatch = path.match(/^\/api\/kanban\/labels\/([^/]+)$/)
  if (labelMatch && method === 'PUT') {
    const id = decodeURIComponent(labelMatch[1])
    const body = await readBody(req)
    const { name, color } = JSON.parse(body.toString()) as { name?: string; color?: string }
    const fields: { name?: string; color?: string } = {}
    if (name !== undefined) {
      if (!name.trim()) { json(res, { error: 'Címke neve kötelező' }, 400); return true }
      fields.name = name.trim()
    }
    if (color !== undefined) {
      fields.color = KANBAN_LABEL_COLORS.includes(color) ? color : KANBAN_LABEL_COLORS[0]
    }
    if (updateLabel(id, fields)) { json(res, { ok: true }); return true }
    json(res, { error: 'Címke nem található' }, 404)
    return true
  }
  if (labelMatch && method === 'DELETE') {
    const id = decodeURIComponent(labelMatch[1])
    if (deleteLabel(id)) { json(res, { ok: true }); return true }
    json(res, { error: 'Címke nem található' }, 404)
    return true
  }

  const cardLabelsMatch = path.match(/^\/api\/kanban\/([^/]+)\/labels$/)
  if (cardLabelsMatch && method === 'GET') {
    const cardId = decodeURIComponent(cardLabelsMatch[1])
    json(res, getLabelsForCard(cardId))
    return true
  }
  if (cardLabelsMatch && method === 'POST') {
    const cardId = decodeURIComponent(cardLabelsMatch[1])
    if (!getKanbanCard(cardId)) { json(res, { error: 'Kártya nem található' }, 404); return true }
    const body = await readBody(req)
    // Accept `id` as an alias for `labelId` -- API callers reasonably send either,
    // since GET /api/kanban/labels returns objects keyed by `id`, not `labelId`.
    const parsed = JSON.parse(body.toString()) as { labelId?: string; id?: string }
    const labelId = parsed.labelId ?? parsed.id
    if (!labelId) { json(res, { error: 'labelId mező kötelező' }, 400); return true }
    if (!getLabel(labelId)) {
      // Common mistake: sending the label's `name` where an `id` is expected -- GET
      // /api/kanban/labels lists both, so this is an easy mix-up. Point at the real id
      // instead of a bare "not found" that reads as if the label doesn't exist at all.
      const byName = listLabels().find((l) => l.name === labelId)
      if (byName) {
        json(res, { error: `Címke nem található id alapján -- a "${labelId}" egy név, nem id. Használd az id-t: ${byName.id}` }, 404)
        return true
      }
      json(res, { error: 'Címke nem található' }, 404)
      return true
    }
    addLabelToCard(cardId, labelId)
    json(res, { ok: true })
    return true
  }

  const cardLabelDeleteMatch = path.match(/^\/api\/kanban\/([^/]+)\/labels\/([^/]+)$/)
  if (cardLabelDeleteMatch && method === 'DELETE') {
    const cardId = decodeURIComponent(cardLabelDeleteMatch[1])
    const labelId = decodeURIComponent(cardLabelDeleteMatch[2])
    if (removeLabelFromCard(cardId, labelId)) { json(res, { ok: true }); return true }
    json(res, { error: 'A kártyán nincs ilyen címke' }, 404)
    return true
  }

  if (path === '/api/kanban-projects' && method === 'GET') {
    json(res, listKanbanProjects())
    return true
  }

  if (path === '/api/kanban/assignees' && method === 'GET') {
    const agents = listAgentNames().map((name) => ({ name, type: 'agent', displayName: readAgentDisplayName(name) || name }))
    json(res, [
      { name: OWNER_NAME, type: 'owner' },
      { name: BOT_NAME, type: 'bot' },
      ...agents,
    ])
    return true
  }

  if (path === '/api/kanban' && method === 'POST') {
    const body = await readBody(req)
    const data = JSON.parse(body.toString())
    const id = randomUUID().slice(0, 8)
    createKanbanCard({ id, ...data })
    // The card IS created either way -- see kanban-project-warning.ts for why
    // this is not a 400 and why the warning travels in the response body.
    const warning = kanbanProjectWarning(data.project)
    if (warning) logger.warn({ id, title: data.title }, 'Kanban card created with an empty project field')
    json(res, warning ? { ok: true, id, warning } : { ok: true, id })
    return true
  }

  // `/api/kanban/<id>` must never swallow a LITERAL sub-path. Measured 2026-08-22,
  // minutes after deploying the GET arm below: `/api/kanban/archived` resolved as a
  // card whose id is "archived", and the archive listing began answering
  // "Kártya nem található" -- on the exact endpoint this change existed to make
  // usable. A negative control caught it (a search for a nonsense word returned one
  // "hit", which was the error object).
  //
  // PUT and DELETE carried the same collision all along; nobody had ever aimed them
  // at a literal, so it stayed invisible. Excluding the reserved words fixes all
  // three arms at once, and the next literal route added above will be covered by
  // adding one entry here rather than by remembering to order the handlers.
  const kanbanCardMatch = matchKanbanCardPath(path)
  // Read ONE card, archived ones included. The archive listing deliberately does
  // not carry `description` (see listArchivedKanbanCards -- the payload grows
  // without bound), so `q` finds the card and this route reads its body. Without
  // both halves a merged-away card is searchable but unreadable.
  if (kanbanCardMatch && method === 'GET') {
    const id = decodeURIComponent(kanbanCardMatch[1])
    const card = getKanbanCard(id)
    // `comment_count`, and the body deliberately NOT included. Measured 2026-08-22:
    // didi read this endpoint, saw no `comments` key, and recorded "0 comments" on a
    // card that had five. Absence and emptiness look identical to a reader -- in
    // Python a missing key and an empty list both arrive as falsy -- and she caught it
    // only because she ran a positive control against a card she KNEW had comments.
    //
    // The bodies stay out on purpose (the same payload argument as the archive
    // listing: they grow without bound and a reader usually wants one card's). The
    // count costs one COUNT and turns a silent absence into an explicit signal:
    // 0 means none, anything else means fetch /comments.
    //
    // AND WHY A COUNT ALONE WAS NOT ENOUGH (2026-08-22, the same trap sprung a
    // SECOND time, two days later, on a different agent): `comment_count: 2`
    // reads as an extra datum, not as a notice that something is MISSING. The
    // reader who does not already know that `comments` never arrives has no
    // reason to suspect a gap -- the payload looks complete. So the response
    // now NAMES THE OMISSION as well as the quantity: `comments_omitted` is
    // true whenever bodies exist but were left out, and the pair reads as one
    // sentence -- "there are 2, and they are not in here".
    if (card) {
      const count = getKanbanComments(id).length
      json(res, { ...card, comment_count: count, comments_omitted: count > 0 })
      return true
    }
    json(res, { error: 'Kártya nem található' }, 404)
    return true
  }

  if (kanbanCardMatch && method === 'PUT') {
    const id = decodeURIComponent(kanbanCardMatch[1])
    const body = await readBody(req)
    const data = JSON.parse(body.toString())

    // A PRECONDITION THIS ENDPOINT CANNOT HONOUR MUST NOT ANSWER 200 (card ddf11b94).
    // Measured before this change: `If-Match: anything` -> 200, and
    // `expected_updated_at: 123` -> 200, both silently ignored. That is not a
    // missing feature, it is a false success handed to the one caller who was
    // trying to be careful -- the silent-success shape this board keeps finding.
    // Repo usage of either is zero, so the 400 breaks nobody who is not already
    // being deceived.
    // WHY 400 AND NOT 412 OR 501: a 412 would claim we evaluated the precondition
    // and found it stale, which is a different (and false) statement; a 501 reads
    // as a server fault and invites a retry of the very same request. This is a
    // request we will not serve as sent, which is what 400 says.
    const ifMatch = req.headers['if-match']
    if (ifMatch !== undefined || data.expected_updated_at !== undefined) {
      json(res, {
        error: 'Felteteles iras nem tamogatott ezen a vegponton: az `If-Match` fejlecet es az '
          + '`expected_updated_at` mezot NEM ertekeljuk ki. Korabban ezek 200-at kaptak, '
          + 'figyelmen kivul hagyva -- ez a valasz azert 400, hogy ne hidd, hogy vedve vagy. '
          + 'A felulirás mostantol a valaszban latszik: `overwritten`.',
      }, 400)
      return true
    }

    const result = updateKanbanCard(id, data)
    if (result.changed) {
      // The overwrite travels in the response because that is where the caller
      // already looks; a log nobody reads is the same silence in another file.
      // The sentence is for the human, the array for the caller that parses.
      if (result.overwritten.length > 0) {
        const list = result.overwritten.map(o => `${o.field} (volt: ${JSON.stringify(o.from)})`).join(', ')
        logger.warn({ id, overwritten: result.overwritten }, 'Kanban PUT overwrote existing values')
        json(res, {
          ok: true,
          overwritten: result.overwritten,
          warning: `Ez az iras MAS erteket irt felul: ${list}. Ha nem te irtad oda, nezd meg, `
            + 'kinek a munkajat cserelted le -- a visszaolvasas ezt NEM mutatja meg, mert a '
            + 'sajat szovegedet adja vissza.',
        })
      } else {
        json(res, { ok: true })
      }
      return true
    }
    json(res, { error: 'Kártya nem található' }, 404)
    return true
  }

  if (kanbanCardMatch && method === 'DELETE') {
    const id = decodeURIComponent(kanbanCardMatch[1])
    revertIdeaFromKanban(id)
    if (deleteKanbanCard(id)) { json(res, { ok: true }); return true }
    json(res, { error: 'Kártya nem található' }, 404)
    return true
  }

  const kanbanMoveMatch = path.match(/^\/api\/kanban\/([^/]+)\/move$/)
  if (kanbanMoveMatch && method === 'POST') {
    const id = decodeURIComponent(kanbanMoveMatch[1])
    const body = await readBody(req)
    const { status, sort_order, actor } = JSON.parse(body.toString())
    if (moveKanbanCard(id, status, sort_order ?? 0, actor)) {
      // Wake the assigned agent once when the card enters in_progress -- unless
      // that agent is the one who moved it (self-pickup needs no wake-up).
      if (status === 'in_progress') fireKanbanDispatch(id, actor)
      json(res, { ok: true })
      return true
    }
    json(res, { error: 'Kártya nem található' }, 404)
    return true
  }

  const kanbanArchiveMatch = path.match(/^\/api\/kanban\/([^/]+)\/archive$/)
  if (kanbanArchiveMatch && method === 'POST') {
    const id = decodeURIComponent(kanbanArchiveMatch[1])
    // The documented call sends an EMPTY body, and every existing caller does
    // exactly that. So the body is optional in both directions: unparseable or
    // absent means "no actor, no reason", never an error.
    let actor = 'ismeretlen'
    let reason: unknown
    try {
      const parsed = JSON.parse((await readBody(req)).toString())
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.actor === 'string' && parsed.actor.trim() !== '') actor = parsed.actor.trim()
        reason = parsed.reason
      }
    } catch { /* empty or non-JSON body: the documented shape */ }

    // Read the comments BEFORE archiving: the scan is about what the archive is
    // taking out of sight. Archiving does not touch comments today, but the
    // order states the intent instead of relying on that.
    const comments = getKanbanComments(id)
    const scan = isDuplicateArchive(reason, comments) ? null : scanUnansweredCondition(comments)

    revertIdeaFromKanban(id)
    if (archiveKanbanCard(id)) {
      // The card IS archived either way -- see reopen-condition-warning.ts for
      // why this warns instead of blocking.
      if (scan) {
        appendReopenWarning({
          ts: Math.floor(Date.now() / 1000),
          card: id,
          matches: scan.matches,
          condition_comment_id: scan.lastConditionCommentId,
          actor,
          last_comment_id_at_fire: scan.lastCommentId,
        })
        logger.warn({ id, matches: scan.matches, actor }, 'Archived a card with an unanswered reopening condition')
        json(res, { ok: true, warning: conditionWarningText(scan) })
        return true
      }
      json(res, { ok: true })
      return true
    }
    json(res, { error: 'Kártya nem található' }, 404)
    return true
  }

  if (path === '/api/kanban/archived' && method === 'GET') {
    // The same guard as on the unfiltered list. Fixing only one of the two
    // would teach that the rule is population-dependent -- and this file has
    // already paid for exactly that once (see the comments-existence guard,
    // which existed on the labels branch and not on its neighbour).
    const ismeretlenA = unknownQueryParams(ctx.url, KANBAN_ARCHIVED_PARAMS)
    if (ismeretlenA.length) {
      json(res, unknownQueryParamError(ismeretlenA, KANBAN_ARCHIVED_PARAMS), 400)
      return true
    }
    const sp      = ctx.url.searchParams
    const q       = sp.get('q')?.trim() || undefined
    const project = sp.get('project')?.trim() || undefined
    const label   = sp.get('label')?.trim() || undefined
    const from    = sp.get('from')  ? Number(sp.get('from'))  : undefined
    const to      = sp.get('to')    ? Number(sp.get('to'))    : undefined
    const limit   = Math.min(Number(sp.get('limit') ?? 0) || Number(getEffectiveSettingValue('KANBAN_ARCHIVED_MAX_ROWS')), 5000)
    const labelsByCard = getLabelsForAllCards()
    const cards = listArchivedKanbanCards({ q, project, label, from, to, limit })
      .map(card => ({ ...card, labels: labelsByCard.get(card.id) ?? [] }))
    json(res, { cards, total: cards.length, limit })
    return true
  }

  const kanbanUnarchiveMatch = path.match(/^\/api\/kanban\/([^/]+)\/unarchive$/)
  if (kanbanUnarchiveMatch && method === 'POST') {
    const id = decodeURIComponent(kanbanUnarchiveMatch[1])
    if (unarchiveKanbanCard(id)) { json(res, { ok: true }); return true }
    json(res, { error: 'Kártya nem található vagy nincs archiválva' }, 404)
    return true
  }

  const kanbanCommentsMatch = path.match(/^\/api\/kanban\/([^/]+)\/comments$/)
  if (kanbanCommentsMatch && method === 'GET') {
    const cardId = decodeURIComponent(kanbanCommentsMatch[1])
    // "NINCS ILYEN KARTYA" ES "VAN, DE NINCS KOMMENTJE" NEM LEHET UGYANAZ A VALASZ.
    // Mindketto 200 + [] volt, tehat kivulrol megkulonboztethetetlen -- es ez ma
    // ROSSZ IRANYBA vitt egy diagnozist (computress, 2026-08-23): egy leletet
    // kapott egy kartyara hivatkozva, az ures tombbol elsore azt hitte, hogy a
    // kartya LETEZIK es egy komment VESZETT EL. Csak azert derult ki az igazsag,
    // mert a kartya-listaban is megnezte.
    //
    // ES EZ NEM UJ FELISMERES A REPOBAN, HANEM UGYANAZ, MASIK IRANYBAN. A POST
    // ugyanezt a kaput mar viseli (cee465c): ott ket munkajelentes veszett el egy
    // nem letezo id-n. Az abbol szuletett szabaly szo szerint ez: "a 200 nem azt
    // jelenti, hogy megtortent; a VISSZAOLVASAS igen". Csakhogy a VISSZAOLVASAS
    // EPP EZ A GET -- vagyis a POST-ra irt szabaly egy olyan ellenorzesre
    // tamaszkodott, ami ugyanazt a ketertelmuseget hordozta.
    //
    // A testver-vegpont (`GET /api/kanban/<id>`) MAR MA IS 404-et ad; ez a sor
    // OSSZEHANGOLJA a kettot, nem uj viselkedest vezet be.
    if (!getKanbanCard(cardId)) { json(res, { error: 'Kártya nem található' }, 404); return true }
    json(res, getKanbanComments(cardId))
    return true
  }
  if (kanbanCommentsMatch && method === 'POST') {
    const cardId = decodeURIComponent(kanbanCommentsMatch[1])
    // A comment on a card that does not exist is WORSE than a rejected one: the
    // POST returned 200 with a real comment id, so the sender's success check
    // (HTTP code AND id -- the rule this repo's CLAUDE.md prescribes) passed,
    // while the comment never appeared on any board and could not be deleted
    // (there is no comment-delete endpoint). Measured 2026-08-22 (card
    // 2060668a): two full work reports were written to a card id that did not
    // exist, and the loss was silent on both sides. The same one-line guard is
    // already used by the card-labels POST above -- this endpoint simply lacked it.
    if (!getKanbanCard(cardId)) { json(res, { error: 'Kártya nem található' }, 404); return true }
    const body = await readBody(req)
    const { author, content } = JSON.parse(body.toString())
    if (!author || !content) { json(res, { error: 'Szerző és tartalom kötelező' }, 400); return true }
    // Code-side kanban-ref enforcement: rewrite `#<hex8>` references that map
    // to a real card into the human-facing `#<seq>` form before persistence
    // (#75 Cuzcoo dispatch). Random hex / non-matching tokens pass through.
    const normalizedContent = normalizeKanbanRefs(content, getKanbanSeqByIdPrefix)
    json(res, addKanbanComment(cardId, author, normalizedContent))
    return true
  }

  const kanbanEventsMatch = path.match(/^\/api\/kanban\/([^/]+)\/events$/)
  if (kanbanEventsMatch && method === 'GET') {
    const cardId = decodeURIComponent(kanbanEventsMatch[1])
    // UGYANAZ AZ ALAK, MINT A /comments-nel -- megmerve ugyanabban a korben:
    // nem letezo id -> 200 + [], letezo id -> 200 + 1 elem. A kartya a
    // /comments-et nevezi meg, de ez a KETTO az egyetlen ket vegpont a fajlban,
    // ami kartya-id alapjan listat ad kapu nelkul, es a ketertelmuseg azonos.
    // Egy javitas, ami a testverét meghagyja, azt tanitja, hogy a szabaly
    // vegpont-fuggo -- pedig nem az.
    if (!getKanbanCard(cardId)) { json(res, { error: 'Kártya nem található' }, 404); return true }
    json(res, getKanbanCardEvents(cardId))
    return true
  }

  const breakdownMatch = path.match(/^\/api\/kanban\/([^/]+)\/breakdown$/)
  if (breakdownMatch && method === 'POST') {
    const cardId = decodeURIComponent(breakdownMatch[1])
    const card = getKanbanCard(cardId)
    if (!card) { json(res, { error: 'Kártya nem található' }, 404); return true }
    const existing = getChildCards(cardId)
    if (existing.length > 0) { json(res, { error: 'A kártya már rendelkezik subtask-okkal' }, 409); return true }
    try {
      const result = await generateBreakdown(card.title, card.description)
      json(res, { subtasks: result.subtasks })
    } catch (err) {
      logger.error({ err, cardId }, 'Breakdown generation failed')
      json(res, { error: (err as Error).message }, 500)
    }
    return true
  }

  const acceptMatch = path.match(/^\/api\/kanban\/([^/]+)\/breakdown\/accept$/)
  if (acceptMatch && method === 'POST') {
    const parentId = decodeURIComponent(acceptMatch[1])
    const parent = getKanbanCard(parentId)
    if (!parent) { json(res, { error: 'Szülő kártya nem található' }, 404); return true }
    const body = await readBody(req)
    const { subtasks } = JSON.parse(body.toString()) as {
      subtasks: Array<{ title: string; description: string; assignee: string | null; priority: string }>
    }
    if (!Array.isArray(subtasks) || subtasks.length === 0) {
      json(res, { error: 'Subtask lista kötelező' }, 400)
      return true
    }
    const db = getDb()
    const created = db.transaction(() => {
      const ids: string[] = []
      for (const st of subtasks) {
        const id = randomUUID().slice(0, 8).toUpperCase()
        createKanbanCard({
          id,
          title: st.title,
          description: st.description,
          assignee: st.assignee ?? undefined,
          priority: (st.priority as any) ?? 'normal',
          project: parent.project ?? undefined,
          parent_id: parentId,
        })
        ids.push(id)
      }
      addKanbanComment(parentId, BOT_NAME, `Auto-breakdown: ${ids.length} subtask létrehozva (${ids.join(', ')})`)
      return ids
    })()
    // Sub-cards inherit `parent.project`, so an unattributed parent silently
    // multiplies into unattributed children -- one breakdown, N new gaps.
    const warning = kanbanProjectWarning(parent.project)
    json(res, warning ? { ok: true, created, warning } : { ok: true, created })
    return true
  }

  const childrenMatch = path.match(/^\/api\/kanban\/([^/]+)\/children$/)
  if (childrenMatch && method === 'GET') {
    const parentId = decodeURIComponent(childrenMatch[1])
    json(res, getChildCards(parentId))
    return true
  }

  return false
}
