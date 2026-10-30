import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { endsOnClosingVerdict } from '../kanban-verdict.js'
import { selectDeclaredWork, notYetDeclinedBy, buildPullNotice, type WorkCountCard } from '../idle-agent.js'

// Card 860db8cd, two halves of one complaint: the idle guard spends wakes on things that are not
// the agent's to do.
//  (1) A reviewer's CLOSING verdict ("VERDIKT: NINCS NYITOTT TETEL") as the last word on a testing
//      card counted as an unanswered finding for the assignee. Measured 2026-10-30: 102 of ford's
//      ~111 woken items were exactly this, and an empty ford was woken twice in one night.
//  (2) The pull notice asks a one-line "not my lane" comment, and nothing read it: jarvis, mandark
//      and zara had each commented on all four cards they kept being offered.

const h = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const os = require('node:os') as typeof import('node:os')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-860d-'))
  for (const d of ['root', 'x', 'rv']) {
    fs.mkdirSync(path.join(tmp, d))
    fs.writeFileSync(path.join(tmp, d, 'workcheck.json'),
      d === 'rv' ? '{"kind":"none","reviewer":true}' : '{"kind":"assigned_open_cards"}')
  }
  return {
    tmp,
    cards: [] as Record<string, unknown>[],
    // rows for `SELECT card_id, author, MAX(created_at)` and for the latest-comments query
    commentAt: [] as { card_id: string; author: string; at: number }[],
    latest: [] as { card_id: string; author: string; content: string }[],
    failLatest: false,
    createAgentMessage: vi.fn(),
    debug: vi.fn(),
  }
})
tmpDirs().adopt(h.tmp)

vi.mock('../config.js', async (orig) => ({
  ...(await orig<typeof import('../config.js')>()),
  PROJECT_ROOT: `${h.tmp}/root`,
}))
vi.mock('../logger.js', () => ({ logger: { debug: (...a: unknown[]) => h.debug(...a), info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('../web/agent-process.js', () => ({ capturePane: () => 'pane', isAgentRunning: (a: string) => a === 'x' }))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: (a: string) => `agent-${a}` }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x', 'rv'],
  agentDir: (a: string) => `${h.tmp}/${a}`,
  readAgentRemoteHost: () => null,
  readAgentProjects: () => null,
}))
vi.mock('../pane-state.js', () => ({
  detectPaneState: () => 'idle', busyEvidence: () => 'none',
  detectsUsageLimitReached: () => false, runningBackgroundWork: () => 0,
  detectsMidTurnApiError: () => false,
}))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: () => {} }))
vi.mock('../db.js', () => ({
  getPendingMessages: () => [],
  getLastOutboundMessageAt: () => null,
  listKanbanCards: () => h.cards,
  getLabelsForAllCards: () => new Map(),
  getDb: () => ({
    prepare: (sql: string) => ({
      all: () => {
        if (sql.includes('ROW_NUMBER')) {
          if (h.failLatest) throw new Error('boom')
          return h.latest
        }
        if (sql.includes('GROUP BY card_id, author') && !sql.includes('NOT IN')) return h.commentAt
        return []
      },
      get: () => undefined,
      run: () => ({ changes: 0 }),
    }),
  }),
  createAgentMessage: (...a: unknown[]) => { h.createAgentMessage(...a); return { id: 1 } },
  saveIdleGuardState: () => {},
  loadIdleGuardState: () => {
    const now = Date.now()
    return { idleSinceMs: now - 60 * 60_000, lastAlertAt: null, lastWakeAt: now - 60 * 60_000, updatedAt: now }
  },
}))

async function sweep(): Promise<void> {
  vi.resetModules()
  const { tick } = await import('../web/idle-agent-watcher.js')
  tick()
}
const toX = () => h.createAgentMessage.mock.calls.filter((c) => c[1] === 'x').map((c) => String(c[2]))
const nowSec = () => Math.floor(Date.now() / 1000)
/** The count the guard DECIDED on for x this tick, from its own per-decision debug line. */
const ownWorkCountOfX = () => {
  const line = h.debug.mock.calls.map((c) => c[0] as { agent?: string; ownWorkCount?: number })
    .filter((o) => o?.agent === 'x' && 'ownWorkCount' in o).at(-1)
  return line?.ownWorkCount
}

