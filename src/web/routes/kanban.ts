import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { join } from 'node:path'
import {
  listKanbanCards, countArchivedKanbanCards, kanbanAssigneeExists, createKanbanCard, updateKanbanCard, KANBAN_CREATE_FIELDS,
  deleteKanbanCard, moveKanbanCard, archiveKanbanCard, unarchiveKanbanCard,
  getKanbanComments, addKanbanComment, getKanbanCardHistory, listKanbanProjects,
  getKanbanCard, getChildCards, getDb,
  createAgentMessage, markKanbanCardDispatched,
  getKanbanSeqByIdPrefix,
  listLabels, getLabel, createLabel, updateLabel, deleteLabel,
  addLabelToCard, removeLabelFromCard, getLabelsForAllCards, getLabelsForCard,
  addCardBlocker, removeCardBlocker, getBlockersForCard, getBlockedByCard,
  getBlockersForAllCards, blockerWouldCycle, parentWouldCycle,
  listArchivedKanbanCards,
  revertIdeaFromKanban,
  getHeartbeatKanbanSummary,
  countNewHotMemories,
  countPlannedKanbanCards,
  getDbFileSizeMb,
  KANBAN_UPDATABLE,
  KANBAN_SERVER_FIELDS,
  KANBAN_ELSEWHERE_FIELDS,
  getTokenPruneLag,
  getStuckKanbanCards,
  type TokenPruneLag,
  recordKanbanCloseOverride,
} from '../../db.js'
import { openVerdicts, overrideReason, closeRefusal, type OpenVerdict } from '../kanban-verdict-gate.js'
import { normalizeKanbanRefs } from '../kanban-ref-normalize.js'
import { kanbanCreateError } from '../kanban-create-validation.js'
import { normalizeDueDate, DUE_DATE_ZONE, DUE_DATE_ACCEPTED } from '../kanban-due-date.js'
import { unknownQueryParams, unknownQueryParamError } from '../query-params.js'
import { kanbanProjectWarning } from '../kanban-project-warning.js'
import { scanUnansweredCondition, isDuplicateArchive, conditionWarningText } from '../reopen-condition-warning.js'
import { appendReopenWarning } from '../reopen-condition-log.js'
import { OWNER_NAME, BOT_NAME, MAIN_AGENT_ID, STORE_DIR, WEB_HOST, WEB_PORT, KANBAN_LABEL_COLORS } from '../../config.js'
import { listAgentNames, readAgentDisplayName } from '../agent-config.js'
import { isAgentRunning } from '../agent-process.js'
import { resolveKanbanDispatch } from '../../kanban-dispatch.js'
import { generateBreakdown } from '../llm-breakdown.js'
import { logger } from '../../logger.js'
import { readBody, json, jsonMaybeGzip, methodNotAllowed } from '../http-helpers.js'
import { getEffectiveSettingValue } from '../../settings-store.js'
import type { RouteContext } from './types.js'

// #1023 (upstream): the keys a PUT body may carry WITHOUT being a writable column.
// Upstream kept them in a local KANBAN_READONLY_FIELDS set; at the merge 88c366f2 the
// PUT guard is ours (card 5112c914, intent-based: a CHANGED value of a field writable
// elsewhere is a 400, an echo is not), and upstream's members were folded into
// db.ts's KANBAN_SERVER_FIELDS ('last_status_at') and KANBAN_ELSEWHERE_FIELDS
// ('blockers') so the dashboard's whole-card echo keeps working.

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
  // FIRST line on purpose: this dispatch is fired ONCE, at the moment the card
  // enters in_progress, and the status is correct then -- the `dispatched_at`
  // guard is right and is not what needs fixing. What can slip is DELIVERY: the
  // message rides the normal inter-agent queue, and a busy session may only read
  // it after finishing that round, by which time the card has moved on. Observed
  // on a live install, on more than one card.
  //
  // A status check at dispatch time therefore cannot help (the card is not yet
  // `testing` when the message is written), so the guard has to travel WITH the
  // message and be re-evaluated by the reader. The wasted round is the mild
  // outcome; the expensive one is a second attempt producing parallel work on the
  // same target -- a SECOND test file for one controller, with its own fixture,
  // maintained in two places. The receiving agent's own rules already forbid that,
  // but they cannot fire on a task the agent has no reason to think is finished.
  //
  // The check is handed over as a runnable command, like every other step here:
  // an instruction the reader has to compose is one it can skip. There is no
  // single-card GET endpoint, hence the board fetch plus a one-field extract.
  //
  // The isinstance(list) branch is not defensive padding: measured while writing
  // this, an unreadable token makes the endpoint answer with an error OBJECT, and
  // iterating that dict yields its KEYS, so the naive one-liner dies on a Python
  // TypeError. A traceback is the one answer this line must never give -- the
  // reader would have no status and no idea why, and the likeliest reaction to a
  // broken pre-flight check is to skip it. Echoing the server's own error keeps it
  // actionable.
  //
  // description is pulled alongside status, not left for a second look-up: a
  // program-specific closing-status override (see the ranking sentence below)
  // lives in the card's description, and a probe that prints only the status
  // gives the reader no reason to ever read it. Two agent incidents on one card
  // (2026-09-15, 7ed56208) confirmed the failure mode -- the reader ran exactly
  // this probe, saw a status, and never saw the override sitting one field over.
  const statusProbe =
    `  curl -s ${auth} ${base}/api/kanban | python3 -c "import sys,json;d=json.load(sys.stdin);c=(next((x for x in d if x.get('id')=='${id}'),None) if isinstance(d,list) else None);print(('status: '+str(c.get('status'))+chr(10)+'description: '+((c.get('description') or '').strip() or '(nincs)')) if c else ('nincs ilyen kartya' if isinstance(d,list) else 'ismeretlen -- a szerver nem kartya-listat adott: '+str(d)[:120]))"`
  return [
    'MIELŐTT NEKIKEZDESZ: nézd meg a kártya AKTUÁLIS státuszát ÉS leírását. Ez az üzenet egy foglalt session sorában KÉSHET, és közben a munka elkészülhetett -- a leírás pedig a kártya saját, ennél a sablonnál erősebb szabályait hordozhatja (lásd lent):',
    statusProbe,
    'Ha a "status:" sor már "testing" vagy "done", NE kezdj bele -- az üzenet későn ért ide, a munka már áll. Egy második nekifutás párhuzamos, két helyen karbantartott munkát szül (például egy MÁSODIK teszt-fájlt ugyanarra a vezérlőre). Ilyenkor jelezd a delegálódnak, és ne írj kódot.',
    'A "description:" sort is OLVASD EL, ne csak a státuszt: ha benne kártya-specifikus kikötés áll (pl. más záró-státusz, "nincs éles restart"), az felülírja ennek a sablonnak az alapértelmezését, lásd a 2) lépésnél.',
    '',
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
    // `done` is right for almost every card, so this template keeps it as the
    // default -- but not for every board PROGRAM. A program can give its cards
    // their own closing status (for example a review status, so the delegator
    // checks the work before the card closes), and that rule lives in the CARD
    // text. Two rules, no stated ranking: an agent either spends a round
    // deciding which one wins, or (worse) quietly follows this template and the
    // work closes unreviewed. One sentence fixes it; swapping the default
    // globally would break the close everywhere else.
    'Ha a KÁRTYA SZÖVEGE más záró-státuszt ír elő (például `testing`, hogy a delegálód átnézze a munkát), AZ az irányadó: a kártya program-specifikus szabálya erősebb ennél a sablonnál. Ilyenkor a fenti hívásban a "done" helyére azt a státuszt írd, az "actor" mezőt ugyanúgy küldve. Ha a kártya nem ír elő mást, a "done" az alapértelmezés.',
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
    const decision = resolveKanbanDispatch(card.assignee, {
      ownerName: OWNER_NAME,
      botName: BOT_NAME,
      mainAgentId: MAIN_AGENT_ID,
      agentNames: listAgentNames(),
      isRunning: isAgentRunning,
      actor,
    })
    const target = decision.target
    if (!target) {
      // 'not-dispatchable' (no/unknown assignee, human owner) and 'self-move'
      // are DELIBERATE no-dispatch cases -- staying quiet is correct, and
      // alerting on them would bury the one case that matters.
      if (decision.reason === 'session-down') reportUndeliveredDispatch(id, decision.unreachable ?? String(card.assignee))
      return
    }
    const desc = (card.description ?? '').trim()
    const content = `[Kanban feladat #${id}]: ${card.title}${desc ? ' — ' + desc : ''}\n\n${kanbanMoveInstructions(id, target)}`
    createAgentMessage(MAIN_AGENT_ID, target, content)
    markKanbanCardDispatched(id)
    logger.info({ id, target, assignee: card.assignee }, 'Kanban in_progress dispatch fired')
  } catch (err) {
    logger.warn({ err, id }, 'Kanban dispatch failed (card move still succeeded)')
    reportUndeliveredDispatch(id, 'a kiosztás hibára futott')
  }
}

