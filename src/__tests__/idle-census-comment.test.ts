/**
 * A CENSUS COMMENT DOES NOT RE-ARM A REVIEWER'S CARD -- card 57cb8d64, marveen's decision 2026-09-25.
 *
 * Not the ROLE but the KIND of comment: didi measured 22 reviewer cards where jarvis spoke last, 21
 * census bookkeeping and 1 a real reply (29a6b7e9) -- the one a role-based exclusion would swallow.
 * The kind is read from a CLOSED header token at the start of the comment, not from its content.
 */
import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { isCensusComment, selectDeclaredWork } from '../idle-agent.js'

describe('isCensusComment: a closed header token at the start, nothing else', () => {
  it("marveen's specified shapes are census (optional date prefix, case-insensitive, optional comma)", () => {
    for (const s of [
      '2026-09-24 -- jarvis, testing-cenzus 3. kor, batch B (gap).',
      'jarvis, testing-cenzus 4. kor',
      'JARVIS TESTING-CENZUS (a65623ef, 9. kor folytatas)',
      '2026-09-25 -- JARVIS testing-cenzus 1. kor',
    ]) expect(isCensusComment(s), s).toBe(true)
  })
  it('a date+TIME(+CEST) prefix is census too (marveen 04:04, on 0 real answers matched)', () => {
    for (const s of ['2026-09-24 17:43:57 CEST -- jarvis, TESTING-CENZUS (a65623ef)', '2026-09-24 17:43:57  -- jarvis, TESTING-CENZUS',
                     '2026-09-24 17:43 CEST -- jarvis, testing-cenzus 2. kor'])
      expect(isCensusComment(s), s).toBe(true)
  })
  it('...but the prefix stays CLOSED: a time with other text before the dashes is not census', () => {
    for (const s of ['2026-09-24 17:43:57 CEST -- VALASZ didi-re: jarvis, testing-cenzus utan', '17:43:57 -- jarvis, testing-cenzus',
                     // other WORDS between the date and the dashes: only a time and CEST/CET may stand there
                     '2026-09-24 VALASZ didi k16827-re -- jarvis, testing-cenzus kor utan ujramertem'])
      expect(isCensusComment(s), s).toBe(false)
  })
  it('a real reply is not, even when it mentions the census', () => {
    for (const s of [
      'VALASZ didi k16827-re -- a jarvis, testing-cenzus kor utan fuggetlenul ujramertem',
      'LELET: a jarvis, testing-cenzus szerint a cim elavult, de a kod hibas',
    ]) expect(isCensusComment(s), s).toBe(false)
  })
  it('other heads are NOT matched: the token is at the start of the first line or nowhere', () => {
    for (const s of ['CIM ATIRVA (jarvis, testing-cenzus 12. kor)', 'VALASZ didi k16827-re: fuggetlen ujrameres', 'x\njarvis, testing-cenzus on the second line'])
      expect(isCensusComment(s), s).toBe(false)
  })
})

// one testing card, assigned elsewhere; didi reviewed at t=100
const CARD = { id: 'c1', status: 'testing', assignee: 'dexter', archived_at: null, updated_at: 500, due_date: null }
const check = { kind: 'testing_without_my_comment' as const, reviewer: true }
const REVIEWERS = new Set(['marveen', 'didi', 'mandark', 'jarvis'])
const map = (o: Record<string, number>) => new Map([[CARD.id, new Map(Object.entries(o))]])
const queue = (raw: Record<string, number>, real?: Record<string, number>) =>
  selectDeclaredWork(check, 'didi', [CARD], map(raw), 'marveen', 1_000, REVIEWERS, real ? map(real) : undefined).map((c) => c.id)

// marveen 2026-09-25 06:07, on didi's review: a census comment that carries a finding re-arms.
describe('a census comment with a column-0 TALALAT: line is NOT census (it re-arms)', () => {
  const HEAD = '2026-09-25 06:30:00 CEST -- jarvis, testing-cenzus (a65623ef).'
  it('POSITIVE: census + a TALALAT: line at column 0 -> not census', () => {
    expect(isCensusComment(`${HEAD}\nallapot: rendben\nTALALAT: ez a kartya ELAVULT FIXET hordoz`)).toBe(false)
  })
  it('NEGATIVE: an INDENTED TALALAT: line is a quotation -> still census', () => {
    expect(isCensusComment(`${HEAD}\n    TALALAT: idezet egy masik kommentbol`)).toBe(true)
  })
  it('NEGATIVE: "LELET: nincs" is not the token -> still census', () => {
    expect(isCensusComment(`${HEAD}\nLELET: nincs`)).toBe(true)
  })
  it('the token MID-LINE (18790e64 shape) does not count -- column 0 only', () => {
    expect(isCensusComment(`${HEAD} TABLA-IGAZSAG TALALAT: ez a kartya ELAVULT`)).toBe(true)
  })
  it('lower case in running text is not the token', () => {
    expect(isCensusComment(`${HEAD}\ntalalat: nincs uj`)).toBe(true)
  })
  it('the accented spelling is the same token, composed or decomposed', () => {
    expect(isCensusComment(`${HEAD}\nTALÁLAT: gazdatlan tetel`)).toBe(false)
    expect(isCensusComment(`${HEAD}\nTALA\u0301LAT: gazdatlan tetel`)).toBe(false)
  })
  it('CRLF line ends still find the column-0 line', () => {
    expect(isCensusComment(`${HEAD}\r\nTALALAT: x`)).toBe(false)
  })
  it('CONTROL: the same census without the line is census', () => {
    expect(isCensusComment(`${HEAD}\nallapot: rendben`)).toBe(true)
  })
})

