import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// AN UNDEFINED CSS CLASS EMITS ZERO RULES AND DOES NOT ERROR (card 6a4067f7).
//
// Measured 2026-09-10: `badge-danger` carried the `error` run status, so a
// FAILED scheduled run rendered indistinguishably from a neutral one; and
// `badge-warn` marked pending channel requests. Both had been emitted for a
// long time and neither had a rule anywhere.
//
// WHY A CLASS-LEVEL ASSERTION AND NOT TWO ONE-LINE FIXES. The two were found on
// two separate occasions by two people, each while standing in the file that
// happened to emit one -- `badge-danger` in the run-status map, `badge-warn` in
// a different file entirely. Nothing signalled either. That is this repo's own
// law: if the next such class only gets caught when somebody remembers, the
// guard belongs at the CLASS level, not beside the thing it protects.
//
// THE METER'S SHAPE IS THE WHOLE PROBLEM HERE, so it is pinned below:
//
//   - A START BOUNDARY IS REQUIRED. A naive /badge-[a-z0-9-]+/ also matches
//     INSIDE longer, unrelated class names -- `recall-badge-agent`,
//     `skills-badge--agent`, `updates-badge-unknown` -- and reports them as
//     undefined `badge-*` classes. Measured: that shape gave SIX findings of
//     which FOUR were false (67%), while the bounded form gives exactly the
//     two real ones. There is a regression test for this below, because the
//     failure looks like a finding rather than like a bug.
//
//   - CLASSES BUILT AT RUNTIME ARE INVISIBLE to any literal matcher. Rather
//     than let that be a silent hole, every concatenation site must be
//     DECLARED here with the values it can produce. An undeclared site fails.

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..', 'web')

// A `badge-x` token that is NOT preceded by a word char or a hyphen.
const BADGE = /(?<![\w-])badge-[a-z0-9-]+/g

// Concatenation sites, each with the suffixes it can produce. Anchored on the
// CODE rather than on a line number, which drifts.
const RUNTIME_SITES: { code: string; produces: string[] }[] = [
  // web/app.js: `const badgeClass = 'badge-' + tier`, tier from
  // `mem.tier || mem.category || 'warm'`; the label map names exactly four.
  { code: "'badge-' + tier", produces: ['badge-hot', 'badge-warm', 'badge-cold', 'badge-shared'] },
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const all = walk(WEB)
const cssFiles = all.filter((f) => f.endsWith('.css'))
const emitFiles = all.filter((f) => f.endsWith('.js') || f.endsWith('.html'))

// COMMENTS ARE STRIPPED FIRST, and that is not tidiness. Measured while adding
// a deliberate note next to two rules (marveen's ruling, 2026-09-10): a class
// merely NAMED in a `/* ... */` comment counted as DEFINED, so an emitted class
// with no rule passed green. The very comment this file's sibling rules needed
// would have created the masking. A guard whose own documentation can blind it
// is worse than none, so the parse sees declarations only.
const stripCssComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ')

const defined = new Set<string>()
for (const f of cssFiles) {
  for (const m of stripCssComments(readFileSync(f, 'utf-8')).matchAll(/\.((?<![\w-])badge-[a-z0-9-]+)/g)) {
    defined.add(m[1])
  }
}

const emitted = new Map<string, Set<string>>()
for (const f of emitFiles) {
  for (const m of readFileSync(f, 'utf-8').matchAll(BADGE)) {
    if (!emitted.has(m[0])) emitted.set(m[0], new Set())
    emitted.get(m[0])!.add(relative(WEB, f))
  }
}

describe('every badge class the web tree emits has a stylesheet rule', () => {
  it('POSITIVE CONTROL: the meter finds classes on BOTH sides', () => {
    // Without this, an empty scan would pass the assertion below in silence --
    // the same "green because it looked at nothing" this repo keeps recording.
    expect(defined.size).toBeGreaterThan(0)
    expect(emitted.size).toBeGreaterThan(0)
    expect([...emitted.keys()].filter((c) => defined.has(c)).length).toBeGreaterThan(0)
  })

  it('leaves no emitted class without a rule', () => {
    const missing = [...emitted.keys()].filter((c) => !defined.has(c)).sort()
    expect(
      missing,
      `emitted with no stylesheet rule: ${missing.map((c) => `${c} (${[...emitted.get(c)!].join(', ')})`).join('; ')}`,
    ).toEqual([])
  })

  it('REGRESSION: the boundary does not mistake a longer class for a badge class', () => {
    // These three exist in web/app.js as suffixes of unrelated names. A meter
    // without the start boundary reports them as undefined badge classes -- it
    // fails in the direction of a FINDING, which is why it is convincing.
    for (const decoy of ['badge-agent', 'badge-cat', 'badge-unknown', 'badge--agent']) {
      expect(emitted.has(decoy), `${decoy} matched -- the start boundary is gone`).toBe(false)
    }
  })
})

describe('classes assembled at runtime are declared, not invisible', () => {
  const sources = emitFiles.map((f) => ({ f: relative(WEB, f), src: readFileSync(f, 'utf-8') }))

  it('every concatenation site in the tree is declared here', () => {
    const found = sources.flatMap(({ f, src }) =>
      [...src.matchAll(/['"`]badge-['"`]\s*\+|`badge-\$\{/g)].map((m) => `${f}: ${src.slice(m.index!, m.index! + 40).split('\n')[0]}`),
    )
    const undeclared = found.filter((hit) => !RUNTIME_SITES.some((s) => hit.includes(s.code)))
    expect(
      undeclared,
      'a runtime-built badge class appeared that this test does not know about; declare it in RUNTIME_SITES with the values it can produce',
    ).toEqual([])
  })

  it('CONTROL: the declared site is actually present (a stale declaration would pass silently)', () => {
    for (const site of RUNTIME_SITES) {
      expect(sources.some(({ src }) => src.includes(site.code)), `${site.code} not found`).toBe(true)
    }
  })

  it('every value a runtime site can produce has a rule', () => {
    for (const site of RUNTIME_SITES) {
      for (const cls of site.produces) {
        expect(defined.has(cls), `${site.code} can produce ${cls}, which has no rule`).toBe(true)
      }
    }
  })
})
