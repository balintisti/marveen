import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

// Card 860db8cd, didi's review 2026-10-30: closingVerdictByCard against a REAL SQLite, not a mocked
// statement. (1) a later closing verdict must not silence ANOTHER reviewer's open one; (2) the census
// skip and the three-row window are SQL behaviour, which a mocked prepare() cannot see.

const h = vi.hoisted(() => ({ db: null as unknown as import('better-sqlite3').Database }))

vi.mock('../logger.js', () => ({ logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('../web/agent-process.js', () => ({ capturePane: () => '', isAgentRunning: () => true }))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: (a: string) => `agent-${a}` }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => [], agentDir: () => '/nonexistent', readAgentRemoteHost: () => null, readAgentProjects: () => null,
}))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: () => {} }))
vi.mock('../db.js', () => ({
  getPendingMessages: () => [], getLastOutboundMessageAt: () => null, listKanbanCards: () => [],
  getLabelsForAllCards: () => new Map(), getDb: () => h.db,
  createAgentMessage: () => ({ id: 1 }), saveIdleGuardState: () => {}, loadIdleGuardState: () => null,
}))

const { closingVerdictByCard } = await import('../web/idle-agent-watcher.js')

const CLOSED = 'VERDIKT: NINCS NYITOTT TETEL | ok'
const OPEN = 'VERDIKT: NYITOTT TETEL | KOZEPES: hianyzik'
const CENSUS = '2026-10-30 05:00 CET -- jarvis testing-cenzus: 3 kartya'
let at = 0

function card(id: string, status = 'testing', archived: number | null = null) {
  h.db.prepare('INSERT INTO kanban_cards (id, status, archived_at) VALUES (?, ?, ?)').run(id, status, archived)
}
function comment(cardId: string, author: string, content: string) {
  h.db.prepare('INSERT INTO kanban_comments (card_id, author, content, created_at) VALUES (?, ?, ?, ?)')
    .run(cardId, author, content, ++at)
}

describe('closingVerdictByCard on a real SQLite', () => {
  beforeEach(() => {
    h.db = new Database(':memory:')
    h.db.exec(`
      CREATE TABLE kanban_cards (id TEXT PRIMARY KEY, status TEXT NOT NULL, archived_at INTEGER);
      CREATE TABLE kanban_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL,
        author TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);`)
    at = 0
  })

  it('CONTROL: one reviewer who closed -> the card is in the map under that reviewer', () => {
    card('c1'); comment('c1', 'x', 'kesz'); comment('c1', 'didi', CLOSED)
    expect(closingVerdictByCard()).toEqual(new Map([['c1', 'didi']]))
  })

  it("a later closing verdict does not silence another reviewer's open one", () => {
    card('c1'); comment('c1', 'didi', OPEN); comment('c1', 'mandark', CLOSED)
    expect(closingVerdictByCard()?.has('c1')).toBe(false)
  })

  it('an open verdict its own author closed later no longer counts', () => {
    card('c1'); comment('c1', 'didi', OPEN); comment('c1', 'didi', CLOSED); comment('c1', 'mandark', CLOSED)
    expect(closingVerdictByCard()?.get('c1')).toBe('mandark')
  })

  it('an open MARADEK leftover keeps the card counted, as the closing gate does', () => {
    card('c1'); comment('c1', 'x', 'MARADEK: a mobil fele | 1234abcd'); comment('c1', 'didi', CLOSED)
    expect(closingVerdictByCard()?.has('c1')).toBe(false)
  })

  it('census comments on top are skipped: two still let the closing verdict decide, three hide it', () => {
    card('two'); comment('two', 'didi', CLOSED); comment('two', 'jarvis', CENSUS); comment('two', 'jarvis', CENSUS)
    card('three'); comment('three', 'didi', CLOSED)
    for (let i = 0; i < 3; i++) comment('three', 'jarvis', CENSUS)
    const map = closingVerdictByCard()
    expect(map?.get('two')).toBe('didi')
    expect(map?.has('three')).toBe(false)
  })

  it('only live testing cards are read', () => {
    card('arch', 'testing', 1); comment('arch', 'didi', CLOSED)
    card('prog', 'in_progress'); comment('prog', 'didi', CLOSED)
    expect(closingVerdictByCard()?.size).toBe(0)
  })

  it('a broken database is undefined (not measured), never an empty "nothing closed" map', () => {
    h.db.close()
    expect(closingVerdictByCard()).toBeUndefined()
  })
})