describe('the reviewer queue: only a NON-census comment after mine re-arms the card', () => {
  it('only a jarvis census after me -> NOT re-armed', () => {
    expect(queue({ didi: 100, jarvis: 200 }, { didi: 100 })).toEqual([])
  })
  it('29a6b7e9: a REAL jarvis reply after me re-arms, even when a census came after it', () => {
    // raw: jarvis's latest is the census at 300; real: his reply at 200
    expect(queue({ didi: 100, jarvis: 300 }, { didi: 100, jarvis: 200 })).toEqual(['c1'])
  })
  it('a census plus someone else\'s real comment -> re-armed', () => {
    expect(queue({ didi: 100, jarvis: 200, dexter: 250 }, { didi: 100, dexter: 250 })).toEqual(['c1'])
  })
  it('a census plus the coordinator -> not re-armed (the coordinator rule still holds)', () => {
    expect(queue({ didi: 100, jarvis: 200, marveen: 250 }, { didi: 100, marveen: 250 })).toEqual([])
  })
  it('CONTROL: without the census-free map every comment counts, exactly as before', () => {
    expect(queue({ didi: 100, jarvis: 200 })).toEqual(['c1'])
  })
})

// The SQL half, on a REAL sqlite (json_each included), through the watcher's own function.
const h = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../db.js', async (orig) => ({ ...(await orig<typeof import('../db.js')>()), getDb: () => h.db }))
const { lastRealCommentAtByCard } = await import('../web/idle-agent-watcher.js')

describe('lastRealCommentAtByCard builds the census-free map on a real sqlite', () => {
  const setup = (rows: [string, string, number, string][]) => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE kanban_comments (id INTEGER PRIMARY KEY, card_id TEXT, author TEXT, content TEXT, created_at INTEGER)')
    const ins = db.prepare('INSERT INTO kanban_comments (card_id, author, created_at, content) VALUES (?, ?, ?, ?)')
    for (const [card, author, at, content] of rows) ins.run(card, author, at, content)
    h.db = db
  }
  it('census rows drop out; a real reply before a census survives as the author\'s latest REAL time', () => {
    setup([
      ['c1', 'didi', 100, 'review'],
      // mentions the census MID-TEXT: the SQL prefilter catches it, the anchored token must let it through
      ['c1', 'jarvis', 200, 'VALASZ didi-re: a jarvis, testing-cenzus kor utan fuggetlenul ujramertem'],
      ['c1', 'jarvis', 300, '2026-09-24 -- jarvis, testing-cenzus 3. kor'],
      ['c2', 'jarvis', 400, 'JARVIS TESTING-CENZUS (x)'],
    ])
    const raw = new Map([['c1', new Map([['didi', 100], ['jarvis', 300]])], ['c2', new Map([['jarvis', 400]])]])
    const real = lastRealCommentAtByCard(raw)!
    expect(real.get('c1')).toEqual(new Map([['didi', 100], ['jarvis', 200]]))
    expect(real.get('c2')).toBeUndefined()
  })
  // The watcher reads only the first 160 characters for the header; the finding line can be far
  // below it (longest census measured: 3029). RED if the query goes back to the head alone.
  it('a census whose TALALAT: line sits beyond the first 160 characters re-arms', () => {
    const filler = 'x'.repeat(400)
    setup([
      ['c1', 'didi', 100, 'review'],
      ['c1', 'jarvis', 300, `2026-09-25 -- jarvis, testing-cenzus (a65623ef)\n${filler}\nTALALAT: gazdatlan tetel`],
      ['c2', 'didi', 100, 'review'],
      ['c2', 'jarvis', 300, `2026-09-25 -- jarvis, testing-cenzus (a65623ef)\n${filler}\n    TALALAT: idezet`],
    ])
    const raw = new Map([['c1', new Map([['didi', 100], ['jarvis', 300]])], ['c2', new Map([['didi', 100], ['jarvis', 300]])]])
    const real = lastRealCommentAtByCard(raw)!
    expect(real.get('c1')).toEqual(new Map([['didi', 100], ['jarvis', 300]]))   // the finding counts
    expect(real.get('c2')).toEqual(new Map([['didi', 100]]))                    // the quotation does not
  })
  it('no census comment at all -> the raw map itself (nothing can change)', () => {
    setup([['c1', 'didi', 100, 'review'], ['c1', 'jarvis', 200, 'real reply']])
    const raw = new Map([['c1', new Map([['didi', 100], ['jarvis', 200]])]])
    expect(lastRealCommentAtByCard(raw)).toBe(raw)
  })
  it('a failing query -> undefined ("not measured"), never an empty map that would silence queues', () => {
    h.db = { prepare: () => { throw new Error('db gone') } }
    expect(lastRealCommentAtByCard(new Map())).toBeUndefined()
  })
})
