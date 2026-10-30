import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Card 3696b63b. The skill-path rule (agent-scaffold.ts, "Skill-útvonal csapda")
// says the global ~/.claude/skills tree is seen by the WHOLE fleet, so writing
// there is a deliberate fleet-level decision and an agent's own skill goes to
// its working directory's .claude/skills. Both shipped templates demonstrated
// the opposite: the auto-skill example and the PreCompact skill-reflection
// prompt wrote straight into the global tree.
//
// MEASURED 2026-10-14: 0 of the live CLAUDE.md pages still carried the example,
// but the PreCompact prompt sat in 12 live settings.json files -- the template
// is what every new agent is seeded from, so it is the source to pin.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, 'templates', rel), 'utf-8')

const GLOBAL_WRITE = /mkdir -p ~\/\.claude\/skills\/SKILL-NEV/
const OWN_WRITE = /mkdir -p \.claude\/skills\/SKILL-NEV/

describe('skill-generation examples write into the agent\'s own skills dir', () => {
  for (const tpl of ['CLAUDE.md.template', 'settings.json.template']) {
    it(`${tpl}: the example creates the skill under ./.claude/skills, not the global tree`, () => {
      const text = read(tpl)
      expect(text).toMatch(OWN_WRITE)
      expect(text).not.toMatch(GLOBAL_WRITE)
    })
  }

  // generateClaudeMd (agent-scaffold.ts) is the OTHER seeding surface: POST /api/agents
  // (routes/agents.ts) has the model write a new agent's CLAUDE.md from this prompt, and the
  // prompt carried the global example after the templates were fixed (measured 2026-10-29).
  it('generateClaudeMd prompt: the example creates the skill under ./.claude/skills, not the global tree', () => {
    const src = readFileSync(join(ROOT, 'src', 'web', 'agent-scaffold.ts'), 'utf-8')
    const start = src.indexOf('export async function generateClaudeMd')
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('\nexport ', start + 1)
    const body = src.slice(start, end === -1 ? undefined : end)
    expect(body).toMatch(OWN_WRITE)
    expect(body).not.toMatch(GLOBAL_WRITE)
  })
})
