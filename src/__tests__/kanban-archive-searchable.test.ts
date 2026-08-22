// kanban bf566867: the archive is the safety net under the house rule for
// duplicates -- carry the content onto the surviving card, THEN archive the
// loser. Measured 2026-08-22 during a 343-card sweep that archived a dozen
// merged cards: listArchivedKanbanCards()'s `q` filter searched
// title/project/assignee only, so the body of a merged-away card could not be
// found. Nothing said so; the listing returned rows and looked healthy.
//
// The fix is deliberately SPLIT, and the split is the interesting part. `q`
// searches the body (one more LIKE, no payload), but the projection does NOT
// carry it: 634 cards hold 737 KB of descriptions, 175 more are queued for the
// archive sweep, and this endpoint's row cap defaults to 500 and allows 5000.
// Reading one body is a different request -- GET /api/kanban/<id>.
//
// The positive controls matter more than the assertions: a `q` that is ignored
// entirely matches EVERY row and would pass a naive "found it" test, so each
// expected hit is paired with a term that must NOT hit.

import { describe, it, expect, beforeEach } from 'vitest'
import { initDatabase, getDb, listArchivedKanbanCards, getKanbanCard } from '../db.js'

beforeEach(() => {
  initDatabase(':memory:')
})

const NOW = Math.floor(Date.now() / 1000)

function seedArchived(id: string, title: string, description: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO kanban_cards (id, title, description, status, priority, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, 'planned', 'normal', ?, ?, ?)`,
    )
    .run(id, title, description, NOW, NOW, NOW)
}

describe('listArchivedKanbanCards: the body is searchable', () => {
  it('finds a card by a word that appears ONLY in the description', () => {
    seedArchived('arch-1', 'a merged duplicate', 'mentions src/pages/superadmin and nothing else')
    seedArchived('arch-2', 'an unrelated archived card', 'about the calendar retry counter')

    expect(listArchivedKanbanCards({ q: 'superadmin', limit: 10 }).map((c) => c.id)).toEqual(['arch-1'])

    // POSITIVE CONTROL -- without it this passes on a `q` that is ignored
    // entirely and returns both rows.
    expect(listArchivedKanbanCards({ q: 'nonexistent-term-zzz', limit: 10 })).toHaveLength(0)
  })

  it('still finds by title, so widening the search did not replace the old path', () => {
    seedArchived('arch-1', 'the calendar retry card', 'body says nothing about calendars')
    seedArchived('arch-2', 'something else', 'unrelated')

    expect(listArchivedKanbanCards({ q: 'calendar retry', limit: 10 }).map((c) => c.id)).toEqual(['arch-1'])
  })

  it('matches a card whose description is NULL without dropping it from title search', () => {
    seedArchived('arch-1', 'a card with no body', null)

    expect(listArchivedKanbanCards({ q: 'no body', limit: 10 }).map((c) => c.id)).toEqual(['arch-1'])
  })
})

describe('listArchivedKanbanCards: the body is NOT in the payload', () => {
  // This is a size guard, not a style rule. The archive only grows, and a
  // projection carrying ~1 KB per card turns a 500-row default into half a
  // megabyte per listing. If someone adds `description` back to the SELECT
  // because a UI wanted a snippet, this test is where that decision surfaces.
  it('omits description from the listing rows', () => {
    seedArchived('arch-1', 'a merged duplicate', 'a body that must not travel in the list response')

    const [row] = listArchivedKanbanCards({ limit: 10 })
    expect(row.id).toBe('arch-1')
    expect(row).not.toHaveProperty('description')
  })

  it('but the body IS reachable one card at a time, archived included', () => {
    seedArchived('arch-1', 'a merged duplicate', 'the eleven file names carried over from the other card')

    // The half that makes the search useful: found via q, read via getKanbanCard
    // (what GET /api/kanban/<id> serves).
    const found = listArchivedKanbanCards({ q: 'eleven file names', limit: 10 })
    expect(found.map((c) => c.id)).toEqual(['arch-1'])
    expect(getKanbanCard('arch-1')!.description).toBe(
      'the eleven file names carried over from the other card',
    )
  })
})