describe('endsOnClosingVerdict', () => {
  const c = (content: string, author = 'didi') => endsOnClosingVerdict({ author, content })
  it('a column-0 NINCS NYITOTT TETEL closes, in both separator forms and with accents', () => {
    expect(c('VERDIKT: NINCS NYITOTT TETEL | 7182d3dc @abc')).toBe(true)
    expect(c('intro\nVERDIKT: NINCS NYITOTT TÉTEL -- minden zold')).toBe(true)
  })
  it("the author's own stamp is not an indent, another author's is", () => {
    expect(c('[didi, 2026-10-14 23:13 CEST, date] VERDIKT: NINCS NYITOTT TETEL')).toBe(true)
    expect(c('[mandark, 2026-10-14 23:13 CEST, date] VERDIKT: NINCS NYITOTT TETEL')).toBe(false)
  })
  it('the LAST verdict line of the comment decides', () => {
    expect(c('VERDIKT: NINCS NYITOTT TETEL | r1\nVERDIKT: NYITOTT TETEL | r2')).toBe(false)
    expect(c('VERDIKT: NYITOTT TETEL | r1\nVERDIKT: NINCS NYITOTT TETEL | r2')).toBe(true)
  })
  it('an open, partial, indented, quoted or prose verdict does not close', () => {
    expect(c('VERDIKT: NYITOTT TETEL | hianyzik a teszt')).toBe(false)
    expect(c('VERDIKT: RÉSZLEGES @558a421bd6')).toBe(false)
    expect(c('  VERDIKT: NINCS NYITOTT TETEL')).toBe(false)
    expect(c('> VERDIKT: NINCS NYITOTT TETEL')).toBe(false)
    expect(c('didi 14:53 NINCS NYITOTT, de nem elo')).toBe(false)
    expect(c('')).toBe(false)
  })
})

describe('selectDeclaredWork: a reviewer who closed is not waiting on the assignee', () => {
  const card = { id: 'card0001', status: 'testing', assignee: 'x', archived_at: null } as WorkCountCard & { id: string }
  const comments = new Map([['card0001', new Map([['x', 100], ['rv', 200]])]])
  const reviewers = new Set(['rv'])
  const pick = (closing?: ReadonlyMap<string, string>) =>
    selectDeclaredWork({ kind: 'assigned_open_cards' }, 'x', [card], comments, 'marveen', 0, reviewers, undefined, closing)

  it('CONTROL: without the map the reviewer word still counts, as before', () => {
    expect(pick()).toHaveLength(1)
  })
  it('a closing verdict by that same reviewer takes the card off', () => {
    expect(pick(new Map([['card0001', 'rv']]))).toHaveLength(0)
  })
  it('a closing verdict by someone else decides nothing', () => {
    expect(pick(new Map([['card0001', 'didi']]))).toHaveLength(1)
  })
  it('a reviewer agent carries the same narrowing in its own half (testing_without_my_comment)', () => {
    // x commented and the card has no updated_at, so the testing half leaves it out: only the own
    // half (the assigned_open_cards selection) can hold it, and that half must get the map too.
    const pickR = (closing?: ReadonlyMap<string, string>) => selectDeclaredWork({ kind: 'testing_without_my_comment' },
      'x', [card], comments, 'marveen', 0, reviewers, undefined, closing)
    expect(pickR().map((c) => c.id)).toEqual(['card0001'])
    expect(pickR(new Map([['card0001', 'rv']]))).toHaveLength(0)
  })
})

