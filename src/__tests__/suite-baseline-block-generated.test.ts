import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderBlock } from '../../scripts/update-suite-baseline.mjs'

// THE GENERATOR IS THE ORACLE (card c28d103d). Prose written INSIDE the
// SUITE-BASELINE block is deleted by the next `npm run test:baseline`, silently
// and completely -- the generator rewrites the whole span between the markers.
//
// This has already happened twice. The block carries a warning about a lesson lost
// that way, and the NEXT lesson went into the block anyway. Two warnings now stand
// there. computress closed the instance (47b5360, card de5e1709) and said plainly
// that the remedy is a CONVENTION, not a mechanism. This is the mechanism.
//
// WHY IT CANNOT FALSE-POSITIVE ON A NUMBER, which is the whole reason it is safe to
// wire in: the current counts, stamp and `how` are parsed OUT of the live block and
// fed BACK into the generator. A stale number therefore renders identically on both
// sides and this test stays silent -- staleness is a DIFFERENT question, already
// answered by the staleness guard. After that round-trip the only thing a difference
// can be is prose the generator does not produce.
//
// MEASURED BEFORE WIRING (the card's precondition, and it was a hypothesis until run):
//     the fixed state (47b5360) ........ SILENT
//     the state before it .............. FIRES, 5 extra lines -- the two-branch ratchet
//                                        lesson, which the next generator run deletes
// So the gate discriminates on the only two states that exist, rather than being
// argued to.

const BEGIN = '// === SUITE-BASELINE:BEGIN ==='
const END = '// === SUITE-BASELINE:END ==='
const TARGET = join(__dirname, 'setup', 'suite-size-guard.ts')

/** The live block, and the values to hand back to the oracle. */
function liveBlock(source: string) {
  const a = source.indexOf(BEGIN)
  const b = source.indexOf(END)
  expect(a, 'the SUITE-BASELINE:BEGIN marker is missing').toBeGreaterThan(-1)
  expect(b, 'the SUITE-BASELINE:END marker is missing').toBeGreaterThan(a)
  return source.slice(a, b + END.length)
}

function regenerate(block: string) {
  const m = block.match(/Merve (.+?) -- `(.+?)` -> (\d+) fajl \/ (\d+) teszt/)
  expect(m, 'the generated header is not parseable -- the generator contract moved').not.toBeNull()
  const [, stamp, how, files, tests] = m as RegExpMatchArray
  return renderBlock({ files: Number(files), tests: Number(tests) }, stamp, how) as string
}

describe('the SUITE-BASELINE block carries nothing the generator would delete', () => {
  it('round-trips through the generator byte for byte', () => {
    const block = liveBlock(readFileSync(TARGET, 'utf-8'))
    const regenerated = regenerate(block)
    const extra = block.split('\n').filter((l) => !regenerated.split('\n').includes(l))
    expect(
      extra,
      'These lines sit INSIDE the generated block and the next `npm run test:baseline` will\n' +
        'DELETE them. Move them ABOVE the BEGIN marker -- the block is for the number, the\n' +
        'lesson goes outside it:\n' +
        extra.map((l) => '    ' + l).join('\n'),
    ).toEqual([])
    expect(block).toBe(regenerated)
  })

  it('CONTROL: it fires when prose IS injected, and names the injected line', () => {
    // Without this the test above could be passing because the comparison is broken.
    const block = liveBlock(readFileSync(TARGET, 'utf-8'))
    const injected = block.replace(END, '// egy tanulsag, amit a generator torolne\n' + END)
    const regenerated = regenerate(injected)
    const extra = injected.split('\n').filter((l) => !regenerated.split('\n').includes(l))
    expect(extra).toContain('// egy tanulsag, amit a generator torolne')
    expect(injected).not.toBe(regenerated)
  })

  it('CONTROL: a STALE NUMBER alone does not fire it -- that is the other guard', () => {
    // The two gates must not be confused. Staleness is answered elsewhere; this one
    // only ever speaks about prose. Round-tripping the parsed values guarantees it.
    //
    // BUILT FROM A SYNTHETIC CLEAN BLOCK, NOT FROM THE LIVE FILE -- and that is a
    // measured correction, not caution. Deriving it from the live block made this
    // control fail on the pre-fix state for the OTHER test's reason (the extra prose
    // is still there after staling the number), so it isolated nothing. A control
    // that inherits the condition under test is not a control.
    const clean = renderBlock({ files: 428, tests: 5459 }, '2026. 01. 01. 00:00:00 CET',
                              'npx vitest run') as string
    const stale = clean.replace('428 fajl / 5459 teszt', '1 fajl / 1 teszt')
      .replace('SUITE_BASELINE_FILES = 428', 'SUITE_BASELINE_FILES = 1')
      .replace('SUITE_BASELINE_TESTS = 5459', 'SUITE_BASELINE_TESTS = 1')
    expect(stale, 'a stale number must round-trip identically').toBe(regenerate(stale))
  })
})
