import { describe, it, expect } from 'vitest'
import { orphanPullList, selectDeclaredWork } from '../idle-agent.js'

/** The unit gap between `due_date` (epoch SECONDS) and a caller's clock.
 *
 *  WHY A SEPARATE FILE RATHER THAN MORE CASES IN idle-agent.test.ts: the two
 *  existing due_date blocks are green, correct, and STRUCTURALLY UNABLE to fail
 *  on this. One derives both sides from the same arbitrary `now = 1_000_000`;
 *  the other uses NOW_SEC for the date AND for the clock. A fixture whose two
 *  values come from one number cannot express a disagreement between them --
 *  the same shape as building an "oversized file" out of content in jsdom.
 *
 *  The sharpest part is that the prose already knew: that block's own comment
 *  says "pass the wrong one and the filter never fires -- silently, which is
 *  the only failure mode that would not show up in a green suite." It named the
 *  defect and then could not produce it. These cases produce it: every one of
 *  them feeds the two sides in DIFFERENT units, which is what the live watcher
 *  did (`orphanPullList(cards, Date.now())` against a seconds column).
 */
describe('due_date filtering is unit-independent (card 9fe77f07)', () => {
  const SEC = 1_800_000_000          // 2027-01-15, epoch seconds -- the table's convention
  const MS = SEC * 1000              // the same instant as a JS clock reads it
  const DAY_SEC = 86_400

  const orphan = (dueDateSec: number | null, now?: number) =>
    orphanPullList(
      [{ id: 'c', status: 'planned', assignee: null, archived_at: null, due_date: dueDateSec }],
      now,
    ).map((c) => c.id)

  describe('orphanPullList -- the ownerless offer list', () => {
    it('a FUTURE seconds date is hidden from a MILLISECOND clock -- the whole finding', () => {
      // Exactly the live call shape. Before the fix this returned ['c']: the
      // comparison 1800086400 > 1.8e12 is never true, so the clause removed
      // nothing and deferred cards were offered back as pickable work.
      expect(orphan(SEC + DAY_SEC, MS)).toEqual([])
    })

    it('a PAST seconds date is still OFFERED to a millisecond clock', () => {
      // The half that stops the fix from being "hide every dated card", which
      // would satisfy the assertion above and bury work forever. The card made
      // this an explicit closing condition.
      expect(orphan(SEC - DAY_SEC, MS)).toEqual(['c'])
    })

    it('both sides in milliseconds still work, in both directions', () => {
      expect(orphan(MS + DAY_SEC * 1000, MS)).toEqual([])
      expect(orphan(MS - DAY_SEC * 1000, MS)).toEqual(['c'])
    })

    it('both sides in seconds still work, in both directions', () => {
      expect(orphan(SEC + DAY_SEC, SEC)).toEqual([])
      expect(orphan(SEC - DAY_SEC, SEC)).toEqual(['c'])
    })

    it('no clock still filters nothing -- an absent `now` must not start hiding cards', () => {
      expect(orphan(SEC + DAY_SEC, undefined)).toEqual(['c'])
    })

    it('a date that has EXACTLY arrived is pickable -- the deferral expires, not persists', () => {
      // Boundary, and it earns its place: `>` -> `>=` was the one mutation that
      // survived the first round. It also exercises the normalisation from both
      // sides at once -- these two numbers are the same instant in different
      // units, so they can only compare equal if both were converted.
      expect(orphan(SEC, MS)).toEqual(['c'])
    })

    it('an undated card is untouched whatever the clock is', () => {
      expect(orphan(null, MS)).toEqual(['c'])
    })
  })

  describe('selectDeclaredWork -- the assigned list, same clause', () => {
    // This path is CORRECT today: its caller derives `nowSec` at
    // idle-agent-watcher.ts:207-210 precisely because someone hit this trap
    // here first. It is normalised anyway, and pinned here, because the reason
    // it works is a caller remembering -- which is what failed 110 lines below.
    const pick = (dueDateSec: number, now?: number) =>
      selectDeclaredWork(
        { kind: 'assigned_open_cards' },
        'friday',
        [{ id: 'c', status: 'planned', assignee: 'friday', due_date: dueDateSec }],
        new Map(),
        'marveen',
        now,
      ).map((c) => c.id)

    it('a FUTURE seconds date is hidden from a MILLISECOND clock', () => {
      expect(pick(SEC + DAY_SEC, MS)).toEqual([])
    })

    it('a PAST seconds date is still returned to a millisecond clock', () => {
      expect(pick(SEC - DAY_SEC, MS)).toEqual(['c'])
    })

    it('the seconds/seconds shape its real caller uses is unchanged', () => {
      expect(pick(SEC + DAY_SEC, SEC)).toEqual([])
      expect(pick(SEC - DAY_SEC, SEC)).toEqual(['c'])
    })
  })
})
