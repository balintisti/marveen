// A FIX ROUND HANDED TO TRILLIAN IS CLOSED BY TRILLIAN -- card c38bd6d0.
//
// didi (10015070, measured on add47084, comment 59220): a reviewer's open line
// ending in "| FIX ROUND: trillian" stayed open after trillian closed the round
// with NINCS NYITOTT TETEL, because the gate reads each author's LAST verdict.
// The done move got 409 until didi posted a closer by hand: 22 manual closers,
// ~18 cards stalled on 2026-11-11. marveen decision A: trillian's later closing
// verdict closes that line.
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, createKanbanCard, addKanbanComment, getKanbanCard, moveKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import { openVerdicts, type VerdictComment } from '../kanban-verdict.js'

function c(id: number, author: string, content: string): VerdictComment {
  return { id, author, content, created_at: id }
}

// The live shape (bb9f4673, comment 59425).
const HANDED = 'VERDIKT: NYITOTT TETEL | L1 KOZEPES teszt-res: routes/kanban.ts:447 fedetlen, P7 tulel | FIX ROUND: trillian'
const DIDI_OPEN = 'VERDIKT: NYITOTT TETEL | L1 viselkedes: a 409 rossz okot nevez'
const T_CLOSED = 'VERDIKT: NINCS NYITOTT TETEL | P7 elhal, kontroll egyezik'
const T_OPEN = 'VERDIKT: NYITOTT TETEL | a teszt meg mindig a megujitas utan ellenoriz'

const authors = (comments: VerdictComment[]) => openVerdicts(comments).map((v) => v.author)

describe('a fix round handed to trillian (card c38bd6d0)', () => {
  it('1. didi hands the round to trillian, trillian closes it later: nothing open', () => {
    expect(authors([c(1, 'didi', HANDED), c(2, 'trillian', T_CLOSED)])).toEqual([])
  })

  it('2. without the marker the line stays didi\'s: trillian\'s closer does not close it', () => {
    expect(authors([c(1, 'didi', DIDI_OPEN), c(2, 'trillian', T_CLOSED)])).toEqual(['didi'])
  })

  it('3. order matters: a trillian closer BEFORE the hand-over closes nothing', () => {
    expect(authors([c(1, 'trillian', T_CLOSED), c(2, 'didi', HANDED)])).toEqual(['didi'])
  })

  it('4. a later didi open line after trillian\'s closer is open again, marker or not', () => {
    expect(authors([c(1, 'didi', HANDED), c(2, 'trillian', T_CLOSED), c(3, 'didi', DIDI_OPEN)])).toEqual(['didi'])
    expect(authors([c(1, 'didi', HANDED), c(2, 'trillian', T_CLOSED), c(3, 'didi', HANDED)])).toEqual(['didi'])
  })

  it('trillian\'s LAST verdict decides: a closer followed by her own open line closes nothing', () => {
    expect(authors([c(1, 'didi', HANDED), c(2, 'trillian', T_CLOSED), c(3, 'trillian', T_OPEN)]))
      .toEqual(['didi', 'trillian'])
  })

  it('only trillian closes it: another author\'s later closer does not', () => {
    expect(authors([c(1, 'didi', HANDED), c(2, 'mandark', T_CLOSED)])).toEqual(['didi'])
  })

  // didi 59475: the verdict-line-only rule closed 2 of the 7 real trillian-closed rounds.
  it('the marker on a column-0 line of its own in the verdict comment hands over (b0177416 58139 shape)', () => {
    const ownLine = `L1 teszt-res: P7 tulel.\nFIX ROUND: trillian. Olendo: P7.\n${DIDI_OPEN}`
    expect(authors([c(1, 'didi', ownLine), c(2, 'trillian', T_CLOSED)])).toEqual([])
    const after = `${DIDI_OPEN}\nFIX ROUND: trillian`
    expect(authors([c(1, 'didi', after), c(2, 'trillian', T_CLOSED)])).toEqual([])
  })

  it('the marker on the verdict line without the colon hands over (17a19228 58639 shape)', () => {
    const noColon = 'VERDIKT: NYITOTT TETEL | L1 teszt-res, FIX ROUND trillian'
    expect(authors([c(1, 'didi', noColon), c(2, 'trillian', T_CLOSED)])).toEqual([])
  })

  it('another name, a quote further in a line, or an indented marker hands nothing over', () => {
    for (const prose of [
      'FIX ROUND: didi. Olendo: P7.',
      'FIX ROUND: nem trillian (08d35100 58457 shape)',
      'A kor: (didi 59159 FIX ROUND: trillian)',
      '  FIX ROUND: trillian',
      'FIX ROUND: trilliankent',
    ]) {
      expect(authors([c(1, 'didi', `${prose}\n${DIDI_OPEN}`), c(2, 'trillian', T_CLOSED)])).toEqual(['didi'])
    }
    expect(authors([c(1, 'didi', 'VERDIKT: NYITOTT TETEL | FIX ROUND: nem trillian'), c(2, 'trillian', T_CLOSED)]))
      .toEqual(['didi'])
  })

  // didi 59485 T1: the name ends where trillian ends on the verdict line too, not only on a line of its own.
  it('a longer name on the verdict line hands nothing over', () => {
    for (const tail of ['FIX ROUND: trilliankent', 'FIX ROUND trillian2']) {
      expect(authors([c(1, 'didi', `VERDIKT: NYITOTT TETEL | L1 teszt-res | ${tail}`), c(2, 'trillian', T_CLOSED)]))
        .toEqual(['didi'])
    }
  })

  // didi 59485 T3: the colon is the writer's habit, not the reader's condition (no such line on the board yet).
  it('the marker on a line of its own without the colon hands over', () => {
    const noColon = `FIX ROUND trillian. Olendo: P7.\n${DIDI_OPEN}`
    expect(authors([c(1, 'didi', noColon), c(2, 'trillian', T_CLOSED)])).toEqual([])
  })

  it('a marker line in an EARLIER comment does not hand over a later verdict comment', () => {
    expect(authors([c(1, 'didi', 'FIX ROUND: trillian'), c(2, 'didi', DIDI_OPEN), c(3, 'trillian', T_CLOSED)]))
      .toEqual(['didi'])
  })

  it('a stamped own marker line of the reviewer counts', () => {
    const stamped = `[didi, 2026-11-12 05:31 CET, date] FIX ROUND: trillian. Olendo: P7.\n${DIDI_OPEN}`
    expect(authors([c(1, 'didi', stamped), c(2, 'trillian', T_CLOSED)])).toEqual([])
  })

  // didi 59485 T2: only the reviewer's OWN stamp comes off. A column-0 line pasted from another
  // author's comment keeps its stamp, so it does not START with the marker: a citation, not a hand-over.
  it('a marker line carrying ANOTHER author\'s stamp is a quote and hands nothing over', () => {
    const quoted = `[trillian, 2026-11-12 04:54 CET, date] FIX ROUND: trillian. Olendo: P7.\n${DIDI_OPEN}`
    expect(authors([c(1, 'didi', quoted), c(2, 'trillian', T_CLOSED)])).toEqual(['didi'])
  })

  it('the marker is read like the rest of the line: case and spacing do not matter', () => {
    const loose = 'VERDIKT: NYITOTT TETEL (kozepes) | teszt-res |  fix  round:  Trillian'
    expect(authors([c(1, 'didi', loose), c(2, 'trillian', T_CLOSED)])).toEqual([])
  })

  it('a stamped closer of trillian\'s own counts (card 08832e26)', () => {
    const stamped = `[trillian, 2026-11-12 04:54 CET, date] ${T_CLOSED}`
    expect(authors([c(1, 'didi', HANDED), c(2, 'trillian', stamped)])).toEqual([])
  })
})

