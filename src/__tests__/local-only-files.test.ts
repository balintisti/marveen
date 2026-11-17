import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { missingLocalFiles } from './helpers/local-only-files.js'

const mkTmp = tmpDirs()

describe('missingLocalFiles', () => {
  it('names exactly the paths that are absent, in the given order', () => {
    const root = mkTmp('local-only-')
    writeFileSync(join(root, 'present.sh'), '')
    expect(missingLocalFiles(root, ['present.sh', 'lib/gone.py', 'also-gone.sh'])).toEqual(['lib/gone.py', 'also-gone.sh'])
  })

  it('is empty when every file is there, so the suite runs', () => {
    const root = mkTmp('local-only-')
    writeFileSync(join(root, 'a.sh'), '')
    expect(missingLocalFiles(root, ['a.sh'])).toEqual([])
  })
})
