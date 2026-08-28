import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../logger.js'
import { MAIN_AGENT_ID } from '../config.js'
import { listAgentNames, agentDir, readAgentRemoteHost } from './agent-config.js'
import { isAgentRunning, capturePane } from './agent-process.js'
import { resolveAgentSession } from './channel-mcp-reconnect.js'
import { sendAlert } from './channel-monitor.js'
import { busyEvidence, detectPaneState } from '../pane-state.js'
import { getPendingMessages, listKanbanCards, getDb, createAgentMessage, saveIdleGuardState, loadIdleGuardState } from '../db.js'
import {
  decideIdleAlert,
  parseWorkCheck,
  countDeclaredWork,
  selectDeclaredWork,
  buildNoWorkNotice,
  buildWakeMessage,
  buildFleetAlert,
  type FleetAlert,
  NO_IDLE_STATE,
  type IdleAgentState,
  type IdleAgentThresholds,
  type WorkCheck,
} from '../idle-agent.js'

// The guard for the agent that HAS work and is not doing it.
//
// Every other watcher in this directory hunts the STUCK agent, and
// stuck-input-watcher explicitly skips a pane sitting at an idle prompt (that is the
// healthy shape for its purposes). Correct for them, and it left a real hole: on
// 2026-08-20 one agent stood for 126 minutes and later the same day for another 65,
// with a perfectly healthy pane and 66 cards waiting. Nothing looked wrong anywhere,
// because nothing was wrong -- it just was not working.
//
// The decision logic lives in ../idle-agent.ts and is unit-tested without tmux or a
// database; this module is only I/O and the per-agent state map, mirroring
// stuck-input-watcher.ts.
//
// The declaration file is agents/<name>/workcheck.json, e.g. {"kind":"none"} for an
// agent with no queue in this system. See idle-agent.ts for why an absent file is
// reported as a config gap rather than quietly treated as either answer.

const THRESHOLDS: IdleAgentThresholds = {
  // Long enough that the gap between two turns, a compaction, or a slow tool call
  // never trips it; short enough that a stalled hour cannot pass unnoticed.
  sustainedMs: 12 * 60_000,
  // A genuinely parked agent is worth one reminder every half hour, not every tick.
  realertMs: 30 * 60_000,
  // The router injects into an IDLE pane almost immediately, so a wake that is going to
  // work has worked long before this. What this window really buys is the difference
  // between "not yet" and "did not take" -- and only the second is worth a human.
  wakeGraceMs: 15 * 60_000,
  // Floor between two wakes of the same agent. An agent finishing short turns ends a
  // spell every time it goes busy, so without this the wake would follow every turn.
  wakeCooldownMs: 30 * 60_000,
}

const INITIAL_DELAY_MS = 90_000
const INTERVAL_MS = 3 * 60_000

// HOW OLD A STORED `idleSinceMs` MAY BE AND STILL BE BELIEVED (card 60060415).
// Two ticks. A restart takes seconds, so the row is fresh and the 12-minute
// sustained window CONTINUES across it -- which is the whole point. An hour of
// downtime leaves a stale row, and then the agent starts a fresh window rather
// than inheriting an idle span nobody observed.
// The suppressors (`lastAlertAt`, `lastWakeAt`) are NOT age-limited: they can
// only delay an alert, never cause one. See loadIdleGuardState.
const MAX_IDLE_AGE_MS = 2 * INTERVAL_MS

// In-process cache only. The truth lives in the database (card 60060415): this
// Map used to BE the state, so every deploy erased it -- and two of that day's
// watcher processes lived 8m12s and 2m28s, both under `sustainedMs`. A guard
// that cannot fire during a deploy sequence, and says nothing about it.
const watchState = new Map<string, IdleAgentState>()

function readWorkCheckRaw(agent: string): string | null {
  try {
    return readFileSync(join(agentDir(agent), 'workcheck.json'), 'utf8')
  } catch {
    return null
  }
}

/** card id -> (author -> the time of that author's LATEST comment on the card).
 *
 *  The timestamp is the point: a reviewer's queue asks whether their review still
 *  covers the card's current state, not whether one ever happened. Without the time
 *  the first comment retires a card forever -- and the guard then falls silent exactly
 *  when the reviewer has caught up. */
function lastCommentAtByCard(): Map<string, Map<string, number>> {
  const rows = getDb()
    .prepare('SELECT card_id, author, MAX(created_at) AS at FROM kanban_comments GROUP BY card_id, author')
    .all() as { card_id: string; author: string; at: number }[]
  const map = new Map<string, Map<string, number>>()
  for (const row of rows) {
    let inner = map.get(row.card_id)
    if (!inner) {
      inner = new Map()
      map.set(row.card_id, inner)
    }
    inner.set(row.author, row.at)
  }
  return map
}

