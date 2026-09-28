import {
  createAgentMessage, getPendingMessages, listAgentMessages, getRecipientQueueState,
  getAgentConversation, getAgentConversationThreads,
  getKanbanSeqByIdPrefix,
  markMessageDone, markMessageFailed, getAgentMessage,
  closeOtelSpan,
  getPendingBacklogByAgent,
  countNewerMessagesForRows,
  COMPLETION_REPORT_PREFIX,
  type AgentMessage,
} from '../../db.js'
import { detectHomoglyphs, formatHomoglyphWarning } from '../../homoglyph.js'
import { logger } from '../../logger.js'
import { COORDINATOR_AGENT_ID, VOICE_CHANNEL_AGENT_ID } from '../../channel-coordinator/ingest.js'
import { SYSTEM_DIRECTIVE_SENDER } from '../system-directive.js'
import { sanitizeAgentIdent } from '../../prompt-safety.js'
import { isKnownAgent, listAllAgentNames } from '../agent-config.js'
import { agentRunState } from '../agent-process.js'
import { MESSAGE_ABANDON_WINDOW_MS } from '../message-router.js'
import { adviseSender, isPullModelRecipient } from '../recipient-advice.js'
import { MAIN_AGENT_ID, OWNER_NAME, SYSTEM_SENDER_IDS, parseSystemSenderIds } from '../../config.js'
import { readBody, json, jsonMaybeGzip } from '../http-helpers.js'
import { normalizeKanbanRefs } from '../kanban-ref-normalize.js'
import { stampHeartbeatHeader } from '../heartbeat-header-stamp.js'
import { buildFreshnessInfo, type MessageFreshness } from '../agent-message-wrap.js'
import { parseQualifiedId, formatQualifiedId, isQualifiedId } from '../federation/address.js'
import { getFederationConfig } from '../federation/config.js'
import type { RouteContext } from './types.js'
import { unknownQueryParams, unknownQueryParamError } from '../query-params.js'

/** Query parameters `GET /api/messages` accepts. */
const MESSAGES_PARAMS: readonly string[] = ['agent', 'status', 'limit', 'before']

// Should closing a message produce a reverse "[Eredmény]" notification to its sender?
//
// Exported and tested directly, rather than inlined in the PUT handler: the previous
// tests re-implemented this condition inside the test file, so they passed no matter
// what the route actually did.
//
// Three senders get no notification:
//   1. self-messages -- the sender already knows;
//   2. senders that are not addressable agents. `system` posts the [session-stuck] and
//      [handoff-failure] notices but owns no tmux session, so a reply to it can never be
//      delivered: it fails, the retry window expires, and the resulting [handoff-failure]
//      wakes the main agent -- which, once closed, produced the next one. Measured on the
//      Acrobot install 2026-08-17: 44 of the last 200 rows were `-> system`, all failed.
//      `isKnownAgent` is the right test here because it accepts MAIN_AGENT_ID as well as
//      the sub-agent directories; a plain registry lookup would have suppressed every
//      notification back to the MAIN agent, which is the case this feature exists for.
//   3. contents that are themselves completion reports -- breaks ping-pong chains.
export function shouldNotifyDelegator(fromAgent: string, toAgent: string, content: string): boolean {
  if (fromAgent === toAgent) return false
  if (!isKnownAgent(fromAgent)) return false
  if (content.startsWith(COMPLETION_REPORT_PREFIX)) return false
  return true
}

// Frozen at module load, like the config constant it derives from.
const SYSTEM_SENDERS = parseSystemSenderIds(SYSTEM_SENDER_IDS, sanitizeAgentIdent)

