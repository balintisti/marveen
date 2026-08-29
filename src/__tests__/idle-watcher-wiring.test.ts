import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// WHY THIS TEST EXISTS, AND WHAT IT CANNOT DO (card 0fe791fb, 2026-08-24).
//
// Three commits added guard behaviour that was correct, tested, and UNREACHABLE. Jarvis
// measured it: the production caller passed no `ownWorkIds`, so the repeat-suppression
// could never fire; and it fetched cards with `listKanbanCards()`, whose table has no
// labels column, so every label test read `undefined` and answered "no". The functions
// were right and NOTHING reached them.
//
// That is a WIRING failure, and no unit test of those functions can see it -- they all
// pass either way. This test reads the call site instead.
//
// IT IS A SOURCE ASSERTION, and its limit is stated rather than left to be discovered:
// it proves the values are CONNECTED TO EACH OTHER, not that the running process
// behaves. It would not catch a wrong label name or a broken query. What it does catch
// is the exact failure that happened: a field quietly missing from the call, and a
// count that stops coming from the same list as the ids.
const SRC = readFileSync(join(__dirname, '..', 'web', 'idle-agent-watcher.ts'), 'utf-8')

describe('the idle guard is actually fed what it needs', () => {
  it('joins the labels, because the cards table does not carry them', () => {
    expect(SRC).toMatch(/getLabelsForAllCards\(\)/)
    // The join must reach the cards the guard sees, not merely be fetched and dropped.
    expect(SRC).toMatch(/listKanbanCards\(\)\s*\.map\([\s\S]{0,120}?labels:/)
  })

  it('passes the work IDS, not only the count', () => {
    expect(SRC).toMatch(/ownWorkIds:/)
  })

  it('CORRESPONDENCE: the count and the ids come from the SAME selection', () => {
    // The claim that matters, and the reason this is not a presence check. Two separate
    // calls to selectDeclaredWork would each pass the two assertions above while still
    // being able to disagree -- and a count from a different list can suppress a wake
    // for work the agent was never shown.
    const countFrom = SRC.match(/const ownWorkCount = (\w+)/)?.[1]
    const idsFrom = SRC.match(/ownWorkIds: (\w+)/)?.[1]
    expect(countFrom).toBeDefined()
    expect(idsFrom).toBe(countFrom)
  })

  it('selects ONCE -- a second selection would be a second chance to disagree', () => {
    const selections = SRC.match(/selectDeclaredWork\(/g) ?? []
    expect(selections).toHaveLength(1)
  })
})

// A LATENT DEPENDENCY BETWEEN TWO THRESHOLDS, found by jarvis in review (2026-08-24).
//
// The cooldown gate runs BEFORE the stale re-arm and returns early. So if
// `wakeCooldownMs` were ever raised above `wakeStaleRearmMs`, the re-arm would never get
// a say -- the guard would go back to silencing itself on a stable list, and nothing
// would say so. Neither value is wrong on its own; only their ORDER is.
//
// This is the kind of coupling that survives review precisely because both numbers look
// reasonable in isolation. Pinned so that changing one is a decision about the pair.
describe('the two wake thresholds are ordered, not merely set', () => {
  it('the cooldown must be SHORTER than the stale re-arm, or the re-arm is dead code', () => {
    const cooldown = Number(SRC.match(/wakeCooldownMs:\s*([\d\s*_]+),/)?.[1]?.replace(/[\s_]/g, '').split('*').reduce((a, b) => a * Number(b), 1))
    const rearm = Number(SRC.match(/wakeStaleRearmMs:\s*([\d\s*_]+),/)?.[1]?.replace(/[\s_]/g, '').split('*').reduce((a, b) => a * Number(b), 1))
    expect(cooldown, 'wakeCooldownMs not found in the watcher source').toBeGreaterThan(0)
    expect(rearm, 'wakeStaleRearmMs not found in the watcher').toBeGreaterThan(0)
    expect(
      cooldown < rearm,
      `wakeCooldownMs (${cooldown}ms) must stay BELOW wakeStaleRearmMs (${rearm}ms): the ` +
        'cooldown gate returns first, so a longer cooldown makes the stale re-arm ' +
        'unreachable and the guard silences itself on a stable list.',
    ).toBe(true)
  })
})
