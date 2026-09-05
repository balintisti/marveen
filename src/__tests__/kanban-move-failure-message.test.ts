// A move that changes no rows used to be indistinguishable from a missing card.
//
// MEASURED 2026-09-05 (mandark, five occurrences): `POST /api/kanban/<id>/move`
// answered 404 with "Kártya nem található" while the row was demonstrably present --
// id length 8, archived_at null, and `GET /api/kanban/<id>` returning 200 in the same
// minute. One incident needed TWO retries before it took.
//
// The route's condition is `moveKanbanCard(...)`, which is
// `UPDATE kanban_cards SET ... WHERE id=?`.changes > 0 -- ZERO ROWS CHANGED, with no
// archived or status predicate anywhere in it. So the string named a different fact
// than the code tested, and the mover believed the string, because that is what the
// system said.
//
// The mechanism behind the zero is still UNKNOWN and this test claims nothing about it.
// What it pins is narrower and is the thing that made the incident undiagnosable: the
// two states must not share a sentence. The dashboard logs no request statuses at all
// (0 hits in 349,274 lines), so the response text is the only artefact a caller gets.
import { describe, it, expect } from 'vitest'
import { moveFailureMessage } from '../web/routes/kanban.js'

describe('moveFailureMessage', () => {
  it('gives DIFFERENT text for the two states -- this is the whole point', () => {
    // The load-bearing assertion. If a later edit collapses the branches back into one
    // string, every other expectation here could still pass while the defect returns.
    expect(moveFailureMessage(true)).not.toBe(moveFailureMessage(false))
  })

  it('says the card EXISTS when it exists, and does not claim it is missing', () => {
    const msg = moveFailureMessage(true)
    expect(msg).toContain('létezik')
    // The old sentence is the thing that misled a reader five times; it must not survive
    // on this branch. Asserting its ABSENCE, not just the presence of new words: an
    // appended clause would satisfy a presence-only check while leaving the lie in place.
    expect(msg).not.toContain('nem található')
  })

  it('still says NOT FOUND when the row is genuinely absent', () => {
    // The negative control. Without it, a message function that returned the "exists"
    // text unconditionally would pass the two assertions above.
    expect(moveFailureMessage(false)).toBe('Kártya nem található')
  })

  it('tells the caller to READ THE STATUS BACK, because a retry alone is not enough', () => {
    // mandark's own advice was "retry once" and five cases refuted it -- one needed two
    // retries. A retry that is not followed by a read-back leaves the card in the wrong
    // column while the mover books it as done, and the status field is what the
    // dispatcher and the idle guard read.
    expect(moveFailureMessage(true)).toContain('OLVASD VISSZA')
  })
})
