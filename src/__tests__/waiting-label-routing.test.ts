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

  // THE NARROWING IS OFF UNTIL THE TRIAGE HAS A CONSUMER (marveen's decision, 13:23).
  // The POLICY -- an untriaged card is the coordinator's -- stands; what is missing is
  // somewhere to deliver it. `selectCoordinatorTriage` has no production caller, so
  // narrowing here would take 185 cards off the agents and drop them. Until then the
  // label only ADDS, and these two cases keep the pre-2026-08-24 behaviour.
  it('a coordinator-marked card STILL reaches the assignee for now -- nothing is dropped', () => {
    expect(pick([card('b', { labels: lab(WAITING_ON_COORDINATOR_LABEL) })])).toEqual(['b'])
  })

  it('an UNTRIAGED testing card also stays with him, which is the status quo', () => {
    expect(pick([card('c', { labels: [] })])).toEqual(['c'])
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
  it('11 untriaged testing items: the triage list is ready, the narrowing is not applied', () => {
    // Both halves in one place, because the pair is the point. The triage SELECTION is
    // correct and tested -- it just has nowhere to go yet, so the assignee still sees
    // them. When the consumer lands, this expectation flips to 0 IN THE SAME COMMIT.
    const board = Array.from({ length: 11 }, (_, i) => card(`k${i}`, { labels: [] }))
    expect(selectCoordinatorTriage(board)).toHaveLength(11)
    expect(pick(board)).toHaveLength(11)
  })
})
