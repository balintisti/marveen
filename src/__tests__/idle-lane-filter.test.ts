import { describe, it, expect } from 'vitest'
import { laneFilteredPullList, orphanPullList, topOfPullList } from '../idle-agent.js'

// Card e4a1ff49. The numbers below are the real ownerless pool on 2026-09-03:
// 87 cards, 49 delta-crm, 32 marveen, 6 with no project -- and friday was offered
// five cards of which all five were delta-crm, a lane he does not work in.
const card = (id: string, project: string | null, priority = 'normal') => ({
  id, project, priority, status: 'planned', assignee: '', updated_at: 1,
})

const POOL = [
  card('dc-high-1', 'delta-crm', 'high'),
  card('dc-high-2', 'delta-crm', 'high'),
  card('dc-norm-1', 'delta-crm'),
  card('mv-norm-1', 'marveen'),
  card('mv-norm-2', 'marveen'),
  card('unclassified', null),
  card('empty-string', ''),
]

describe('laneFilteredPullList', () => {
  it('keeps only the declared lane, plus everything unclassified', () => {
    const got = laneFilteredPullList(POOL, ['marveen']).map(c => c.id)
    expect(got).toEqual(['mv-norm-1', 'mv-norm-2', 'unclassified', 'empty-string'])
  })

  it('lets a cross-lane agent declare BOTH', () => {
    // jarvis and marveen are 54.5% / 65.0% split across projects -- their correct
    // lane is both, and the field has to be able to say so.
    expect(laneFilteredPullList(POOL, ['marveen', 'delta-crm'])).toHaveLength(POOL.length)
  })

  // THE LOAD-BEARING DEFAULT. A filter showing too much is today's behaviour; one
  // showing too little starves an agent and inverts the guard's purpose.
  it('filters by NOTHING when the agent declares no lane', () => {
    expect(laneFilteredPullList(POOL, null)).toEqual(POOL)
    expect(laneFilteredPullList(POOL, undefined)).toEqual(POOL)
    expect(laneFilteredPullList(POOL, [])).toEqual(POOL)
    // Whitespace-only is a declaration of nothing, not a lane called " ".
    expect(laneFilteredPullList(POOL, ['  '])).toEqual(POOL)
  })

  it('never hides an unclassified card from anyone', () => {
    // An empty project is a missing answer, not a lane. 27% of the whole board
    // carried an empty project on 08-29; hiding those would make a card with one
    // unfilled field invisible to the entire fleet.
    for (const lanes of [['marveen'], ['delta-crm'], ['nonexistent']]) {
      const ids = laneFilteredPullList(POOL, lanes).map(c => c.id)
      expect(ids).toContain('unclassified')
      expect(ids).toContain('empty-string')
    }
  })

  it('yields ONLY unclassified cards for a lane nobody uses -- not a crash, not everything', () => {
    expect(laneFilteredPullList(POOL, ['nonexistent']).map(c => c.id))
      .toEqual(['unclassified', 'empty-string'])
  })

  // The regression this card is about, end to end through the real pipeline.
  it('stops a lane-foreign high card from heading a marveen agent list', () => {
    const before = topOfPullList(orphanPullList(POOL, Date.now()))
    expect(before[0]!.project).toBe('delta-crm') // today: the 49 outrank the 32

    const after = topOfPullList(
      laneFilteredPullList(orphanPullList(POOL, Date.now()), ['marveen']),
    )
    expect(after[0]!.project).not.toBe('delta-crm')
    expect(after.map(c => c.id)).not.toContain('dc-high-1')
  })

  it('is order-preserving, so ranking stays the ranker s job', () => {
    // If this ever starts sorting, two functions decide order and only one is tested.
    const got = laneFilteredPullList(POOL, ['delta-crm']).map(c => c.id)
    expect(got).toEqual(['dc-high-1', 'dc-high-2', 'dc-norm-1', 'unclassified', 'empty-string'])
  })
})
