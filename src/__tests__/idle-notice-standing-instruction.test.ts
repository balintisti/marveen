// Card 6ecd85e5: an agent with work that stands under the coordinator's standing instruction is a
// THIRD state, beside "take the top item" and "the list is not yours". Measured on dexter: 159 items,
// workcheck.json `assigned_open_cards` and TRUE. The fix the coordinator notice offered, `{"kind":"none"}`,
// silences the guard with no expiry. Both messages now hand over the expiring standstill instead, and
// the shape they hand over must be one the parser accepts and honours.
import { describe, it, expect } from 'vitest'
import {
  buildNoWorkNotice, buildWakeMessage, parseWorkCheck, standstillVerdict, STANDSTILL_EXAMPLE,
} from '../idle-agent.js'

const NOW = Date.UTC(2026, 9, 30, 8, 0)
const UNTIL = '2026-10-30T13:00:00+01:00'

/** The standstill JSON a message hands over, its blank filled, merged into a real declaration. */
function handedOver(msg: string): ReturnType<typeof parseWorkCheck> {
  const m = msg.match(/\{"standstill":\{.*?\}\}/)
  expect(m).not.toBeNull()
  const standstill = JSON.parse(m![0].replace('<ISO-8601 idozonaval>', UNTIL)).standstill
  return parseWorkCheck(JSON.stringify({ kind: 'assigned_open_cards', standstill }))
}

describe('the coordinator notice offers the expiring standstill before `none`', () => {
  const msg = buildNoWorkNotice('dexter', 42, NOW, 'assigned_open_cards')
  it('the handed-over shape parses and holds until its until', () => {
    const check = handedOver(msg)
    expect(standstillVerdict(check, NOW, null).state).toBe('active')
    expect(standstillVerdict(check, Date.parse(UNTIL), null).state).toBe('expired')
  })
  it('the standstill comes first; `none` only for an on-call agent, with its cost named', () => {
    expect(msg.indexOf('"standstill"')).toBeGreaterThan(0)
    expect(msg.indexOf('"standstill"')).toBeLessThan(msg.indexOf('{"kind":"none"}'))
    expect(msg).toContain('`{"kind":"none"}` CSAK tartosan sor nelkuli, ugyeletes agensnek: az LEJARAT NELKUL nemit.')
    expect(msg).toContain('IDEIGLENESEN')
  })
})

describe('the wake names the third state', () => {
  const items = [{ id: 'aaaa1111-x', title: 'T', status: 'planned', priority: 'normal' }] as never
  for (const kind of ['assigned_open_cards', 'waiting_on_me', 'testing_without_my_comment'] as const) {
    it(`${kind}: standing instruction -> coordinator's expiring standstill, a shape that parses`, () => {
      const msg = buildWakeMessage('dexter', 13, 1, items, NOW, kind)
      expect(msg).toContain('ALLO UTASITAS')
      expect(msg).toContain('HARMADIK eset')
      expect(standstillVerdict(handedOver(msg), NOW, null).state).toBe('active')
    })
  }
  it('the example constant is the one both messages carry', () => {
    expect(buildWakeMessage('dexter', 13, 1, items, NOW, 'assigned_open_cards')).toContain(STANDSTILL_EXAMPLE)
    expect(buildNoWorkNotice('dexter', 42, NOW)).toContain(STANDSTILL_EXAMPLE)
  })
})
