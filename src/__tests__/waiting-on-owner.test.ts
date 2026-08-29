import { describe, it, expect } from 'vitest'
import {
  isWaitingOnOwner,
  selectWaitingOnOwner,
  WAITING_ON_OWNER_LABEL,
  type WorkCountCard,
} from '../idle-agent.js'

// WHY A LABEL AND NOT THE TEXT (card 0fe791fb, measured 2026-08-24 over the 64 waiting
// cards). A title keyword filter found 18 and missed real ones; widening it to the
// description and the last comment found 33 and swept in cards that were already
// settled -- including 0a15a0ea, the card named as the example, whose last comment says
// the owner approved it that morning.
//
// THE TEXT RECORDS THE HISTORY, NOT THE STATE. A comment saying "waiting on Isti" stays
// true-looking after Isti has answered, because nobody goes back to rewrite it and
// nobody should. A label is a state because it can be TAKEN OFF.

const card = (over: Partial<WorkCountCard> = {}): WorkCountCard => ({
  status: 'waiting', assignee: 'friday', ...over,
})
const labelled = (name: string) => [{ name }]

describe('isWaitingOnOwner -- the label is the signal', () => {
  it('matches a waiting card carrying the label', () => {
    expect(isWaitingOnOwner(card({ labels: labelled(WAITING_ON_OWNER_LABEL) }))).toBe(true)
  })

  it('MUTATION 1: a card that SAYS it awaits the owner but carries no label does NOT match', () => {
    // The discriminating case, and it is the whole point. If this ever passes, the
    // filter has fallen back to reading the history instead of the state.
    const shouty = card({
      // Everything a keyword filter would fire on, and nothing a state filter should.
      labels: [],
    })
    expect(isWaitingOnOwner(shouty)).toBe(false)
    expect(isWaitingOnOwner(card({ labels: labelled('DONTES KELL (Isti)') }))).toBe(false)
  })

  it('MUTATION 2: taking the label OFF removes the card from the set', () => {
    // Revocability is what makes this a state rather than an entry. Measured live on
    // 2026-08-24 against the running board: attach -> the list endpoint shows it,
    // detach -> the list endpoint shows [].
    const on = card({ labels: labelled(WAITING_ON_OWNER_LABEL) })
    const off = card({ labels: [] })
    expect(isWaitingOnOwner(on)).toBe(true)
    expect(isWaitingOnOwner(off)).toBe(false)
  })

  it('only counts a card that is actually WAITING', () => {
    // A label left behind on a card that moved on is not a claim about today.
    expect(isWaitingOnOwner(card({ status: 'in_progress', labels: labelled(WAITING_ON_OWNER_LABEL) }))).toBe(false)
    expect(isWaitingOnOwner(card({ status: 'done', labels: labelled(WAITING_ON_OWNER_LABEL) }))).toBe(false)
  })

  it('a missing labels field is NOT a match -- absence is not evidence', () => {
    // The measured trap: GET /api/kanban carries `labels`, GET /api/kanban/<id> does
    // not. A caller filling cards from the detail endpoint sees no labels at all, and
    // must get "no match" rather than a crash -- but it must never get a match either.
    expect(isWaitingOnOwner(card({}))).toBe(false)
    expect(isWaitingOnOwner(card({ labels: null }))).toBe(false)
  })

  it('tolerates case and stray whitespace, so a variant is not silently invisible', () => {
    // Exact matching would be stricter and its failure would be SILENT: a card labelled
    // `Varakozik:Isti` would simply never appear, and "nobody is waiting on the owner"
    // is precisely the reassuring answer nobody re-checks. A visible duplicate in the
    // label list is the cheaper problem.
    expect(isWaitingOnOwner(card({ labels: labelled('  Varakozik:Isti ') }))).toBe(true)
  })

  it('selectWaitingOnOwner returns the subset and skips archived cards', () => {
    const cards: WorkCountCard[] = [
      card({ labels: labelled(WAITING_ON_OWNER_LABEL) }),
      card({ labels: [] }),
      card({ status: 'testing', labels: labelled(WAITING_ON_OWNER_LABEL) }),
      card({ labels: labelled(WAITING_ON_OWNER_LABEL), archived_at: 123 }),
    ]
    expect(selectWaitingOnOwner(cards)).toHaveLength(1)
  })
})
