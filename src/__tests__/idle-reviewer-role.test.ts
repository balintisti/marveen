import { describe, expect, it } from 'vitest'
import { parseWorkCheck, selectDeclaredWork, type WorkCountCard } from '../idle-agent.js'

// THE FILTER WENT BY NAME, NOT BY ROLE (card 02ba43e7, dexter 2026-08-22).
//
// The old rule was `latestAuthor !== agent && latestAuthor !== coordinator`, i.e.
// "anyone except me and ONE named agent has the last word, so I owe an answer".
// It excluded MAIN_AGENT_ID by name. Measured the night it was found: jarvis --
// also coordinator-shaped, not a reviewer -- became last commenter on EIGHT of
// dexter's testing cards in one night, and every one of them counted as an
// unanswered finding. Every future coordinator-shaped agent reopens it.
//
// AND "reviewer = didi" WOULD NOT HAVE FIXED IT EITHER: mandark is a real
// reviewer (live browser measurement) whose OWN queue is `assigned_open_cards`,
// exactly like a worker's. So the role cannot be derived from `kind`, and that is
// why it is a separate declared field rather than a fourth kind.
//
// FAIL-CLOSED, and the asymmetry is the reason: a false POSITIVE (inventing an
// item) is expensive because there is no moment when it surfaces -- the assignee
// looks, finds nothing, and that reads like a normal result. A false NEGATIVE is
// cheaper: the finding stays on the card and its AUTHOR knows they wrote it.

const card = (over: Partial<WorkCountCard> & { id: string }): WorkCountCard & { id: string } => ({
  status: 'testing', assignee: 'dexter', archived_at: null, updated_at: 100, due_date: null,
  ...over,
} as WorkCountCard & { id: string })

const commentedBy = (id: string, author: string) =>
  new Map([[id, new Map([[author, 1000]])]])

describe('parseWorkCheck carries the declared role', () => {
  it('accepts reviewer: true', () => {
    expect(parseWorkCheck('{"kind":"assigned_open_cards","reviewer":true}'))
      .toEqual({ kind: 'assigned_open_cards', reviewer: true })
  })

  it('a declaration without the field is not a reviewer', () => {
    expect(parseWorkCheck('{"kind":"assigned_open_cards"}')).toEqual({ kind: 'assigned_open_cards' })
  })

  it('NEGATIVE CONTROL: a truthy non-boolean is a TYPO, not a declaration', () => {
    // Coercing these would grant the role by accident, in the direction that
    // invents work for somebody else.
    for (const raw of ['"true"', '1', '"yes"', '{}']) {
      const parsed = parseWorkCheck(`{"kind":"assigned_open_cards","reviewer":${raw}}`)
      expect(parsed?.reviewer, `reviewer:${raw} must not grant the role`).toBeUndefined()
    }
  })
})

describe('a testing card counts only when a DECLARED reviewer spoke last', () => {
  const cards = [card({ id: 'c1' })]
  const check = { kind: 'assigned_open_cards' as const }

  it('a declared reviewer had the last word -> the assignee owes an answer', () => {
    const out = selectDeclaredWork(check, 'dexter', cards, commentedBy('c1', 'didi'), 'marveen', 0,
      new Set(['didi', 'mandark']))
    expect(out.map((c) => c.id)).toEqual(['c1'])
  })

  it('THE DEFECT: a coordinator-shaped agent no longer counts as a reviewer', () => {
    // jarvis is not MAIN_AGENT_ID, so the old name-based rule let him through.
    const out = selectDeclaredWork(check, 'dexter', cards, commentedBy('c1', 'jarvis'), 'marveen', 0,
      new Set(['didi', 'mandark']))
    expect(out).toEqual([])
  })

  it('mandark counts even though his OWN kind is a worker kind', () => {
    // The case that rules out deriving the role from `kind`.
    const out = selectDeclaredWork(check, 'dexter', cards, commentedBy('c1', 'mandark'), 'marveen', 0,
      new Set(['didi', 'mandark']))
    expect(out.map((c) => c.id)).toEqual(['c1'])
  })

  it('the coordinator still does not count when roles ARE declared', () => {
    const out = selectDeclaredWork(check, 'dexter', cards, commentedBy('c1', 'marveen'), 'marveen', 0,
      new Set(['didi', 'mandark']))
    expect(out).toEqual([])
  })

  it('my own last comment is never an unanswered finding against me', () => {
    const out = selectDeclaredWork(check, 'dexter', cards, commentedBy('c1', 'dexter'), 'marveen', 0,
      new Set(['didi', 'mandark']))
    expect(out).toEqual([])
  })
})

describe('an UNCONFIGURED fleet keeps the old rule instead of emptying every queue', () => {
  const cards = [card({ id: 'c1' })]
  const check = { kind: 'assigned_open_cards' as const }

  for (const [label, set] of [['undefined', undefined], ['empty', new Set<string>()]] as const) {
    it(`${label} reviewer set -> the old name-based rule still stands`, () => {
      // Landing the code before the declarations must change NOTHING. Treating
      // "nobody declared" as "nobody is a reviewer" would take every such card out
      // of every queue at once and deliver them nowhere.
      const out = selectDeclaredWork(check, 'dexter', cards, commentedBy('c1', 'jarvis'), 'marveen', 0, set)
      expect(out.map((c) => c.id)).toEqual(['c1'])
    })
  }

  it('CONTROL: the coordinator is still excluded in that unconfigured state', () => {
    const out = selectDeclaredWork(check, 'dexter', cards, commentedBy('c1', 'marveen'), 'marveen', 0, undefined)
    expect(out).toEqual([])
  })
})
