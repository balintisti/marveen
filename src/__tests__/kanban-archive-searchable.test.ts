// kanban bf566867: the archive is the safety net under the house rule for
// duplicates -- carry the content onto the surviving card, THEN archive the
// loser. Measured 2026-08-22 during a 343-card sweep that archived a dozen
// merged cards: listArchivedKanbanCards() SELECTed no `description` at all,
// and its `q` filter searched title/project/assignee only. So the body of a
// merged-away card could not be read or found through the API -- and nothing
// said so. The listing returned rows and looked healthy.
//
// The positive controls matter more than the assertions here: a search that
// matches EVERY row proves nothing, so each test that expects a hit is paired
// with a term that must NOT hit.

import { describe, it, expect, beforeEach } from 'vitest'
import { initDatabase, getDb, listArchivedKanbanCards } from '../db.js'

beforeEach(() => {
  initDatabase(':memory:')
})

const NOW = Math.floor(Date.now() / 1000)

function seed(id: string, title: string, description: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO kanban_cards (id, title, description, status, priority, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, 'planned', 'normal', ?, ?, ?)`,
    )
    .run(id, title, description, NOW, NOW, NOW)
}

describe('listArchivedKanbanCards', () => {
  it('returns the description, because a merged-away body lives only there', () => {
    seed('arch-1', 'a merged duplicate', 'the eleven file names carried over from the other card')

    const [row] = listArchivedKanbanCards({ limit: 10 })
    expect(row.id).toBe('arch-1')
    expect(row.description).toBe('the eleven file names carried over from the other card')
  })

  it('finds a card by a word that appears ONLY in the description', () => {
    seed('arch-1', 'a merged duplicate', 'mentions src/pages/superadmin and nothing else')
    seed('arch-2', 'an unrelated archived card', 'about the calendar retry counter')

    const hits = listArchivedKanbanCards({ q: 'superadmin', limit: 10 })
    expect(hits.map((c) => c.id)).toEqual(['arch-1'])

    // POSITIVE CONTROL -- without this the test above passes on a `q` that is
    // ignored entirely and returns both rows.
    const miss = listArchivedKanbanCards({ q: 'nonexistent-term-zzz', limit: 10 })
    expect(miss).toHaveLength(0)
  })

  it('still finds by title, so widening the search did not replace the old path', () => {
    seed('arch-1', 'the calendar retry card', 'body says nothing about calendars')
    seed('arch-2', 'something else', 'unrelated')

    expect(listArchivedKanbanCards({ q: 'calendar retry', limit: 10 }).map((c) => c.id)).toEqual(['arch-1'])
  })

  it('tolerates a NULL description instead of dropping the row', () => {
    seed('arch-1', 'a card with no body', null)

    const [row] = listArchivedKanbanCards({ q: 'no body', limit: 10 })
    expect(row.id).toBe('arch-1')
    expect(row.description).toBeNull()
  })
})