// A card that reached in_progress without its assignee being woken must never
// stay silent: the board shows it running, status-driven monitoring skips on
// exactly that status, and the false in_progress SUSTAINS ITSELF -- a single
// missed dispatch can hold a card open for hours behind a green log. So the
// failure is written where both readers look: a comment on
// the card (the board) and a notice in the main agent's inbox (the delegator,
// who triages and can put the card back).
//
// Best-effort by construction: this runs inside the move request, and the move
// itself has already succeeded. A throw here (db locked, inbox write failing)
// must not turn a completed move into a 500, so it is swallowed after a log --
// the same contract as the dispatch it reports on.
function reportUndeliveredDispatch(id: string, unreachable: string): void {
  logger.warn({ id, unreachable }, 'Kanban card is in_progress but its assignee was NOT woken')
  try {
    addKanbanComment(
      id,
      'system',
      `A kártya in_progress lett, de a kiosztott ügynök (${unreachable}) NEM kapott üzenetet -- a session nem fut, vagy a kiosztás hibára futott. ` +
      'A kártya NEM fut: tedd vissza planned-re, vagy indítsd el az ügynököt és húzd újra in_progress-re.',
    )
  } catch (err) {
    logger.warn({ err, id }, 'Undelivered-dispatch card comment failed')
  }
  try {
    createAgentMessage(
      'system',
      MAIN_AGENT_ID,
      `[kanban-dispatch] A(z) #${id} kártya in_progress lett, de a kiosztott ügynök (${unreachable}) NEM kapott üzenetet. ` +
      'A tábla futónak mutatja, közben senki nem dolgozik rajta. Tedd vissza planned-re, vagy indítsd el az ügynököt és aktiváld újra.',
    )
  } catch (err) {
    logger.warn({ err, id }, 'Undelivered-dispatch inbox notice failed')
  }
}

/** Query parameters `GET /api/kanban` accepts.
 *
 *  `fields=summary` drops `description` and `labels` from every row. It does NOT
 *  change WHICH cards come back -- same sweep, same population, same
 *  X-Archived-Hidden -- so a caller cannot use it to ask a narrower question by
 *  accident. That is the whole point: the ?archived=1 incident this guard exists
 *  for was a DIFFERENT POPULATION wearing an honest face, and a field filter
 *  must not be able to repeat it.
 *
 *  MEASURED 2026-09-19 09:24 CEST, 2307 live cards: the full payload is
 *  3 964 380 chars (~991k tokens) and `description` alone is 2 841 766 of it
 *  (72%). Every agent that lists the board pays that, every listing. The
 *  dashboard UI needs the descriptions and keeps getting them by default; the
 *  agents do not, and now have a way to say so.
 */
//
//  `agent` / `assignee` (one filter, two spellings) and `includeArchived` are
//  upstream's (a98d02c3), added at the merge 88c366f2. Unlike `fields` they DO
//  change the population -- which is exactly why they are named here: an
//  honoured filter is fine, a silently dropped one is the defect.
const KANBAN_LIST_PARAMS: readonly string[] = ['fields', 'agent', 'assignee', 'includeArchived']

/** Query parameters `GET /api/kanban/archived` accepts. */
const KANBAN_ARCHIVED_PARAMS: readonly string[] = ['q', 'project', 'label', 'from', 'to', 'limit']

/** Literal sub-paths of /api/kanban that are NOT card ids. */
export const KANBAN_RESERVED_SEGMENTS = ['archived', 'labels', 'assignees', 'heartbeat-summary', 'due-date-rules', 'stuck'] as const

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
/**
 * THE CLOSING GATE -- card 5a967042. Answers 409 and returns true when the card
 * has an open verdict and the caller gave no reason to close it anyway. With a
 * reason, the closing goes ahead and the reason is written to the card's history
 * (`close_override`), next to the status change it allowed. The parser and its
 * rules live in kanban-verdict-gate.ts.
 */
function closeBlocked(res: ServerResponse, cardId: string, body: unknown, actor: unknown): boolean {
  const open: OpenVerdict[] = openVerdicts(getKanbanComments(cardId))
  if (open.length === 0) return false
  const reason = overrideReason(body)
  if (!reason) {
    json(res, closeRefusal(open), 409)
    return true
  }
  const who = typeof actor === 'string' && actor.trim() !== '' ? actor.trim() : null
  recordKanbanCloseOverride(cardId, JSON.stringify(open.map((v) => ({ author: v.author, line: v.line }))), reason, who)
  logger.warn({ cardId, open, actor: who }, 'Kanban card closed over an open verdict, with a stated reason')
  return false
}

/**
 * A move that changed no rows, put into words that name WHICH condition failed.
 *
 * Exported and pure so the distinction is testable: the whole point is that the two
 * states STOP SHARING A STRING. An inline ternary would be untestable without an HTTP
 * harness, and this file's other route tests are built on exported helpers for the same
 * reason.
 *
 * The 404 is unchanged on both branches -- callers are bound to it. Only the words move.
 */
export function moveFailureMessage(cardStillExists: boolean): string {
  return cardStillExists
    ? 'A mozgatás nulla sort változtatott, pedig a kártya létezik -- próbáld újra, és utána OLVASD VISSZA a státuszt'
    : 'Kártya nem található'
}

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
  tokenPrune: TokenPruneLag,
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
    // HBDBKUSZOB823: placed immediately after `counts` and BEFORE the lists,
    // for the same reason counts comes first -- a truncated read must keep the
    // health signal and lose only the annotating card lists. The retired
    // `dbSize > 100 MB` warning could never go quiet (the DB is bounded by
    // design at ~480 MB); this one is quiet whenever the daily sweep runs.
    token_prune: tokenPrune,
    urgent: summary.urgent.map(slim),
    waiting: waitingRecent.map(slim),
    waiting_shown: Math.min(summary.waiting.length, HEARTBEAT_SUMMARY_WAITING_CAP),
  }
}

