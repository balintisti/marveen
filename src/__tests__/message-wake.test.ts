// Card a85a9acd: the wake class of an inter-agent message. Pure rules first (message-wake.ts),
// then the database half: the column, the sender's flag, the claim and the 24 h expiry.
import { describe, it, expect, beforeAll } from 'vitest'
import {
  isWakeRow, wakeRows, deliverableRows, isUnwokenExpired, UNWOKEN_EXPIRY_S, UNWOKEN_EXPIRED_RESULT,
} from '../message-wake.js'
import {
  initDatabase, getDb, createAgentMessage, getPendingMessages, claimPendingForAgent,
  expireUnwokenMessages, getPendingBacklogByAgent, getRecipientQueueState, markMessageDelivered,
} from '../db.js'
import { decideNudgePreflight, INITIAL_NUDGE_STATE } from '../web/inbox-nudge-watcher.js'

describe('isWakeRow / wakeRows: only an explicit 0 is quiet', () => {
  it('absent, null and 1 wake; 0 does not', () => {
    expect(isWakeRow({})).toBe(true)
    expect(isWakeRow({ wake: null })).toBe(true)
    expect(isWakeRow({ wake: 1 })).toBe(true)
    expect(isWakeRow({ wake: 0 })).toBe(false)
  })
  it('wakeRows keeps order and drops the quiet rows', () => {
    const rows = [{ id: 1, wake: 0 }, { id: 2, wake: 1 }, { id: 3 }, { id: 4, wake: 0 }]
    expect(wakeRows(rows).map((r) => r.id)).toEqual([2, 3])
  })
})

describe('deliverableRows: a quiet row rides only with a waking row for the SAME recipient', () => {
  const row = (id: number, to: string, wake: number) => ({ id, to_agent: to, wake })
  it('a recipient with only quiet rows gets nothing', () => {
    expect(deliverableRows([row(1, 'a', 0), row(2, 'a', 0)])).toEqual([])
  })
  it('a quiet row is delivered with a waking row of the same recipient, in order', () => {
    const rows = [row(1, 'a', 0), row(2, 'a', 1), row(3, 'a', 0)]
    expect(deliverableRows(rows).map((r) => r.id)).toEqual([1, 2, 3])
  })
  it("another recipient's waking row does not carry a quiet row", () => {
    const rows = [row(1, 'a', 0), row(2, 'b', 1)]
    expect(deliverableRows(rows).map((r) => r.id)).toEqual([2])
  })
  it('a row with no wake field is waking (fixtures, old rows)', () => {
    expect(deliverableRows([{ id: 1, to_agent: 'a' }]).map((r) => r.id)).toEqual([1])
  })
})

describe('isUnwokenExpired: the 24 h boundary', () => {
  const now = 2_000_000_000
  it('23h59 is not expired, 24h is, 24h01 is', () => {
    expect(isUnwokenExpired({ wake: 0, created_at: now - (UNWOKEN_EXPIRY_S - 60) }, now)).toBe(false)
    expect(isUnwokenExpired({ wake: 0, created_at: now - UNWOKEN_EXPIRY_S }, now)).toBe(true)
    expect(isUnwokenExpired({ wake: 0, created_at: now - (UNWOKEN_EXPIRY_S + 60) }, now)).toBe(true)
  })
  it('a waking row of any age is never expired', () => {
    expect(isUnwokenExpired({ wake: 1, created_at: now - 30 * UNWOKEN_EXPIRY_S }, now)).toBe(false)
    expect(isUnwokenExpired({ created_at: now - 30 * UNWOKEN_EXPIRY_S }, now)).toBe(false)
  })
})

beforeAll(() => { initDatabase(':memory:') })

