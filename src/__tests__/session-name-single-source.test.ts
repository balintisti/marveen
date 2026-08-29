import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// A DRIFT GUARD, and it exists because a mutation survived (card 228c9252).
//
// Breaking one of the six call sites back to a hand-built `agent-${name}` was
// caught by NOTHING in the 4637-test suite -- measured, not assumed. So the
// consolidation cannot be defended by the tests that cover behaviour: a seventh
// copy would compile, pass, and drift exactly the way the first six did.
//
// This guard asks the one question those tests cannot: does the `<id>-channels`
// derivation exist anywhere but its definition? That template is unambiguous --
// it is a tmux session name and nothing else -- which is why it is checked and
// the `agent-${...}` shape is not: the latter also spells secret names
// (`agent-${name}-api-key`) and bundle filenames, so a guard on it would flag
// correct code, and a guard that flags correct code gets deleted.
//
// Comments are stripped FIRST. Half the matches in this repo are prose about the
// rule -- including the paragraph you are reading -- and a guard that fires on
// its own documentation teaches people the guard is noise.

const SRC = join(import.meta.dirname, '..')
const OWNER = join('web', 'session-names.ts')

function tsFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) {
      if (e === '__tests__' || e === 'node_modules') continue
      tsFiles(p, acc)
    } else if (e.endsWith('.ts')) acc.push(p)
  }
  return acc
}

function stripComments(src: string): string {
  // Line-preserving: the report names a line number, and a block comment that
  // collapses to nothing shifts every line after it.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/\/\/.*$/gm, '')
}

describe('the channels session name is derived in exactly one place', () => {
  it('no file outside session-names.ts builds `<id>-channels` by hand', () => {
    const offenders: string[] = []
    for (const file of tsFiles(SRC)) {
      const rel = file.slice(SRC.length + 1)
      if (rel === OWNER) continue
      const code = stripComments(readFileSync(file, 'utf8'))
      code.split('\n').forEach((line, i) => {
        if (/`\$\{[^}]+\}-channels`/.test(line)) offenders.push(`${rel}:${i + 1}`)
      })
    }
    expect(offenders, 'use channelsSessionName() instead of rebuilding the name').toEqual([])
  })

  // POSITIVE CONTROL. Without it an empty result proves nothing: a broken regex,
  // a wrong root, or a directory walk that silently returns nothing all produce
  // the same green. This asserts the matcher does fire on the shape it hunts.
  it('the matcher fires on the shape it is hunting', () => {
    const sample = 'const SESSION = `${MAIN_AGENT_ID}-channels`'
    expect(/`\$\{[^}]+\}-channels`/.test(sample)).toBe(true)
    expect(/`\$\{[^}]+\}-channels`/.test('const s = channelsSessionName(MAIN_AGENT_ID)')).toBe(false)
  })

  // And the walk really visited the tree -- an empty file list would also pass
  // the first test.
  it('the scan covers the source tree', () => {
    expect(tsFiles(SRC).length).toBeGreaterThan(100)
  })
})
