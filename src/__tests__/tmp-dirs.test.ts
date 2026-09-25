// The temp-dir helper really removes what it made (card b610c593 (c)), and the seven files that
// leaked keep using it. The first half is the leak coming back as a RED test instead of as a disk
// at 90%: empty the helper's afterAll, or stop recording the directories, and it fails.
import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { stripComments } from './helpers/strip-comments.js'

const mkTmp = tmpDirs()
let made: string[] = []

// Vitest runs a file's describes in order, so the second one observes the first one's afterAll.
describe('a scope that makes temporary directories', () => {
  const mkTmp = tmpDirs()
  it('gets real, distinct directories under the prefix', () => {
    const a = mkTmp('tmpdirs-probe-')
    const b = mkTmp('tmpdirs-probe-')
    writeFileSync(join(a, 'f'), 'x')           // a non-empty directory must go too
    const c = mkTmp.adopt(join(a, '..', `${a.split(sep).pop()}-adopted`))   // made elsewhere, handed over
    mkdirSync(c)
    made = [a, b, c]
    expect(a).not.toBe(b)
    expect(a).toContain('tmpdirs-probe-')
    expect(existsSync(a) && existsSync(b)).toBe(true)
  })
})

describe('after that scope finishes', () => {
  it('all three directories are gone, contents and the adopted one included', () => {
    expect(made).toHaveLength(3)
    for (const d of made) expect(existsSync(d)).toBe(false)
  })
})

// THE GUARD IS OVER EVERY TEST FILE, NOT A NAME LIST (card 66756e73, marveen; didi 07:38 measured
// 4 of 4 sampled files outside the first list leaking). A new file is not exempt by default.
// The one allowed bare mkdtemp is inside vi.hoisted(), where mkTmp does not exist yet -- and only
// in a file that hands it over with mkTmp.adopt().
const SRC = join(__dirname, '..')
function testFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') testFiles(p, out) }
    else if (e.name.endsWith('.ts') && (p.includes(`${sep}__tests__${sep}`) || e.name.endsWith('.test.ts'))) out.push(p)
  }
  return out
}
function hoistedSpans(src: string): [number, number][] {
  const spans: [number, number][] = []
  for (const m of src.matchAll(/vi\.hoisted\(/g)) {
    let i = (m.index ?? 0) + m[0].length
    let depth = 1
    while (depth > 0 && i < src.length) { depth += src[i] === '(' ? 1 : src[i] === ')' ? -1 : 0; i++ }
    spans.push([m.index ?? 0, i])
  }
  return spans
}
/** Comments AND string literals out: a test name or a fixture text is not a call. */
function codeOnly(src: string): string {
  return stripComments(src).replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''")
}
/**
 * Every mkdtemp TOKEN outside the helper, as "file:offset" -- the token, not the call shape: an
 * aliased import (`mkdtempSync as mkdt`) or a destructured `await import('node:fs')` leaked just
 * the same, and the first version of this scan, which looked for `mkdtempSync(`, missed one.
 */
function bareMkdtemps(files: string[]): string[] {
  const bad: string[] = []
  for (const f of files) {
    if (f.endsWith(`helpers${sep}tmp-dirs.ts`)) continue
    const src = codeOnly(readFileSync(f, 'utf8'))
    const spans = hoistedSpans(src)
    for (const m of src.matchAll(/\bmkdtemp(?:Sync)?\b/g)) {
      const at = m.index ?? 0
      const inHoisted = spans.some(([a, b]) => at >= a && at < b)
      if (inHoisted && /\.adopt\(/.test(src)) continue
      bad.push(`${f.slice(SRC.length + 1)}:${at}`)
    }
  }
  return bad
}

describe('every test file makes its temp dirs through tmpDirs()', () => {
  const files = testFiles(SRC)
  it('CONTROL: the scan sees the whole test tree, and the helper in use', () => {
    // measured 2026-09-25: 100+ files use the helper; a scan that sees a handful is not a guard
    expect(files.length).toBeGreaterThan(300)
    const users = files.filter((f) => /const mkTmp = tmpDirs\(\)/.test(readFileSync(f, 'utf8')))
    expect(users.length).toBeGreaterThanOrEqual(100)
  })
  it('no bare mkdtemp / mkdtempSync anywhere', () => {
    expect(bareMkdtemps(files)).toEqual([])
  })
  it('CONTROL: the scanner does flag a bare call, and lets an adopted hoisted one through', () => {
    const dir = mkTmp('tmpdirs-guard-')
    // assembled at run time, so this file does not contain the very call it scans for
    const MK = ['mkdtemp', 'Sync('].join('')
    const bare = join(dir, 'bare.test.ts')
    writeFileSync(bare, `const d = ${MK}'/x')\n`)
    const hoisted = join(dir, 'hoisted.test.ts')
    writeFileSync(hoisted, `const r = vi.hoisted(() => require('node:fs').${MK}'/x'))\nmkTmp.adopt(r)\n`)
    const unadopted = join(dir, 'unadopted.test.ts')
    writeFileSync(unadopted, `const r = vi.hoisted(() => require('node:fs').${MK}'/x'))\n`)
    const aliased = join(dir, 'aliased.test.ts')
    writeFileSync(aliased, `import { ${MK.slice(0, -1)} as mk } from 'node:fs'\nconst d = mk('/x')\n`)
    const dynamic = join(dir, 'dynamic.test.ts')
    writeFileSync(dynamic, `const { ${MK.slice(0, -1)} } = await import('node:fs')\n`)
    const named = join(dir, 'named.test.ts')
    writeFileSync(named, `it('no ${MK} here', () => {})\n`)   // only in a string: not a call
    expect(bareMkdtemps([bare, hoisted, unadopted, aliased, dynamic, named]).map((x) => x.split(':')[0].split(sep).pop()))
      .toEqual(['bare.test.ts', 'unadopted.test.ts', 'aliased.test.ts', 'dynamic.test.ts'])
  })
})
