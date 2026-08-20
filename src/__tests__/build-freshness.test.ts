/**
 * THE SOURCE IS NOT EVIDENCE -- card b807c756.
 *
 * On 2026-08-20 three people read the same source file and all three believed
 * it was running. The dashboard runs from `dist/`, that build was four days
 * old, and a fix written that morning had never executed. Nothing anywhere
 * compared the two.
 *
 * The tests below hold the three things the card asked for: ONE verdict rather
 * than one per file, BOTH ways of being stale, and -- the one that came out of
 * the evening itself -- that an unanswerable question is answered with "I do
 * not know" instead of with silence, because a missing value that looks like a
 * healthy one does not just fail to warn, it CLOSES the question.
 */
import { describe, it, expect } from 'vitest'
import { judgeBuildFreshness } from '../web/build-freshness.js'

const T = (h: number) => new Date(`2026-08-20T${String(h).padStart(2, '0')}:00:00Z`).getTime()

const input = (over: Partial<Parameters<typeof judgeBuildFreshness>[0]> = {}) => ({
  builtAt: T(10),
  sourceAt: T(9),
  newestSourceFile: 'src/db.ts',
  startedAt: T(11),
  ...over,
})

describe('judgeBuildFreshness', () => {
  it('is current when the build is newer than the source and older than the process', () => {
    expect(judgeBuildFreshness(input()).status).toBe('current')
  })

  describe('the source is newer than the build', () => {
    it('is stale-source: what you are reading is not what runs', () => {
      const v = judgeBuildFreshness(input({ builtAt: T(9), sourceAt: T(10) }))
      expect(v.status).toBe('stale-source')
    })

    it('says HOW MANY files are newer, not just which one is newest', () => {
      // The example alone was not enough, and the live case proved it: the
      // newest file there is a TEST, and a reader seeing only that concludes
      // "just a test changed". The count is what separates a stray touch from
      // four days of drift -- and it is still one line.
      const v = judgeBuildFreshness(
        input({ builtAt: T(9), sourceAt: T(10), newerSourceCount: 43 }))
      expect(v.detail).toContain('43 fajl ujabb')
      expect(v.detail.split('\n')).toHaveLength(1)
    })

    it('leaves the count out rather than printing a made-up zero', () => {
      const v = judgeBuildFreshness(input({ builtAt: T(9), sourceAt: T(10) }))
      expect(v.detail).not.toContain('fajl ujabb')
      expect(v.newerSourceCount).toBeNull()
    })

    it('still reads as a sentence when there is no count to give', () => {
      // The first version glued the example on with a lowercase clause after a
      // full stop. A warning that reads as broken gets treated as broken.
      const v = judgeBuildFreshness(input({ builtAt: T(9), sourceAt: T(10) }))
      expect(v.detail).toContain('A legfrissebb valtozas: src/db.ts.')
      expect(v.detail).not.toContain('. a legfrissebb')
    })

    it('names ONE example file, not every file that is newer', () => {
      // A stale build means hundreds of newer files. A hundred warnings is a
      // wall people learn to scroll past, so the verdict is one line and the
      // newest file is an example that tells the reader whether the difference
      // is a real change or a stray touch.
      const v = judgeBuildFreshness(
        input({ builtAt: T(9), sourceAt: T(10), newestSourceFile: 'src/web/routes/messages.ts' }))
      expect(v.detail).toContain('src/web/routes/messages.ts')
      expect(v.detail.split('\n')).toHaveLength(1)
    })

    it('says what to do, and that a build alone is not enough', () => {
      const v = judgeBuildFreshness(input({ builtAt: T(9), sourceAt: T(10) }))
      expect(v.detail).toContain('npm run build')
      expect(v.detail).toContain('ujrainditas')
    })

    it('survives having no example file to name', () => {
      const v = judgeBuildFreshness(
        input({ builtAt: T(9), sourceAt: T(10), newestSourceFile: null }))
      expect(v.status).toBe('stale-source')
      expect(v.detail).not.toContain('null')
    })
  })

  describe('the build is newer than the running process', () => {
    it('is stale-process: compiled, and still not running', () => {
      // The half that springs on the person who DID remember to build. The
      // process read dist/ once, at start, and holds the old code in memory.
      const v = judgeBuildFreshness(input({ sourceAt: T(9), builtAt: T(11), startedAt: T(10) }))
      expect(v.status).toBe('stale-process')
      expect(v.detail).toContain('ujrainditas')
    })

    it('does NOT ask for another build, which is not what is missing', () => {
      const v = judgeBuildFreshness(input({ sourceAt: T(9), builtAt: T(11), startedAt: T(10) }))
      expect(v.detail).not.toContain('npm run build')
    })

    it('reports the source problem first when both are true', () => {
      // Uncompiled AND unrestarted: the build has to happen before the restart
      // can carry anything, so that is the instruction to give.
      const v = judgeBuildFreshness(input({ sourceAt: T(12), builtAt: T(11), startedAt: T(10) }))
      expect(v.status).toBe('stale-source')
    })
  })

  describe('when it cannot tell', () => {
    it('says unknown -- never current -- with no build timestamp', () => {
      // THE LESSON OF THE EVENING, as a branch. A missing value that renders
      // identically to a healthy one is worse than no check: it also ends the
      // question, and nobody comes back to it.
      const v = judgeBuildFreshness(input({ builtAt: null }))
      expect(v.status).toBe('unknown')
      expect(v.status).not.toBe('current')
    })

    it('says unknown with no source timestamp either', () => {
      expect(judgeBuildFreshness(input({ sourceAt: null })).status).toBe('unknown')
    })

    it('spells out that unknown is NOT the same as up to date', () => {
      // Without this sentence a reader fills the gap with the comfortable
      // reading, which is exactly how four days went by.
      const v = judgeBuildFreshness(input({ builtAt: null }))
      expect(v.detail).toContain('NEM azt jelenti')
    })

    it('does not invent a verdict from the one timestamp it does have', () => {
      // A source newer than nothing is not "stale"; it is unmeasured.
      const v = judgeBuildFreshness(input({ builtAt: null, sourceAt: T(23) }))
      expect(v.status).toBe('unknown')
    })
  })

  it('always carries the raw numbers, so a reader can check the verdict', () => {
    // A verdict nobody can audit is a verdict people either trust blindly or
    // ignore. Both are worse than one they can subtract for themselves.
    const v = judgeBuildFreshness(input({ builtAt: T(9), sourceAt: T(10) }))
    expect(v.builtAt).toBe(T(9))
    expect(v.sourceAt).toBe(T(10))
    expect(v.startedAt).toBe(T(11))
  })
})
