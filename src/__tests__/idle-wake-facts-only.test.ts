import { describe, expect, it } from 'vitest'
import { buildApiErrorResumeMessage, buildPullNotice, buildWakeMessage, type WorkCheckKind } from '../idle-agent.js'

// Card c2246921 (marveen 40484, decision A): the idle guard's wake reaches the agent from `system`,
// which the router wraps as <untrusted>, and that wrapping forbids reading its content as an
// instruction. A fresh session that obeys the wrapping refused the wake (jarvis, 2026-09-28). So
// the wake states FACTS the agent re-measures on the board, and no sentence orders anything.
// Every branch of the text is built here, because each one carried its own imperative before.
const NOW = Date.parse('2026-10-30T20:00:00Z')
const SEC = Math.floor(NOW / 1000)
const item = (id: string, status: string, due_date: number | null = null) =>
  ({ id, title: `t ${id}`, priority: 'normal', status, due_date })

// The Hungarian imperatives the old text used, one per branch, plus the generic second-person
// orders. A letter-boundary (not \b, which is ASCII-only and misses "írd") keeps nouns like "foglalas" out.
const IMPERATIVE = /(?<!\p{L})(FOGLALJ|FOGLALD|Vedd fel|javitsd ki|Merd ujra|ird meg|nezd meg|NE allitsd|NE sorold|mondd|folytasd|dolgozz|[ií]rd)(?!\p{L})/iu

const wakes: [string, WorkCheckKind, ReturnType<typeof item>[], Set<string>?][] = [
  ['pickable work', 'assigned_open_cards', [item('work1111', 'planned')]],
  ['reviews only', 'assigned_open_cards', [item('rev11111', 'testing')]],
  ['expired floor only', 'assigned_open_cards', [item('flor1111', 'waiting', SEC - 86400)]],
  ['bounced fix', 'assigned_open_cards', [item('bnc11111', 'testing'), item('work2222', 'planned')], new Set(['bnc11111'])],
  ['review queue, items', 'testing_without_my_comment', [item('tst11111', 'testing')]],
  ['review queue, none named', 'testing_without_my_comment', []],
  ['decision queue', 'waiting_on_me', [item('wait1111', 'waiting')]],
  ['nothing nameable', 'assigned_open_cards', []],
]

describe('idle wake carries facts, not orders (c2246921)', () => {
  it.each(wakes)('%s: no imperative sentence', (_n, kind, items, bounced) => {
    const msg = buildWakeMessage('jarvis', 13, Math.max(items.length, 1), items, NOW, kind, bounced)
    expect(msg).not.toMatch(IMPERATIVE)
  })

  it.each(wakes)('%s: says it carries facts and whose rule decides', (_n, kind, items, bounced) => {
    const msg = buildWakeMessage('jarvis', 13, Math.max(items.length, 1), items, NOW, kind, bounced)
    // f494cace: the facts line also says where a card's title is read (the wake names cards by id only).
    expect(msg).toContain('Ez az uzenet TENYEKET allit (szamok, kartya-id-k; cim: GET /api/kanban/<id>), utasitast nem hordoz')
    expect(msg).toContain('a SAJAT allando szabalyaid dontik el')
  })

  it('the header the pane classifier and the restart-loss line match on is unchanged', () => {
    const msg = buildWakeMessage('jarvis', 13, 1, [item('work1111', 'planned')], NOW, 'assigned_open_cards')
    expect(msg).toMatch(/^\[tetlen-or\] 13 perce allsz ureses prompton \(MERVE /)
  })

  it('the bounced-fix rule is still named, as Isti\'s rule rather than an order', () => {
    const msg = buildWakeMessage('jarvis', 13, 2, [item('bnc11111', 'testing'), item('work2222', 'planned')],
      NOW, 'assigned_open_cards', new Set(['bnc11111']))
    expect(msg).toContain('Isti szabalya (TG 8509): a visszadobott javitas MEGELOZI az uj kartya felvetelet.')
  })

  it.each([
    ['without parked count', undefined],
    ['with parked count', 2],
  ] as const)('pull notice %s: no imperative sentence', (_n, parked) => {
    const msg = buildPullNotice('jarvis', 13, [item('pull1111', 'planned')], NOW, ['marveen'], parked)
    expect(msg).not.toMatch(IMPERATIVE)
    expect(msg).toContain('A foglalas (`assignee` + `in_progress`) a meres ELOTT jar')
  })

  // didi 49848 F1: the API-error resume goes the same system -> agent way, wrapped as <untrusted>.
  it('the API-error resume states the interruption and carries no order', () => {
    const msg = buildApiErrorResumeMessage(NOW)
    expect(msg).toMatch(/^a turnod API-hibával megszakadt \d\d:\d\d-kor\. /)
    expect(msg).not.toMatch(IMPERATIVE)
    expect(msg).toContain('a SAJAT allando szabalyaid dontik el')
  })

  it('the imperative check itself catches the old resume text (positive control)', () => {
    expect('a turnod API-hibával megszakadt 12:05-kor, folytasd onnan, ahol tartottál, rövid fordulókban dolgozz, a leleteket a kártyára írd').toMatch(IMPERATIVE)
    expect('a leleteket a kártyára írd').toMatch(IMPERATIVE)
    expect('foglalas, irda, folytasdal').not.toMatch(IMPERATIVE)
  })
})