async function call(method: 'POST', path: string, body?: unknown) {
  const payloadIn = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Object.assign(Readable.from(payloadIn), { method, headers: {} }) as unknown as http.IncomingMessage
  let status = 200
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string) { if (data) chunk = data },
  } as unknown as http.ServerResponse
  const handled = await tryHandleKanban({
    req, res, path, method, url: new URL('http://x' + path),
  } as never)
  expect(handled, `the route did not handle ${method} ${path}`).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

describe('the done move through the real route (card c38bd6d0)', () => {
  beforeEach(() => {
    initDatabase(':memory:')
    createKanbanCard({ id: 'fr1', title: 'Kartya', status: 'planned' })
    moveKanbanCard('fr1', 'testing', 0, 'dexter')
    addKanbanComment('fr1', 'marveen', 'KESZ-IGAZOLAS: TARGYTALAN | teszt-kartya')
    addKanbanComment('fr1', 'didi', `FIX ROUND: trillian. Olendo: P7.\n${HANDED}`)
  })

  it('CONTROL: before trillian closes the round the move is refused', async () => {
    const r = await call('POST', '/api/kanban/fr1/move', { status: 'done', actor: 'jarvis' })
    expect(r.status).toBe(409)
    expect(getKanbanCard('fr1')?.status).toBe('testing')
  })

  it('after trillian\'s closer the card closes without a hand-written didi closer', async () => {
    addKanbanComment('fr1', 'trillian', T_CLOSED)
    const r = await call('POST', '/api/kanban/fr1/move', { status: 'done', actor: 'jarvis' })
    expect(r.status).toBe(200)
    expect(getKanbanCard('fr1')?.status).toBe('done')
  })
})
