// Card 00262e3f: what the board and the queues say at a card boundary, and the three queries under it.
//
// The gatherer is read fail-closed, and each line of it is a decision: a probe that throws is a
// blocker in its own words, an unreadable move is 'unknown', never "no boundary". The queries run
// against a real (in-memory) database: a mocked query says nothing about the SQL.

import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import {
  initDatabase, createKanbanCard, moveKanbanCard, updateKanbanCard, archiveKanbanCard,
  createAgentMessage, markMessageDelivered, markMessageDone, markMessageFailed,
  getLastOwnCardEvent, listOwnInProgressCardIds, listOpenOwnOutbound, closeMessagesWithoutDelivery,
  COMPLETION_REPORT_PREFIX, GATE_ALERT_ORIGIN_NOTE,
} from '../db.js'
import { gatherCardRestartFacts, CARD_BOUNDARY_TARGETS, type CardRestartProbes } from '../web/card-restart-facts.js'
import { projectsDirFor, readFirstToolUseMsAfter } from '../web/active-model.js'

const mkTmp = tmpDirs()
const SINCE = 1_800_000_000
const moved = (to = 'testing', from: string | null = 'in_progress') => ({ card_id: 'c0ffee11', from_status: from, to_status: to, created_at: SINCE + 600 })

function probes(overrides: Partial<CardRestartProbes> = {}): CardRestartProbes {
  return {
    lastOwnCardEvent: () => moved(),
    ownInProgressCardIds: () => [],
    pendingInboundCount: () => 0,
    pendingApprovalCount: () => 0,
    openChannelQuestion: () => false,
    ...overrides,
  }
}
const boom = () => { throw new Error('db is locked') }