/** null = could not tell (no session, capture failed, unknown pane). NOT the same as
 *  "busy". Folding an unreadable pane into "busy" silently switches the guard off for
 *  that agent -- a failure that looks exactly like health, which is the one shape this
 *  whole guard exists to avoid. Didi spotted it on my own code; the rule "not measured
 *  is not passing" applies here too, and here it means: say so, do not assume. */
// EXPORTALVA A BEKOTES MERHETOSEGEERT (kartya b5bff340, didi merese 2026-08-27).
// A ket VEG kulon-kulon vedve volt -- a `busyEvidence` a pane-state.test.ts-ben, a
// dontesi oldal az idle-agent.test.ts-ben, KEZZEL adott `staleCounterOnly: true`-val --,
// a KOZTUK LEVO BEKOTES viszont sehol. Merve: a `staleCounterOnly` szamitasat elvagva
// mind a 3803 teszt ZOLD maradt.
// Ez nem viselkedes-valtozas: csak lathatova teszi a fuggvenyt a tesztnek.
export function readPane(agent: string): { idle: boolean | null; staleCounterOnly: boolean } {
  const session = resolveAgentSession(agent)
  if (!session) return { idle: null, staleCounterOnly: false }
  const pane = capturePane(session, readAgentRemoteHost(agent))
  if (!pane) return { idle: null, staleCounterOnly: false }
  const state = detectPaneState(pane)
  if (state === 'unknown') return { idle: null, staleCounterOnly: false }
  return { idle: state === 'idle', staleCounterOnly: busyEvidence(pane) === 'counter' }
}

