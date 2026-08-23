/**
 * POST /api/memories/backfill -- the status code and the body must agree.
 *
 * Card a6685b0f. The old handler answered `{"ok":true,"count":0}` with HTTP 200
 * whether every memory already had a vector or every single attempt had just
 * failed. Two nights running, the dream-engine called it, read 200, and moved
 * on while 161 memories waited. A caller that only looks at the status -- a
 * probe, a `curl -f`, a shell `&&` -- had nothing to look at.
 *
 * 503 is reserved for the TOTAL failure: there was work and none of it got
 * done. A partial run stays 200, because something did happen; `ok:false` in
 * the body carries the rest. Both readings then agree on the worst case, which
 * is the only case where disagreeing is dangerous.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { initDatabase, getDb } from '../db.js'
import { tryHandleMemories } from '../web/routes/memories.js'
import type { RouteContext } from '../web/routes/types.js'

// An empty OLLAMA_URL makes every embedding attempt fail deterministically,
// WITHOUT depending on whether Ollama happens to be running on this machine.
// It is running here right now (since 08-21 08:54, coverage back to 546/546),
// which is exactly why the test must not ask.
vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof import('../config.js')>('../config.js')
  return { ...actual, MAIN_AGENT_ID: 'agent-a', ALLOWED_CHAT_ID: 'test-chat', OLLAMA_URL: '' }
})

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

function makeCtx(): { ctx: RouteContext; status: () => number; body: () => any } {
  let code = 0
  let responseBody = ''
  const res = {
    writeHead: (c: number) => { code = c },
    end: (b?: string) => { responseBody = b || '' },
  }
  return {
    ctx: {
      req: {} as never,
      res: res as never,
      path: '/api/memories/backfill',
      method: 'POST',
      url: new URL('http://localhost:3420/api/memories/backfill'),
    },
    status: () => code,
    body: () => (responseBody ? JSON.parse(responseBody) : null),
  }
}

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  // In-memory: initDatabase() with no argument writes store/claudeclaw.db into
  // the checkout, which the live-install gate treats as a production marker --
  // one run would leave the worktree unable to run the suite again.
  initDatabase(':memory:')
})

function markAllVectorized(): void {
  getDb().prepare('UPDATE memories SET embedding = ?').run(JSON.stringify([0.1]))
}

function insertUnvectorized(n: number): void {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const stmt = db.prepare(
    `INSERT INTO memories (chat_id, topic_key, content, sector, salience,
     created_at, accessed_at, agent_id, category, auto_generated, keywords)
     VALUES (?, NULL, ?, 'semantic', 1.0, ?, ?, 'route-test-agent', 'cold', 0, NULL)`,
  )
  for (let i = 0; i < n; i++) stmt.run('test-chat', `route backfill row ${i}`, now, now)
}

describe('POST /api/memories/backfill', () => {
  it('answers 200 and ok:true when there was nothing to do', async () => {
    markAllVectorized()
    const { ctx, status, body } = makeCtx()
    expect(await tryHandleMemories(ctx)).toBe(true)
    expect(status()).toBe(200)
    expect(body().ok).toBe(true)
    expect(body().pending).toBe(0)
    expect(body().embedded).toBe(0)
  })

  it('answers 503 and ok:false when there was work and none of it succeeded', async () => {
    // Same `embedded: 0` as the test above. That is the entire point: the two
    // used to be one response.
    markAllVectorized()
    insertUnvectorized(4)
    const { ctx, status, body } = makeCtx()
    expect(await tryHandleMemories(ctx)).toBe(true)
    expect(status()).toBe(503)
    expect(body().ok).toBe(false)
    expect(body().embedded).toBe(0)
    expect(body().pending).toBe(4)
    expect(body().error).toBeTruthy()
  })

  it('names a reason the operator can act on, not just "failed"', async () => {
    // "Backfill failed" would send the reader to the logs -- which is where
    // this bug lived, unread, for two nights.
    markAllVectorized()
    insertUnvectorized(2)
    const { ctx, body } = makeCtx()
    await tryHandleMemories(ctx)
    expect(String(body().error).length).toBeGreaterThan(10)
  })

  it('reports how many are still waiting, so the next run has a target', async () => {
    markAllVectorized()
    insertUnvectorized(6)
    const { ctx, body } = makeCtx()
    await tryHandleMemories(ctx)
    expect(body().remaining).toBe(6)
  })
})

describe('web/app.js -- the dashboard toast', () => {
  // Source-pinned: this is a browser handler with no test harness in the repo,
  // and the defect is a MESSAGE shown to a person. "0 memories vectorized" was
  // the success toast for a run in which everything failed.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'web', 'app.js'),
    'utf-8',
  ) as string

  it('branches on ok:false instead of printing the count unconditionally', () => {
    expect(src).toMatch(/data\.ok === false/)
    expect(src).toMatch(/memories\.toast\.vector_failed/)
  })

  it('puts the REASON in the failure toast', () => {
    expect(src).toMatch(/reason: data\.error/)
  })

  it('reads the new field name, not the removed `count`', () => {
    expect(src).toMatch(/data\.embedded/)
    expect(src).not.toMatch(/vector_count', \{ count: data\.count \}/)
  })
})