/**
 * How much of a `result` travels inside the completion notification, and what the recipient
 * is told about the rest.
 *
 * WHY THIS IS NOT COSMETIC (measured twice on 2026-08-12): the notification carried the first
 * 500 characters and then said "the full text is in msg N's result field". Both times the cut
 * landed mid-argument -- once on a review condition, once on the numbers that decided whether a
 * filter was safe -- and both times the recipient could only ask for a resend, because the
 * pointer named a FIELD, not a way to read it. A pointer the consumer cannot follow is the same
 * as no pointer: the sender ends up retyping, which is exactly what the notification was for.
 *
 * TWO CHANGES, AND THE SECOND MATTERS MORE. The cap is 2000, because our results routinely
 * carry a measurement plus its interpretation and 500 truncates that mid-sentence. And the
 * marker now names the EXACT command, so following it is one step, not a research task.
 *
 * ES A MUTATO MEGMONDJA, MIRE MUTAT (2026-08-21). A megnevezett id NEM az olvasott uzenete,
 * hanem azé, amelyiknek a `result` mezőjében a teljes szöveg áll. Ezt korábban nem mondtuk ki,
 * és egy ágens a saját üzenet-id-jével kérdezte le: üres választ kapott, abból adatvesztésre
 * következtetett, és majdnem hibajelentést írt róla. Egy mutató, ami helyes, de nem mondja meg,
 * MIRE mutat, ugyanannyi kört visz el, mint egy hiányzó mutató -- csak nem lehet rá fogni.
 *
 * The cap stays FINITE on purpose: the notification is injected into a live session, and an
 * unbounded paste there costs context that the recipient did not choose to spend.
 */
export const RESULT_NOTIFY_MAX = 2000

export function resultSummary(id: number, result: string | undefined | null): string {
  if (!result) return '(nincs eredmény)'
  if (result.length <= RESULT_NOTIFY_MAX) return result
  const maradt = result.length - RESULT_NOTIFY_MAX
  return (
    result.slice(0, RESULT_NOTIFY_MAX) +
    `\n... [levágva, még ${maradt} karakter. A teljes szöveg a(z) ${id}. üzenet result mezőjében áll` +
    ` -- ez NEM ennek az üzenetnek az id-je. Kérd le: bash scripts/agent-msg-get.sh ${id}]`
  )
}

// Every JSON read of a message body carries the same freshness / supersession
// state the router stamps on the delivered text.
//
// WHY THE READ PATH NEEDS IT AT ALL. Reading the pending mailbox is a SUPPORTED
// move, not a workaround: the pull drain-inbox path exists precisely because it
// hands the main agent its messages in seconds where the router's push can take
// many minutes. So the answer to an early read acting on stale orders is
// emphatically NOT to forbid the read -- that would break a working mechanism
// over a missing annotation. It is to make the two paths say the same thing.
// Until now they did not: a row read from this endpoint arrived bare, and if its
// sender corrected or revoked it in the interval before delivery, the reader had
// nothing to go on. The annotation sat on the path the early read bypasses.
//
// Added as a SEPARATE `freshness` object rather than folded into `content`: the
// row is evidence (the system-directive rule compares `content` byte for byte
// against the quoted directive), so the body must stay untouched.
export type AgentMessageWithFreshness = AgentMessage & { freshness: MessageFreshness }

export function attachFreshness(messages: AgentMessage[]): AgentMessageWithFreshness[] {
  const nowMs = Date.now()
  // One query per distinct (from, to) partition, not one per row.
  const newer = countNewerMessagesForRows(messages)
  return messages.map((m) => ({
    ...m,
    freshness: buildFreshnessInfo(nowMs - m.created_at * 1000, newer.get(m.id) ?? 0),
  }))
}

