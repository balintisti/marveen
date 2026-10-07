import { describe, it, expect } from 'vitest'
import { buildWakeMessage, isFloorExpired, selectDeclaredWork } from '../idle-agent.js'

/** The waiting column's date reader (card ce5c9e4b).
 *
 *  Before: `assigned_open_cards` dropped every `waiting` row on its status, so a waiting
 *  card's `due_date` -- the floor the board convention promises will fire even if the awaited
 *  event never comes -- was read by nothing. deeper measured it 2026-09-28: 26 dated waiting
 *  cards, and not one of them could ever reach its assignee through the guard.
 *
 *  The acceptance the card set, both directions: an expired waiting card IS offered, a future
 *  one is NOT, and a planned card's future date stays NOT-BEFORE. The rest pins the traps the
 *  implementation had to step around.
 */
const NOW = 1_800_000_000 // epoch seconds, the column's unit
const DAY = 86_400
const ME = 'friday'

type Card = { id: string; status: string; assignee: string | null; due_date?: number | null; archived_at?: number | null }
// `now` has NO default on purpose: a default parameter turns an explicit `undefined` back into
// NOW, and the no-clock case below then measures the clocked path (it did, first run).
const pick = (cards: Card[], now: number | undefined, kind: 'assigned_open_cards' | 'waiting_on_me' | 'testing_without_my_comment' = 'assigned_open_cards', agent = ME) =>
  selectDeclaredWork({ kind } as never, agent, cards, new Map(), 'marveen', now).map((c) => c.id)

