import { describe, it, expect } from 'vitest'
import { diffEnabledTransitions } from '../web/schedule-runner.js'

/**
 * The four controls stated on card 947d0b82 BEFORE this was written, plus the
 * prune case. They are here in the order they were agreed, so a reader can
 * check the card against the file rather than take this suite's word for it.
 *
 * What this suite does NOT claim: that the runner calls this on every tick, or
 * that the map reaches disk. Those are wiring, and a pure-function suite
 * cannot see them -- the acceptance control for that is a live flip, recorded
 * on the card, not here.
 */

const task = (name: string, enabled: boolean) => ({ name, enabled })

describe('diffEnabledTransitions', () => {
  // (a) a tick on which nothing moved must produce no line -- otherwise the
  // message fires 4x a minute per task and stops being a signal.
  it('(a) reports nothing when no flag moved', () => {
    const remembered = new Map([['alpha', true], ['beta', false]])
    const out = diffEnabledTransitions([task('alpha', true), task('beta', false)], remembered)
    expect(out.transitions).toEqual([])
    expect(out.firstSeen).toEqual([])
    expect(out.removed).toEqual([])
  })

  // (b) two successive flips must produce two lines, and each must say which
  // way it went -- a count alone cannot separate a disable from an enable.
  it('(b) reports each flip, with direction, in both directions', () => {
    const remembered = new Map([['alpha', true]])

    const off = diffEnabledTransitions([task('alpha', false)], remembered)
    expect(off.transitions).toEqual([{ name: 'alpha', from: true, to: false }])

    // the caller writes the new value back; simulate that and flip again
    remembered.set('alpha', false)
    const on = diffEnabledTransitions([task('alpha', true)], remembered)
    expect(on.transitions).toEqual([{ name: 'alpha', from: false, to: true }])
  })

  // (c) the whole reason the map is persisted: a flip that happened while the
  // process was down is still a transition at the next boot, because the
  // remembered value came off disk and the task's value came off the config.
  it('(c) a flip during downtime is one transition on the first tick after boot', () => {
    const rememberedFromDisk = new Map([['alpha', true], ['beta', true]])
    const out = diffEnabledTransitions([task('alpha', false), task('beta', true)], rememberedFromDisk)
    expect(out.transitions).toEqual([{ name: 'alpha', from: true, to: false }])
  })

  // (d) the rule that keeps the signal usable. A task with no remembered value
  // -- new task, first boot after this ships, deleted state file -- is NOT a
  // transition. Without this, one missing file writes a false "changed" line
  // for every task in the fleet.
  it('(d) a first observation is not a transition, in either state', () => {
    const out = diffEnabledTransitions([task('alpha', true), task('beta', false)], new Map())
    expect(out.transitions).toEqual([])
    expect(out.firstSeen).toEqual([
      { name: 'alpha', enabled: true },
      { name: 'beta', enabled: false },
    ])
  })

  it('(d2) an entirely empty state file does not make the whole fleet a transition', () => {
    const fleet = ['a', 'b', 'c', 'd', 'e', 'f'].map(n => task(n, true))
    const out = diffEnabledTransitions(fleet, new Map())
    expect(out.transitions).toHaveLength(0)
    expect(out.firstSeen).toHaveLength(6)
  })

  // A deleted task is pruned, not reported as a disable: those are different
  // events, and reporting one as the other is the exact confusion this card
  // exists to remove.
  it('prunes a task that no longer exists, and does not call it a disable', () => {
    const remembered = new Map([['alpha', true], ['gone', true]])
    const out = diffEnabledTransitions([task('alpha', true)], remembered)
    expect(out.removed).toEqual(['gone'])
    expect(out.transitions).toEqual([])
  })

  // Recreating a name must not fabricate a transition against the dead task's
  // last value -- this only holds because the prune above actually removes it.
  it('a task recreated under a pruned name is a first observation', () => {
    const remembered = new Map([['alpha', true]])
    const afterPrune = diffEnabledTransitions([], remembered)
    expect(afterPrune.removed).toEqual(['alpha'])
    for (const name of afterPrune.removed) remembered.delete(name)

    const recreated = diffEnabledTransitions([task('alpha', false)], remembered)
    expect(recreated.transitions).toEqual([])
    expect(recreated.firstSeen).toEqual([{ name: 'alpha', enabled: false }])
  })

  it('separates several tasks moving in opposite directions on one tick', () => {
    const remembered = new Map([['up', false], ['down', true], ['still', true]])
    const out = diffEnabledTransitions(
      [task('up', true), task('down', false), task('still', true)],
      remembered,
    )
    expect(out.transitions).toEqual([
      { name: 'up', from: false, to: true },
      { name: 'down', from: true, to: false },
    ])
  })
})
