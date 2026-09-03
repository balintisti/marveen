import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const src = readFileSync(join(REPO, 'src', 'web', 'context-guard-runner.ts'), 'utf8')

// Card c32ebf32, found while doing 6c1439ac. Latent, not broken: the coordinator
// has no agents/ directory today, so listAgentNames() cannot return him and the
// prepend cannot duplicate. It turns real the moment someone creates
// agents/<MAIN_AGENT_ID>/ -- which is exactly what 6c1439ac first proposed doing.
describe('context-guard population is deduped', () => {
  it('EVERY MAIN_AGENT_ID prepend goes through a Set', () => {
    // Asserted over ALL occurrences rather than the one line I happened to fix:
    // the file had two prepends and only one carried a Set, which is how the odd
    // one out survived. A test pinned to a single site would allow the next one.
    const prepends = [...src.matchAll(/\[\s*(?:\.\.\.new Set\(\[\s*)?MAIN_AGENT_ID,\s*\.\.\.listAll?AgentNames\(\)/g)]
    expect(prepends.length).toBeGreaterThan(0)
    for (const m of prepends) {
      const window = src.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + 80)
      expect(window, `undeduped prepend at ${m.index}`).toContain('new Set')
    }
  })

  it('does not contain a bare, undeduped prepend', () => {
    // The exact shape that was there. Spelled out so a reviewer can see what
    // regressing looks like, rather than only what passing looks like.
    expect(src).not.toMatch(/const names = \[MAIN_AGENT_ID, \.\.\.listAgentNames\(\)\]/)
  })
})
