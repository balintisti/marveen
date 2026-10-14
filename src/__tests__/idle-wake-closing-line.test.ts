import { describe, expect, it } from 'vitest'
import { buildWakeMessage, type WorkCheckKind } from '../idle-agent.js'

// Card 82c53a51 (from 0e36eab0, dexter's comment 15838): the wake's closing line told the
// agent its workcheck.json "lies" and must be fixed. The only quiet value there is `none`,
// which silences the guard -- the agent's only source of a new turn. Every branch of the
// close must point at the card / coordinator and away from `none`.
const NOW = Date.parse('2026-10-14T15:00:00Z')
const item = (id: string, status: string) => ({ id, title: `t ${id}`, priority: 'normal', status, due_date: null })

const cases: [string, WorkCheckKind, ReturnType<typeof item>[]][] = [
  ['pickable work', 'assigned_open_cards', [item('work1111', 'planned')]],
  ['reviews only', 'assigned_open_cards', [item('rev11111', 'testing')]],
  ['review queue', 'testing_without_my_comment', []],
  ['decision queue', 'waiting_on_me', [item('wait1111', 'waiting')]],
]

describe('wake closing line (82c53a51)', () => {
  it.each(cases)('%s: does not call the declaration a lie or ask to fix it', (_n, kind, items) => {
    const msg = buildWakeMessage('dexter', 13, Math.max(items.length, 1), items, NOW, kind)
    expect(msg).not.toMatch(/hazudik/)
    expect(msg).not.toMatch(/azt kell javitani/)
  })

  it.each(cases)('%s: warns against `none` and names where the answer goes', (_n, kind, items) => {
    const msg = buildWakeMessage('dexter', 13, Math.max(items.length, 1), items, NOW, kind)
    const tail = msg.split('\n').slice(-3).join('\n')
    expect(tail).toContain('NE allitsd `none`-ra')
    expect(tail).toContain('a kartyara vagy marveennek')
  })
})
