import { describe, it, expect } from 'vitest'
import { rootMismatchMessage, jsonDrift, lineDrift, UNRESOLVED } from '../seed-drift.js'

// A seeded scheduled task never receives a later template fix
// (`if (existsSync(dest)) continue`), and that early exit is NOT a bug -- it
// protects hand edits that have been earned. What is missing is that the two
// cases are indistinguishable, so a template fix is lost silently. This tool
// only SIGNALS; the four acceptance conditions come from the card, and the
// fifth came from running it.

describe('condition 5: the tool refuses to compare from anywhere but the install', () => {
  // Found by RUNNING it: from a worktree, {{INSTALL_DIR}} resolves to that
  // worktree, so every template path is rewritten and reported as drift --
  // confidently, with a direction, in the exact shape of a real finding. Ten
  // files, all artifact. Same class as a resolver that misses a placeholder,
  // one level out: complete resolver, wrong tree.
  it('refuses when the resolved root is not the main worktree', () => {
    const msg = rootMismatchMessage('/Users/x/some-worktree', '/Users/x/install')
    expect(msg).toContain('not the install')
    expect(msg).toContain('/Users/x/some-worktree')
    expect(msg).toContain('/Users/x/install')
  })
  it('CONTROL: and says nothing when it IS the install', () => {
    expect(rootMismatchMessage('/Users/x/install', '/Users/x/install')).toBeNull()
  })
})

describe('condition 2: the direction is the output, because the three want different decisions', () => {
  it('only-in-template = the fix never reached the live task', () => {
    const d = lineDrift('a\nb\nNEW\n', 'a\nb\n')
    expect(d.onlyTemplate).toEqual(['NEW'])
    expect(d.onlyLive).toEqual([])
  })
  it('only-in-live = a hand edit an overwrite would destroy', () => {
    const d = lineDrift('a\nb\n', 'a\nb\nEARNED LESSON\n')
    expect(d.onlyTemplate).toEqual([])
    expect(d.onlyLive).toEqual(['EARNED LESSON'])
  })
  it('both = the case that proves overwriting is the wrong remedy', () => {
    const d = lineDrift('a\nFROM TEMPLATE\n', 'a\nFROM LIVE\n')
    expect(d.onlyTemplate).toEqual(['FROM TEMPLATE'])
    expect(d.onlyLive).toEqual(['FROM LIVE'])
  })
  it('CONTROL: identical content yields nothing in either direction', () => {
    expect(lineDrift('a\nb\n', 'a\nb\n')).toEqual({ onlyTemplate: [], onlyLive: [] })
  })
  it('blank lines are not drift', () => {
    expect(lineDrift('a\n\n\nb\n', 'a\nb\n')).toEqual({ onlyTemplate: [], onlyLive: [] })
  })
})

describe('condition 3: an untouched seed must not be flagged', () => {
  // Measured on this repo: all three live task-config.json files carry
  // `stuckAfterMinutes`, which no template has. Treating a runtime-added key as
  // drift would flag every task every run, and a signal that always fires is
  // one nobody reads.
  it('a runtime-added key is not drift -- IN EITHER DIRECTION', () => {
    const d = jsonDrift('{"schedule":"0 7 * * *"}', '{"schedule":"0 7 * * *","stuckAfterMinutes":30}')
    // BOTH sides, and the mutation probe is why. Asserting only `onlyTemplate`
    // let a mutation through that reported the runtime key as `onlyLive` -- the
    // CLI flags on EITHER side, so that version would have flagged every task
    // every run, which is exactly what condition 3 forbids. The assertion was
    // narrower than the claim it was standing in for.
    expect(d).toEqual({ onlyTemplate: [], onlyLive: [] })
  })
  it('CONTROL: but a CHANGED value the template declares IS drift', () => {
    const d = jsonDrift('{"agent":"marveen"}', '{"agent":"jarvis","stuckAfterMinutes":30}')
    expect(d.onlyTemplate.length).toBe(1)
    expect(d.onlyTemplate[0]).toContain('marveen')
    expect(d.onlyTemplate[0]).toContain('jarvis')
  })
  it('CONTROL: and a MISSING key the template declares is drift too', () => {
    const d = jsonDrift('{"enabled":true}', '{}')
    expect(d.onlyTemplate.length).toBe(1)
  })
})

describe('condition 4: an unresolved placeholder stops the tool', () => {
  // jarvis paid for this three times in a row -- INSTALL_DIR only, then
  // MAIN_AGENT_ID, then BOT_NAME -- each producing a confident, wrong report.
  it('the pattern finds what the resolver left behind', () => {
    expect('x {{BOT_NAME}} y {{WEB_PORT}}'.match(UNRESOLVED)).toEqual(['{{BOT_NAME}}', '{{WEB_PORT}}'])
  })
  it('CONTROL: and finds nothing in fully resolved text', () => {
    expect('x Marveen y 3420'.match(UNRESOLVED)).toBeNull()
  })
  it('CONTROL: a lone brace pair is not a placeholder', () => {
    expect('{{lowercase}} and { {SPACED} }'.match(UNRESOLVED)).toBeNull()
  })
})
