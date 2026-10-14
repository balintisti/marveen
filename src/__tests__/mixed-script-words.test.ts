// MIXED-SCRIPT WORDS (card 0d5217f4): no word may mix Latin with Cyrillic or Greek letters.
//
// didi measured 2026-09-19: Cyrillic letters inside Hungarian words in 7 files ("ki\u0432\u0430\u043d" in a
// test AND in a shell script, byte-identical: one input habit, not independent typos, so it
// comes back). A word like that cannot be found by grep: whoever searches the source for a
// message they just read gets ZERO hits and reads it as "the code does not produce this".
// 2026-10-14 the same scan found 15 such words in 12 files; this test keeps it at zero.
//
// Deliberate specimens (homoglyph fixtures, a page quoting the defect) are listed below,
// keyed by file AND word, and written with \u escapes so this file does not trip itself.
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const SPECIMENS = new Set([
  'rulebook/glifa-kollacio.md ker\u0435\u0442té',
  'src/__tests__/federation-address.test.ts te\u043edor',
  'src/__tests__/federation-classify.test.ts te\u043edor',
  'scripts/__tests__/kartya-leiras-mozgatas.test.py h\u0430tarido',
  'scripts/__tests__/outgoing-copy-gate.test.py k\u043eszonom',
])

export function mixedScriptWords(text: string): string[] {
  return (text.match(/\p{L}+/gu) ?? []).filter(
    (w) => /\p{Script=Latin}/u.test(w) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(w),
  )
}

describe('mixed-script words (card 0d5217f4)', () => {
  it('finds a Cyrillic letter inside a Latin word, and leaves pure words alone', () => {
    expect(mixedScriptWords('hiheto hihet\u043e \u03bb tau \u043a\u0438\u0440\u0438\u043b\u043b')).toEqual(['hihet\u043e'])
  })

  it('no tracked source, script or rulebook file carries one outside the specimen list', () => {
    const files = execFileSync('git', ['ls-files', '-z', '--', 'src', 'scripts', 'web', 'rulebook', 'update.sh'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).split('\0').filter(Boolean)
    expect(files.length).toBeGreaterThan(100) // positive control: the scan saw the tree
    const found: string[] = []
    const seenSpecimens = new Set<string>()
    for (const f of files) {
      let text: string
      try {
        text = readFileSync(join(repoRoot, f), 'utf8')
      } catch {
        continue // listed but absent in this checkout (e.g. a sparse worktree)
      }
      if (text.includes('\0')) continue // binary
      text.split('\n').forEach((line, i) => {
        for (const w of mixedScriptWords(line)) {
          const key = `${f} ${w}`
          if (SPECIMENS.has(key)) seenSpecimens.add(key)
          else found.push(`${f}:${i + 1}: ${w}`)
        }
      })
    }
    expect(found, 'Latin word with a Cyrillic/Greek letter: retype it, or list it in SPECIMENS if deliberate').toEqual([])
    // A specimen that disappeared is a stale entry: drop it, so the list cannot hide a new one.
    expect([...SPECIMENS].filter((s) => !seenSpecimens.has(s))).toEqual([])
  })
})
