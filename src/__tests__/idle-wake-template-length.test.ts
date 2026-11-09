import { describe, it, expect } from 'vitest'
import { buildWakeMessage, WAKE_MAX_CHARS, STANDSTILL_EXAMPLE, ASYMMETRY_NOTE, type WorkCheckKind } from '../idle-agent.js'

// Card 2e78cf63 (marveen, comments 56870 / 56900): the [tetlen-or] wake went out 195 times a week at an average of
// 2 692 characters. It is now capped by construction (WAKE_MAX_CHARS: the fixed parts first, the item lists into
// what is left) and this file pins BOTH halves: no instance goes over the cap, and every OPERATIVE piece is still in
// it ("a fresh session does not follow links before acting"). Cutting a step, or growing the text back, fails here.
const NOW = Date.UTC(2026, 10, 9, 9, 0, 0)
const card = (id: string, status: string, priority = 'normal', title = 'a'.repeat(80)) =>
  ({ id, status, priority, title, due_date: null as number | null })

const KINDS: WorkCheckKind[] = ['assigned_open_cards', 'testing_without_my_comment', 'waiting_on_me']
// The longest agent name makes the longest message (the name rides in the text twice).
const AGENTS = ['computress', 'marveen', 'ford']

const many = [
  card('bnc00001', 'testing', 'high'), card('bnc00002', 'in_progress', 'high'),
  ...Array.from({ length: 12 }, (_, i) => card(`wrk${String(i).padStart(5, '0')}`, 'planned', 'urgent')),
  ...Array.from({ length: 40 }, (_, i) => card(`rev${String(i).padStart(5, '0')}`, 'testing', 'high')),
  { ...card('flr00001', 'waiting'), due_date: Math.floor(NOW / 1000) - 86_400 },
  { ...card('flr00002', 'waiting'), due_date: Math.floor(NOW / 1000) - 86_400 },
]
const bounced = new Set(['bnc00001', 'bnc00002'])
const scenarios: [string, () => (agent: string, kind: WorkCheckKind) => string][] = [
  ['every group full, two bounced', () => (a, k) => buildWakeMessage(a, 120, 400, many, NOW, k, bounced)],
  ['reviews only (40)', () => (a, k) => buildWakeMessage(a, 120, 40, many.filter((c) => c.id.startsWith('rev')), NOW, k)],
  ['one pickable card', () => (a, k) => buildWakeMessage(a, 13, 1, [card('one00001', 'planned')], NOW, k)],
  ['nothing nameable', () => (a, k) => buildWakeMessage(a, 13, 3, [], NOW, k)],
]

describe('the wake never goes over the cap', () => {
  it('the cap itself is the agreed ceiling (a raised constant fails here)', () => {
    expect(WAKE_MAX_CHARS).toBeLessThanOrEqual(1100)
  })
  for (const [label, make] of scenarios) {
    for (const kind of KINDS) {
      for (const agent of AGENTS) {
        it(`${label} / ${kind} / ${agent}: at most ${WAKE_MAX_CHARS} characters`, () => {
          expect(make()(agent, kind).length).toBeLessThanOrEqual(WAKE_MAX_CHARS)
        })
      }
    }
  }
  it('the fixed parts alone (no card named) leave room for at least one header and one card line', () => {
    // 'nothing nameable' still prints the fixed parts; the cap minus their length is what the lists can use.
    const fixed = buildWakeMessage('computress', 120, 3, [], NOW, 'testing_without_my_comment').length
    expect(WAKE_MAX_CHARS - fixed).toBeGreaterThanOrEqual(200)
  })
})

describe('the wake still names cards (the one thing that moved agents, measured 2026-08-21)', () => {
  it('a normal queue: at least two pickable cards are named and the rest is counted', () => {
    const msg = buildWakeMessage('computress', 12, 21, many.slice(2, 14), NOW, 'assigned_open_cards')
    expect((msg.match(/^ {2}wrk\d{5}/gm) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(msg).toMatch(/^\+\d+ tovabbi a tablan$/m)
  })
  it('the count line is exact: named + counted = the cards given', () => {
    const items = many.slice(2, 14)
    const msg = buildWakeMessage('ford', 12, items.length, items, NOW, 'assigned_open_cards')
    const named = (msg.match(/^ {2}wrk\d{5}/gm) ?? []).length
    const more = Number(/^\+(\d+) tovabbi a tablan$/m.exec(msg)?.[1] ?? 0)
    expect(named + more).toBe(items.length)
  })
})

describe('the operative pieces survive the cut, in every kind', () => {
  for (const kind of KINDS) {
    const msg = buildWakeMessage('ford', 13, 2, [card('wrk00001', 'planned'), card('wrk00002', 'planned')], NOW, kind)
    const pieces: [string, string][] = [
      ['what arrived: the idle minutes, the stamp, the count', '[tetlen-or] 13 perce allsz ureses prompton (MERVE '],
      ['nobody human was alerted', 'Isti NEM lett ertesitve'],
      ['facts, not orders, and whose rule decides', 'utasitast nem hordoz: a SAJAT allando szabalyaid dontik el'],
      ['the count is a snapshot', 'PILLANATFELVETEL'],
      ['the re-measure, by absolute script path and the agent name', '/scripts/my-open-cards.sh ford'],
      ['the set the line does not count', ASYMMETRY_NOTE],
      ['the declared kind is named', `\`${kind}\``],
      ['the one-line reason goes to the card or the coordinator', 'egy soros indoklas a helye'],
      ['...', 'a kartya vagy marveen'],
      ['`none` mutes the only wake-up', 'A workcheck.json `none` erteke elnemitja ezt az ort'],
      ['the standing-instruction third case', 'ALLO UTASITAS'],
      ['...', 'HARMADIK eset'],
      ['...in a shape the standstill parser reads', STANDSTILL_EXAMPLE],
    ]
    it.each(pieces)(`${kind}: keeps %s`, (_what, text) => {
      expect(msg).toContain(text)
    })
  }
})
