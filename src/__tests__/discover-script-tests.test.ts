/**
 * Recursive discovery for scripts/__tests__ (card 20258ef3). The flat readdirSync dropped a test placed
 * in a subdirectory silently; the python sibling already globbed recursively.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverScriptTests } from './helpers/discover-script-tests.js'

const root = mkdtempSync(join(tmpdir(), 'discover-tests-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const touch = (rel: string) => {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, '')
}
touch('top.test.sh')
touch('sub/nested.test.py')
touch('sub/deeper/deepest.test.sh')
touch('__pycache__/imported.test.cpython-311.pyc')   // generated when one test imports another
touch('sub/__pycache__/x.test.cpython-311.pyc')
touch('helper.py')                                    // not a test
mkdirSync(join(root, 'dir.test.d'))                   // a DIRECTORY named like a test is not a file

describe('discoverScriptTests', () => {
  it('finds tests at every depth, relative to the root, sorted', () => {
    expect(discoverScriptTests(root)).toEqual(['sub/deeper/deepest.test.sh', 'sub/nested.test.py', 'top.test.sh'])
  })

  it('CONTROL: the old flat listing would have seen only the top-level one', () => {
    expect(readdirSync(root).filter((f) => f.includes('.test.') && !f.endsWith('.d'))).toEqual(['top.test.sh'])
  })

  it('on the real directory it finds exactly what the flat listing found today (no subdirectories yet)', () => {
    const real = join(__dirname, '..', '..', 'scripts', '__tests__')
    const flat = readdirSync(real).filter((f) => f.includes('.test.')).sort()
    expect(discoverScriptTests(real)).toEqual(flat)
    expect(flat.length).toBeGreaterThan(0)
  })
})
