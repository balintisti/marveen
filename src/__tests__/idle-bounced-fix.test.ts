import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

// Card 1affb872, Isti TG 8509: "mindig logikusabb lenne eloszor a tesztelesen visszadobott
// javitasokat kijavitani utana uj kartyat felvenni". The idle guard names the agent's own cards
// with an OPEN reviewer verdict first, before any new card, whatever the priorities.

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

const { bouncedCardIds } = await import('../web/idle-agent-watcher.js')
const { buildWakeMessage } = await import('../idle-agent.js')

const OPEN = 'VERDIKT: NYITOTT TETEL | KOZEPES: a 409 ag nincs rogzitve'
const CLOSED = 'VERDIKT: NINCS NYITOTT TETEL | ok'
const NOW = Date.parse('2026-10-30T09:30:00Z')
let at = 0

const card = (id: string, status: string, priority = 'normal', assignee = 'dexter') =>
  ({ id, title: `t ${id}`, priority, status, assignee, due_date: null })
function comment(cardId: string, author: string, content: string) {
  h.db.prepare('INSERT INTO kanban_comments (card_id, author, content, created_at) VALUES (?, ?, ?, ?)')
    .run(cardId, author, content, ++at)
}
// The card ids the wake LISTS, in the order it lists them (each card line starts with two spaces).
const listed = (msg: string) => msg.split('\n').filter((l) => /^ {2}[0-9a-z]{8} {2}/.test(l)).map((l) => l.trim().slice(0, 8))

beforeEach(() => {
  h.db = new Database(':memory:')
  h.db.exec(`CREATE TABLE kanban_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL,
    author TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);`)
  at = 0
})

describe('bouncedCardIds on a real SQLite (1affb872)', () => {
  it('CONTROL: an open reviewer verdict on the own testing card -> bounced', () => {
    comment('bnc11111', 'dexter', 'Kesz: ...'); comment('bnc11111', 'didi', OPEN)
    expect(bouncedCardIds('dexter', [card('bnc11111', 'testing')])).toEqual(new Set(['bnc11111']))
  })
  it('an in_progress card with an open verdict is bounced too', () => {
    comment('bnc11111', 'didi', OPEN)
    expect(bouncedCardIds('dexter', [card('bnc11111', 'in_progress')])).toEqual(new Set(['bnc11111']))
  })
  it('a closed verdict, the agent\'s own NYITOTT line, and a closed-later verdict are not bounced', () => {
    comment('c1', 'didi', CLOSED)
    comment('c2', 'dexter', OPEN)
    comment('c3', 'didi', OPEN); comment('c3', 'didi', CLOSED)
    expect(bouncedCardIds('dexter', [card('c1', 'testing'), card('c2', 'testing'), card('c3', 'testing')])?.size).toBe(0)
  })
  it('ANSWERED is not bounced: the agent commented after the open verdict (the fix is handed back)', () => {
    comment('ans11111', 'didi', OPEN); comment('ans11111', 'dexter', 'Javitva: 1187 rogzitve, didi ujra')
    expect(bouncedCardIds('dexter', [card('ans11111', 'testing')])?.size).toBe(0)
    // ...and a NEW open verdict after that answer bounces it again
    comment('ans11111', 'didi', OPEN)
    expect(bouncedCardIds('dexter', [card('ans11111', 'testing')])).toEqual(new Set(['ans11111']))
  })
  it('only the agent\'s own testing/in_progress cards are read', () => {
    comment('oth11111', 'didi', OPEN); comment('pln11111', 'didi', OPEN)
    expect(bouncedCardIds('dexter', [card('oth11111', 'testing', 'normal', 'ford'), card('pln11111', 'planned')])?.size).toBe(0)
  })
  it('a broken database is undefined (not measured), never an empty set', () => {
    h.db.close()
    expect(bouncedCardIds('dexter', [card('bnc11111', 'testing')])).toBeUndefined()
  })
})

describe('the wake names a bounced fix before any new card (1affb872)', () => {
  const items = [card('new11111', 'planned', 'urgent'), card('bnc11111', 'testing', 'normal')]

  it('CONTROL: an urgent planned card and a bounced testing card -> the bounced one is named first', () => {
    const msg = buildWakeMessage('dexter', 13, 2, items, NOW, 'assigned_open_cards', new Set(['bnc11111']))
    expect(listed(msg)).toEqual(['bnc11111', 'new11111'])
    expect(msg).toContain('VISSZADOBOTT JAVITAS (1)')
    expect(msg.indexOf('VISSZADOBOTT JAVITAS')).toBeLessThan(msg.indexOf('new11111'))
  })
  it('negative control: nothing bounced -> the order and the text are unchanged', () => {
    const before = buildWakeMessage('dexter', 13, 2, items, NOW, 'assigned_open_cards')
    expect(listed(before)).toEqual(['new11111', 'bnc11111'])
    expect(buildWakeMessage('dexter', 13, 2, items, NOW, 'assigned_open_cards', new Set())).toBe(before)
    expect(before).not.toContain('VISSZADOBOTT')
  })
  it('the end to end path: the DB lookup feeds the order', () => {
    comment('bnc11111', 'didi', OPEN)
    const msg = buildWakeMessage('dexter', 13, 2, items, NOW, 'assigned_open_cards', bouncedCardIds('dexter', items))
    expect(listed(msg)[0]).toBe('bnc11111')
  })
  // didi 49379 I7: a bounced-only list named its items, yet the fallback line would also claim none.
  it('bounced items only: they are named, and the "could not name an item" line is absent', () => {
    const only = [card('bnc11111', 'testing'), card('bnc22222', 'in_progress')]
    const msg = buildWakeMessage('dexter', 13, 2, only, NOW, 'assigned_open_cards', new Set(['bnc11111', 'bnc22222']))
    expect(listed(msg)).toEqual(['bnc11111', 'bnc22222'])
    expect(msg).not.toContain('tetelt nem tudtam megnevezni')
  })
  // didi 49379 I8: the bounced block is capped like the other blocks, the header keeps the full count.
  // Card 2e78cf63: the wake is capped in characters (WAKE_MAX_CHARS), so the block is filled into what the fixed
  // parts leave: the header keeps the full count, at most five are listed, the rest is counted in one line.
  it('six bounced cards: the header says 6, at most five are listed (as many as the character cap leaves), the rest counted', () => {
    const six = ['bnc11111', 'bnc22222', 'bnc33333', 'bnc44444', 'bnc55555', 'bnc66666'].map((id) => card(id, 'testing'))
    const msg = buildWakeMessage('dexter', 13, 6, six, NOW, 'assigned_open_cards', new Set(six.map((c) => c.id)))
    expect(msg).toContain('VISSZADOBOTT JAVITAS (6)')
    expect(listed(msg).length).toBeGreaterThanOrEqual(1)
    expect(listed(msg).length).toBeLessThanOrEqual(5)
    expect(listed(msg)).toEqual(['bnc11111', 'bnc22222', 'bnc33333', 'bnc44444', 'bnc55555', 'bnc66666'].slice(0, listed(msg).length))
    expect(msg).toMatch(new RegExp(`^\\+${6 - listed(msg).length} tovabbi a tablan$`, 'm'))
  })
})
