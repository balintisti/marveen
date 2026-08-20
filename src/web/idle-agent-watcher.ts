import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../logger.js'
import { listAgentNames, agentDir, readAgentRemoteHost } from './agent-config.js'
import { isAgentRunning, capturePane } from './agent-process.js'
import { resolveAgentSession } from './channel-mcp-reconnect.js'
import { sendAlert } from './channel-monitor.js'
import { detectPaneState } from '../pane-state.js'
import { getPendingMessages, listKanbanCards, getDb } from '../db.js'
import {
  decideIdleAlert,
  parseWorkCheck,
  countDeclaredWork,
  NO_IDLE_STATE,
  type IdleAgentState,
  type IdleAgentThresholds,
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

function commentAuthorsByCard(): Map<string, Set<string>> {
  const rows = getDb()
    .prepare('SELECT card_id, author FROM kanban_comments')
    .all() as { card_id: string; author: string }[]
  const map = new Map<string, Set<string>>()
  for (const row of rows) {
    let set = map.get(row.card_id)
    if (!set) {
      set = new Set()
      map.set(row.card_id, set)
    }
    set.add(row.author)
  }
  return map
}

function paneIsIdle(agent: string): boolean {
  const session = resolveAgentSession(agent)
  if (!session) return false
  const pane = capturePane(session, readAgentRemoteHost(agent))
  if (!pane) return false
  return detectPaneState(pane) === 'idle'
}

function tick(): void {
  try {
    const agents = listAgentNames()
    if (agents.length === 0) return

    // Loaded once per tick, not once per agent: the board is the same for everyone,
    // and re-reading it per agent turned a cheap tick into N table scans.
    const cards = listKanbanCards()
    const authors = commentAuthorsByCard()
    const now = Date.now()

    for (const agent of agents) {
      const running = isAgentRunning(agent)
      const check = parseWorkCheck(readWorkCheckRaw(agent))
      const ownWorkCount = check ? countDeclaredWork(check, agent, cards, authors) : null

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

      const minutes = Math.round(decision.idleForMs / 60_000)
      sendAlert(
        `[tetlen-or] A(z) "${agent}" ${minutes} perce tetlen, kozben ${decision.workCount} tetel var rá. ` +
          `A panelje egeszseges es nincs kezbesitetlen uzenete -- tehat nem elakadt, hanem all. ` +
          `Adj neki munkat, vagy ha tenyleg nincs mit tennie, az a workcheck.json-jaban latszodjon.`,
      )
      logger.warn(
        { idleGuard: true, agent, workCount: decision.workCount, idleForMs: decision.idleForMs },
        'idle guard: agent is idle with work waiting',
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

export function _resetIdleStateForTest(): void {
  watchState.clear()
}
