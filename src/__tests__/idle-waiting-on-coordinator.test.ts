// Card 515d668f: a `waiting` card that waits ON the coordinator had no channel that reached
// the coordinator. `waiting_on_me` filtered on assignee only -- the BLOCKED side -- and the
// `varakozik:koordinator` label had zero production readers. Measured on the live board
// 2026-09-24 before the change: the probe card 5a3f9fae (assignee jarvis, label set) was
// INVISIBLE in marveen's waiting_on_me (84 cards) and visible to jarvis (control). After:
// 87 for marveen (the 3 labelled cards), jarvis unchanged at 12.
//
// What this pins beyond "the probe shows up":
//   - it is ADDITIVE: the assignee keeps the card (no narrowing, so the coupling rule in
//     idle-triage-coupling.test.ts is not engaged);
//   - only the COORDINATOR is reached by the label, not every agent;
//   - only `waiting` cards count, and the label match is case/space-insensitive (an exact
//     match would fail silently, which is the expensive direction here);
//   - the watcher really passes the coordinator id, or all of this is inert.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { selectDeclaredWork, WAITING_ON_COORDINATOR_LABEL } from '../idle-agent.js'

type Card = { id: string; status: string; assignee: string | null; labels?: { name: string }[] }
const W = { kind: 'waiting_on_me' } as const
const NOW = 1_790_000_000
// NOT a default parameter: a default would silently replace an explicit `undefined` with
// 'marveen' -- the first version of the no-coordinator case did exactly that and went red.
const NO_COORDINATOR = Symbol('none')
const run = (agent: string, cards: Card[], coordinator: string | typeof NO_COORDINATOR = 'marveen') =>
  selectDeclaredWork(W as any, agent, cards as any, new Map(),
    coordinator === NO_COORDINATOR ? undefined : coordinator, NOW).map((c: any) => c.id)

const labelled = (id: string, status = 'waiting', assignee = 'jarvis', name = WAITING_ON_COORDINATOR_LABEL): Card =>
  ({ id, status, assignee, labels: [{ name }] })

describe('varakozik:koordinator reaches the coordinator', () => {
  it('the coordinator sees a labelled waiting card assigned to someone else', () => {
    expect(run('marveen', [labelled('p1')])).toEqual(['p1'])
  })
  it('CONTROL, the gap before: without the label the coordinator does not see it', () => {
    expect(run('marveen', [{ id: 'p0', status: 'waiting', assignee: 'jarvis' }])).toEqual([])
  })
  it('ADDITIVE: the assignee still sees the same card', () => {
    expect(run('jarvis', [labelled('p1')])).toEqual(['p1'])
  })
  it('only the coordinator is reached by the label, not every agent', () => {
    expect(run('dexter', [labelled('p1')])).toEqual([])
  })
  it('only waiting cards count', () => {
    expect(run('marveen', [labelled('p2', 'planned'), labelled('p3', 'testing')])).toEqual([])
  })
  it('the label matches case- and space-insensitively', () => {
    expect(run('marveen', [labelled('p4', 'waiting', 'jarvis', '  Varakozik:Koordinator ')])).toEqual(['p4'])
  })
  it('with no coordinator configured the label reaches nobody extra', () => {
    expect(run('marveen', [labelled('p5')], NO_COORDINATOR)).toEqual([])
  })
})

describe('wiring', () => {
  it('the watcher calls selectDeclaredWork with MAIN_AGENT_ID as the coordinator', () => {
    const src = readFileSync(new URL('../web/idle-agent-watcher.ts', import.meta.url), 'utf-8')
    expect(src).toMatch(/selectDeclaredWork\(\s*check,\s*agent,\s*cards,\s*[A-Za-z]+,\s*MAIN_AGENT_ID/)
  })
})
