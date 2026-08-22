import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import {
  initDatabase,
  getDb,
  saveAgentMemory,
  getAgentMemories,
  updateMemory,
  clearMemoryCache,
  getMemoryCacheSize,
  backfillEmbeddings,
} from '../db.js'

// All tests use an in-memory SQLite database so they never touch the real store.
beforeAll(() => {
  process.env.NODE_ENV = 'test'
  initDatabase(':memory:')
})

beforeEach(() => {
  clearMemoryCache()
})

// ---------------------------------------------------------------------------
// 1. SQLite pragmas
// ---------------------------------------------------------------------------
describe('SQLite performance pragmas', () => {
  it('cache_size is set to -65536 (64 MB)', () => {
    const row = getDb().pragma('cache_size', { simple: true })
    expect(row).toBe(-65536)
  })

  it('synchronous is NORMAL (1)', () => {
    // SQLite reports NORMAL as integer 1.
    const row = getDb().pragma('synchronous', { simple: true })
    expect(row).toBe(1)
  })

  // journal_mode and mmap_size cannot be verified on :memory: databases:
  // - WAL is silently downgraded to 'memory' journal for in-memory DBs.
  // - mmap_size is a no-op without a backing file.
  // Both are applied on the real on-disk DB; here we only test the pragmas
  // that behave identically regardless of the storage path.
})

// ---------------------------------------------------------------------------
// 2. In-process TTL cache
// ---------------------------------------------------------------------------
describe('getAgentMemories in-process cache', () => {
  const AGENT = 'cache-test-agent'

  it('cold miss: returns data from DB, cache is populated', () => {
    saveAgentMemory(AGENT, 'First memory', 'warm', 'keyword1')
    const before = getMemoryCacheSize()
    getAgentMemories(AGENT, 5)
    expect(getMemoryCacheSize()).toBe(before + 1)
  })

  it('warm hit: second call returns same object from cache (no DB round-trip)', () => {
    saveAgentMemory(AGENT, 'Cache hit check', 'warm', 'keyword2')
    const first = getAgentMemories(AGENT, 5)
    const second = getAgentMemories(AGENT, 5)
    // Same array reference means the cache was hit.
    expect(second).toBe(first)
  })

  it('cache key is per agentId+limit: different limit = separate entry', () => {
    getAgentMemories(AGENT, 5)
    getAgentMemories(AGENT, 10)
    // Both limit variants should be cached as separate entries.
    expect(getMemoryCacheSize()).toBeGreaterThanOrEqual(2)
  })

  it('saveAgentMemory invalidates the cache for that agent', () => {
    const before = getAgentMemories(AGENT, 5)
    saveAgentMemory(AGENT, 'Invalidation trigger', 'hot', 'new')
    // After write the cache for this agent should be gone.
    expect(getMemoryCacheSize()).toBe(0)
    const after = getAgentMemories(AGENT, 5)
    // Different reference: fresh DB read.
    expect(after).not.toBe(before)
    // New memory must appear.
    expect(after.some(m => m.content === 'Invalidation trigger')).toBe(true)
  })

  it('updateMemory with agentId invalidates the cache', () => {
    const { id } = saveAgentMemory(AGENT, 'Update me', 'warm', 'upd')
    getAgentMemories(AGENT, 5) // warm the cache
    const sizeBefore = getMemoryCacheSize()
    updateMemory(id, 'Updated content', 'warm', AGENT, 'upd')
    expect(getMemoryCacheSize()).toBeLessThan(sizeBefore)
  })

  it('cache is isolated between agents', () => {
    const OTHER = 'other-agent'
    saveAgentMemory(AGENT, 'Agent A memory', 'cold', 'a')
    saveAgentMemory(OTHER, 'Agent B memory', 'cold', 'b')
    getAgentMemories(AGENT, 5)
    getAgentMemories(OTHER, 5)
    const sizeBefore = getMemoryCacheSize()
    // Write to AGENT should not evict OTHER's cache entry.
    saveAgentMemory(AGENT, 'New for agent A', 'hot')
    const sizeAfter = getMemoryCacheSize()
    // At least one entry (OTHER's) should survive.
    expect(sizeAfter).toBeGreaterThan(0)
    expect(sizeAfter).toBeLessThan(sizeBefore)
  })

  it('clearMemoryCache wipes all entries', () => {
    getAgentMemories(AGENT, 5)
    expect(getMemoryCacheSize()).toBeGreaterThan(0)
    clearMemoryCache()
    expect(getMemoryCacheSize()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 3. Embedding backfill
// ---------------------------------------------------------------------------
describe('backfillEmbeddings', () => {
  // WHAT THESE USED TO ASSERT, AND WHY IT LET THE BUG THROUGH (rewritten
  // 2026-08-22, card a6685b0f). The old version checked `typeof count ===
  // 'number'` and `count >= 0`. Both are true of the broken implementation and
  // of the fixed one, on a machine with Ollama and on a machine without -- so
  // the test was green for two nights while the vectorizer sat dead and the
  // endpoint reported success. A test that cannot fail is documentation with a
  // green tick next to it.
  //
  // The failure paths now live in embedding-silent-success.test.ts, which
  // drives a fake backend so the result does not depend on whether Ollama
  // happens to be running here. What stays here are the INVARIANTS: the
  // relationships between the fields that must hold in every world.
  it('returns a result whose fields agree with each other', async () => {
    const r = await backfillEmbeddings()
    expect(r.remaining).toBe(r.pending - r.embedded)
    expect(r.embedded + r.failed).toBeLessThanOrEqual(r.pending)
    expect(r.ok).toBe(r.failed === 0)
  })

  it('carries a reason whenever something failed, and none when nothing did', async () => {
    const r = await backfillEmbeddings()
    if (r.failed > 0) expect(r.error).not.toBeNull()
    else expect(r.error).toBeNull()
  })

  it('leaves every embedding column either NULL or valid JSON', async () => {
    const BACKFILL_AGENT = 'backfill-test-agent'
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    const result = db.prepare(
      `INSERT INTO memories (chat_id, topic_key, content, sector, salience,
       created_at, accessed_at, agent_id, category, auto_generated, keywords)
       VALUES (?, NULL, ?, 'semantic', 1.0, ?, ?, ?, 'cold', 0, NULL)`
    ).run('test-chat', 'Backfill target content', now, now, BACKFILL_AGENT)
    const id = Number(result.lastInsertRowid)

    const rowBefore = db.prepare('SELECT embedding FROM memories WHERE id = ?').get(id) as { embedding: string | null }
    expect(rowBefore.embedding).toBeNull()

    await backfillEmbeddings()

    const rowAfter = db.prepare('SELECT embedding FROM memories WHERE id = ?').get(id) as { embedding: string | null }
    if (rowAfter.embedding !== null) {
      expect(() => JSON.parse(rowAfter.embedding!)).not.toThrow()
      expect(Array.isArray(JSON.parse(rowAfter.embedding!))).toBe(true)
    }
  })
})