describe('gatherCardRestartFacts', () => {
  it('a clean boundary: the card, the target and the time of the move, no blockers', () => {
    expect(gatherCardRestartFacts('computress', SINCE, probes())).toEqual({
      boundary: { cardId: 'c0ffee11', toStatus: 'testing', movedAtMs: (SINCE + 600) * 1000 },
      blockers: [],
    })
  })

  it('every hand-over target is a boundary', () => {
    expect(CARD_BOUNDARY_TARGETS).toEqual(['testing', 'waiting', 'done'])
    for (const to of CARD_BOUNDARY_TARGETS) {
      const f = gatherCardRestartFacts('computress', SINCE, probes({ lastOwnCardEvent: () => moved(to) }))
      expect((f.boundary as { toStatus: string }).toStatus, to).toBe(to)
    }
  })

  it('asks for the agent\'s own events since the session started', () => {
    const seen: unknown[] = []
    gatherCardRestartFacts('computress', SINCE, probes({ lastOwnCardEvent: (a, s) => { seen.push([a, s]); return moved() } }))
    expect(seen).toEqual([['computress', SINCE]])
  })

  it('the last board event is something else: no boundary, and nothing else is asked', () => {
    const notBoundary = [
      null,                                   // no event in this session
      moved('in_progress', 'planned'),        // it picked a card up
      moved('planned'),                       // it put the card back
      moved('testing', 'waiting'),            // a move, but not out of in_progress
      moved('planned', null),                 // it filed a card
    ]
    for (const ev of notBoundary) {
      const f = gatherCardRestartFacts('computress', SINCE, probes({
        lastOwnCardEvent: () => ev, ownInProgressCardIds: boom, pendingInboundCount: boom, pendingApprovalCount: boom, openChannelQuestion: boom,
      }))
      expect(f, JSON.stringify(ev)).toEqual({ boundary: null, blockers: [] })
    }
  })

  it('an unknown session start is UNKNOWN, not "no boundary": an earlier session\'s move must not pass for this one\'s', () => {
    expect(gatherCardRestartFacts('computress', undefined, probes({ lastOwnCardEvent: boom }))).toEqual({ boundary: 'unknown', blockers: [] })
  })

  it('a move that cannot be read is UNKNOWN', () => {
    expect(gatherCardRestartFacts('computress', SINCE, probes({ lastOwnCardEvent: boom }))).toEqual({ boundary: 'unknown', blockers: [] })
  })

  it('each blocker in its own words', () => {
    const one = (o: Partial<CardRestartProbes>) => gatherCardRestartFacts('computress', SINCE, probes(o)).blockers
    expect(one({ ownInProgressCardIds: () => ['aa11'] })).toEqual(['another own card is in_progress: aa11'])
    expect(one({ ownInProgressCardIds: () => ['a', 'b', 'c', 'd', 'e'] })).toEqual(['another own card is in_progress: a, b, c and 2 more'])
    expect(one({ pendingInboundCount: () => 2 })).toEqual(['2 inbound message(s) not delivered yet'])
    expect(one({ pendingApprovalCount: () => 1 })).toEqual(['1 approval(s) pending'])
    expect(one({ openChannelQuestion: () => true })).toEqual(['a channel message is unanswered'])
  })

  it('all of them at once, none hides another', () => {
    const f = gatherCardRestartFacts('computress', SINCE, probes({
      ownInProgressCardIds: () => ['aa11'], pendingInboundCount: () => 1, pendingApprovalCount: () => 1, openChannelQuestion: () => true,
    }))
    expect(f.blockers).toHaveLength(4)
    expect(f.boundary).not.toBeNull()
  })

  it('a probe that throws is a BLOCKER, and the others are still asked', () => {
    const f = gatherCardRestartFacts('computress', SINCE, probes({
      ownInProgressCardIds: boom, pendingInboundCount: boom, pendingApprovalCount: boom, openChannelQuestion: boom,
    }))
    expect(f.blockers).toEqual([
      'the agent\'s in_progress cards could not be read',
      'the inbound queue could not be read',
      'the pending approvals could not be read',
      'the channel could not be read',
    ])
    const mixed = gatherCardRestartFacts('computress', SINCE, probes({ pendingInboundCount: boom, pendingApprovalCount: () => 3 }))
    expect(mixed.blockers).toEqual(['the inbound queue could not be read', '3 approval(s) pending'])
  })

  it('an open OWN request is not asked about at all (marveen 58625: listed for the fresh session instead)', () => {
    // The probe set has no such member: a blocker for it cannot come back by accident.
    expect(Object.keys(probes()).sort()).toEqual(['lastOwnCardEvent', 'openChannelQuestion', 'ownInProgressCardIds', 'pendingApprovalCount', 'pendingInboundCount'])
  })
})