describe('assigned_open_cards reads the floor of a waiting card (ce5c9e4b)', () => {
  it('an EXPIRED waiting card is offered to its assignee -- the whole finding', () => {
    expect(pick([{ id: 'w', status: 'waiting', assignee: ME, due_date: NOW - DAY }], NOW)).toEqual(['w'])
  })

  it('a floor that has EXACTLY arrived is expired -- same edge as the planned NOT-BEFORE', () => {
    expect(pick([{ id: 'w', status: 'waiting', assignee: ME, due_date: NOW }], NOW)).toEqual(['w'])
  })

  it('a FUTURE date on a waiting card still means nothing -- not offered', () => {
    expect(pick([{ id: 'w', status: 'waiting', assignee: ME, due_date: NOW + DAY }], NOW)).toEqual([])
  })

  it('a waiting card with NO floor stays out -- a floor never set cannot run out', () => {
    expect(pick([{ id: 'w', status: 'waiting', assignee: ME, due_date: null }], NOW)).toEqual([])
    expect(pick([{ id: 'w', status: 'waiting', assignee: ME }], NOW)).toEqual([])
  })

  it('NO clock wakes nothing -- the `!isDeferred` trap: that reading would expire every dated card', () => {
    expect(pick([{ id: 'w', status: 'waiting', assignee: ME, due_date: NOW - DAY }], undefined)).toEqual([])
  })

  it('the planned column is unchanged: future date hidden, past date offered', () => {
    expect(pick([{ id: 'p', status: 'planned', assignee: ME, due_date: NOW + DAY }], NOW)).toEqual([])
    expect(pick([{ id: 'p', status: 'planned', assignee: ME, due_date: NOW - DAY }], NOW)).toEqual(['p'])
  })

  it('someone ELSE\'s expired waiting card is not mine', () => {
    expect(pick([{ id: 'w', status: 'waiting', assignee: 'dexter', due_date: NOW - DAY }], NOW)).toEqual([])
  })

  it('an archived expired waiting card stays out', () => {
    expect(pick([{ id: 'w', status: 'waiting', assignee: ME, due_date: NOW - DAY, archived_at: NOW - 2 * DAY }], NOW)).toEqual([])
  })

  it('unit-independent like its sibling: seconds date against a MILLISECOND clock, both directions', () => {
    expect(pick([{ id: 'w', status: 'waiting', assignee: ME, due_date: NOW - DAY }], NOW * 1000)).toEqual(['w'])
    expect(pick([{ id: 'w', status: 'waiting', assignee: ME, due_date: NOW + DAY }], NOW * 1000)).toEqual([])
  })

  it('the other kinds are untouched: the review queue never takes a waiting card', () => {
    expect(pick([{ id: 'w', status: 'waiting', assignee: ME, due_date: NOW - DAY }], NOW, 'testing_without_my_comment')).toEqual([])
  })

  it('waiting_on_me still takes EVERY waiting card on the name, dated or not', () => {
    const cards: Card[] = [
      { id: 'a', status: 'waiting', assignee: 'marveen', due_date: NOW + DAY },
      { id: 'b', status: 'waiting', assignee: 'marveen', due_date: NOW - DAY },
      { id: 'c', status: 'waiting', assignee: 'marveen', due_date: null },
    ]
    expect(pick(cards, NOW, 'waiting_on_me', 'marveen').sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('isFloorExpired', () => {
  it('answers NO when it cannot tell -- the opposite default of isDeferred, on purpose', () => {
    expect(isFloorExpired(null, NOW)).toBe(false)
    expect(isFloorExpired(undefined, NOW)).toBe(false)
    expect(isFloorExpired(NOW - DAY, undefined)).toBe(false)
  })
  it('past and present are expired, future is not', () => {
    expect(isFloorExpired(NOW - 1, NOW)).toBe(true)
    expect(isFloorExpired(NOW, NOW)).toBe(true)
    expect(isFloorExpired(NOW + 1, NOW)).toBe(false)
  })
})

describe('the wake names a floor expiry AS a floor expiry, not as work', () => {
  const nowMs = NOW * 1000
  const floorCard = { id: 'ffffffff-1', status: 'waiting', priority: 'high', title: 'blocked on X', due_date: NOW - DAY }
  const workCard = { id: 'aaaaaaaa-1', status: 'planned', priority: 'normal', title: 'real work' }

  it('its own labelled group, with the floor date, and NOT under FELVEHETO MUNKA', () => {
    const msg = buildWakeMessage(ME, 12, 2, [workCard, floorCard], nowMs, 'assigned_open_cards')
    expect(msg).toMatch(/FELVEHETO MUNKA \(1\)/)
    expect(msg).toMatch(/PADLO-LEJARAT \(1\)/)
    expect(msg).toContain(`padlo ${new Date((NOW - DAY) * 1000).toISOString().slice(0, 10)}`)
    const workBlock = msg.split('PADLO-LEJARAT')[0]
    expect(workBlock).not.toContain('ffffffff')
  })

  it('a floor-only wake asks for a RE-MEASURE, not a review answer', () => {
    const msg = buildWakeMessage(ME, 12, 1, [floorCard], nowMs, 'assigned_open_cards')
    expect(msg).not.toMatch(/FELVEHETO MUNKA/)
    expect(msg).toMatch(/PADLO-LEJARAT \(1\)/)
    expect(msg).toContain('Merd ujra a legfelso PADLO-LEJARAT')
    expect(msg).not.toContain('csak valaszra varo ellenorzes')
    expect(msg).not.toContain('tetelt nem tudtam megnevezni')
  })

  it('the asymmetry note declares that the re-query line does not count expired floors', () => {
    const msg = buildWakeMessage(ME, 12, 1, [floorCard], nowMs, 'assigned_open_cards')
    expect(msg).toContain('a LEJART padloju `waiting` kartyakat')
  })

  it('the floor group and its sentence belong to assigned_open_cards ONLY', () => {
    // waiting_on_me: every item IS a waiting card, taken for a different reason -- the
    // coordinator's decision queue must not be relabelled a floor expiry (first version did).
    const coord = buildWakeMessage('marveen', 12, 2, [floorCard, { ...floorCard, id: 'bbbbbbbb-1', due_date: NOW + DAY }], nowMs, 'waiting_on_me')
    expect(coord).not.toMatch(/PADLO-LEJARAT/)
    expect(coord).not.toContain('LEJART padloju')
    const review = buildWakeMessage('didi', 12, 1, [{ ...workCard, status: 'testing' }], nowMs, 'testing_without_my_comment')
    expect(review).not.toContain('LEJART padloju')
  })
})
