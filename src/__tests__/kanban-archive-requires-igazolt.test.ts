// CARD 8b982892 -- Isti (Telegram 6309): what is not finished must not be archived.
//
// Measured 2026-10-11 on our install: the hourly sweep archived 77 done cards in 26 hours,
// 55 of them in one 03h pass, and not one carried the IGAZOLT label or a KESZ-IGAZOLAS
// comment -- they were closed before the verified-done rule (card 08eed527). `done` is the
// assignee's word; IGAZOLT is the proof. So the sweep only archives verified cards, and an
// unverified done card stays on the board where it can still be verified or reopened.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  initDatabase, getDb, sweepArchivedKanbanCards, getKanbanCard, createLabel, addLabelToCard,
} from '../db.js'

beforeEach(() => {
  initDatabase(':memory:')
})

const OLD = Math.floor(Date.now() / 1000) - 40 * 86400 // past the 30-day default cutoff

function oldDone(id: string): void {
  getDb().prepare(
    `INSERT INTO kanban_cards (id, title, status, priority, created_at, updated_at)
     VALUES (?, 'old and done', 'done', 'normal', ?, ?)`
  ).run(id, OLD, OLD)
}

describe('the archive sweep only takes VERIFIED done cards', () => {
  it('an old done card WITHOUT the IGAZOLT label stays on the board', () => {
    oldDone('unverified')
    expect(sweepArchivedKanbanCards()).toBe(0)
    expect(getKanbanCard('unverified')!.archived_at).toBeNull()
  })

  it('POSITIVE CONTROL: the same card WITH the label is archived', () => {
    oldDone('verified')
    createLabel({ id: '0554c87b', name: 'IGAZOLT', color: '#16a34a' })
    addLabelToCard('verified', '0554c87b')
    expect(sweepArchivedKanbanCards()).toBe(1)
    expect(getKanbanCard('verified')!.archived_at).not.toBeNull()
  })

  it('the label is matched by NAME, case-insensitively -- the id differs per install', () => {
    oldDone('lower')
    createLabel({ id: 'another-id', name: 'igazolt', color: '#16a34a' })
    addLabelToCard('lower', 'another-id')
    expect(sweepArchivedKanbanCards()).toBe(1)
  })

  it('a DIFFERENT label does not count as verification', () => {
    oldDone('other-label')
    createLabel({ id: 'x1', name: 'IGAZOLT-NEM', color: '#000000' })
    addLabelToCard('other-label', 'x1')
    expect(sweepArchivedKanbanCards()).toBe(0)
  })

  it('in a mixed set, only the verified card goes', () => {
    oldDone('a'); oldDone('b')
    createLabel({ id: 'ig', name: 'IGAZOLT', color: '#16a34a' })
    addLabelToCard('b', 'ig')
    expect(sweepArchivedKanbanCards()).toBe(1)
    expect(getKanbanCard('a')!.archived_at).toBeNull()
    expect(getKanbanCard('b')!.archived_at).not.toBeNull()
  })
})
