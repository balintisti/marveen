import { describe, it, expect } from 'vitest'
import { sigTransitionFacts } from '../web/stuck-sig-transition-probe.js'

const T0 = 1_700_000_000_000

describe('parked-sig transition facts (card 7406eb1f)', () => {
  it('separates the two causes of a permanently-zero attempts counter', () => {
    // THE WHOLE POINT. Both of these show attempts 0, which is why the existing
    // deferral log cannot tell them apart. These facts can.
    const changing = sigTransitionFacts('sig-B', 'sig-A', T0 - 5_000, 0, false, T0)
    const stable = sigTransitionFacts('sig-A', 'sig-A', T0 - 5_000, 0, false, T0)

    // (a) signature churn: the counter resets every tick, so the spell never matures
    expect(changing.sigChanged).toBe(true)
    // (b) stable signature, still inside the confirm window
    expect(stable.sigChanged).toBe(false)
    expect(stable.spellAgeMs).toBe(5_000)

    // Asserted as a pair: this fails if the field collapses to a constant in
    // either direction, which a single-case assertion would not catch.
    expect([changing.sigChanged, stable.sigChanged]).toEqual([true, false])
  })

  it('a first sighting reads as changed, with no spell age yet', () => {
    const f = sigTransitionFacts('sig-A', null, null, 0, false, T0)
    expect(f.sigChanged).toBe(true)
    expect(f.sigPresent).toBe(true)
    expect(f.spellAgeMs).toBeNull()
    expect(f.prevSigHash).toBeNull()
  })

  it('an emptied box reads as changed and not present', () => {
    const f = sigTransitionFacts(null, 'sig-A', T0 - 1_000, 3, false, T0)
    expect(f.sigPresent).toBe(false)
    expect(f.sigChanged).toBe(true)
    expect(f.sigHash).toBeNull()
    // The attempts the recovery saw on ENTRY, so a run of ticks reads in sequence.
    expect(f.attemptsBefore).toBe(3)
  })

  it('carries identity WITHOUT carrying content', () => {
    // The signature is derived from the parked text, i.e. message content. The
    // question only needs "did it change", so the facts must not ship the text.
    const secretish = 'TEAM MEMBER NOTICE the quarterly figures are 4.2M and the token is abc123'
    const f = sigTransitionFacts(secretish, secretish, T0 - 1, 0, false, T0)
    const serialised = JSON.stringify(f)
    expect(serialised).not.toContain('4.2M')
    expect(serialised).not.toContain('abc123')
    expect(serialised).not.toContain('quarterly')
    // ...but identity is still usable: the same input hashes the same, and a
    // different input hashes differently.
    expect(f.sigHash).toBe(f.prevSigHash)
    expect(sigTransitionFacts('other', null, null, 0, false, T0).sigHash).not.toBe(f.sigHash)
    expect(f.sigHash).toMatch(/^[0-9a-f]{10}$/)
  })

  it('reports whether the recovery actually fired', () => {
    expect(sigTransitionFacts('a', 'a', T0 - 60_000, 1, true, T0).recovered).toBe(true)
    expect(sigTransitionFacts('a', 'a', T0 - 60_000, 1, false, T0).recovered).toBe(false)
  })
})
