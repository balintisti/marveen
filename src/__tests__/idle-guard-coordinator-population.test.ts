import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectDeclaredWork, parseWorkCheck } from '../idle-agent.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Card 6c1439ac. The idle guard was the ONLY one of the three watchers that never
// evaluated the coordinator -- not "evaluated and found no declaration", but never
// iterated him at all, because listAgentNames() reads agents/ and he has no
// directory there. The other two include him with the same one-liner.
describe('the coordinator is in the idle guard population', () => {
  // A SOURCE-LEVEL assertion on purpose. The population is built from the
  // filesystem, so a behavioural test would need a fake agents/ tree and would
  // then be testing the fake. What must not silently regress is the PREPEND.
  const watcher = readFileSync(join(REPO, 'src', 'web', 'idle-agent-watcher.ts'), 'utf8')

  it('prepends MAIN_AGENT_ID to the agent list', () => {
    expect(watcher).toMatch(/const agents = \[\.\.\.new Set\(\[MAIN_AGENT_ID, \.\.\.listAgentNames\(\)\]\)\]/)
  })

  it('does NOT build the population from listAgentNames alone', () => {
    // The exact line this card exists to change. If it comes back, the coordinator
    // silently leaves the population again and nothing reports it.
    expect(watcher).not.toMatch(/const agents = listAgentNames\(\)\s*$/m)
  })

  it('reads the coordinator declaration from PROJECT_ROOT, not agents/<name>', () => {
    // Creating agents/marveen/ would put him in listAgentNames(), and
    // context-guard-runner:478 prepends MAIN_AGENT_ID WITHOUT deduping -- so he
    // would be processed twice there. The codebase already has the pattern for
    // this, in two other files.
    expect(watcher).toMatch(/agent === MAIN_AGENT_ID \? PROJECT_ROOT : agentDir\(agent\)/)
  })
})

describe("waiting_on_me: the blocker's own queue", () => {
  const card = (id: string, status: string, assignee: string | null) =>
    ({ id, status, assignee, archived_at: null, priority: 'normal', updated_at: 1 })

  const cards = [
    card('w1', 'waiting', 'marveen'),
    card('w2', 'waiting', 'marveen'),
    card('w3', 'waiting', 'friday'),      // someone else is the blocker
    card('p1', 'planned', 'marveen'),     // his own pickable work, not the decision queue
    card('t1', 'testing', 'marveen'),
    card('d1', 'done', 'marveen'),
  ]
  const check = parseWorkCheck('{"kind":"waiting_on_me"}')!

  it('is accepted as a declaration kind at all', () => {
    // Without this the file parses to null and the guard reports
    // 'no-work-check-declared' at him every round -- a guard red from birth.
    expect(check).not.toBeNull()
    expect(check.kind).toBe('waiting_on_me')
  })

  it('selects exactly the waiting cards blocked on THIS agent', () => {
    const got = selectDeclaredWork(check, 'marveen', cards, new Map(), 'marveen').map(c => c.id)
    expect(got).toEqual(['w1', 'w2'])
  })

  it('is the MIRROR of assigned_open_cards, which excludes waiting', () => {
    // The two kinds must disagree on exactly the `waiting` column: for a worker it
    // means blocked on someone else, for the blocker it is the only column that is
    // his. If both returned the same set, one of them is mislabelled.
    const mine = selectDeclaredWork(check, 'marveen', cards, new Map(), 'marveen').map(c => c.id)
    const worker = selectDeclaredWork(
      parseWorkCheck('{"kind":"assigned_open_cards"}')!, 'marveen', cards, new Map(), 'marveen',
    ).map(c => c.id)
    expect(mine).not.toEqual(worker)
    expect(worker).not.toContain('w1')
    expect(mine).not.toContain('p1')
  })

  it('never counts an archived card', () => {
    const withArchived = [...cards, { ...card('w9', 'waiting', 'marveen'), archived_at: 123 }]
    const got = selectDeclaredWork(check, 'marveen', withArchived, new Map(), 'marveen').map(c => c.id)
    expect(got).not.toContain('w9')
  })
})