// EXPORTALVA A NAPLOZAS MERHETOSEGEERT (kartya 60060415). A `readPane`-nel ugyanez a
// dontes all: a kartya allitasa az, hogy MINDEN dontes naplozodik -- ezt csak ugy lehet
// megmerni, ha a kort le lehet futtatni. Viselkedes nem mozdul, csak lathatosag.
export function tick(): void {
  try {
    const agents = listAgentNames()
    if (agents.length === 0) return

    // Loaded once per tick, not once per agent: the board is the same for everyone,
    // and re-reading it per agent turned a cheap tick into N table scans.
    const cards = listKanbanCards()
    const comments = lastCommentAtByCard()
    const now = Date.now()

    // Alerts are COLLECTED here and sent once at the end of the sweep. Sending inside
    // the loop turned one situation ("the fleet is standing") into one Telegram message
    // per agent -- eight of them between 04:58 and 05:28 on 2026-08-22, while the owner
    // slept. Per-agent rate limiting cannot fix that: the limit is per agent, so more
    // agents means more copies of the same news.
    const alerts: FleetAlert[] = []

    for (const agent of agents) {
      const running = isAgentRunning(agent)
      const check = parseWorkCheck(readWorkCheckRaw(agent))
      // MAIN_AGENT_ID is passed so the coordinator's own comments are not mistaken for
      // a reviewer's unanswered finding -- see selectDeclaredWork for the measurement.
      // nowSec: the due_date column is in epoch SECONDS while this loop's `now` is in
      // milliseconds. Passing the wrong unit would make every future date look long past
      // (or never reached) -- silently, since the filter would simply never fire.
      const nowSec = Math.floor(now / 1000)
      const ownWorkCount = check ? countDeclaredWork(check, agent, cards, comments, MAIN_AGENT_ID, nowSec) : null

      // One capture per agent per tick: the evidence strength comes from the same read
      // as the idle verdict, so the two can never disagree about what was on screen.
      const paneRead = running
        ? readPane(agent)
        : { idle: false as boolean | null, staleCounterOnly: false }

      // Memory first, then the database: after a restart the Map is empty and the
      // row carries what this agent was doing before we deployed.
      let state = watchState.get(agent)
      if (!state) {
        const stored = loadIdleGuardState(agent, MAX_IDLE_AGE_MS, now)
        state = stored
          ? { idleSinceMs: stored.idleSinceMs, lastAlertAt: stored.lastAlertAt, lastWakeAt: stored.lastWakeAt }
          : NO_IDLE_STATE
      }
      const { decision, next } = decideIdleAlert(
        {
          agent,
          running,
          // Only pay for the tmux capture when the cheap checks have not already
          // settled it -- a running fleet ticks this every three minutes.
          paneIdle: running ? paneRead.idle : false,
          staleCounterOnly: running ? paneRead.staleCounterOnly : false,
          pendingMessages: running ? getPendingMessages(agent).length : 0,
          ownWorkCount,
          workCheckKind: (check as WorkCheck | null)?.kind ?? null,
        },
        state,
        THRESHOLDS,
        now,
      )
      watchState.set(agent, next)
      try {
        saveIdleGuardState(agent, next, now)
      } catch (err) {
        // Never fatal to the sweep: a guard that stops guarding because it could
        // not write a row would trade a diagnosability problem for a real one.
        logger.warn({ err, agent }, 'idle guard: could not persist state')
      }

      // EVERY DECISION IS LOGGED, INCLUDING THE EIGHT THAT DO NOTHING (card 60060415).
      //
      // This line is unconditional and stands BEFORE the branches on purpose. The
      // eight "nothing to do" reasons used to fall off the `continue` below with no
      // output at all, and that is what made last night undiagnosable: the guard sent
      // 10-12 messages about ONE agent while three others stood five hours, and
      // nothing recorded whether their chain reached a verdict or stopped earlier.
      //
      // WHY IT SPREADS `decision` INSTEAD OF NAMING REASONS: a reason added later is
      // logged without anyone remembering to come back here. A list would have to be
      // maintained, and the failure mode of a stale list is exactly this silence.
      //
      // WHY `debug` AND NOT `info` (marveen's number, and it is the argument that
      // belongs beside every "let us log everything"): six agents every three minutes
      // is 120 lines an hour. At info that buries the real signals.
      logger.debug(
        {
          idleGuard: true,
          agent,
          ...decision,
          idleForMs: next.idleSinceMs !== null ? now - next.idleSinceMs : null,
          sinceLastWakeMs: state.lastWakeAt !== null ? now - state.lastWakeAt : null,
          sinceLastAlertMs: state.lastAlertAt !== null ? now - state.lastAlertAt : null,
          pendingMessages: running ? getPendingMessages(agent).length : 0,
          ownWorkCount,
        },
        `idle guard: ${agent} -> ${decision.reason}`,
      )

      if (!decision.alert) continue

      if (decision.reason === 'pane-unreadable') {
        alerts.push({ kind: 'pane-unreadable', agent })
        logger.warn({ idleGuard: true, agent }, 'idle guard: pane unreadable, guard blind for this agent')
        continue
      }

      if (decision.reason === 'no-work-check-declared') {
        alerts.push({ kind: 'no-work-check', agent })
        logger.warn({ idleGuard: true, agent }, 'idle guard: agent has no declared work check')
        continue
      }

      if (decision.reason === 'idle-no-work') {
        const minutes = Math.round(decision.idleForMs / 60_000)
        try {
          createAgentMessage('system', MAIN_AGENT_ID, buildNoWorkNotice(agent, minutes))
          logger.info(
            { idleGuard: true, agent, idleForMs: decision.idleForMs },
            'idle guard: agent idle with nothing assigned -- told the coordinator',
          )
        } catch (err) {
          logger.warn({ err, agent }, 'idle guard: could not tell the coordinator about an unassigned idle agent')
        }
        continue
      }

      if (decision.reason === 'wake-agent') {
        const items = selectDeclaredWork(check as WorkCheck, agent, cards, comments, MAIN_AGENT_ID, nowSec)
        const minutes = Math.round(decision.idleForMs / 60_000)
        try {
          createAgentMessage('system', agent, buildWakeMessage(agent, minutes, decision.workCount, items, (check as WorkCheck).kind))
          logger.info(
            { idleGuard: true, agent, workCount: decision.workCount, idleForMs: decision.idleForMs },
            'idle guard: woke the agent (stage 1) -- no human told yet',
          )
        } catch (err) {
          // A failed enqueue must not look like a successful wake: stage 2 would then
          // wait out its grace window for a message that was never sent.
          logger.warn({ err, agent }, 'idle guard: could not enqueue the wake message')
          alerts.push({
            kind: 'wake-enqueue-failed',
            agent,
            minutes,
            workCount: decision.workCount,
          })
        }
        continue
      }

      const minutes = Math.round(decision.idleForMs / 60_000)
      alerts.push({ kind: 'still-idle', agent, minutes, workCount: decision.workCount })
      logger.warn(
        { idleGuard: true, agent, workCount: decision.workCount, idleForMs: decision.idleForMs },
        'idle guard: agent still idle AFTER a wake (stage 2) -- human alerted',
      )
    }

    // One message for the whole sweep, or none at all.
    if (alerts.length > 0) sendAlert(buildFleetAlert(alerts))
  } catch (err) {
    logger.warn({ err }, 'idle guard: tick error')
  }
}

export function startIdleAgentWatcher(): NodeJS.Timeout {
  setTimeout(() => { tick() }, INITIAL_DELAY_MS).unref()
  return setInterval(() => { tick() }, INTERVAL_MS)
}

