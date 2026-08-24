import { describe, it, expect } from 'vitest'
import {
  selectDeclaredWork,
  selectCoordinatorTriage,
  WAITING_ON_ASSIGNEE_LABEL,
  WAITING_ON_COORDINATOR_LABEL,
  WAITING_ON_OWNER_LABEL,
  type WorkCountCard,
} from '../idle-agent.js'

// WHY THE ROUTING CHANGED (card 0fe791fb, measured 2026-08-24). The old rule was "if
// someone else spoke last, the assignee owes an answer". Over friday's 11 such items,
// ZERO were questions: three were verifiers saying the card was closable, five were
// stale-hash bookkeeping that explicitly says the card's claim is UNCHANGED, three were
// confirmations. The guard woke the assignee five times over that list.
//
// The author of the last comment is not the signal; WHO IT WAITS ON is. And the ABSENT
// label routes to the COORDINATOR rather than to nobody -- "nobody's" is the tempting
// rule and the wrong one, because a missing mark would leave a real question waiting
// mutely, at the cost of whoever forgot.

type C = WorkCountCard & { id: string }
const card = (id: string, over: Partial<C> = {}): C =>
  ({ id, status: 'testing', assignee: 'friday', updated_at: 100, ...over }) as C
const lab = (name: string) => [{ name }]
/** A verifier spoke last on every card -- the condition the OLD rule fired on. */
const commented = (ids: string[]) =>
  new Map(ids.map((id) => [id, new Map([['didi', 50]])]))

const pick = (cards: C[]) =>
  selectDeclaredWork({ kind: 'assigned_open_cards' }, 'friday', cards,
    commented(cards.map((c) => c.id)), 'marveen', 999).map((c) => c.id)

describe('a testing card reaches the assignee only when it is marked for him', () => {
  it('`varakozik:assignee` IS his queue', () => {
    expect(pick([card('a', { labels: lab(WAITING_ON_ASSIGNEE_LABEL) })])).toEqual(['a'])
  })

  it('a verifier-said-closable card is NOT his -- even though a verifier spoke last', () => {
    // The exact case the old rule got wrong, and the reason it is now a label.
    expect(pick([card('b', { labels: lab(WAITING_ON_COORDINATOR_LABEL) })])).toEqual([])
  })

  it('an UNTRIAGED testing card is not his either', () => {
    expect(pick([card('c', { labels: [] })])).toEqual([])
  })

  it('a non-testing card of his is unaffected by any of this', () => {
    expect(pick([card('d', { status: 'in_progress', labels: [] })])).toEqual(['d'])
  })
})

describe('what the coordinator has to look at', () => {
  it('takes the explicitly-his card', () => {
    expect(selectCoordinatorTriage([card('a', { labels: lab(WAITING_ON_COORDINATOR_LABEL) })]).map(c => c.id))
      .toEqual(['a'])
  })

  it('MUTATION (marveen): an UNTRIAGED card lands on HIS list, not on nobody’s', () => {
    // The inverse probe. If this returns [], the "nobody's" branch was built instead,
    // and a real question can wait mutely.
    expect(selectCoordinatorTriage([card('b', { labels: [] })]).map(c => c.id)).toEqual(['b'])
  })

  it('MUTATION (marveen): a `varakozik:assignee` card does NOT land on his list', () => {
    expect(selectCoordinatorTriage([card('c', { labels: lab(WAITING_ON_ASSIGNEE_LABEL) })])).toEqual([])
  })

  it('an owner-decision label is not coordinator triage either', () => {
    expect(selectCoordinatorTriage([card('d', { labels: lab(WAITING_ON_OWNER_LABEL) })])).toEqual([])
  })

  it('only testing cards, and never archived ones', () => {
    expect(selectCoordinatorTriage([
      card('e', { status: 'waiting', labels: [] }),
      card('f', { labels: [], archived_at: 1 }),
    ])).toEqual([])
  })
})

describe('THE PROBE marveen specified: today’s board, untriaged', () => {
  it('11 untriaged testing items -> 0 to the assignee, 11 to the coordinator', () => {
    // Today nothing carries a label, which is exactly the starting state: the whole
    // list moves to triage rather than waking the person who cannot act on it.
    const board = Array.from({ length: 11 }, (_, i) => card(`k${i}`, { labels: [] }))
    expect(pick(board)).toHaveLength(0)
    expect(selectCoordinatorTriage(board)).toHaveLength(11)
  })
})
