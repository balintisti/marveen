// Card 17eedaee (marveen 74b3ff53): the "Rám vár" toggle shows the cards WAITING on the
// owner -- the `varakozik:<owner>` label -- not the cards ASSIGNED to the owner. The
// filter functions are taken out of web/app.js and run, so the test reads behaviour,
// not the presence of a string.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const APP = readFileSync(join(ROOT, 'web', 'app.js'), 'utf-8')

function fn(name: string): string {
  const a = APP.indexOf(`function ${name}(`)
  expect(a, `nincs ilyen fuggveny: ${name}`).toBeGreaterThan(-1)
  const b = APP.indexOf('\n}\n', a)
  expect(b).toBeGreaterThan(a)
  return APP.slice(a, b + 2)
}

type Card = { id: string; assignee: string | null; project?: string; labels?: { id: string; name: string }[] }
const WAIT = { id: 'c288717c', name: 'varakozik:isti' }
const CARDS: Card[] = [
  { id: 'e756c0d5', assignee: 'jarvis', labels: [WAIT] },
  { id: '69f38d7a', assignee: 'computress', labels: [{ id: '0554c87b', name: 'IGAZOLT' }, WAIT] },
  { id: 'isti0001', assignee: 'Isti', labels: [] },
  { id: 'none0001', assignee: 'didi' },
]

function run(state: { waiting: boolean; assignee?: string; owner?: string | null }): string[] {
  const ctx = vm.createContext({
    kanbanAssignees: state.owner === null ? [] : [{ name: state.owner ?? 'Isti', type: 'owner' }, { name: 'didi', type: 'agent' }],
    kanbanProjectFilter: '',
    kanbanAssigneeFilter: state.assignee ?? '',
    kanbanWaitingOnOwner: state.waiting,
    CARDS,
  })
  vm.runInContext([fn('ownerAssigneeName'), fn('ownerWaitLabelName'), fn('kanbanCardMatchesBaseFilters')].join('\n'), ctx)
  return vm.runInContext('CARDS.filter(kanbanCardMatchesBaseFilters).map((c) => c.id)', ctx) as string[]
}

describe('"Rám vár" filters on the varakozik:<owner> label (card 17eedaee)', () => {
  it('shows the two labelled cards, not the owner-assigned one without the label', () => {
    expect(run({ waiting: true })).toEqual(['e756c0d5', '69f38d7a'])
  })

  it('off: every card is shown (control)', () => {
    expect(run({ waiting: false })).toEqual(CARDS.map((c) => c.id))
  })

  it('the owner\'s own assigned cards stay reachable from the assignee dropdown', () => {
    expect(run({ waiting: false, assignee: 'Isti' })).toEqual(['isti0001'])
  })

  it('the two filters combine', () => {
    expect(run({ waiting: true, assignee: 'jarvis' })).toEqual(['e756c0d5'])
  })

  it('the label follows the owner\'s name, case-insensitively', () => {
    expect(run({ waiting: true, owner: 'ISTI' })).toEqual(['e756c0d5', '69f38d7a'])
    expect(run({ waiting: true, owner: 'Bea' })).toEqual([])
  })

  it('the button no longer writes the assignee filter', () => {
    const a = APP.indexOf("ownerBtn.addEventListener('click'")
    const handler = APP.slice(a, APP.indexOf('})', a))
    expect(handler).toMatch(/kanbanWaitingOnOwner = !kanbanWaitingOnOwner/)
    expect(handler).not.toMatch(/kanbanAssigneeFilter\s*=/)
  })
})
