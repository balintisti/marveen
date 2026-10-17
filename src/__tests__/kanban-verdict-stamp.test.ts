// Card 08832e26: a verdict line behind its author's OWN measured-time stamp is
// a verdict given, not cited. Measured on 970be4b3: didi's stamped 34722 ("NINCS
// NYITOTT TETEL") was skipped and her older 26541 ("NYITOTT TETEL") stayed her
// last, so the card could not close over a verdict she had already closed.
import { describe, it, expect } from 'vitest'
import { openVerdicts, openLeftovers, type VerdictComment } from '../kanban-verdict.js'

function c(id: number, author: string, content: string): VerdictComment {
  return { id, author, content, created_at: id }
}

const OPEN = 'VERDIKT: NYITOTT TETEL | 94b2765c6f: harom gombszin kezzel'
const CLOSED_STAMPED = '[didi, 2026-10-14 23:13 CEST, date] VERDIKT: NINCS NYITOTT TETEL | 970be4b3 @1f2a0ac615'

describe('the author\'s own stamp in front of a verdict (card 08832e26)', () => {
  it('the measured case: a stamped NINCS after an open line closes it', () => {
    expect(openVerdicts([c(26541, 'didi', OPEN), c(34722, 'didi', CLOSED_STAMPED)])).toEqual([])
  })

  it('a stamped NYITOTT opens, and the refusal quotes the line without the stamp', () => {
    const open = openVerdicts([c(1, 'didi', '[didi, 2026-10-17 15:58 CEST, date] ' + OPEN)])
    expect(open).toHaveLength(1)
    expect(open[0].line).toBe(OPEN)
  })

  it('seconds and another zone name are the same stamp', () => {
    expect(openVerdicts([c(1, 'didi', OPEN), c(2, 'didi', '[didi, 2026-12-01 09:05:07 CET, date] VERDIKT: NINCS NYITOTT TETEL | x')])).toEqual([])
  })

  it('ANOTHER author\'s stamp is a citation: it neither opens nor closes', () => {
    expect(openVerdicts([c(1, 'marveen', '[didi, 2026-10-17 15:58 CEST, date] ' + OPEN)])).toEqual([])
    expect(openVerdicts([c(1, 'didi', OPEN), c(2, 'marveen', CLOSED_STAMPED)])).toHaveLength(1)
  })

  it('an indented stamp, or a bracket that is not the stamp shape, stays prose', () => {
    expect(openVerdicts([c(1, 'didi', '  [didi, 2026-10-17 15:58 CEST, date] ' + OPEN)])).toEqual([])
    expect(openVerdicts([c(1, 'didi', '[didi] ' + OPEN)])).toEqual([])
    expect(openVerdicts([c(1, 'didi', '[didi, 2026-10-17 15:5x CEST, date] ' + OPEN)])).toEqual([])
  })

  it('the column-0 form still works (control)', () => {
    expect(openVerdicts([c(1, 'didi', OPEN)])).toHaveLength(1)
    expect(openVerdicts([c(1, 'didi', OPEN), c(2, 'didi', 'VERDIKT: NINCS NYITOTT TETEL | x')])).toEqual([])
  })

  it('MARADEK: the same stamp opens and closes a leftover', () => {
    const opened = openLeftovers([c(1, 'friday', '[friday, 2026-10-17 15:58 CEST, date] MARADEK: a backfill | kartya 1234')])
    expect(opened).toHaveLength(1)
    expect(opened[0].line).toBe('MARADEK: a backfill | kartya 1234')
    expect(openLeftovers([
      c(1, 'friday', 'MARADEK: a backfill | kartya 1234'),
      c(2, 'friday', '[friday, 2026-10-17 16:01 CEST, date] MARADEK: NINCS | kartya 5678'),
    ])).toEqual([])
  })
})
