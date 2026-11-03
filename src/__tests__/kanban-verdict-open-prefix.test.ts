// Card 1e5c33c9: an open verdict with something other than "(severity)" after the
// token and no `|` read as no verdict, so the done gate let the card close over it.
// The lines below are the measured ones (2026-11-03, 5 of 1637 cards), shortened.
import { describe, it, expect } from 'vitest'
import { openVerdicts, type VerdictComment } from '../kanban-verdict.js'

function c(id: number, author: string, content: string): VerdictComment {
  return { id, author, content, created_at: id }
}

describe('an open verdict token followed by more than a severity (card 1e5c33c9)', () => {
  it('the measured case: "@<sha> (who, how, when)" with no pipe is open', () => {
    const line = 'VERDIKT: NYITOTT TETEL @28d1f4c1a (mandark, API+kod, helyi teszt-DB crm_e2e_test, 2026-10-21 07:22 Europe/Belgrade)'
    const open = openVerdicts([c(41983, 'mandark', line)])
    expect(open).toHaveLength(1)
    expect(open[0].author).toBe('mandark')
  })

  it('a colon after the accented token is open', () => {
    expect(openVerdicts([c(32030, 'mandark', 'VERDIKT: NYITOTT TÉTEL: MODE=tip-only (NEM merge-tiszta, 60 fájl konfliktus)')])).toHaveLength(1)
  })

  it('the shapes that were already open stay open', () => {
    expect(openVerdicts([c(1, 'didi', 'VERDIKT: NYITOTT TETEL')])).toHaveLength(1)
    expect(openVerdicts([c(1, 'didi', 'VERDIKT: NYITOTT TETEL (kozepes) -- a bekotese nem')])).toHaveLength(1)
    expect(openVerdicts([c(1, 'didi', 'VERDIKT: NYITOTT TETEL | x')])).toHaveLength(1)
  })

  it('a later closing line of the same author still closes it', () => {
    const open = 'VERDIKT: NYITOTT TETEL @f2ea84df09 (mandark, böngésző, 2026-10-20 07:52 CEST)'
    expect(openVerdicts([c(1, 'mandark', open), c(2, 'mandark', 'VERDIKT: NINCS NYITOTT TETEL @0d39a20bc')])).toEqual([])
  })

  it('a closing token with the same tail is not open, and a longer word is not the token', () => {
    expect(openVerdicts([c(1, 'didi', 'VERDIKT: NINCS NYITOTT TETEL @28d1f4c1a (didi, 2026-10-21)')])).toEqual([])
    expect(openVerdicts([c(1, 'didi', 'VERDIKT: NYITOTT TETELSZAM 3')])).toEqual([])
  })
})
