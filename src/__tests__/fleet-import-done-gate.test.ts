import { describe, it, expect, beforeEach, vi } from 'vitest'
import { initDatabase, getDb, getKanbanCard, getKanbanComments, getKanbanCardEvents } from '../db.js'

// Card 7902ee84 (marveen 59873 C13). The fleet import copied a card's status as the source
// had it, so it wrote `done` on this board without the KESZ-IGAZOLAS line the done gate
// demands (3c7be3c4). An imported done card now stays done only with BOTH its proof comment
// and the verified label; otherwise it becomes testing. Run against a real database: the
// import writes cards, comments and labels, and the result on the board is what is judged.

const requiredLabel = { value: 'IGAZOLT' as string | number }
vi.mock('../settings-store.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../settings-store.js')>()
  return {
    ...real,
    getEffectiveSettingValue: (key: string) =>
      key === 'KANBAN_ARCHIVE_REQUIRE_LABEL' ? requiredLabel.value : real.getEffectiveSettingValue(key),
  }
})

// The import's file side, as fleet-transfer.test.ts stubs it; the database stays real.
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return { ...real, existsSync: () => false, mkdirSync: () => undefined, unlinkSync: () => undefined, rmSync: () => undefined, readdirSync: () => [] }
})
vi.mock('../web/atomic-write.js', () => ({ atomicWriteFileSync: vi.fn() }))
vi.mock('../web/scheduled-tasks-io.js', () => ({ SCHEDULED_TASKS_DIR: '/mock/tasks' }))
vi.mock('../web/agent-config.js', () => ({
  AGENTS_BASE_DIR: '/mock/agents',
  listAgentNames: () => [],
  readJsonObjectForWrite: () => ({}),
}))
vi.mock('../web/vault-bindings.js', () => ({ getBindings: () => [] }))
vi.mock('../env.js', async (importOriginal) => ({ ...(await importOriginal<object>()), updateEnvFile: vi.fn() }))

const T = 1_790_000_000
const LABEL = { id: 'lbl-src-igazolt', name: 'IGAZOLT', color: '#0a0', created_at: T }
const PROOF = 'KESZ-IGAZOLAS: ELES a futo fa tartalmazza (abc1234)'

type Card = { id: string; status: string; archived_at?: number | null; version?: number }
const card = (c: Card) => ({
  title: `card ${c.id}`, priority: 'normal', sort_order: 0, created_at: T, updated_at: T, ...c,
})

function fleet(opts: {
  cards: Card[]
  comments?: Array<{ card_id: string; content: string }>
  cardLabels?: string[]
}): string {
  return JSON.stringify({
    schemaVersion: 1,
    exportedAt: '2026-11-14T00:00:00.000Z',
    sourceHost: 'source-host',
    agents: [], skills: [], scheduledTasks: [], memories: [], dailyLogs: [],
    kanban: {
      cards: opts.cards.map(card),
      comments: (opts.comments ?? []).map((c) => ({ ...c, author: 'friday', created_at: T + 1 })),
      cardEvents: [],
      labels: [LABEL],
      cardLabels: (opts.cardLabels ?? []).map((id) => ({ card_id: id, label_id: LABEL.id, created_at: T + 2 })),
    },
    ideaBox: { ideas: [], comments: [], statusLog: [] },
    dashboardSettings: { autonomy: {}, autoRestart: {}, agentsDesired: {}, norbertPersonal: {} },
  })
}

async function runImport(json: string) {
  const { importFleet } = await import('../web/fleet-transfer.js')
  const result = importFleet(json, { apply: true }) as { ok: boolean; warnings?: string[] }
  expect(result.ok).toBe(true)
  return result
}

const labelled = (id: string) =>
  !!getDb().prepare(
    `SELECT 1 FROM kanban_card_labels cl JOIN labels l ON l.id = cl.label_id
      WHERE cl.card_id = ? AND l.name = 'IGAZOLT'`,
  ).get(id)
const gateComments = (id: string) => getKanbanComments(id).filter((c) => c.author === 'fleet-import')

beforeEach(() => {
  initDatabase(':memory:')
  requiredLabel.value = 'IGAZOLT'
})

