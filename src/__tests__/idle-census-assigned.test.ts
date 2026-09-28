import { describe, it, expect } from 'vitest'
import { selectDeclaredWork } from '../idle-agent.js'

/** A census comment is transparent in the ASSIGNEE's queue too (card 4ea61e29).
 *
 *  The census skip (lastRealCommentAtByCard, card 57cb8d64) lived only in the reviewer branch.
 *  `assigned_open_cards` read the raw map, so jarvis's board check (reviewer: true) counted as "a
 *  reviewer spoke last" and woke the assignee. Measured 2026-09-28: 7 of 55 offered items. The pin
 *  is both directions: the census adds no reviewer word, and it hides none either.
 *
 *  `raw` is every comment's last time per author; `real` the same without census comments -- what
 *  the watcher builds. jarvis at 400 in `raw` but not in `real` = his last word is a census.
 */
const CARD = { id: 'c1', status: 'testing', assignee: 'dexter', archived_at: null, updated_at: 500, due_date: null }
const check = { kind: 'assigned_open_cards' as const }
const REVIEWERS = new Set(['didi', 'mandark', 'jarvis', 'friday'])
const map = (o: Record<string, number>) => new Map([[CARD.id, new Map(Object.entries(o))]])
const queue = (raw: Record<string, number>, real?: Record<string, number>, labels?: string[]) =>
  selectDeclaredWork(
    check, 'dexter',
    [{ ...CARD, labels: (labels ?? []).map((name) => ({ name })) }],
    map(raw), 'marveen', 1_000, REVIEWERS, real ? map(real) : undefined,
  ).map((c) => c.id)

describe('assigned_open_cards: a census comment neither adds nor hides a reviewer word (4ea61e29)', () => {
  it('the author answered, then jarvis ran a census -> NOT waiting on the author (the finding)', () => {
    expect(queue({ dexter: 100, jarvis: 400 }, { dexter: 100 })).toEqual([])
  })

  it('a real reviewer finding, then a census on top -> STILL waiting on the author', () => {
    expect(queue({ dexter: 100, didi: 300, jarvis: 400 }, { dexter: 100, didi: 300 })).toEqual(['c1'])
  })

  it("a NON-census comment from jarvis still counts like anyone's (role is not the filter)", () => {
    expect(queue({ dexter: 100, jarvis: 400 }, { dexter: 100, jarvis: 400 })).toEqual(['c1'])
  })

  it('only census comments on the card -> nothing to answer', () => {
    expect(queue({ jarvis: 400 }, {})).toEqual([])
  })

  it('NOT MEASURED (no real map) -> every comment counts, exactly as before', () => {
    expect(queue({ dexter: 100, jarvis: 400 })).toEqual(['c1'])
  })

  it('the varakozik:assignee label still wins, whatever the comments are', () => {
    expect(queue({ dexter: 100, jarvis: 400 }, { dexter: 100 }, ['varakozik:assignee'])).toEqual(['c1'])
  })
})
