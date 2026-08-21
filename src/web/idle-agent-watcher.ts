import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../logger.js'
import { MAIN_AGENT_ID } from '../config.js'
import { listAgentNames, agentDir, readAgentRemoteHost } from './agent-config.js'
import { isAgentRunning, capturePane } from './agent-process.js'
import { resolveAgentSession } from './channel-mcp-reconnect.js'
import { sendAlert } from './channel-monitor.js'
import { detectPaneState } from '../pane-state.js'
import { getPendingMessages, listKanbanCards, getDb, createAgentMessage } from '../db.js'
import {
  decideIdleAlert,
  parseWorkCheck,
  countDeclaredWork,
  selectDeclaredWork,
  buildWakeMessage,
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
function paneIsIdle(agent: string): boolean | null {
  const session = resolveAgentSession(agent)
  if (!session) return null
  const pane = capturePane(session, readAgentRemoteHost(agent))
  if (!pane) return null
  const state = detectPaneState(pane)
  if (state === 'unknown') return null
  return state === 'idle'
}

function tick(): void {
  try {
    const agents = listAgentNames()
    if (agents.length === 0) return

    // Loaded once per tick, not once per agent: the board is the same for everyone,
    // and re-reading it per agent turned a cheap tick into N table scans.
    const cards = listKanbanCards()
    const comments = lastCommentAtByCard()
    const now = Date.now()

    for (const agent of agents) {
      const running = isAgentRunning(agent)
      const check = parseWorkCheck(readWorkCheckRaw(agent))
      // MAIN_AGENT_ID is passed so the coordinator's own comments are not mistaken for
      // a reviewer's unanswered finding -- see selectDeclaredWork for the measurement.
      const ownWorkCount = check ? countDeclaredWork(check, agent, cards, comments, MAIN_AGENT_ID) : null

      const state = watchState.get(agent) ?? NO_IDLE_STATE
      const { decision, next } = decideIdleAlert(
        {
          agent,
          running,
          // Only pay for the tmux capture when the cheap checks have not already
          // settled it -- a running fleet ticks this every three minutes.
          paneIdle: running ? paneIsIdle(agent) : false,
          pendingMessages: running ? getPendingMessages(agent).length : 0,
          ownWorkCount,
        },
        state,
        THRESHOLDS,
        now,
      )
      watchState.set(agent, next)

      if (!decision.alert) continue

      if (decision.reason === 'pane-unreadable') {
        sendAlert(
          `[tetlen-or] A(z) "${agent}" panelje NEM OLVASHATO (nincs session, vagy a capture elszallt), ` +
            `ezert nem tudom megmondani, dolgozik-e. Ez NEM azt jelenti, hogy dolgozik -- azt jelenti, ` +
            `hogy az or VAK erre az agensre. Nezd meg a tmux session-jet.`,
        )
        logger.warn({ idleGuard: true, agent }, 'idle guard: pane unreadable, guard blind for this agent')
        continue
      }

      if (decision.reason === 'no-work-check-declared') {
        sendAlert(
          `[tetlen-or] A(z) "${agent}" agensnek NINCS workcheck.json-ja, ezert nem tudom megmondani, ` +
            `van-e dolga. Ez konfiguracios hiany, NEM az agens hibaja -- amig nincs, a tetlenseg-or ` +
            `rá nem mukodik. Fajl: agents/${agent}/workcheck.json, tartalom pl. {"kind":"none"} ha ` +
            `ennek az agensnek nincs sora ebben a rendszerben.`,
        )
        logger.warn({ idleGuard: true, agent }, 'idle guard: agent has no declared work check')
        continue
      }

      if (decision.reason === 'wake-agent') {
        const items = selectDeclaredWork(check as WorkCheck, agent, cards, comments, MAIN_AGENT_ID)
        const minutes = Math.round(decision.idleForMs / 60_000)
        try {
          createAgentMessage('system', agent, buildWakeMessage(agent, minutes, decision.workCount, items))
          logger.info(
            { idleGuard: true, agent, workCount: decision.workCount, idleForMs: decision.idleForMs },
            'idle guard: woke the agent (stage 1) -- no human told yet',
          )
        } catch (err) {
          // A failed enqueue must not look like a successful wake: stage 2 would then
          // wait out its grace window for a message that was never sent.
          logger.warn({ err, agent }, 'idle guard: could not enqueue the wake message')
          sendAlert(
            `[tetlen-or] A(z) "${agent}" ${minutes} perce tetlen, ${decision.workCount} tetellel, ` +
              `es az EBRESZTO UZENETET SEM SIKERULT betenni a soraba. Ez nem tetlenseg-kerdes tobbe, ` +
              `hanem az uzenetsore. Nezd meg kezzel.`,
          )
        }
        continue
      }

      const minutes = Math.round(decision.idleForMs / 60_000)
      sendAlert(
        `[tetlen-or] A(z) "${agent}" ${minutes} perce tetlen, ${decision.workCount} tetellel a soraban, ` +
          `ES MAR FELEBRESZTETTEM -- az ebreszto uzenetet megkapta, megsem mozdult. Ezert szolok: ` +
          `nem az a hir, hogy all valaki, hanem hogy egy ebresztes nem hatott. ` +
          `Nezd meg a panelt (elakadt turn, telitett kontextus), vagy ha tenyleg nincs mit tennie, ` +
          `az a workcheck.json-jaban latszodjon.`,
      )
      logger.warn(
        { idleGuard: true, agent, workCount: decision.workCount, idleForMs: decision.idleForMs },
        'idle guard: agent still idle AFTER a wake (stage 2) -- human alerted',
      )
    }
  } catch (err) {
    logger.warn({ err }, 'idle guard: tick error')
  }
}

export function startIdleAgentWatcher(): NodeJS.Timeout {
  setTimeout(() => { tick() }, INITIAL_DELAY_MS).unref()
  return setInterval(() => { tick() }, INTERVAL_MS)
}