describe('the queries, on a real database', () => {
  beforeEach(() => { initDatabase(':memory:') })

  it('getLastOwnCardEvent: the agent\'s own last status event, whoever else moved the card since', () => {
    createKanbanCard({ id: 'k1', title: 'x', assignee: 'computress' })
    moveKanbanCard('k1', 'in_progress', 0, 'computress')
    moveKanbanCard('k1', 'testing', 0, 'computress')
    const mine = getLastOwnCardEvent('computress', 0)
    expect(mine).toMatchObject({ card_id: 'k1', from_status: 'in_progress', to_status: 'testing' })
    expect(typeof mine!.created_at).toBe('number')
    // The reviewer closes it: that is the reviewer's event, the agent's last word is unchanged.
    moveKanbanCard('k1', 'waiting', 0, 'didi')
    expect(getLastOwnCardEvent('computress', 0)).toMatchObject({ card_id: 'k1', to_status: 'testing' })
    expect(getLastOwnCardEvent('didi', 0)).toMatchObject({ from_status: 'testing', to_status: 'waiting' })
  })

  it('getLastOwnCardEvent: among same-second events the LATER one wins', () => {
    createKanbanCard({ id: 'k1', title: 'x' })
    createKanbanCard({ id: 'k2', title: 'y' })
    moveKanbanCard('k1', 'in_progress', 0, 'computress')
    moveKanbanCard('k1', 'testing', 0, 'computress')
    moveKanbanCard('k2', 'in_progress', 0, 'computress')
    // All within one second in a test: only the id order can tell them apart.
    expect(getLastOwnCardEvent('computress', 0)).toMatchObject({ card_id: 'k2', to_status: 'in_progress' })
  })

  it('getLastOwnCardEvent: nothing since the session started is null, and so is an agent that never moved a card', () => {
    createKanbanCard({ id: 'k1', title: 'x' })
    moveKanbanCard('k1', 'in_progress', 0, 'computress')
    const future = Math.floor(Date.now() / 1000) + 3600
    expect(getLastOwnCardEvent('computress', future)).toBeNull()
    expect(getLastOwnCardEvent('nobody', 0)).toBeNull()
  })

  it('getLastOwnCardEvent: a status change through the card PUT counts like a move', () => {
    createKanbanCard({ id: 'k1', title: 'x' })
    moveKanbanCard('k1', 'in_progress', 0, 'computress')
    updateKanbanCard('k1', { status: 'waiting' }, 'computress')
    expect(getLastOwnCardEvent('computress', 0)).toMatchObject({ card_id: 'k1', from_status: 'in_progress', to_status: 'waiting' })
  })

  it('listOwnInProgressCardIds: live in_progress cards on the agent\'s name, nothing else', () => {
    createKanbanCard({ id: 'mine-ip', title: 'x', assignee: 'computress' })
    createKanbanCard({ id: 'mine-planned', title: 'x', assignee: 'computress' })
    createKanbanCard({ id: 'theirs-ip', title: 'x', assignee: 'ford' })
    createKanbanCard({ id: 'mine-archived', title: 'x', assignee: 'computress' })
    for (const id of ['mine-ip', 'theirs-ip', 'mine-archived']) moveKanbanCard(id, 'in_progress', 0, 'marveen')
    archiveKanbanCard('mine-archived')
    expect(listOwnInProgressCardIds('computress')).toEqual(['mine-ip'])
    expect(listOwnInProgressCardIds('ford')).toEqual(['theirs-ip'])
    expect(listOwnInProgressCardIds('nobody')).toEqual([])
  })

  it('listOpenOwnOutbound: what the agent asked and nobody closed, newest first, with the full count', () => {
    const a = createAgentMessage('computress', 'didi', 'REVIEW REQUEST card aa11: please look at the diff')
    const b = createAgentMessage('computress', 'marveen', 'DECISION: which of the two?')
    markMessageDelivered(a.id)
    const c = createAgentMessage('computress', 'jarvis', 'closed already')
    markMessageDone(c.id, 'ok')
    const d = createAgentMessage('computress', 'ford', 'never arrived')
    markMessageFailed(d.id, 'x')
    createAgentMessage('ford', 'didi', 'somebody else\'s request')
    createAgentMessage('computress', 'computress', 'a note to self')
    const out = listOpenOwnOutbound('computress', 0, 10)
    expect(out.total).toBe(2)
    expect(out.rows.map(r => r.id)).toEqual([b.id, a.id])
    // A DECISION asked of the main agent IS listed: the fresh session has to know it is waiting for it.
    expect(out.rows[0]).toMatchObject({ to_agent: 'marveen', head: 'DECISION: which of the two?' })
    expect(typeof out.rows[0].created_at).toBe('number')
  })

  it('listOpenOwnOutbound: a receipt, a row closed without delivery and the restart gate\'s own alert are not requests', () => {
    const ask = createAgentMessage('computress', 'didi', 'REVIEW REQUEST card bb22: the second round')
    // A receipt for work somebody else asked for: nothing comes back for it.
    createAgentMessage('computress', 'ford', `${COMPLETION_REPORT_PREFIX} #41: megvan`)
    // Closed by an operator, never shown to anybody: its status reads "delivered" all the same.
    const dead = createAgentMessage('computress', 'jarvis', 'a report nobody will be shown')
    expect(closeMessagesWithoutDelivery([dead.id], 'stale backlog')).toBe(1)
    // Written in the agent's name by the restart gate, not by the agent.
    createAgentMessage('computress', 'marveen', '[CONTEXT-RESTART-GATE-RIASZTAS] blocked', GATE_ALERT_ORIGIN_NOTE)
    const out = listOpenOwnOutbound('computress', 0, 10)
    expect(out.total).toBe(1)
    expect(out.rows.map(r => r.id)).toEqual([ask.id])
  })

  it('listOpenOwnOutbound: the count is of ALL, the rows are capped, the head is cut', () => {
    const ids = [1, 2, 3, 4, 5].map(n => createAgentMessage('computress', 'didi', `request number ${n} ` + 'x'.repeat(200)).id)
    const out = listOpenOwnOutbound('computress', 0, 2, 16)
    expect(out.total).toBe(5)
    expect(out.rows.map(r => r.id)).toEqual([ids[4], ids[3]])
    expect(out.rows[0].head).toBe('request number 5')
  })

  it('listOpenOwnOutbound: nothing before the window', () => {
    createAgentMessage('computress', 'didi', 'old request')
    expect(listOpenOwnOutbound('computress', Math.floor(Date.now() / 1000) + 3600, 10)).toEqual({ total: 0, rows: [] })
  })
})