describe('notYetDeclinedBy and the pull notice count', () => {
  it('drops only the cards THIS agent commented on', () => {
    const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const comments = new Map([['a', new Map([['x', 1]])], ['b', new Map([['zara', 1]])]])
    expect(notYetDeclinedBy(cards, 'x', comments).map((c) => c.id)).toEqual(['b', 'c'])
  })
  it('the notice names the declined count and adds it to the re-query comparison', () => {
    const msg = buildPullNotice('x', 30, [{ id: 'card0001', priority: 'normal' }], Date.now(), null, 1, 2)
    expect(msg).toContain('+ 2 gazdatlan kartya, amire mar kommentaltal')
    expect(msg).toContain('mint a fenti 4, a lista ELAVULT')
  })
  it('CONTROL: no declined line when there is none', () => {
    const msg = buildPullNotice('x', 30, [{ id: 'card0001', priority: 'normal' }], Date.now(), null, 0)
    expect(msg).not.toContain('amire mar kommentaltal')
    expect(msg).toContain('mint a fenti 1, a lista ELAVULT')
  })
})

describe('tick(): both halves reach the running guard', () => {
  beforeEach(() => {
    h.cards = []; h.commentAt = []; h.latest = []; h.failLatest = false
    h.createAgentMessage.mockReset(); h.debug.mockReset()
  })
  const testingCard = (id: string) => ({
    id, title: `t-${id}`, status: 'testing', assignee: 'x', priority: 'normal',
    archived_at: null, updated_at: nowSec(), due_date: null, project: null,
  })
  const orphan = (id: string) => ({
    id, title: `t-${id}`, status: 'planned', assignee: null, priority: 'normal',
    archived_at: null, updated_at: nowSec(), due_date: null, project: null,
  })

  it("CONTROL: an open reviewer verdict as the last word counts as the assignee's work", async () => {
    h.cards = [testingCard('open0001')]
    h.commentAt = [{ card_id: 'open0001', author: 'x', at: 100 }, { card_id: 'open0001', author: 'rv', at: 200 }]
    h.latest = [{ card_id: 'open0001', author: 'rv', content: 'VERDIKT: NYITOTT TETEL | hianyzik' }]
    await sweep()
    expect(ownWorkCountOfX()).toBe(1)
  })

  it("a closing reviewer verdict as the last word is not counted as the assignee's work", async () => {
    h.cards = [testingCard('clos0001')]
    h.commentAt = [{ card_id: 'clos0001', author: 'x', at: 100 }, { card_id: 'clos0001', author: 'rv', at: 200 }]
    h.latest = [{ card_id: 'clos0001', author: 'rv', content: 'VERDIKT: NINCS NYITOTT TETEL | ok' }]
    await sweep()
    expect(ownWorkCountOfX()).toBe(0)
  })

  it('a failed closing-verdict lookup counts every reviewer word, it does not silence the queue', async () => {
    h.cards = [testingCard('clos0002')]
    h.commentAt = [{ card_id: 'clos0002', author: 'x', at: 100 }, { card_id: 'clos0002', author: 'rv', at: 200 }]
    h.latest = [{ card_id: 'clos0002', author: 'rv', content: 'VERDIKT: NINCS NYITOTT TETEL | ok' }]
    h.failLatest = true
    await sweep()
    expect(ownWorkCountOfX()).toBe(1)
  })

  it('an ownerless card the agent already commented on is not offered again; the other one is', async () => {
    h.cards = [orphan('decl0001'), orphan('free0001')]
    h.commentAt = [{ card_id: 'decl0001', author: 'x', at: 100 }]
    await sweep()
    const pull = toX().filter((m) => m.includes('GAZDATLAN'))
    expect(pull).toHaveLength(1)
    expect(pull[0]).toContain('free0001')
    expect(pull[0]).not.toContain('decl0001')
    expect(pull[0]).toContain('+ 1 gazdatlan kartya, amire mar kommentaltal')
  })

  it('when the agent declined every ownerless card, no pull notice goes to it', async () => {
    h.cards = [orphan('decl0001')]
    h.commentAt = [{ card_id: 'decl0001', author: 'x', at: 100 }]
    await sweep()
    expect(toX().filter((m) => m.includes('GAZDATLAN'))).toHaveLength(0)
  })
})
