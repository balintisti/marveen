import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// WHY THIS TEST EXISTS (card 0fe791fb, 2026-08-24). Twice in one day the same shape:
// code that was correct, tested and UNREACHABLE. The second time it was a PRODUCER with
// no CONSUMER -- `selectCoordinatorTriage` would have taken 185 testing cards off the
// agents' lists and delivered them nowhere, and the invariant test that swears nothing
// can be invisible passed the whole time, because IT calls the function directly.
//
// The rule agreed with marveen is that the narrowing comes back WITH the consumer, in
// the SAME commit. This test is that rule, in a form that does not depend on anyone
// remembering it: the two halves are pinned to each other, and whichever moves first
// fails here with the reason written out.
const SRC = readFileSync(join(__dirname, '..', 'idle-agent.ts'), 'utf-8')
const WATCHER = readFileSync(join(__dirname, '..', 'web', 'idle-agent-watcher.ts'), 'utf-8')

/** Call sites outside this module's own definition and its own comments. */
const productionCalls = (name: string) =>
  (WATCHER.match(new RegExp(`${name}\\(`, 'g')) ?? []).length

describe('a producer with no consumer must not narrow anything', () => {
  it('the triage selector still has no production caller -- so the assignee keeps untriaged cards', () => {
    const wired = productionCalls('selectCoordinatorTriage')
    const narrows = /if \(!labelNames\(c\)\.includes\(WAITING_ON_ASSIGNEE_LABEL\)\) return false/.test(SRC)
    // The coupling, stated as the implication it is: narrowing is allowed ONLY once the
    // triage list is actually delivered somewhere.
    expect(
      !narrows || wired > 0,
      'the assignee-side narrowing is back while selectCoordinatorTriage still has no ' +
        'production caller -- that combination takes cards off the agents and delivers ' +
        'them nowhere. Wire the consumer in the SAME commit, or leave the label additive.',
    ).toBe(true)
  })

  it('and the owner-decision selector is in the same position, for the same reason', () => {
    // Pinned so its state is a decision rather than a leftover. When it gains a caller,
    // this line is where someone will come to say so.
    expect(productionCalls('selectWaitingOnOwner')).toBe(0)
  })

  it('the label still ADDS: a card marked for the assignee is his even with no other signal', () => {
    // The half that must keep working while the narrowing is off -- otherwise the label
    // family is inert and the convention has nothing to show for itself.
    expect(SRC).toMatch(/const markedForMe = labelNames\(c\)\.includes\(WAITING_ON_ASSIGNEE_LABEL\)/)
    expect(SRC).toMatch(/if \(markedForMe\) return true/)
  })
})