describe('fleet import: done only with its proof AND the verified label (7902ee84)', () => {
  it('a done card that brings both stays done, labelled, with no gate comment', async () => {
    const r = await runImport(fleet({ cards: [{ id: 'both', status: 'done' }], comments: [{ card_id: 'both', content: PROOF }], cardLabels: ['both'] }))
    expect(getKanbanCard('both')?.status).toBe('done')
    expect(labelled('both')).toBe(true)
    expect(gateComments('both')).toEqual([])
    expect(getKanbanCardEvents('both')).toEqual([])
    expect(r.warnings ?? []).toEqual([])
  })

  it('proof without the label: testing, with the event and a comment naming the label', async () => {
    const r = await runImport(fleet({ cards: [{ id: 'proof', status: 'done', version: 4 }], comments: [{ card_id: 'proof', content: PROOF }] }))
    const after = getKanbanCard('proof')
    expect(after?.status).toBe('testing')
    expect(after?.version).toBe(5)
    expect(getKanbanCardEvents('proof').map((e) => [e.from_status, e.to_status, e.actor]))
      .toEqual([['done', 'testing', 'fleet-import']])
    const [note] = gateComments('proof')
    expect(note.content).toContain('IGAZOLT cimke')
    expect(note.content).not.toContain('KESZ-IGAZOLAS sor')
    expect(r.warnings?.join(' ')).toContain('proof')
  })

  it('the label without the proof: testing, and the label goes with the done it vouched for', async () => {
    await runImport(fleet({ cards: [{ id: 'label', status: 'done' }], cardLabels: ['label'] }))
    expect(getKanbanCard('label')?.status).toBe('testing')
    expect(labelled('label')).toBe(false)
    const [note] = gateComments('label')
    expect(note.content).toContain('KESZ-IGAZOLAS sor')
    expect(note.content).not.toContain('IGAZOLT cimke')
  })

  it('neither: testing, both named', async () => {
    await runImport(fleet({ cards: [{ id: 'none', status: 'done' }] }))
    expect(getKanbanCard('none')?.status).toBe('testing')
    expect(gateComments('none')[0].content).toContain('KESZ-IGAZOLAS sor es a(z) IGAZOLT cimke')
  })

  it('an archived done card is judged too (unarchive would bring it back as done) and stays archived', async () => {
    await runImport(fleet({ cards: [{ id: 'arch', status: 'done', archived_at: T + 5 }] }))
    const after = getDb().prepare('SELECT status, archived_at FROM kanban_cards WHERE id = ?').get('arch')
    expect(after).toEqual({ status: 'testing', archived_at: T + 5 })
  })

  it('a card already on this board keeps its own state; other statuses are not touched', async () => {
    getDb().prepare(
      `INSERT INTO kanban_cards (id, title, status, priority, sort_order, created_at, updated_at)
       VALUES ('local', 'local card', 'done', 'normal', 0, ?, ?)`,
    ).run(T, T)
    const r = await runImport(fleet({ cards: [{ id: 'local', status: 'done' }, { id: 'open', status: 'in_progress' }] }))
    expect(getKanbanCard('local')?.status).toBe('done')
    expect(getKanbanCardEvents('local')).toEqual([])
    expect(getKanbanCard('open')?.status).toBe('in_progress')
    expect(r.warnings ?? []).toEqual([])
  })

  it('an install that does not gate on the label (empty setting): the proof alone decides', async () => {
    requiredLabel.value = ''
    await runImport(fleet({
      cards: [{ id: 'p', status: 'done' }, { id: 'n', status: 'done' }],
      comments: [{ card_id: 'p', content: PROOF }],
    }))
    expect(getKanbanCard('p')?.status).toBe('done')
    expect(getKanbanCard('n')?.status).toBe('testing')
    expect(gateComments('n')[0].content).not.toContain('cimke')
  })

  it('the apply result names every card it set to testing', async () => {
    const r = await runImport(fleet({ cards: [{ id: 'a1', status: 'done' }, { id: 'a2', status: 'done' }] }))
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings?.[0]).toMatch(/^2 importalt done kartya testing-be kerult/)
    expect(r.warnings?.[0]).toContain('a1, a2')
  })
})
