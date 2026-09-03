// Contract tests for the kanban status-change audit trail.
//
// moveKanbanCard records a kanban_card_events row on every REAL status
// transition (who moved the card, when, from/to status). A pure sort_order
// reorder within the same column, or a move that touches no row, records
// nothing. getKanbanCardEvents returns a card's events in chronological order.
//
// These tests call the real production entry points (moveKanbanCard,
// getKanbanCardEvents) on an in-memory database seeded with the production
// schema, the same way the other kanban db tests do.

import { describe, it, expect, beforeEach } from 'vitest'
import { initDatabase, createKanbanCard, moveKanbanCard, getKanbanCardEvents } from '../db.js'

beforeEach(() => {
  // Re-init with an in-memory database for isolation.
  initDatabase(':memory:')
})

// CREATION NOW RECORDS AN EVENT TOO (card 8c03ef29), so these tests separate the
// two kinds instead of asserting on a raw count. That is deliberate: the board
// could not tell an agent's own OUTPUT from work assigned to it -- the share an
// agent started itself was 83% for mandark against 16% for dexter -- and the idle
// guard answers "has this agent work?" from exactly that number.
const moves = (id: string) => getKanbanCardEvents(id).filter((e) => e.from_status !== null)
const creations = (id: string) => getKanbanCardEvents(id).filter((e) => e.from_status === null)

describe('kanban card creation audit (card 8c03ef29)', () => {
  it('records ONE creation event carrying the reported actor', () => {
    createKanbanCard({ id: 'made-a', title: 'Created by friday', actor: 'friday' })
    const c = creations('made-a')
    expect(c).toHaveLength(1)
    expect(c[0].to_status).toBe('planned')
    expect(c[0].actor).toBe('friday')
  })

  it('still records the event when no actor is reported -- with a NULL actor', () => {
    // The distinction the whole card rests on: an event with a null actor says
    // "created, creator not reported"; NO event says "created before this
    // existed". A counter that conflated them would repeat the original mistake.
    createKanbanCard({ id: 'made-b', title: 'Anonymous' })
    const c = creations('made-b')
    expect(c).toHaveLength(1)
    expect(c[0].actor).toBeNull()
  })

  it('marks creation with a NULL from_status, which nothing else uses', () => {
    // Measured on the live board before shipping: of 2655 event rows, ZERO had a
    // null from_status. So the marker cannot collide with a legacy move.
    createKanbanCard({ id: 'made-c', title: 'Marker', actor: 'friday' })
    moveKanbanCard('made-c', 'in_progress', 0, 'friday')
    const all = getKanbanCardEvents('made-c')
    expect(all).toHaveLength(2)
    expect(all.filter((e) => e.from_status === null)).toHaveLength(1)
    expect(all.filter((e) => e.from_status !== null)).toHaveLength(1)
  })

  it('records the creation event at the card s ACTUAL initial status', () => {
    // A card created straight into another column must not be logged as 'planned'.
    createKanbanCard({ id: 'made-d', title: 'Born in progress', status: 'in_progress', actor: 'friday' })
    expect(creations('made-d')[0].to_status).toBe('in_progress')
  })
})

describe('kanban move audit trail', () => {
  it('records exactly one event with correct from/to status and actor on a status change', () => {
    createKanbanCard({ id: 'card-a', title: 'Audited card' })

    const moved = moveKanbanCard('card-a', 'in_progress', 1, 'marveen')
    expect(moved).toBe(true)

    const events = moves('card-a')
    expect(events).toHaveLength(1)
    expect(events[0].card_id).toBe('card-a')
    expect(events[0].from_status).toBe('planned')
    expect(events[0].to_status).toBe('in_progress')
    expect(events[0].actor).toBe('marveen')
    expect(typeof events[0].created_at).toBe('number')
  })

  it('records no event when the status is unchanged (pure reorder)', () => {
    createKanbanCard({ id: 'card-b', title: 'Reordered card' })

    // Same status (planned), only sort_order differs -> not a transition.
    const moved = moveKanbanCard('card-b', 'planned', 5, 'marveen')
    expect(moved).toBe(true)
    expect(moves('card-b')).toHaveLength(0)
    // ...and the creation event is still there, so "no move" is not "no history".
    expect(creations('card-b')).toHaveLength(1)
  })

  it('records no event when no row matches', () => {
    const moved = moveKanbanCard('nonexistent-card', 'done', 0, 'marveen')
    expect(moved).toBe(false)
    expect(getKanbanCardEvents('nonexistent-card')).toHaveLength(0)
  })

  it('leaves actor null when none is supplied (backward-compatible callers)', () => {
    createKanbanCard({ id: 'card-c', title: 'No actor' })

    const moved = moveKanbanCard('card-c', 'waiting', 0)
    expect(moved).toBe(true)

    const events = moves('card-c')
    expect(events).toHaveLength(1)
    expect(events[0].actor).toBeNull()
  })

  it('returns events in chronological order across multiple moves', () => {
    createKanbanCard({ id: 'card-d', title: 'Multi-move card' })

    moveKanbanCard('card-d', 'in_progress', 0, 'marveen')
    moveKanbanCard('card-d', 'waiting', 0, 'samu')
    moveKanbanCard('card-d', 'done', 0, 'marveen')

    const events = moves('card-d')
    expect(events.map((e) => e.to_status)).toEqual(['in_progress', 'waiting', 'done'])
    expect(events.map((e) => e.from_status)).toEqual(['planned', 'in_progress', 'waiting'])
    // created_at is monotonically non-decreasing and the id ordering breaks ties.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].created_at).toBeGreaterThanOrEqual(events[i - 1].created_at)
      expect(events[i].id).toBeGreaterThan(events[i - 1].id)
    }
  })
})
