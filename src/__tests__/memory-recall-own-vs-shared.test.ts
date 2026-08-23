import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { initDatabase, getDb, saveAgentMemory, getAgentMemories, clearMemoryCache } from '../db.js'

// The shared tier used to crowd an agent out of its own recall.
//
// Measured on the real store 2026-08-22: 76 of 535 memories were 'shared', and
// 70 of those belonged to ONE agent. A second agent with 13 memories of his own
// asked for his recall and got a 50-row window holding NINE of them -- the flat
// `WHERE (agent_id = ? OR category = 'shared') ORDER BY accessed_at` put the
// other agent's shared notes above his own.
//
// It was first reported as a broken `agent` filter. It was not: rows coming
// back for an unknown agent ARE the shared tier, which is what shared means.
// The defect was the ratio. These tests hold the ratio, not the WHERE clause.
beforeAll(() => {
  process.env.NODE_ENV = 'test'
  initDatabase(':memory:')
})
beforeEach(() => clearMemoryCache())

// accessed_at is set EXPLICITLY, and that is the whole point of the fixture.
//
// Without it every row lands in the same second, SQLite is free to return them
// in any order, and the flat-union bug does not reproduce -- the test then
// passes against the broken code. Measured: with implicit timestamps a
// mutation back to the flat union failed only ONE of these six tests, and not
// the one that matters. The real store had the shared rows genuinely more
// recently accessed; the fixture has to say so.
const seed = (agent: string, n: number, category: 'cold' | 'shared', tag: string, accessedAt: number) => {
  const db = getDb()
  for (let i = 0; i < n; i++) {
    const { id } = saveAgentMemory(agent, `${tag} ${i}`, category, tag)
    db.prepare('UPDATE memories SET accessed_at = ? WHERE id = ?').run(accessedAt + i, id)
  }
}

// Own memories are OLDER than the shared flood: recency alone would bury them.
const OWN_AT = 1_000_000
const SHARED_AT = 2_000_000

describe('getAgentMemories: own memories are never crowded out by the shared tier', () => {
  it('gives a small owner ALL of their own memories inside the window', () => {
    const OWNER = 'recall-small-owner'
    // The measured shape: few own memories, a flood of shared ones from
    // elsewhere, and the shared ones written LATER so recency favours them.
    seed(OWNER, 13, 'cold', 'own', OWN_AT)
    seed('recall-flooder', 70, 'shared', 'flood', SHARED_AT)

    const got = getAgentMemories(OWNER, 50)
    const mine = got.filter(m => m.agent_id === OWNER)
    expect(mine.length).toBe(13)
    expect(got.length).toBe(50)
  })

  it('still delivers the shared tier -- this is not own-only', () => {
    const OWNER = 'recall-shared-reaches'
    seed(OWNER, 13, 'cold', 'own', OWN_AT)
    seed('recall-flooder2', 70, 'shared', 'flood', SHARED_AT)

    const got = getAgentMemories(OWNER, 50)
    expect(got.filter(m => m.agent_id !== OWNER).length).toBeGreaterThan(0)
  })

  it('splits the window evenly when the owner has more than half a window', () => {
    const OWNER = 'recall-big-owner'
    seed(OWNER, 80, 'cold', 'own', OWN_AT)
    seed('recall-flooder3', 80, 'shared', 'flood', SHARED_AT)

    const got = getAgentMemories(OWNER, 50)
    const mine = got.filter(m => m.agent_id === OWNER).length
    // Alternating merge: neither source takes the window from the other.
    expect(mine).toBe(25)
    expect(got.length - mine).toBe(25)
  })

  it('an agent with no memories of its own still gets the shared tier', () => {
    // The negative control from the original report: an unknown agent returning
    // rows is CORRECT. Locking it here so a later "fix" does not make shared
    // unreachable in the name of filtering.
    seed('recall-flooder4', 20, 'shared', 'flood', SHARED_AT)
    const got = getAgentMemories('recall-agent-with-nothing', 50)
    expect(got.length).toBeGreaterThan(0)
    expect(got.every(m => m.category === 'shared')).toBe(true)
  })

  it('a category-scoped recall stays own-only (a memory has one category)', () => {
    const OWNER = 'recall-category-scoped'
    seed(OWNER, 5, 'cold', 'own', OWN_AT)
    seed('recall-flooder5', 20, 'shared', 'flood', SHARED_AT)

    const got = getAgentMemories(OWNER, 50, 'cold')
    expect(got.length).toBe(5)
    expect(got.every(m => m.agent_id === OWNER)).toBe(true)
  })

  it('asking for the shared tier explicitly returns it unsplit', () => {
    const OWNER = 'recall-asks-shared'
    seed(OWNER, 5, 'cold', 'own', OWN_AT)
    seed('recall-flooder6', 20, 'shared', 'flood', SHARED_AT)

    // The suite shares one in-memory DB, so earlier seeds are visible here.
    // Assert the PROPERTY (shared only, own excluded), not a global count.
    const got = getAgentMemories(OWNER, 50, 'shared')
    expect(got.length).toBeGreaterThanOrEqual(20)
    expect(got.every(m => m.category === 'shared')).toBe(true)
    expect(got.some(m => m.keywords === 'flood')).toBe(true)
  })
})