describe('readFirstToolUseMsAfter: when the agent\'s own work resumed', () => {
  const AFTER = Date.parse('2026-11-11T06:00:00.000Z')
  const at = (offsetSec: number) => new Date(AFTER + offsetSec * 1000).toISOString()
  const toolUse = (ts: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'Bash' }] }, ...extra })
  const text = (ts: string) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'text', text: 'the word "tool_use" in prose' }] } })

  function withTranscript(lines: string[], mtimeMs: number, run: (workingDir: string, configDir: string) => void): void {
    const root = mkTmp('firsttool-')
    try {
      const workingDir = join(root, 'agent')
      const configDir = join(root, 'config')
      mkdirSync(workingDir, { recursive: true })
      // The key of the directory is not this test's subject (realpath + Claude Code's encoding, tested elsewhere).
      const projects = projectsDirFor(workingDir, configDir)
      mkdirSync(projects, { recursive: true })
      const file = join(projects, 'session.jsonl')
      writeFileSync(file, lines.join('\n') + '\n')
      utimesSync(file, mtimeMs / 1000, mtimeMs / 1000)
      run(workingDir, configDir)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it('the first tool call AFTER the moment, not the ones before it', () => {
    withTranscript([toolUse(at(-60)), text(at(30)), toolUse(at(90)), toolUse(at(200))], AFTER + 300_000, (w, c) => {
      expect(readFirstToolUseMsAfter(w, c, AFTER)).toBe(AFTER + 90_000)
    })
  })

  it('a turn that only talks is not work resuming', () => {
    withTranscript([toolUse(at(-60)), text(at(30))], AFTER + 300_000, (w, c) => {
      expect(readFirstToolUseMsAfter(w, c, AFTER)).toBeNull()
    })
  })

  it('a sub-agent\'s tool call is not the agent\'s own', () => {
    withTranscript([toolUse(at(30), { isSidechain: true }), toolUse(at(120))], AFTER + 300_000, (w, c) => {
      expect(readFirstToolUseMsAfter(w, c, AFTER)).toBe(AFTER + 120_000)
    })
  })

  it('a transcript not written since the moment holds nothing new', () => {
    withTranscript([toolUse(at(90))], AFTER - 1_000, (w, c) => {
      expect(readFirstToolUseMsAfter(w, c, AFTER)).toBeNull()
    })
  })

  it('malformed lines and a missing directory are "not yet", never a throw', () => {
    withTranscript(['{"tool_use" broken', '"tool_use"', toolUse('not a date'), toolUse(at(45))], AFTER + 300_000, (w, c) => {
      expect(readFirstToolUseMsAfter(w, c, AFTER)).toBe(AFTER + 45_000)
      expect(readFirstToolUseMsAfter(join(w, 'nowhere'), c, AFTER)).toBeNull()
    })
  })
})
