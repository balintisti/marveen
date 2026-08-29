import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A STRUCTURAL guard, and it says so: card f9aff0b5.
//
// The context guard used to ask the main agent a DIFFERENT presence question
// than every other agent -- `capturePane(session) !== null` instead of
// agentRunState -- because agentRunState looked for `agent-<name>` and the
// coordinator does not run under that name (card 228c9252). With the resolver
// fixed, the special branch became a second path to one question.
//
// WHY THIS IS NOT A BEHAVIOUR TEST, stated rather than hidden: after the change
// the decision is one line calling agentRunState, and what agentRunState answers
// for the main agent is already pinned behaviourally, in both directions, by
// main-agent-run-state.test.ts (fake tmux on PATH, real call). There is nothing
// left at this call site that a behaviour test could distinguish -- the runner's
// tick is not reachable from outside, and re-introducing the branch would leave
// every existing test green. That is measured, not assumed: on 2026-08-28 a
// deduplicated call site was reverted by hand and all 4637 tests passed.
//
// So this guard defends the one property tests cannot: that the question is
// asked ONCE. It is deliberately narrow -- it reads the presence decision only,
// not the file.
const SRC = join(import.meta.dirname, '..')
const FILE = join(SRC, 'web', 'context-guard-runner.ts')

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/\/\/.*$/gm, '')
}

/** The `const running = ...` statement, comments removed: from the assignment to
 *  the first blank line after it. */
function presenceDecision(code: string): string {
  const start = code.indexOf('const running =')
  expect(start, 'the presence decision was not found at all').toBeGreaterThan(-1)
  const end = code.indexOf('\n\n', start)
  return code.slice(start, end === -1 ? undefined : end)
}

describe('the context guard asks ONE presence question (card f9aff0b5)', () => {
  it('does not branch on the main agent when deciding whether an agent is running', () => {
    const decision = presenceDecision(stripComments(readFileSync(FILE, 'utf8')))
    expect(decision).toContain('agentRunState')
    // THE LOAD-BEARING LINE. On the pre-fix code this is red.
    expect(decision).not.toContain('MAIN_AGENT_ID')
  })

  // POSITIVE CONTROL for the extractor: without it, a decision that could not be
  // found -- a rename, a refactor, a wrong path -- would produce an empty string
  // that satisfies both assertions above. An empty result must not read as a pass.
  it('the extractor really reads a decision, and a reverted one would fail', () => {
    const code = stripComments(readFileSync(FILE, 'utf8'))
    expect(presenceDecision(code).length).toBeGreaterThan(20)
    const reverted = presenceDecision(
      "const running = name === MAIN_AGENT_ID\n    ? capturePane(session) !== null\n    : agentRunState(name) === 'running'\n\n",
    )
    expect(reverted).toContain('MAIN_AGENT_ID')
  })
})