const age = (id: number, seconds: number) =>
  getDb().prepare('UPDATE agent_messages SET created_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - seconds, id)
const rowOf = (id: number) =>
  getDb().prepare('SELECT * FROM agent_messages WHERE id = ?').get(id) as Record<string, unknown>

describe('createAgentMessage: the sender marks the wake class', () => {
  it('defaults to waking; { wake: false } writes 0; the returned row says which', () => {
    const w = createAgentMessage('system', 'wk-a', 'hello')
    const q = createAgentMessage('system', 'wk-a', 'quiet', undefined, undefined, { wake: false })
    const t = createAgentMessage('system', 'wk-a', 'explicitly waking', undefined, undefined, { wake: true })
    expect([w.wake, q.wake, t.wake]).toEqual([1, 0, 1])
    expect([rowOf(w.id).wake, rowOf(q.id).wake, rowOf(t.id).wake]).toEqual([1, 0, 1])
  })
  it('the other optional parameters still land with the flag', () => {
    const m = createAgentMessage('system', 'wk-a', 'x', 'note', { trace_id: 't', span_id: 's', parent_span_id: null }, { wake: false })
    const r = rowOf(m.id)
    expect([r.origin_note, r.trace_id, r.span_id, r.wake]).toEqual(['note', 't', 's', 0])
  })
  it('a row inserted by hand without the column reads as waking (column default)', () => {
    getDb().prepare("INSERT INTO agent_messages (from_agent,to_agent,content,status,created_at) VALUES ('s','wk-b','c','pending',1)").run()
    expect(getPendingMessages('wk-b')[0].wake).toBe(1)
  })
})

describe('a quiet row stays pending, the nudge decision says no, and the drain carries it', () => {
  it('end to end on the real table', () => {
    const to = 'wk-main'
    const q = createAgentMessage('system', to, 'quiet notice', undefined, undefined, { wake: false })
    age(q.id, 3600)
    // 1. still pending
    const pending = getPendingMessages(to)
    expect(pending.map((r) => r.id)).toEqual([q.id])
    // 2. the nudge sees an empty inbox: no oldest id, no nudge, however old the row is
    const waking = wakeRows(pending)
    expect(waking).toEqual([])
    const d = decideNudgePreflight({ now: Date.now(), oldestId: waking[0]?.id ?? null, oldestAgeMs: 0 }, INITIAL_NUDGE_STATE)
    expect(d.proceed).toBe(false)
    // 3. POSITIVE CONTROL: a waking row of the same age DOES produce a nudge
    const w = createAgentMessage('system', to, 'waking notice')
    age(w.id, 3600)
    const waking2 = wakeRows(getPendingMessages(to))
    expect(waking2.map((r) => r.id)).toEqual([w.id])
    const d2 = decideNudgePreflight({ now: Date.now(), oldestId: waking2[0].id, oldestAgeMs: 3_600_000 }, INITIAL_NUDGE_STATE)
    expect(d2.proceed).toBe(true)
    // 4. the drain claims EVERYTHING, quiet row included, in FIFO order
    const claimed = claimPendingForAgent(to, 50)
    expect(claimed.map((r) => r.id)).toEqual([q.id, w.id])
    expect(claimed.map((r) => r.wake)).toEqual([0, 1])
    expect(getPendingMessages(to)).toEqual([])
  })
})

describe('expireUnwokenMessages: quiet rows close at 24 h, waking rows never', () => {
  it('23h59 stays pending; 24h01 closes done/unwoken-expired with completed_at and no delivered_at', () => {
    const to = 'wk-exp'
    const young = createAgentMessage('system', to, 'young', undefined, undefined, { wake: false })
    const old = createAgentMessage('system', to, 'old', undefined, undefined, { wake: false })
    age(young.id, UNWOKEN_EXPIRY_S - 60)
    age(old.id, UNWOKEN_EXPIRY_S + 60)
    const before = Math.floor(Date.now() / 1000)
    expect(expireUnwokenMessages()).toBe(1)
    expect(rowOf(young.id).status).toBe('pending')
    const r = rowOf(old.id)
    expect(r.status).toBe('done')
    expect(r.result).toBe(UNWOKEN_EXPIRED_RESULT)
    expect(r.result).toBe('unwoken-expired')
    expect(r.completed_at as number).toBeGreaterThanOrEqual(before)
    expect(r.delivered_at).toBeNull()
  })
  it('a waking row of any age is never touched, and a second sweep closes nothing', () => {
    const to = 'wk-exp2'
    const w = createAgentMessage('system', to, 'waking, ancient')
    age(w.id, 90 * UNWOKEN_EXPIRY_S)
    expect(expireUnwokenMessages()).toBe(0)
    expect(rowOf(w.id).status).toBe('pending')
    expect(expireUnwokenMessages()).toBe(0)
  })
  it('only PENDING quiet rows close: a quiet row already delivered keeps its status', () => {
    const to = 'wk-exp3'
    const q = createAgentMessage('system', to, 'q', undefined, undefined, { wake: false })
    age(q.id, 2 * UNWOKEN_EXPIRY_S)
    expect(markMessageDelivered(q.id)).toBe(true)
    expect(expireUnwokenMessages()).toBe(0)
    expect(rowOf(q.id).status).toBe('delivered')
  })
  it('the expiry boundary is the injected clock, not the wall clock', () => {
    const to = 'wk-exp4'
    const q = createAgentMessage('system', to, 'q', undefined, undefined, { wake: false })
    const created = rowOf(q.id).created_at as number
    // other tests' quiet rows are in the table too, so the row's own status is the measure
    expireUnwokenMessages((created + UNWOKEN_EXPIRY_S - 1) * 1000)
    expect(rowOf(q.id).status).toBe('pending')
    expireUnwokenMessages((created + UNWOKEN_EXPIRY_S) * 1000)
    expect(rowOf(q.id).status).toBe('done')
  })
})

describe('the backlog readers do not count quiet rows', () => {
  it('getPendingBacklogByAgent and getRecipientQueueState see only the waking rows', () => {
    const to = 'wk-count'
    const q = createAgentMessage('system', to, 'quiet quiet quiet', undefined, undefined, { wake: false })
    age(q.id, 7200)
    expect(getPendingBacklogByAgent(to)).toEqual([])
    expect(getRecipientQueueState(to)).toMatchObject({ queueDepth: 0, oldestPendingSec: 0, pendingChars: 0 })
    const w = createAgentMessage('system', to, 'waking')
    age(w.id, 60)
    const [b] = getPendingBacklogByAgent(to)
    expect(b.pending).toBe(1)
    expect(b.oldestAgeSeconds).toBeLessThan(7200)
    expect(getRecipientQueueState(to)).toMatchObject({ queueDepth: 1, pendingChars: 'waking'.length })
  })
})
