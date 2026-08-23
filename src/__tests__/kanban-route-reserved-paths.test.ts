// A live regression, caught by a negative control and not by this suite -- which is
// why the suite now has it. 2026-08-22: a `GET /api/kanban/<id>` arm was added so an
// archived card's body could be read. Its regex also matched `/api/kanban/archived`,
// so the ARCHIVE LISTING started resolving as a card whose id is "archived" and
// answered "Kártya nem található" -- on the exact endpoint the change existed to make
// usable. Everything looked healthy: 200s everywhere, no error logs.
//
// What caught it: a search for a nonsense word returned "1 hit". The hit was the error
// object, counted as a row. A positive-only check would have shipped this.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { matchKanbanCardPath, KANBAN_RESERVED_SEGMENTS } from '../web/routes/kanban.js'

describe('matchKanbanCardPath', () => {
  it('matches a real card id', () => {
    const m = matchKanbanCardPath('/api/kanban/bf566867')
    expect(m?.[1]).toBe('bf566867')
  })

  it('NEVER matches a literal sub-path -- every reserved segment, not just the one that broke', () => {
    // Iterating the exported list rather than hard-coding: a segment added to the
    // route file without a thought for this collision is covered the moment it is
    // added to the list, and NOT covered if someone forgets -- which this test then
    // cannot detect, so the list is also asserted below.
    for (const seg of KANBAN_RESERVED_SEGMENTS) {
      expect(matchKanbanCardPath(`/api/kanban/${seg}`)).toBeNull()
    }
  })

  it('the reserved list covers every literal sub-path the router actually serves', () => {
    // Pinning the list itself: if a new `path === '/api/kanban/<literal>'` handler is
    // added and not registered here, the id route will swallow it silently -- the same
    // failure, one endpoint later.
    expect([...KANBAN_RESERVED_SEGMENTS].sort()).toEqual(
      ['archived', 'assignees', 'heartbeat-summary', 'labels'].sort(),
    )
  })

  it('does not match deeper paths, which belong to their own handlers', () => {
    expect(matchKanbanCardPath('/api/kanban/bf566867/comments')).toBeNull()
    expect(matchKanbanCardPath('/api/kanban/bf566867/move')).toBeNull()
    expect(matchKanbanCardPath('/api/kanban')).toBeNull()
  })

  it('survives a malformed percent-escape instead of throwing at the router', () => {
    // decodeURIComponent throws on '%zz'. A 500 from the route table would be a worse
    // outcome than a card that is simply not found.
    expect(() => matchKanbanCardPath('/api/kanban/%zz')).not.toThrow()
    expect(matchKanbanCardPath('/api/kanban/%zz')?.[1]).toBe('%zz')
  })

  it('treats a percent-encoded reserved word as reserved too', () => {
    expect(matchKanbanCardPath('/api/kanban/archi%76ed')).toBeNull()
  })
})

// Measured 2026-08-22: didi read GET /api/kanban/<id>, found no `comments` key, and
// recorded "0 comments" on a card that had five. Absence and emptiness are the same
// shape to a reader. `comment_count` makes them different -- and the count is asserted
// in BOTH directions here, because a field pinned only on a card WITH comments would
// also pass if it always returned a positive number.
describe('GET /api/kanban/<id> -- comment_count', () => {
  it('is part of the response contract, so a missing body is not read as "none"', () => {
    // WHY THIS ASSERTION IS SHAPED THIS WAY (rewritten 2026-08-22): it used to pin
    // the literal expression `comment_count: getKanbanComments(`. That broke the
    // moment the handler hoisted the count into a local -- a change that altered
    // NOTHING a caller can observe. A test that fails on a refactor it does not
    // care about teaches the next author to loosen the test, which is exactly how
    // this repo loses guards. So: assert that the field is composed FROM the
    // comment store, without pinning the statement's shape.
    const src = readFileSync(new URL('../web/routes/kanban.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/comment_count/)
    expect(src).toMatch(/getKanbanComments\(id\)\.length/)
    // ...and that the bodies are NOT spread into the card response: the payload
    // argument is the same one the archive listing settled.
    expect(src).not.toMatch(/comments:\s*getKanbanComments\(id\)\s*\}/)
    // The RUNTIME contract -- that the field is actually present, with the right
    // value, in both directions -- lives in kanban-comment-existence.test.ts.
    // This file keeps the source-level half only because it sits next to the
    // reserved-path rules that share the same handler.
  })
})
