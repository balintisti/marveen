import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { judgeBuiltCommit, MARKER_LAG_TOLERANCE_MS } from '../web/build-freshness.js'

// Card 20498b42. `dist/.built-commit` is written by hand, and on 2026-08-28 the
// hand skipped it: the build ran at 23:18 and the marker went on saying a commit
// from two days earlier. Two agents read it, both concluded the work was not
// deployed, and confirmed each other -- the artefact they trusted was the one
// lying, and nothing else in the system reads that file (measured: zero hits for
// `built-commit` across src/, scripts/, web/ and package.json before this change).
//
// The shape, not the slip: a MISSING marker is conspicuous; a STALE one is
// indistinguishable from a true "you are two days behind". So the judge returns
// NO COMMIT rather than a warning next to one.

const HASH = '0a09c732be2280c954072f15ae1c7da1cbb0f561'
const BUILT = 1_800_000_000_000

describe('judgeBuiltCommit -- a marker that cannot be believed answers nothing', () => {
  it('reports the commit when the marker was written with the build', () => {
    const r = judgeBuiltCommit({ markerCommit: HASH, markerAt: BUILT + 1_000, builtAt: BUILT })
    expect(r.status).toBe('known')
    expect(r.commit).toBe(HASH)
  })

  // THE CASE THIS EXISTS FOR. 34 hours out on the night it was written.
  it('REFUSES the commit when the marker is older than the build it claims to describe', () => {
    const r = judgeBuiltCommit({
      markerCommit: '31f06313f9f01f96b14a91f628bd8d591d6c9f1c',
      markerAt: BUILT - 34 * 3600_000,
      builtAt: BUILT,
    })
    expect(r.status).toBe('contradicted')
    // The load-bearing assertion: not "warned about", ABSENT. A hash next to a
    // caveat is read as a hash.
    expect(r.commit).toBeNull()
    expect(r.detail).not.toContain('31f06313')
  })

  // NEGATIVE CONTROL for the tolerance: the healthy order (marker last) and a
  // small skew must NOT be called a contradiction, or the guard fires on every
  // correct build and gets removed.
  it('does not cry contradiction over write skew inside the tolerance', () => {
    // A LITERAL four minutes, deliberately NOT derived from the constant.
    // The first version of this test used `MARKER_LAG_TOLERANCE_MS - 1000`, and
    // a mutation proved it worthless: setting the tolerance to 0 moved the test
    // input along with it and all six stayed green. A test that computes its
    // input from the number it exists to pin cannot see that number change.
    const r = judgeBuiltCommit({ markerCommit: HASH, markerAt: BUILT - 4 * 60_000, builtAt: BUILT })
    expect(r.status).toBe('known')
    expect(r.commit).toBe(HASH)
    // And the constant itself, so a silent tightening is visible in the diff.
    expect(MARKER_LAG_TOLERANCE_MS).toBe(5 * 60 * 1000)
  })

  it('says unknown -- and says unknown is not "up to date" -- when there is no marker', () => {
    const r = judgeBuiltCommit({ markerCommit: null, markerAt: null, builtAt: BUILT })
    expect(r.status).toBe('unknown')
    expect(r.commit).toBeNull()
    expect(r.detail).toMatch(/NEM azt jelenti/)
  })

  it('says unknown when the two cannot be compared at all', () => {
    const r = judgeBuiltCommit({ markerCommit: HASH, markerAt: null, builtAt: BUILT })
    expect(r.status).toBe('unknown')
    expect(r.commit).toBeNull()
  })
})

describe('the build writes the marker, so it cannot be forgotten', () => {
  // The other half of the card: the failure was a MANUAL step, and a rule that
  // holds only when someone remembers a runbook line is not a rule. Asserted on
  // package.json because that is where the deploy path actually reads from --
  // and the fallback matters as much as the write: if the hash cannot be
  // produced, the marker is REMOVED, never left stale. No marker reads as
  // unknown; a stale one reads as a date.
  it('npm run build writes the marker, and deletes it when it cannot', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8'))
    const build: string = pkg.scripts.build
    expect(build).toContain('tsc')
    expect(build).toContain('git rev-parse HEAD > dist/.built-commit')
    expect(build).toContain('rm -f dist/.built-commit')
  })
})
