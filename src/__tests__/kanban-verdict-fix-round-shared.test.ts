// THE SAME FIX-ROUND CASES FOR BOTH VERDICT READERS -- card e9d95660 (marveen decision B, 10022702).
//
// The done move reads verdicts here (openVerdicts); the close gate reads them in
// scripts/verdict-parse.py. Two readers of one rule drift unless they are held to the same
// cases, so the cases live in ONE file that both test suites load:
// scripts/__tests__/fixtures/fix-round-cases.json. Changing the rule in one reader fails the
// other reader's test on the same case.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { openVerdicts, type VerdictComment } from '../kanban-verdict.js'

type FixtureCase = { name: string; comments: { author: string; content: string }[]; open: string[] }

// src/__tests__ and dist/__tests__ are both two levels under the repo root.
const fixture = JSON.parse(
  readFileSync(new URL('../../scripts/__tests__/fixtures/fix-round-cases.json', import.meta.url), 'utf8'),
) as { cases: FixtureCase[] }

const open = (c: FixtureCase) =>
  openVerdicts(
    c.comments.map((x, i): VerdictComment => ({ id: i + 1, author: x.author, content: x.content, created_at: i + 1 })),
  ).map((v) => v.author).sort()

describe('the shared fix-round cases (card e9d95660)', () => {
  it('CONTROL: the fixture loads its cases, with both outcomes', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(30)
    expect(fixture.cases.some((c) => c.open.length === 0)).toBe(true)
    expect(fixture.cases.some((c) => c.open.length > 0)).toBe(true)
  })

  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(open(c)).toEqual(c.open)
    })
  }
})
