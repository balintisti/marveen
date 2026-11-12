import { getLastOwnCardEvent, getPendingMessages, listApprovals, listOwnInProgressCardIds } from '../db.js'
import type { CardRestartFacts } from '../context-guard.js'
import { openQuestionIgnoringCommands } from './open-question.js'

// WHAT THE BOARD AND THE QUEUES SAY AT A CARD BOUNDARY (card 00262e3f).
//
// The card-aligned restart restarts an agent WITHOUT asking it for a handoff, on the claim that the
// card it has just moved out of in_progress is the handoff. That claim holds only while nothing else
// lives in the session alone, so everything here is read fail-closed: a probe that throws is a
// blocker with its own words, and a boundary that cannot be read is 'unknown', never "none".
//
// NOT a blocker (marveen's decision, comment 58625): the agent's own open requests. A review request
// stays open until the verdict, so it stood at about half of the boundaries measured; the fresh
// session's first message lists them instead (cardRestartResumePrompt).
//
// The probes are a parameter because the guard runner's tests replace db.js with hand-written
// factories, and because each line below is a decision somebody has to be able to break in a test.

/** A card moved out of in_progress INTO one of these is handed over: the comment on it is the handoff. */
export const CARD_BOUNDARY_TARGETS: readonly string[] = ['testing', 'waiting', 'done']

export interface CardRestartProbes {
  /** The last status event the agent itself recorded since the session started, or null. */
  lastOwnCardEvent(agent: string, sinceSec: number): { card_id: string; from_status: string | null; to_status: string; created_at: number } | null
  ownInProgressCardIds(agent: string): string[]
  /** Rows addressed to the agent that the router has not delivered yet. */
  pendingInboundCount(agent: string): number
  pendingApprovalCount(agent: string): number
  /** The owner wrote on the agent's channel and nothing went out since. */
  openChannelQuestion(agent: string): boolean
}

export const REAL_CARD_RESTART_PROBES: CardRestartProbes = {
  lastOwnCardEvent: (agent, sinceSec) => getLastOwnCardEvent(agent, sinceSec),
  ownInProgressCardIds: agent => listOwnInProgressCardIds(agent),
  pendingInboundCount: agent => getPendingMessages(agent).length,
  pendingApprovalCount: agent => listApprovals({ agent_id: agent, status: 'pending', limit: 500 }).length,
  // null = nothing open; '' = open but unidentifiable, which is still open.
  openChannelQuestion: agent => openQuestionIgnoringCommands(agent) !== null,
}

const CARDS_NAMED = 3

/**
 * `sessionStartSec` undefined (the session's start is not known) gives 'unknown': a move from an
 * EARLIER session would otherwise pass for this one's, and the same card would restart the agent
 * again and again.
 */
export function gatherCardRestartFacts(
  agent: string,
  sessionStartSec: number | undefined,
  probes: CardRestartProbes = REAL_CARD_RESTART_PROBES,
): CardRestartFacts {
  if (sessionStartSec === undefined) return { boundary: 'unknown', blockers: [] }
  let last: ReturnType<CardRestartProbes['lastOwnCardEvent']>
  try {
    last = probes.lastOwnCardEvent(agent, sessionStartSec)
  } catch {
    return { boundary: 'unknown', blockers: [] }
  }
  if (!last || last.from_status !== 'in_progress' || !CARD_BOUNDARY_TARGETS.includes(last.to_status)) {
    return { boundary: null, blockers: [] }
  }

  const blockers: string[] = []
  const probe = (what: string, read: () => string | null): void => {
    try {
      const blocker = read()
      if (blocker) blockers.push(blocker)
    } catch {
      blockers.push(`${what} could not be read`)
    }
  }
  probe('the agent\'s in_progress cards', () => {
    const ids = probes.ownInProgressCardIds(agent)
    if (ids.length === 0) return null
    const more = ids.length > CARDS_NAMED ? ` and ${ids.length - CARDS_NAMED} more` : ''
    return `another own card is in_progress: ${ids.slice(0, CARDS_NAMED).join(', ')}${more}`
  })
  probe('the inbound queue', () => {
    const n = probes.pendingInboundCount(agent)
    return n > 0 ? `${n} inbound message(s) not delivered yet` : null
  })
  probe('the pending approvals', () => {
    const n = probes.pendingApprovalCount(agent)
    return n > 0 ? `${n} approval(s) pending` : null
  })
  probe('the channel', () => (probes.openChannelQuestion(agent) ? 'a channel message is unanswered' : null))

  return { boundary: { cardId: last.card_id, toStatus: last.to_status, movedAtMs: last.created_at * 1000 }, blockers }
}