// The methods the single-card path actually serves. One source, so the Allow
// header can never drift from the branches above it -- advertising a method
// that is not routed would send the caller one step further into the same fog.
// GET is ours (the single-card read route, card 66454b7d and 2e493a4b); upstream's
// list predates it on their side. merge 88c366f2.
const KANBAN_CARD_METHODS = ['GET', 'PUT', 'DELETE'] as const

/**
 * Parse the `includeArchived` query parameter.
 *
 * Three-valued on purpose: true / false / null-meaning-REJECT. The bug this replaces was
 * a two-valued read where every unrecognised input collapsed into "false" -- which is how
 * `?includeArchived=1` came back with the archived cards missing and no complaint.
 *
 * Bare presence (`?includeArchived` or `=`) reads as TRUE: that is the common URL idiom,
 * and it errs toward returning MORE rows, which is the safe direction here -- the failure
 * we are fixing was rows going missing.
 */
export function parseIncludeArchived(raw: string | null): boolean | null {
  if (raw === null) return false
  const v = raw.trim().toLowerCase()
  if (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
  return null
}

export async function tryHandleKanban(ctx: RouteContext): Promise<boolean> {
  const { req, res, path, method, url } = ctx

  if (path === '/api/kanban' && method === 'GET') {
    // UNKNOWN PARAMETERS ARE A 400, NEVER SILENTLY DROPPED (card cf85d765; upstream
    // reached the same rule independently, a98d02c3). Without the guard, `?archived=1`
    // answered 200 with the LIVE cards -- a different population, wearing the face of
    // an honest empty result. See web/query-params.ts.
    // ⛔ SZIGORU halmaz, ALIAS NELKUL (upstream ugyvezetoi dontes): egy alias eletben
    // tartana a talalgatast; a hibauzenetbol viszont megtanulhato a helyes nev. Merve
    // upstream: hat agens HAROM kulonbozo neven probalta ugyanazt (includeArchived 16x,
    // archived 6x, include_archived 6x), plusz ?id= 4x.
    // The body keeps OUR `error` text (kanban-unknown-query-param.test.ts reads it) and
    // carries upstream's machine-readable `unknown` / `known` fields next to it.
    const ismeretlen = unknownQueryParams(ctx.url, KANBAN_LIST_PARAMS)
    if (ismeretlen.length) {
      json(res, {
        ...unknownQueryParamError(ismeretlen, KANBAN_LIST_PARAMS,
          'Archivalt kartyak: GET /api/kanban?includeArchived=1 vagy GET /api/kanban/archived. '
          + 'Heartbeat-osszegzo: GET /api/kanban/heartbeat-summary. '
          + 'A lapok szurese "agent" (vagy "assignee"); EGY lapot a /api/kanban/<id> utvonal ad, nem a ?id= parameter.'),
        unknown: ismeretlen,
        known: [...KANBAN_LIST_PARAMS],
      }, 400)
      return true
    }
    // includeArchived is honoured or REFUSED -- never silently dropped. Ignoring it was
    // the actual defect: a caller had evidence it asked for archived cards, the response
    // had evidence it did not, and nothing reconciled the two.
    const includeArchived = parseIncludeArchived(ctx.url.searchParams.get('includeArchived'))
    if (includeArchived === null) {
      json(res, {
        error: 'Az includeArchived értéke érvénytelen. Elfogadott: 1, true, yes, on, ' +
               '0, false, no, off (vagy érték nélkül = igaz).',
      }, 400)
      return true
    }
    // Embed each card's labels in one extra JOIN query (getLabelsForAllCards)
    // instead of an N+1 per-card lookup, so the footer-pill UI gets
    // everything it needs in a single round trip.
    // Az `assignee=` ugyanazt jelenti, mint az `agent=`: a dashboard es az agens-CLAUDE.md
    // kulonbozo nevet tanit ugyanarra, es a KETTO kozul egyik sem volt hibas -- csak nem
    // mukodott egyik sem.
    const agent = ctx.url.searchParams.get('agent')
      ?? ctx.url.searchParams.get('assignee')
      ?? undefined
    // An unrecognised agent name 400s naming the accepted set, rather than silently
    // matching everything (`assignee = ?` against a name nothing has would just return
    // an empty list with 200) -- the same silence-teaches-guessing argument as the
    // KNOWN_PARAMS check above, applied to the value instead of the key. Accepted: a
    // configured name (OWNER_NAME, BOT_NAME, fleet agents -- what /api/kanban/assignees
    // advertises) OR any assignee that already exists on the board (external contributors
    // get cards too). Both sides compare case-insensitively: configured names are
    // capitalised (BOT_NAME=Marveen) while stored assignees are usually lowercase
    // (`marveen`), and an exact compare rejected the bot's and owner's own names.
    if (agent !== undefined) {
      const wanted = agent.toLowerCase()
      const isConfigured = [OWNER_NAME, BOT_NAME, ...listAgentNames()]
        .some((n) => n.toLowerCase() === wanted)
      if (!isConfigured && !kanbanAssigneeExists(agent)) {
        json(res, {
          error: 'unknown agent',
          agent,
          hint: 'lásd GET /api/kanban/assignees az elfogadott nevekért, vagy egy a táblán már szereplő assignee (kis/nagybetű mindegy)',
        }, 400)
        return true
      }
    }
    const labelsByCard = getLabelsForAllCards()
    // Blockers ride along in the same round trip as labels: the board needs
    // them to mark a blocked card, and a per-card fetch would be an N+1 on
    // every poll.
    const blockersByCard = getBlockersForAllCards()
    const cards = listKanbanCards({ includeArchived, agent }).map((card) => ({
      ...card,
      labels: labelsByCard.get(card.id) ?? [],
      blockers: blockersByCard.get(card.id) ?? [],
    }))
    // X-Archived-Hidden: what this list is NOT showing (card 1785bb14).
    //
    // The filter is deliberate and stays. What was missing is that the response
    // said nothing about it, so the list could be -- and was -- used to decide
    // whether a card EXISTS. Measured 2026-08-28: 1157 live, 54 archived, and
    // one archived id read as absent here and 200 from GET /api/kanban/<id>.
    //
    // ALWAYS SENT, ZERO INCLUDED. A header that appears only when non-zero
    // cannot be told apart from an old build that never sends it -- which is
    // the same silence one level up. With `includeArchived` nothing is hidden,
    // so the header says 0 (merge 88c366f2). Without it the count is
    // board-wide, NOT narrowed by `agent=`: it is an upper bound on what an
    // agent-filtered list hides, never an undercount.
    //
    // (It used to matter that this was counted AFTER listKanbanCards(), because
    // that call ran the auto-archive sweep. Upstream a98d02c3 moved the sweep to
    // a scheduled job, so reading the board no longer writes to it.)
    //
    // WHAT THIS DOES NOT DO: it does not help the caller who never looks at
    // headers -- the same limit the ?archived=1 guard has. Discovery is the
    // recipe's job (the munkakezdes-elozetes-ellenorzes skill now asks both
    // endpoints); this makes the gap visible to someone who IS looking, and in
    // particular to an author writing their own archived_at filter: nine dead
    // ones across seven skills were written by people who believed they were
    // filtering something.
    // `?fields=summary`: same rows, fewer columns. See KANBAN_LIST_PARAMS for the
    // measurement. Built by OMITTING two keys rather than by listing the keepers,
    // so a column added to kanban_cards later shows up here automatically instead
    // of silently vanishing from the slim view -- a missing field reads as an
    // empty value, and this endpoint has already been bitten once by a response
    // that looked honest while answering something else.
    const slim = (ctx.url.searchParams.get('fields') ?? '') === 'summary'
    const payload = slim
      ? cards.map(({ description: _description, labels: _labels, ...rest }) => rest)
      : cards
    jsonMaybeGzip(req, res, payload, 200, {
      'X-Archived-Hidden': includeArchived ? '0' : String(countArchivedKanbanCards()),
      // ALWAYS SENT, both modes -- a header that appears only in slim mode cannot
      // be told apart from an old build that never sends it.
      'X-Fields': slim ? 'summary' : 'full',
    })
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
    json(res, buildHeartbeatSummaryResponse(getHeartbeatKanbanSummary(), countNewHotMemories(MAIN_AGENT_ID), countPlannedKanbanCards(), getDbFileSizeMb(), getTokenPruneLag()))
    return true
  }

  // KANBANSTUCKURES916: replaces the kanban-audit skill's inline "status ==
  // in_progress" detector (structurally near-always empty on this board) with
  // a real "started, then went idle" measurement across all non-done statuses.
  // See getStuckKanbanCards in db.ts for the "started"/"last_activity"
  // definitions. `examined: 0` gets its own `empty_reason` -- the skill's
  // job is to report "could not measure" instead of a reassuring false zero.
  if (path === '/api/kanban/stuck' && method === 'GET') {
    const plannedDaysRaw = url.searchParams.get('planned_days') ?? '7'
    const activeDaysRaw = url.searchParams.get('active_days') ?? '3'
    const plannedDays = Number(plannedDaysRaw)
    const activeDays = Number(activeDaysRaw)
    if (!Number.isFinite(plannedDays) || plannedDays <= 0 || !Number.isFinite(activeDays) || activeDays <= 0) {
      json(res, { error: 'invalid planned_days/active_days: must be positive numbers' }, 400)
      return true
    }
    // 600s: the measured creator-comment window (D001, ELSOKOR922 Phase 0) --
    // an immediate comment on a fresh card is a description, not a work-trace.
    const result = getStuckKanbanCards({ plannedDays, activeDays, creatorCommentWindowSec: 600 })
    if (result.examined === 0) {
      json(res, { ...result, empty_reason: 'nincs megkezdett kártya' })
    } else {
      json(res, result)
    }
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

  // --- Blockers: "this card is blocked by that card" ---
  // GET returns both directions in one payload. The reverse list (what waits on
  // THIS card) is the half that changes behaviour: it is what tells the operator
  // that leaving a card open is holding up three others.
  const cardBlockersMatch = path.match(/^\/api\/kanban\/([^/]+)\/blockers$/)
  if (cardBlockersMatch && method === 'GET') {
    const cardId = decodeURIComponent(cardBlockersMatch[1])
    if (!getKanbanCard(cardId)) { json(res, { error: 'Kártya nem található' }, 404); return true }
    json(res, { blockers: getBlockersForCard(cardId), blocking: getBlockedByCard(cardId) })
    return true
  }
  if (cardBlockersMatch && method === 'POST') {
    const cardId = decodeURIComponent(cardBlockersMatch[1])
    if (!getKanbanCard(cardId)) { json(res, { error: 'Kártya nem található' }, 404); return true }
    const body = await readBody(req)
    // `id` is accepted as an alias for `blockerId` for the same reason the label
    // route accepts it: GET /api/kanban returns cards keyed by `id`.
    const parsed = JSON.parse(body.toString()) as { blockerId?: string; id?: string }
    const blockerId = parsed.blockerId ?? parsed.id
    if (!blockerId) { json(res, { error: 'blockerId mező kötelező' }, 400); return true }
    if (!getKanbanCard(blockerId)) { json(res, { error: 'A blokkoló kártya nem található' }, 404); return true }
    // A cycle is refused rather than stored: a block that can never clear is
    // not information, it is a deadlock the board would render as normal.
    if (blockerWouldCycle(cardId, blockerId)) {
      json(res, { error: blockerId === cardId
        ? 'Egy kártya nem blokkolhatja saját magát'
        : 'Ez a kapcsolat kört zárna be (a két kártya kölcsönösen egymásra várna)' }, 409)
      return true
    }
    addCardBlocker(cardId, blockerId)
    json(res, { ok: true })
    return true
  }

  const cardBlockerDeleteMatch = path.match(/^\/api\/kanban\/([^/]+)\/blockers\/([^/]+)$/)
  if (cardBlockerDeleteMatch && method === 'DELETE') {
    const cardId = decodeURIComponent(cardBlockerDeleteMatch[1])
    const blockerId = decodeURIComponent(cardBlockerDeleteMatch[2])
    if (removeCardBlocker(cardId, blockerId)) { json(res, { ok: true }); return true }
    json(res, { error: 'A kártyán nincs ilyen blokkoló' }, 404)
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

  // The due-date contract, readable by the edit modal so the zone lives in ONE
  // place (DUE_DATE_ZONE). The modal fetches it instead of carrying a copy; the
  // 400 for a bad due_date points here.
  if (path === '/api/kanban/due-date-rules' && method === 'GET') {
    json(res, { zone: DUE_DATE_ZONE, accepted: DUE_DATE_ACCEPTED })
    return true
  }

  if (path === '/api/kanban' && method === 'POST') {
    const body = await readBody(req)
    const data = JSON.parse(body.toString())
    // `agent` -> `assignee` alias (upstream 826453d9, #1501): createKanbanCard reads named
    // fields, so a body carrying `agent` instead of `assignee` made an OWNERLESS card with
    // {ok:true}. Measured upstream: five such cards before anyone noticed. Only when
    // `assignee` is absent (`=== undefined`: an explicit `assignee: null` still wins), and
    // `agent` is removed only when the alias fired, so an ignored `agent` reaches the
    // unknown-key warning below instead of vanishing unlogged.
    let agentAliasApplied = false
    if (data.assignee === undefined && typeof data.agent === 'string') {
      data.assignee = data.agent
      agentAliasApplied = true
    }
    if (agentAliasApplied) delete data.agent
    // The row cannot be created with a bad `status`/`priority` or no `title` --
    // SQLite's NOT NULL and CHECK see to that. Without this line the caller was
    // told so by an anonymous 500 while the field name went to the log, which is
    // indistinguishable from the server crashing. See kanban-create-validation.ts.
    const invalid = kanbanCreateError(data)
    if (invalid) { json(res, { error: invalid }, 400); return true }
    // due_date is normalised or refused BEFORE the row exists: a garbage value
    // used to create the card anyway (mandark's probe 2cecb0ac). See kanban-due-date.ts.
    if ('due_date' in data) {
      const due = normalizeDueDate(data.due_date)
      if (!due.ok) { json(res, { error: due.error }, 400); return true }
      data.due_date = due.value
    }
    // The caller may supply its own id (upstream e3cf63a9: readable slugs for
    // long-lived cards). Resolve it BEFORE the spread so the stored id and the
    // reported id are the same value: `{ id, ...data }` let a caller-supplied id win
    // in the row while the response still echoed the generated one, so anything
    // referencing the returned id pointed at a card that does not exist -- with 200.
    const suppliedId = typeof data.id === 'string' ? data.id.trim() : ''
    // Two supplied ids cannot be stored honestly, and each is named here instead of
    // surfacing as the anonymous 500 kanban-create-validation.ts exists to prevent
    // (merge 88c366f2): an id that is already taken (PRIMARY KEY), and one that is a
    // literal sub-path or contains a slash -- /api/kanban/<id> could never reach it.
    if (suppliedId) {
      if (suppliedId.includes('/') || (KANBAN_RESERVED_SEGMENTS as readonly string[]).includes(suppliedId)) {
        json(res, { error: `Az azonosito (${suppliedId}) nem hasznalhato: foglalt utvonal-szo vagy perjelet tartalmaz. Hagyd el az "id" mezot, es a szerver general egyet.` }, 400)
        return true
      }
      if (getKanbanCard(suppliedId)) {
        json(res, { error: `Mar letezik kartya ezzel az azonositoval: ${suppliedId}. A kartya NEM jott letre.` }, 409)
        return true
      }
    }
    const id = suppliedId || randomUUID().slice(0, 8)
    // Unknown keys are WARNED, not rejected (upstream 826453d9): POST's caller population is
    // not measured, and a 400 here would turn a silent data loss into an outage in card
    // creation. The known set is what createKanbanCard itself writes (KANBAN_CREATE_FIELDS).
    const knownPostFields = new Set<string>([...KANBAN_CREATE_FIELDS, 'id'])
    const unknownKeys = Object.keys(data).filter((key) => !knownPostFields.has(key))
    if (unknownKeys.length > 0) {
      logger.warn({ id, keys: unknownKeys }, 'POST /api/kanban: ismeretlen mező(k), csendben eldobva')
    }
    createKanbanCard({ ...data, id })
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
    //
    // AND `labels`, FOR THE SAME REASON, TWO ROUTES APART (card 2e493a4b, jarvis
    // measured it, marveen re-measured independently). The list embeds `labels`
    // on all 1184 cards; this route did not carry the key at all -- so an agent
    // reading a card BY ID, which is the obvious move for one card, saw a
    // complete-looking object with no marker and read it as "no labels". Same
    // shape the comment above documents, and the same silence: no error, just a
    // key that never arrives.
    //
    // Embedded whole rather than counted, unlike the comment bodies: labels are
    // small and bounded (a handful per card), so the payload argument that keeps
    // bodies out does not apply. This also makes the two routes agree -- a
    // reader can move between them without the answer changing.
    //
    // It matters more AFTER a fix than before: since d3d11bef the `allando-sor`
    // label is what excludes a card from the audit's stuck-detection. Anyone
    // writing the next checker correctly filters on the label -- and inherits
    // this blind spot if they fetch by id.
    if (card) {
      const count = getKanbanComments(id).length
      // `blockers` for the same reason as `labels` above: the list embeds them
      // (upstream 7e9a7362), so a by-id read without the key would read as "none".
      json(res, { ...card, labels: getLabelsForCard(id), blockers: getBlockersForCard(id), comment_count: count, comments_omitted: count > 0 })
      return true
    }
    json(res, { error: 'Kártya nem található' }, 404)
    return true
  }

  if (kanbanCardMatch && method === 'PUT') {
    const id = decodeURIComponent(kanbanCardMatch[1])
    const body = await readBody(req)
    const data = JSON.parse(body.toString())
    // AZ URES TORZS HIVOI HIBA, NEM MUVELET (kartya af9f6cd4). Megmerve: nulla
    // hivo kuld ilyet -- sem a frontend, sem az agens-lapok --, tehat a 400 nem
    // tor el semmit, viszont megnevezi, mi hianyzik.
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      json(res, { error: 'Ures torzsu PUT: nincs mit modositani. Add meg a valtoztatando mezot, pl. {"assignee":"..."}.' }, 400)
      return true
    }

    // A PRECONDITION THIS ENDPOINT CANNOT HONOUR MUST NOT ANSWER 200 (card ddf11b94).
    // Measured before this change: `If-Match: anything` -> 200, and
    // `expected_updated_at: 123` -> 200, both silently ignored. That is not a
    // missing feature, it is a false success handed to the one caller who was
    // trying to be careful -- the silent-success shape this board keeps finding.
    // WHY 400 AND NOT 412 OR 501: a 412 would claim we evaluated the precondition
    // and found it stale, which is a different (and false) statement; a 501 reads
    // as a server fault and invites a retry of the very same request.
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

    // AZ ISMERETLEN TORZS-MEZO NEM MEHET AT NEMAN (kartya 5112c914, sajat meres 2026-08-24).
    // Mert eset: `PUT {"labels":["varakozik:isti"]}` -> `{"ok":true}`, es a visszaolvasas
    // `labels: []`. A mezo IRHATO, csak nem ezen az uton -- es a rossz ut nem mondott nemet.
    // Ugyanaz az alak, mint a lenyelt query-parameter (cf85d765) es a csendben elfogadott
    // letrehozas (b7b0f400).
    //
    // ES AMIERT NEM EGYSZERU "ismeretlen kulcs -> 400" (ez volt az elso alakom, es MERVE
    // ELTORTE VOLNA A FELULETET): a dashboard KET inline szerkesztese a TELJES kartyat kuldi
    // vissza -- `{ ...card, assignee: newVal }` es `{ ...card, parent_id: newParentId }`
    // (`web/app.js`). A kartya-objektum pedig HAT nem-frissitheto mezot hordoz: `id`,
    // `created_at`, `updated_at`, `seq`, `dispatched_at`, `labels`. Egy csupasz kulcs-tiltas
    // MINDEN inline szerkesztesre 400-at adna -- egy or, ami a HELYES allapotra tuzel, es
    // ezt a fajl mar kimondja par sorral lejjebb.
    //
    // A MEGKULONBOZTETO EZERT A SZANDEK, NEM A KULCS, es ugyanaz a logika, mint az
    // `overwritten`-e: nem az szamit, hogy a mezo OTT VAN, hanem hogy a hivo MAST kuldott,
    // mint ami tarolva van. Egy visszhangzott `{...card}` nem allit semmit; egy MEGVALTOZTATOTT
    // ertek igen -- es akkor a hivo azt hiszi, irt valamit.
    const roCard = getKanbanCard(id)
    if (roCard) {
      // AZ `actor` NEM KARTYA-MEZO, HANEM VEZERLO MEZO, es ez a sor a KET AG SEAM-JE
      // (kartya 5112c914 x 4e27d5ad). Ez az or azelott keszult, hogy a PUT torzse
      // egyaltalan fogadott volna `actor`-t; kulon-kulon mindket ag ZOLD volt, es EGYUTT
      // PIROS: a `{"actor":"..."}` ismeretlen kulcsnak minosult es 400-at kapott, tehat a
      // mezo-tortenet "ki" fele nemán elveszett volna. A `merge-tree` errol semmit nem
      // mondott -- a ket valtozas a fajl KET KULONBOZO regiojaban all.
      // MERVE a seam-en: a `kanban-field-history.test.ts` ket esete 400-at kapott 200 helyett.
      // `override_reason` is a control field too: the reason a closing overrides an
      // open verdict (card 5a967042), never stored on the card.
      const PUT_CONTROL_FIELDS = ['actor', 'override_reason'] as const
      const sentKeys = Object.keys(data).filter(
        (k) => !(KANBAN_UPDATABLE as readonly string[]).includes(k)
             && !(PUT_CONTROL_FIELDS as readonly string[]).includes(k),
      )
      const unknownKeys = sentKeys.filter(
        (k) => !(KANBAN_SERVER_FIELDS as readonly string[]).includes(k)
             && !(KANBAN_ELSEWHERE_FIELDS as readonly string[]).includes(k),
      )
      // 1. A KARTYAN NEM IS LETEZO KULCS: eliras vagy kitalalt mezo. Ilyet egyetlen mert hivo
      //    sem kuld (a dashboard a kartya sajat alakjat kuldi vissza), tehat a 400 nem tor el
      //    semmit -- viszont megnevezi, mi nem tortent meg.
      if (unknownKeys.length > 0) {
        json(res, {
          error: `Ismeretlen mezo(k): ${unknownKeys.join(', ')}. Ezeket a vegpont NEM tarolja el. `
            + `Frissitheto mezok: ${KANBAN_UPDATABLE.join(', ')}.`,
        }, 400)
        return true
      }
      // 2. MASHOL IRHATO MEZO, MEGVALTOZTATOTT ERTEKKEL -> 400, a helyes vegpont nevevel.
      //    A kulcs jelenlete ONMAGABAN nem eleg: ugyanaz a kulcs ott van a legitim `{...card}`
      //    visszhangban is, valtozatlan ertekkel -- arra hallgatunk, mint eddig.
      // ES A SZERVER-TULAJDONU MEZOKRE EZ NEM ALL, ezert kulon halmaz:
      // ha a beküldött `updated_at` vagy `seq` eltér a tarolttol, az ELAVULT OLVASAS -- verseny,
      // nem szandek. A felulet a lista-nezetbol kuldi vissza a kartyat; ha kozben mas irt ra, a
      // visszhang elavul. Ezeket 400-zal elutasitani pontosan a FELTETELES IRAST valositana meg,
      // amit ez a vegpont par sorral feljebb KIMONDOTTAN nem tamogat -- es a felulet inline
      // szerkesztese torne el egy jóhiszemű versenyen.
      // A `labels` MAS: ott van hova irni, tehat a valtozott ertek SZANDEK.
      //
      // `blockers` (upstream 7e9a7362, merge 88c366f2) is embedded in the list the UI
      // echoes, and is writable ELSEWHERE (/api/kanban/<id>/blockers) -- so it belongs
      // here, not among the server fields. Compared by blocker ID SET only: each ref
      // also carries the blocker card's title and status, which change whenever THAT
      // card moves, so a whole-object compare would 400 a good-faith inline edit made
      // from a list loaded a minute earlier.
      const blockerIds = (v: unknown): string =>
        JSON.stringify((Array.isArray(v) ? v : [])
          .map((b) => (b && typeof b === 'object' ? String((b as { id?: unknown }).id) : String(b)))
          .sort())
      const stored: Record<string, unknown> = {
        labels: getLabelsForAllCards().get(id) ?? [],
        blockers: getBlockersForCard(id),
      }
      const ignored = (KANBAN_ELSEWHERE_FIELDS as readonly string[])
        .filter((k) => k in data && (k === 'blockers'
          ? blockerIds(data[k]) !== blockerIds(stored[k])
          : JSON.stringify(data[k]) !== JSON.stringify(stored[k])))
      if (ignored.length > 0) {
        const hint = (ignored.includes('labels')
          ? ' A cimkekhez a dedikalt vegpont valo: POST /api/kanban/<id>/labels {"labelId":"..."}.'
          : '')
          + (ignored.includes('blockers')
            ? ' A blokkolokhoz: POST /api/kanban/<id>/blockers {"blockerId":"..."} es DELETE /api/kanban/<id>/blockers/<blockerId>.'
            : '')
        logger.warn({ id, ignored }, 'Kanban PUT received non-updatable fields with changed values')
        json(res, {
          error: `Ezeket a mezoket ez a vegpont NEM irja: ${ignored.join(', ')} -- a keres NEM `
            + `tortent meg, hogy ne hidd, hogy eltarolodott.${hint}`,
        }, 400)
        return true
      }
    }

    // ARCHIVALT KARTYA SZERKESZTESE: ENGEDJUK, DE NEM HALLGATUNK ROLA (kartya 66454b7d,
    // mert eset 2026-08-22 06:50, `4a9480b2`).
    //
    // AZ ESET: 03:21-kor valaki archivalta a kartyat, 03:59-kor MAS atirta rajta a cimet, a
    // felelost es a prioritast. Az atiras a PUT-on ment, es nem erintette az `archived_at`-et.
    // A kartya ezzel egyszerre volt `archived_at != NULL` ES `status = planned`; a
    // `listKanbanCards()` `archived_at IS NULL`-ra szur, tehat AZ UJ FELELOS SOHA NEM LATTA
    // VOLNA. Mindket muvelet sikert jelentett, es a res A KETTO KOZOTT keletkezett.
    //
    // MIERT NEM TILTAS (a kartya harom iranya kozul): egy archivalt kartya javitasa legitim
    // (elgepelt cim, rossz projekt-cimke), es a 400 azt is elzarna. Es MIERT NEM AUTOMATIKUS
    // FELOLDAS: az csendben visszahozna kartyakat, amiket valaki SZANDEKOSAN archivalt --
    // ugyanaz a nema dontes-helyettesites, csak a masik iranyba. Marad a harmadik: a muvelet
    // megtortenik, es a valasz KIMONDJA, hogy a kartya lathatatlan marad.
    //
    // A SZANDEK-SZURES UGYANAZ, MINT PAR SORRAL FELJEBB: ha a hivo MAGA kuldi az
    // `archived_at`-et, akkor eppen az archivalasi allapotot kezeli -- annak nem szolunk.
    // A figyelmeztetes annak jar, aki EGYEB mezot ir egy archivalt kartyan, es nem tud rola.
    const archivedBefore = roCard && (roCard as { archived_at?: number | null }).archived_at != null
    const archiveWarning = archivedBefore && !('archived_at' in data)
      ? `FIGYELEM: ez a kartya ARCHIVALT (archived_at nem ures), es az marad -- a `
        + `lista-nezetben NEM jelenik meg, tehat a felelos nem fogja latni. Ha elo kartyat `
        + `akartal szerkeszteni, oldd fel: POST /api/kanban/${encodeURIComponent(id)}/unarchive.`
      : null

    // AZ `actor` A TORZSBOL JON, ES OPCIONALIS -- card 4e27d5ad, ugyanaz az alak,
    // mint a `/move`-nal. Kotelezove tenni azt jelentene, hogy a mai hivok
    // (a dashboard harom PUT helye es minden agens-lap dokumentalt peldaja)
    // egyik naprol a masikra 400-at kapnanak egy iras helyett -- egy audit-nyom
    // kedveert eltorni az irast rosszabb, mint egy NULL actor.
    //
    // Nem kell kiszurni a `data`-bol: a KANBAN_UPDATABLE lista zart, es az
    // `actor` nincs benne, tehat sem a valtozas-detektalasba, sem az UPDATE-be
    // nem jut el. Megmerve: `{"actor":"x"}` egyedul -> `unchanged`.
    const actor = typeof data.actor === 'string' && data.actor.trim() !== '' ? data.actor.trim() : undefined
    // THE LAST GUARD BEFORE THE WRITE, so a refused due_date leaves the WHOLE card
    // untouched, not just that field: a PUT that changed the priority and failed
    // on the date must not half-apply. The value a caller sees on success is the
    // stored one -- the reason this is normalised here and not in the reader.
    //
    // AN ECHO OF THE STORED VALUE IS NOT CHECKED, for the reason the unknown-key
    // guard above gives: the intent is the distinguisher, not the key. The two
    // inline edits send `{ ...card, assignee }`, i.e. whatever due_date is stored.
    // Validating that would lock any card holding a legacy value out of every
    // inline edit -- a guard that freezes the broken state instead of leaving a
    // way out. It also leaves the two legacy text rows exactly as they are, which
    // is what a8dff303 asked for.
    if ('due_date' in data && !(roCard && data.due_date === (roCard as { due_date?: unknown }).due_date)) {
      const due = normalizeDueDate(data.due_date)
      if (!due.ok) { json(res, { error: due.error }, 400); return true }
      data.due_date = due.value
    }
    // A re-parent is refused rather than stored if it would close a loop (upstream
    // 94765127): a parent chain that loops back on itself is not a hierarchy, and
    // touchAncestorChain (db.ts) only detects one after it already exists -- it cannot
    // prevent the write that creates it. Clearing the parent (null/omitted) needs no check.
    //
    // ONLY A CHANGED parent_id IS CHECKED (merge 88c366f2), for the reason the echo
    // rule above gives: the UI sends `{ ...card }` on every inline edit, so a card that
    // ALREADY sits in a cycle (written by some other path) -- or whose parent was
    // deleted -- would otherwise be locked out of every edit, including the one that
    // repairs it. A guard that freezes the broken state is a trap, not a guard.
    if (roCard && typeof data.parent_id === 'string' && data.parent_id
        && data.parent_id !== (roCard as { parent_id?: string | null }).parent_id) {
      if (!getKanbanCard(data.parent_id)) {
        json(res, { error: 'A szülő kártya nem található' }, 404)
        return true
      }
      if (parentWouldCycle(id, data.parent_id)) {
        json(res, {
          error: data.parent_id === id
            ? 'Egy kártya nem lehet a saját szülője'
            : 'Ez a szülő-kapcsolat kört zárna be',
        }, 409)
        return true
      }
    }
    // CARD 5a967042: a card does not close over an open verdict. Only a real
    // transition to done is gated -- an echo of a card already done is not a
    // closing, and blocking it would lock the card out of every inline edit.
    if (roCard && data.status === 'done' && (roCard as { status?: string }).status !== 'done') {
      if (closeBlocked(res, id, data, actor)) return true
    }
    const result = updateKanbanCard(id, data, actor)
    if (result.outcome === 'not-found') { json(res, { error: 'Kártya nem található' }, 404); return true }

    // A `unchanged` NEM hiba: egy hivo joggal kuldheti ujra ugyanazt (a szerkeszto
    // modal minden mentesnel a TELJES objektumot kuldi). De az `updated_at` NEM
    // emelkedik, es a valasz KIMONDJA, hogy nem tortent semmi -- kulonben a kartya
    // frissnek latszana anelkul, hogy barmi valtozott volna. Felulirni ilyenkor
    // nincs mit, tehat `overwritten` szuksegszeruen ures.
    if (result.outcome === 'unchanged') {
      json(res, { ok: true, changed: false, ...(archiveWarning ? { archived: true, warning: archiveWarning } : {}) })
      return true
    }

    // The overwrite travels in the response because that is where the caller
    // already looks; a log nobody reads is the same silence in another file.
    // The sentence is for the human, the array for the caller that parses.
    if (result.overwritten.length > 0) {
      const list = result.overwritten.map(o => `${o.field} (volt: ${JSON.stringify(o.from)})`).join(', ')
      logger.warn({ id, overwritten: result.overwritten }, 'Kanban PUT overwrote existing values')
      json(res, {
        ok: true,
        changed: true,
        overwritten: result.overwritten,
        // KET FIGYELMEZTETES EGY VALASZBAN: a felulirast es az archivaltsagot NEM olvasztjuk
        // ossze egy mondatba -- ket kulonbozo dolgot kell tenni tolük, es egy osszevont szoveg
        // az egyiket elnyeli.
        warning: `Ez az iras MAS erteket irt felul: ${list}. Ha nem te irtad oda, nezd meg, `
          + 'kinek a munkajat cserelted le -- a visszaolvasas ezt NEM mutatja meg, mert a '
          + 'sajat szovegedet adja vissza.',
        ...(archiveWarning ? { archived: true, archivedWarning: archiveWarning } : {}),
      })
      return true
    }
    json(res, { ok: true, changed: true, ...(archiveWarning ? { archived: true, warning: archiveWarning } : {}) })
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
    const parsedMove = JSON.parse(body.toString())
    const { status, sort_order, actor } = parsedMove
    // CARD 5a967042: the move to done is where a card closes; see closeBlocked.
    if (status === 'done') {
      const current = getKanbanCard(id)
      if (current && current.status !== 'done' && closeBlocked(res, id, parsedMove, actor)) return true
    }
    // A HAROM-ALLAPOTU KIMENET ES A TORZS DIAGNOSZTIKAJA EGYUTT MARAD, es a sorrend a lenyeg
    // (kartya aca11ba5 x a 09-05-i /move-naplozas). A torzs azert naplozott, mert a BOOLEAN
    // hamis erteke KET dolgot fedett -- "nincs ilyen kartya" es "nulla sor valtozott" --, es
    // mandark otszor olvasta "a kartya eltunt"-nek. Ez a valtozat a FORRASNAL valasztja szet
    // oket (a db elobb OLVASSA a sort), tehat a naplo eredeti MUNKAJAT mar a visszateresi
    // ertek elvegzi. A `warn` megis marad a `not-found` agon: egy valodi nem-talalt kartya
    // tovabbra is megerdemel egy sort, es a `serverUptimeSec` az egyetlen idobeli teny, amit
    // ez az oldal hozza tud tenni. Ami KIKERULT: a `getKanbanCard` ujra-lekerdezese, mert az
    // `outcome` mar megmondta, amit az meg akart tudni.
    const outcome = moveKanbanCard(id, status, sort_order ?? 0, actor)
    if (outcome === 'not-found') {
      logger.warn(
        { id, status, exists: false, serverUptimeSec: Math.round(process.uptime()) },
        'Kanban move: no such card',
      )
      json(res, { error: moveFailureMessage(false) }, 404)
      return true
    }

    // A `changed:false` NEM hiba -- ugyanaz a dontes, mint a testver PUT-on: egy hivo joggal
    // kuldheti ujra ugyanazt. De KIMONDJUK, mert a csendes `{ok:true}` mert kart okozott:
    // dexter hat lezart kartyat jelentett, es harom a hatbol NO-OP volt (didi es mandark mar
    // lezarta oket) -- a valasz nem adott semmit, amin ez latszott volna.
    // A no-op itt sem ir semmit, tehat az `updated_at` sem emelkedik: egy kartya nem latszhat
    // frissen attol, hogy valaki ujrakuldte a mar fennallo allapotat.
    if (outcome === 'unchanged') { json(res, { ok: true, changed: false }); return true }

    // Wake the assigned agent once when the card enters in_progress -- unless
    // that agent is the one who moved it (self-pickup needs no wake-up).
    if (status === 'in_progress') fireKanbanDispatch(id, actor)
    json(res, { ok: true, changed: true })
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
    let parsedArchive: unknown = null
    try {
      const parsed = JSON.parse((await readBody(req)).toString())
      if (parsed && typeof parsed === 'object') {
        parsedArchive = parsed
        if (typeof parsed.actor === 'string' && parsed.actor.trim() !== '') actor = parsed.actor.trim()
        reason = parsed.reason
      }
    } catch { /* empty or non-JSON body: the documented shape */ }

    // CARD 5a967042: archiving takes a card out of sight as surely as closing it.
    if (getKanbanCard(id) && closeBlocked(res, id, parsedArchive, actor)) return true

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
    // Zero by construction: this endpoint IS the archive, so nothing is hidden
    // from it. Sent rather than omitted for the same reason as above -- absence
    // and zero must not look alike -- and it doubles as the negative control
    // for the header itself.
    json(res, { cards, total: cards.length, limit }, 200, { 'X-Archived-Hidden': '0' })
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
    const alle = getKanbanComments(cardId)

    // `?limit=N` -- OPT-IN CSONKOLAS, ES A VALASZ MEGNEVEZI A SAJAT HIANYAT.
    //
    // MIERT KELL. Egy kartya kommentjeinek elolvasasa ma a TELJES halmazt hozza, es a
    // lap ELO is irja, hogy felveteelkor olvasd vegig. Merve 2026-09-19, elesben:
    // 900 elo kartya 19 057 038 karakternyi kommentet tart (~4,76 M token), es az
    // eloszlas extrem ferde -- a median kartya 9 154 karakter (~2,3 e token), de
    // `a65623ef` egymaga 804 261 (~201 e token). Vagyis EGY kartya elolvasasa ma
    // elviheti egy agens teljes kontextusablakat.
    //
    // MIERT BORITEK ES NEM CSUPASZ TOMB. Egy nema csonkolas pontosan azt a hibat
    // termelne, ami ellen ez keszult: a hianyzo sorok NEM-LETEZESNEK olvasodnak, es
    // a lap ket kulon torvenye is ezt mondja ki (a csonkolt nezet mint populacio, es
    // hogy a 200-as valasz onmagaban nem bizonyitek). Ezert aki limitet KER, MAS
    // ALAKU valaszt kap: egy boritekot, amiben ott a `total`, a `returned` es az
    // `omitted`. Aki nem ker limitet, BAJTRA a mai valaszt kapja -- a csonkolas nem
    // tortenhet meg veletlenul.
    //
    // A TESTVER-VEGPONT MAR IGY VISELKEDIK: a `GET /api/kanban/<id>` a
    // `comments_omitted` mezovel NEVEZI MEG, hogy kihagyta oket. Ez ugyanaz az alak,
    // egy szinttel lejjebb.
    const limitRaw = ctx.url.searchParams.get('limit')
    if (limitRaw === null) { json(res, alle); return true }
    const limit = Number.parseInt(limitRaw, 10)
    if (!Number.isFinite(limit) || limit < 1) {
      json(res, { error: '`limit` pozitiv egesz legyen' }, 400); return true
    }
    // `from=start` az ELSO N-et adja (a kartya eredete), `from=end` (alapertelmezes)
    // az UTOLSO N-et (a friss dontesek). A boritek KIIRJA, melyiket kaptad: egy
    // reszhalmaz a kivalasztasi szabalya nelkul nem rekonstrualhato.
    const from = (ctx.url.searchParams.get('from') ?? 'end') === 'start' ? 'start' : 'end'
    const valasztott = from === 'start' ? alle.slice(0, limit) : alle.slice(Math.max(0, alle.length - limit))
    // `order` CSAK a visszaadott sorrendet forditja, a KIVALASZTAST nem. A ketto
    // szetvalasztasa szandekos: kulonben a `desc` csendben mas reszhalmazt adna.
    const order = (ctx.url.searchParams.get('order') ?? 'asc') === 'desc' ? 'desc' : 'asc'
    const sorok = order === 'desc' ? [...valasztott].reverse() : valasztott
    json(res, {
      comments: sorok,
      total: alle.length,
      returned: sorok.length,
      omitted: alle.length - sorok.length,
      from,
      order,
    })
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
    // exist, and the loss was silent on both sides. Upstream (#1107) fixed the
    // same hole independently; its message is kept because it also names the
    // commonest cause -- a literal `KARTYA_ID` placeholder or a prefix id --
    // and says outright that nothing was created.
    const card = getKanbanCard(cardId)
    if (!card) {
      json(res, { error: `Kártya nem található: ${cardId}. A komment NEM jött létre. Teljes azonosító kell, a rövidített (prefix) alak nem működik.` }, 404)
      return true
    }
    const body = await readBody(req)
    const { author, content, automated } = JSON.parse(body.toString())
    if (!author || !content) { json(res, { error: 'Szerző és tartalom kötelező' }, 400); return true }
    // Code-side kanban-ref enforcement: rewrite `#<hex8>` references that map
    // to a real card into the human-facing `#<seq>` form before persistence
    // (#75 Cuzcoo dispatch). Random hex / non-matching tokens pass through.
    const normalizedContent = normalizeKanbanRefs(content, getKanbanSeqByIdPrefix)
    // `automated: true`: a bulk/machine writer marks its own comment, so the
    // stuck detector never reads it as a work-trace (KANBANSTUCKURES916).
    json(res, automated === true
      ? addKanbanComment(cardId, author, normalizedContent, { automated: true })
      : addKanbanComment(cardId, author, normalizedContent))
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
    json(res, getKanbanCardHistory(cardId))
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

  // Last, deliberately: every other single-card matcher above has had its turn,
  // including the fixed paths that also happen to be one segment long
  // (/api/kanban/archived among them). Placing this earlier would answer 405
  // for those before their own handler ran.
  //
  // Reached only when the path IS a single-card path and the method is not one
  // this route serves. Without it the request falls through to the server's
  // catch-all 404, whose body cannot be told apart from "no such card" -- an
  // ambiguity that has twice pointed a caller at the wrong bug.
  if (path.match(/^\/api\/kanban\/([^/]+)$/)) {
    methodNotAllowed(res, method, KANBAN_CARD_METHODS)
    return true
  }

  return false
}