export async function tryHandleMessages(ctx: RouteContext): Promise<boolean> {
  const { req, res, path, method, url } = ctx

  if (path === '/api/messages' && method === 'POST') {
    const body = await readBody(req)
    const { from, to, content, origin_note } = JSON.parse(body.toString()) as
      { from: string; to: string; content: string; origin_note?: string }
    if (!from?.trim() || !to?.trim() || !content?.trim()) {
      json(res, { error: 'from, to, and content are required' }, 400)
      return true
    }
    // Security: the channel-coordinator id grants channel-inbound delivery
    // (verbatim <channel> + reply-expected framing) in the message-router. The
    // ONLY legitimate writer of that id is the in-process coordinator, which
    // inserts directly into the DB -- it never POSTs here. The dashboard token
    // is readable by every sub-agent, so without this guard any sub-agent could
    // forge a reply-expected message addressed at the main agent. Reject it.
    //
    // CRITICAL: normalize with the EXACT function the router matches on
    // (sanitizeAgentIdent), NOT from.trim(). The router does
    // CHANNEL_COORDINATOR_AGENTS.has(sanitizeAgentIdent(from)), and
    // sanitizeAgentIdent STRIPS [^a-zA-Z0-9_-] rather than trimming. A bypass
    // like from="@telegram-coordinator" / "telegram-coordinator." survives
    // .trim() (!= the constant) yet sanitizes to "telegram-coordinator" in the
    // router -> channel-inbound with an attacker-controlled body. Matching the
    // router's normalization here closes that asymmetry.
    if (sanitizeAgentIdent(from) === COORDINATOR_AGENT_ID) {
      logger.warn({ from: from.trim(), to: to.trim() }, 'Rejected /api/messages POST forging channel-coordinator id')
      json(res, { error: 'from is reserved for the in-process channel coordinator' }, 403)
      return true
    }
    // System directives (SYSRESERVED918): the same shape, one level up. Every
    // fleet agent authenticates an operational directive
    // ([SYSTEM-DIREKTIVA msg_id:<N>]: stop, prepare to restart, drop work) by
    // reading the referenced row back and requiring from_agent === 'system' --
    // the header text alone is what a prompt injection would also write. That
    // recipe is only sound while 'system' cannot be POSTed here.
    //
    // Before this guard it could not be -- but only by ACCIDENT: 'system' has
    // no agents/<id>/ directory, so the known-agent check below rejected it.
    // Two ordinary, reversible acts would have removed that: adding 'system' to
    // SYSTEM_SENDER_IDS (an .env line whose entire PURPOSE is to exempt ids
    // from that check), or `mkdir agents/system/`. Either one hands the shared
    // dashboard token -- which every sub-agent reads -- the power to forge a
    // stop order, and nothing would have announced it.
    //
    // So the id is RESERVED, ahead of both the SYSTEM_SENDERS exemption and the
    // known-agent check, and on every auth lane including an enrolled device
    // key. No legitimate path is lost: every 'system' message is written
    // in-process via createAgentMessage (system-directive, message-router,
    // schedule-runner, context-guard-runner, agents), never over HTTP.
    // The other SYSTEM_SENDER_IDS entries are untouched -- they name external
    // notifiers, and none of them is the fleet's authentication base.
    if (sanitizeAgentIdent(from) === SYSTEM_DIRECTIVE_SENDER) {
      logger.warn({ from: from.trim(), to: to.trim(), authKind: ctx.auth?.kind ?? 'none' }, 'Rejected /api/messages POST forging the system directive sender')
      json(res, { error: `from '${SYSTEM_DIRECTIVE_SENDER}' is reserved for in-process system directives and can never be POSTed` }, 403)
      return true
    }
    // Voice channel (HANGCSATORNA918): the VOICE_CHANNEL_AGENT_ID also earns
    // channel-inbound
    // framing, but unlike the coordinator it is a legitimate POST writer -- the
    // relay runs out-of-process. So the guard is the AUTH LANE, not a blanket
    // 403: accept it only from an enrolled DEVICE KEY.
    //
    // WHY THE LANE AND NOT THE NAME: channel-inbound tells the receiving agent
    // "this is the owner, a reply is expected". The dashboard token is readable
    // by every sub-agent, so a name-only rule would let any of them forge an
    // owner message. A device key is a per-device secret the sub-agents do not
    // have, so requiring it is what makes the id trustworthy at DELIVERY time,
    // where the auth context is long gone and only from_agent survives.
    if (sanitizeAgentIdent(from) === VOICE_CHANNEL_AGENT_ID && ctx.auth?.kind !== 'device') {
      logger.warn(
        { from: from.trim(), to: to.trim(), authKind: ctx.auth?.kind ?? 'none' },
        'Rejected /api/messages POST as voice channel without a device key',
      )
      json(res, { error: `from '${VOICE_CHANNEL_AGENT_ID}' requires an enrolled device key, not the shared dashboard token` }, 403)
      return true
    }
    // Federation spoof guard: a slash-qualified from ("teodor/teodor") is the
    // provenance mark of a REMOTE sender and may only ever be written by the
    // token-authenticated /api/federation/inbox. Accepting it here would let
    // any dashboard-token holder (i.e. every local sub-agent) impersonate a
    // federation peer toward another local agent.
    if (from.includes('/')) {
      logger.warn({ from: from.trim(), to: to.trim() }, 'Rejected /api/messages POST with qualified from (federation impersonation guard)')
      json(res, { error: 'from must be a local agent id without "/" -- federated senders are only accepted via /api/federation/inbox' }, 403)
      return true
    }
    // From-authentication: accept messages only from registered fleet agents.
    // The shared Bearer token is readable by any sub-agent, so without this
    // check any process with the token could inject messages as an arbitrary
    // sender ("from": "zack" from an external attacker who obtained the token).
    // Server-side validation: the `from` claim must match a known agent on the
    // filesystem (agents/<id>/ directory, or MAIN_AGENT_ID). This is not
    // impersonation-proof between fleet agents (they share the same token) but
    // it closes the "unknown sender" injection path without per-agent secrets.
    //
    // The human OWNER is a legitimate sender too: the dashboard "Messages" page
    // composes with from=OWNER_NAME (resolveOwnerName -> the owner assignee), so
    // without this exemption the operator's own dashboard messages 403 with
    // "unknown agent". The owner is not a fleet agent (no agents/<id>/ dir), so
    // isKnownAgent alone rejects it. Match on the router's normalization to stay
    // symmetric with the other guards above.
    //
    // Neighbouring SYSTEMS are legitimate senders too, on the same reasoning as
    // the owner: they are token-authenticated and only notify an agent, but they
    // have no agents/<id>/ directory. Opt-in via SYSTEM_SENDER_IDS in .env
    // (empty by default). Without this, such a system silently loses its push
    // channel the moment this guard ships -- observed here: an external case
    // manager pushed 4182 messages, then every call 403'd for nine days while
    // its fail-soft caller logged nothing.
    const isOwnerSender = sanitizeAgentIdent(from) === sanitizeAgentIdent(OWNER_NAME)
    // The voice channel is the OWNER speaking, not a fleet agent: it has no
    // agents/<id>/ directory, so isKnownAgent alone would 403 it. It is already
    // device-key gated above, which is a STRONGER check than this one.
    const isVoiceChannelSender = sanitizeAgentIdent(from) === VOICE_CHANNEL_AGENT_ID
    const isSystemSender = SYSTEM_SENDERS.has(sanitizeAgentIdent(from))
    if (!isOwnerSender && !isSystemSender && !isVoiceChannelSender && !isKnownAgent(sanitizeAgentIdent(from))) {
      logger.warn({ from: from.trim(), to: to.trim() }, 'Rejected /api/messages POST from unregistered agent')
      json(res, { error: `unknown agent '${from.trim()}' -- from must be a registered fleet agent id` }, 403)
      return true
    }
    // Qualified to ("peer/agent"): validate at creation time so the sender
    // gets an actionable error NOW instead of a silent 1h abandon. Local
    // (slash-free) recipients are untouched.
    let storedTo = to.trim()
    if (storedTo.includes('/')) {
      const target = parseQualifiedId(storedTo)
      if (!target) {
        json(res, { error: 'Invalid federated address in to (expected "<system>/<agent>")' }, 400)
        return true
      }
      const cfg = getFederationConfig()
      if (!cfg.enabled) {
        json(res, { error: 'Federation is disabled on this system' }, 400)
        return true
      }
      // System ids are case-insensitive (stored lowercase in the config).
      // Normalize the STORED prefix too: the per-peer purge SQL and the
      // bridge's peer lookup key on it, and thread grouping in the UI should
      // not split 'Teodor/x' from 'teodor/x'. The agent segment is the
      // PEER's namespace -- leave its case alone.
      const targetSystem = target.system.toLowerCase()
      if (targetSystem === cfg.systemId) {
        json(res, { error: `'${target.system}' is this system -- address the agent locally as '${target.agent}'` }, 400)
        return true
      }
      if (!cfg.peers.some((p) => p.id === targetSystem)) {
        json(res, { error: `Unknown federation peer '${target.system}'` }, 400)
        return true
      }
      storedTo = formatQualifiedId(targetSystem, target.agent)
    } else if (storedTo.includes(':')) {
      // A colon-form 'to' ("federation:teodor:teodor", copied from an
      // <untrusted source> attribute) is NOT a valid address: it has no '/',
      // so it would be treated as a LOCAL recipient, never match a session,
      // and silently sit pending until the 1h abandon window. Reject it now
      // with the correct form. Safe: sanitizeAgentIdent strips ':', so no
      // legitimate local agent id can contain one, and the channel
      // coordinator inserts directly into the DB, bypassing this endpoint.
      json(res, { error: 'Invalid recipient: use "<system>/<agent>" (slash) for a federated address, not the "federation:x:y" source form' }, 400)
      return true
    } else {
      // LOKALIS CIMZETT ELLENORZESE (kartya 4689f10b). A `from` ot kapun megy at ebben a
      // fajlban; a slash-mentes `to` EDDIG EGYIKEN SEM -- a komment fent ki is mondta, hogy
      // "Local (slash-free) recipients are untouched". Kovetkezmeny: egy ELGEPELT agens-nev
      // 200-at es `pending`-et kap, majd ~1 ora mulva az elhagyasi ablakban bukik el. A kuldo
      // addig azt hiszi, hogy sorban all -- es a lap sajat szabalya szerint a `pending` az az
      // allapot, amire KIFEJEZETTEN azt mondjuk, hogy NE kuldd ujra.
      //
      // MERVE 2026-09-03, a teljes `agent_messages` tablan: 14 kulonbozo cimzettbol 7 valodi
      // flotta-agens, a masik 7 kozul 6 szandekos proba -- es MIND A HAT `failed`. Vagyis ez a
      // kapu a mert forgalombol semmit nem zart volna el, amit valaha kezbesitettunk.
      //
      // A HETEDIK a `system` (EGY uzenet, 2026-08-17, `done`): egy agens valasza egy
      // system-uzenetre. A `system` 846 uzenetet KULDOTT, de azok KOZVETLENUL a DB-be irodnak
      // (`src/db.ts`), nem ezen a vegponton -- tehat ez a kapu a tetlen-ort nem erinti. A
      // szimmetria kedveert megis atengedjuk azt, amit a `from`-oldal is: OWNER es SYSTEM_SENDERS.
      //
      // A KIVETELEK PONTOSAN A `from`-GUARD KIVETELEI, es szandekosan: ket iranyban kulonbozo
      // szabaly ugyanarra a nevre kesobb megmagyarazhatatlan.
      const toIdent = sanitizeAgentIdent(storedTo)
      const isOwnerRecipient = toIdent === sanitizeAgentIdent(OWNER_NAME)
      const isSystemRecipient = SYSTEM_SENDERS.has(toIdent)
      if (!isOwnerRecipient && !isSystemRecipient && !isKnownAgent(toIdent)) {
        // A HIBAUZENET SOROLJA FEL A LEHETSEGES CIMZETTEKET. Egy "unknown agent" onmagaban
        // ugyanolyan nema, mint a hallgatas volt: a leggyakoribb ok egy ELIRAS, es az elirast
        // a helyes nevek listaja javitja, nem a tenye.
        // `listAllAgentNames` es NEM `listAgentNames`: a REJTETT agens is ervenyes cimzett
        // (`isKnownAgent` elfogadja), tehat a lathato lista KEVESEBB nevet sorolna fel, mint
        // amennyit a kapu atenged -- egy hibauzenet, ami ellentmond a sajat kapujanak.
        // A MAIN_AGENT_ID kulon jon: az `agents/`-en KIVUL el, de elsoosztalyu cimzett.
        const known = [MAIN_AGENT_ID, ...listAllAgentNames()].sort().join(', ')
        logger.warn({ from: from.trim(), to: storedTo }, 'Rejected /api/messages POST to unknown recipient')
        json(res, {
          error: `unknown recipient '${storedTo}' -- to must be a registered fleet agent id`
            + (known ? ` (known: ${known})` : ''),
        }, 400)
        return true
      }
    }
    // Unknown LOCAL recipient (UNKNOWNTO924): reject at once.
    // Measured: a literal 'PLACEHOLDER' recipient (x3) and an '<agent>_placeholder' one
    // were accepted with 200 and only turned 'failed' after the ~65 min retry
    // window, so the sender believed they had been delivered. In the last 30
    // days these were the ONLY non-agent recipients. A registered agent that is
    // merely not running is a different case and keeps the retry path below.
    if (!storedTo.includes('/') && !isKnownAgent(sanitizeAgentIdent(storedTo))) {
      logger.warn({ from: from.trim(), to: storedTo }, 'Rejected /api/messages POST to an unregistered recipient')
      json(res, { error: `unknown recipient '${storedTo}' -- to must be a registered fleet agent id (or "<system>/<agent>" for federation)` }, 400)
      return true
    }
    // Code-side enforcement of the kanban-ref convention: rewrite any
    // `#<hex8>` token that maps to a real kanban_cards row into its
    // human-facing `#<seq>` form before persistence, so the dashboard and
    // every downstream consumer sees the canonical reference even when a
    // sub-agent forgets the CLAUDE.md rule (#75 Cuzcoo dispatch).
    // HBORACSUSZAS908: the digest header clock is machine-stamped at
    // persistence -- an agent-typed hour drifts forward as its session fills
    // (measured 0,0,0,0,0,+1h,+3h on 2026-09-08) and the digest is the surface
    // the whole fleet reads time from. Same code-side-enforcement pattern as
    // normalizeKanbanRefs below.
    const normalizedContent = normalizeKanbanRefs(stampHeartbeatHeader(content.trim()), getKanbanSeqByIdPrefix)
    // Card 06f062e4: optional attributability tag, self-declared like `from`
    // itself -- capped short so it stays a label, not a second content field.
    const trimmedOriginNote = origin_note?.trim().slice(0, 120) || null
    const msg = createAgentMessage(from.trim(), storedTo, normalizedContent, trimmedOriginNote)
    // Backpressure, returned WITH the id rather than behind a second call:
    // `{"id":N,"status":"pending"}` alone reads as "sent", and on a busy
    // recipient it can be 80 minutes from true. See getRecipientQueueState for
    // the measurement this came from. Federated recipients are skipped -- their
    // queue lives on the peer, so any number we computed here would be a local
    // artefact, and a wrong number is worse than none.
    const queue = isQualifiedId(storedTo) ? undefined : getRecipientQueueState(storedTo)
    // IS THE RECIPIENT EVEN THERE -- card bbb8557c. The depth on its own is
    // ambiguous: the same "4" means "they are working through a backlog, wait"
    // and "nobody is listening, all four will be abandoned in an hour", and the
    // sender's next move is the opposite in the two cases. Asked here, once,
    // for the one agent this message is addressed to; the router already makes
    // the same call per tick, so this is not a new class of cost. The SAME
    // reading feeds upstream's stopped-recipient warning below, so the two
    // signals in one response cannot disagree about one probe.
    const runState = queue ? agentRunState(storedTo) : undefined
    // A fougynok `<nev>-channels`-ben fut, nem `agent-<nev>`-ben, tehat az
    // agentRunState() rá MINDIG 'stopped'-ot ad. Ugyanezt a kiveteltt kezeli a
    // model-fallback-runner:100 es az auto-restart-runner:120 is -- ez a
    // HARMADIK hivo, ami kimaradt belole. (Upstream MSGWARN908 ugyanezt merte.)
    const pullModel = isPullModelRecipient(storedTo, MAIN_AGENT_ID)
      || sanitizeAgentIdent(storedTo) === sanitizeAgentIdent(MAIN_AGENT_ID)
    const advice = queue && runState
      ? adviseSender(queue, runState, Math.round(MESSAGE_ABANDON_WINDOW_MS / 60000), pullModel)
      : undefined
    logger.info(
      {
        id: msg.id, from: msg.from_agent, to: msg.to_agent, originNote: msg.origin_note,
        queueDepth: queue?.queueDepth, recipientPresence: advice?.presence,
      },
      'Agent message created',
    )
    const respBody: Record<string, unknown> = queue ? { ...msg, queue: { ...queue, ...advice } } : { ...msg }
    // A LOCAL recipient that is not running never receives this (upstream): the
    // router retries for a while and then abandons it, and the failure notice goes
    // to the MAIN agent, not to the sender. A non-breaking warning field rather
    // than a status change, so existing callers keep working. The main agent is
    // exempt (pull model, MSGWARN908): the warning was always false for it, and on
    // 2026-09-08 the false "not running" state reached the owner as a system-down
    // report.
    if (queue && runState === 'stopped' && !pullModel) {
      logger.warn({ id: msg.id, to: msg.to_agent }, 'Agent message queued for a STOPPED agent -- likely to be abandoned')
      respBody.targetRunning = false
      respBody.warning = `'${msg.to_agent}' nem fut -- indítsd el (POST /api/agents/${msg.to_agent}/start), várd meg amíg feláll, és küldd újra. Egy leállított ügynöknek küldött üzenet nem várakozik, hanem elveszik.`
    }
    // Warn-only homoglyph check (upstream, 2026-09-14) -- same contract as
    // memories/daily-log/cases. This channel carried 442 messages in a single day
    // on 2026-09-11, and one Cyrillic letter inside a client name or an id makes
    // every later `content LIKE` probe return zero. Warn, never block: the message
    // is already created above. Carried IN ADDITION to the fields above -- the
    // upstream shape returned early on the stopped-recipient branch and so dropped
    // this warning exactly when two things were wrong at once.
    const homoglyphs = detectHomoglyphs(normalizedContent)
    if (homoglyphs.length > 0) {
      const warning = formatHomoglyphWarning(homoglyphs)
      logger.warn({ id: msg.id, from: msg.from_agent, to: msg.to_agent }, `agent message created with ${warning}`)
      respBody.homoglyph_warning = warning
    }
    json(res, respBody)
    return true
  }

  // Sidebar threads: one row per conversation peer (system agents excluded),
  // each with its count + most-recent message, recency computed per-peer.
  if (path === '/api/messages/threads' && method === 'GET') {
    json(res, getAgentConversationThreads())
    return true
  }

  // Backlog per agent: count + how long the oldest has been waiting. Cheap
  // enough to curl on a schedule; the point is that a growing queue behind a
  // busy agent becomes visible BEFORE someone mistakes it for lost messages.
  if (path === '/api/messages/backlog' && method === 'GET') {
    // Ugyanaz a kikotes, mint a /api/messages-en es a /api/kanban-on: ismeretlen param -> HANGOS
    // 400, szigoru halmaz, alias nelkul. A vegpont eddig NEMAN eldobta az `agent=`-et, tehat a
    // teljes flotta backlogjat adta vissza -- tobbet, mint amit kertek, ami a dragabb irany.
    const KNOWN_PARAMS = new Set(['agent', 'assignee'])
    const unknown = [...url.searchParams.keys()].filter((k) => !KNOWN_PARAMS.has(k))
    if (unknown.length) {
      json(res, {
        error: 'unknown query parameter',
        unknown,
        known: [...KNOWN_PARAMS],
        hint: 'a backlog szurese "agent" (vagy "assignee"); parameter nelkul a TELJES flotta jon',
      }, 400)
      return true
    }
    const agent = url.searchParams.get('agent') ?? url.searchParams.get('assignee') ?? undefined
    json(res, getPendingBacklogByAgent(agent))
    return true
  }

  if (path === '/api/messages' && method === 'GET') {
    // UGYANAZ AZ OR, MINT A /api/kanban-on (kartya cf85d765) -- es ez a vegpont
    // MEG DRAGABBAN nyelte el a hibat.
    //
    // A LELET, 2026-08-23 18:3x: computress egy valodi vizsgalatban a
    // `?to=marveen&limit=200` hivast hasznalta, es 200 sort kapott 200-as
    // valasszal. A `to` NEM SZURO -- a vegpont az `agent`-et olvassa --, tehat
    // a GLOBALIS utolso 200 jott vissza. A belole szamolt "harom uzenet vart
    // 60 percnel tovabb" tehat helyes szam volt egy MASIK populaciora: a harom
    // kozul EGYIK SEM marveennek szolt (friday->didi, marveen->dexter x2).
    // Nem tevedes volt: a vegpont valaszolt egy kerdesre, amit nem tettek fel neki.
    //
    // POZITIV KONTROLL, ami ezt kimondta: `?to=marveen` es
    // `?to=NINCS_ILYEN_AGENS` BETU SZERINT AZONOS id-listat adott.
    const ismeretlenM = unknownQueryParams(url, MESSAGES_PARAMS)
    if (ismeretlenM.length) {
      json(res, unknownQueryParamError(ismeretlenM, MESSAGES_PARAMS,
        'A cimzett szurese: `agent=<nev>` (a beszelgetes MINDKET iranya). `to=` nem letezik.'), 400)
      return true
    }
    const agent = url.searchParams.get('agent') || ''
    const status = url.searchParams.get('status') || ''
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)
    const beforeRaw = url.searchParams.get('before')
    const before = beforeRaw !== null ? parseInt(beforeRaw, 10) : undefined

    let messages: AgentMessage[]
    if (status === 'pending' && agent) {
      messages = getPendingMessages(agent)
    } else if (status === 'pending') {
      messages = getPendingMessages()
    } else if (agent) {
      // SQL-filtered to THIS agent's last N (+ before-cursor pagination), not
      // global-last-N-then-JS-filter which starved rarely-active threads.
      messages = getAgentConversation(agent, limit, Number.isFinite(before as number) ? before : undefined)
    } else {
      messages = listAgentMessages(limit)
    }

    jsonMaybeGzip(req, res, attachFreshness(messages))
    return true
  }

  const msgUpdateMatch = path.match(/^\/api\/messages\/(\d+)$/)
  // EGY uzenet a TELJES tartalmaval -- ezt nevezi meg a levagott ertesites markere.
  // A lista-vegpont csak agens szerint kerdezheto, tehat egy `msg N` hivatkozast eddig
  // nem lehetett egy lepesben kovetni.
  if (msgUpdateMatch && method === 'GET') {
    const one = getAgentMessage(parseInt(msgUpdateMatch[1], 10))
    if (!one) { json(res, { error: 'Message not found' }, 404); return true }
    json(res, attachFreshness([one])[0])
    return true
  }
  if (msgUpdateMatch && method === 'PUT') {
    const id = parseInt(msgUpdateMatch[1], 10)
    const body = await readBody(req)
    const { status: newStatus, result, notify } = JSON.parse(body.toString()) as
      { status: string; result?: string; notify?: boolean }

    // `notify` lets the CLOSER decide whether the reverse [Eredmény] message is
    // worth an agent turn at the other end. The two cases share this one code
    // path and cannot be told apart from here:
    //   - closing a DELEGATED task   -> the delegator is waiting, the ack IS the result;
    //   - closing an INCOMING report -> the sender already knows it sent it, and the ack
    //     (typically the 52-char "(nincs eredmény)" form) only lengthens the very queue
    //     whose delay made the report late. Measured on a live install: several such acks
    //     sat queued behind an agent whose delivery was already lagging, so closing the
    //     reports made the queue that the reports arrive in longer still.
    // Absent (or null) keeps today's behavior, so no existing caller changes.
    // Rejected BEFORE the status write, not coerced: a truthy `"false"` string would send
    // exactly the notification the caller asked to skip, and a half-applied close (status
    // written, unwanted ack sent) is worse than an actionable error the caller can retry
    // -- the same reason the GET list handler rejects unknown query params.
    if (notify !== undefined && notify !== null && typeof notify !== 'boolean') {
      json(res, {
        error: 'notify must be a boolean',
        hint: 'omit it for the default (notify the sender), or send JSON true/false -- not a string',
      }, 400)
      return true
    }

    let ok = false
    if (newStatus === 'done') ok = markMessageDone(id, result)
    else if (newStatus === 'failed') ok = markMessageFailed(id, result)

    if (ok) {
      const done = getAgentMessage(id)
      // Close the OTel span now that the message has a terminal status.
      if (done?.trace_id && done?.span_id) {
        closeOtelSpan(done.trace_id, done.span_id, Date.now(), newStatus === 'done' ? 'ok' : 'error')
      }
      // Notify the delegator: create a reverse message from executor → delegator so
      // they learn the result without polling. See shouldNotifyDelegator for which
      // senders are skipped and why.
      // `notify: false` suppresses it; `notify: true` is only the default spelled out --
      // it does NOT override shouldNotifyDelegator, whose guards stop undeliverable and
      // ping-pong acks, not merely expensive ones.
      if (done && notify !== false && shouldNotifyDelegator(done.from_agent, done.to_agent, done.content)) {
        // A vagas NE legyen nema, ES legyen KOVETHETO: lasd resultSummary().
        const summary = resultSummary(id, result)
        createAgentMessage(
          done.to_agent,
          done.from_agent,
          `${COMPLETION_REPORT_PREFIX} msg_id:${id} status:${newStatus}\n\n${summary}`,
        )
      }
      json(res, { ok: true }); return true
    }
    json(res, { error: 'Message not found or invalid status' }, 404)
    return true
  }

  return false
}
