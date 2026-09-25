// The temp-dir helper really removes what it made (card b610c593 (c)), and the seven files that
// leaked keep using it. The first half is the leak coming back as a RED test instead of as a disk
// at 90%: empty the helper's afterAll, or stop recording the directories, and it fails.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { stripComments } from './helpers/strip-comments.js'

let made: string[] = []

// Vitest runs a file's describes in order, so the second one observes the first one's afterAll.
describe('a scope that makes temporary directories', () => {
  const mkTmp = tmpDirs()
  it('gets real, distinct directories under the prefix', () => {
    const a = mkTmp('tmpdirs-probe-')
    const b = mkTmp('tmpdirs-probe-')
    writeFileSync(join(a, 'f'), 'x')           // a non-empty directory must go too
    made = [a, b]
    expect(a).not.toBe(b)
    expect(a).toContain('tmpdirs-probe-')
    expect(existsSync(a) && existsSync(b)).toBe(true)
  })
})

describe('after that scope finishes', () => {
  it('both directories are gone, contents included', () => {
    expect(made).toHaveLength(2)
    for (const d of made) expect(existsSync(d)).toBe(false)
  })
})

const LEAKED = [
  'rulebook-snapshot-audit', 'rulebook-snapshot', 'documented-commands-exist', 'merge-overlap-probe',
  'update-readiness', 'data-source-alarm', 'voice-dest-resolution',
]
describe('the files that leaked make no bare mkdtemp any more', () => {
  for (const f of LEAKED) {
    it(f, () => {
      const src = stripComments(readFileSync(join(__dirname, `${f}.test.ts`), 'utf8'))
      expect(src).not.toMatch(/\bmkdtempSync\s*\(/)
      expect(src).toMatch(/const mkTmp = tmpDirs\(\)/)
    })
  }
})
