// THE SIX AUTO-WRITTEN CLAUDE.md SECTIONS HAVE A BUDGET (88c366f2 merge, P13; marveen 2026-09-28).
//
// Every agent re-reads its sheet on every turn, so a section written into all of them is paid for
// on every turn of every agent. Measured before shortening, on copies of the 8 live sheets: the six
// sections added 9691 (main) to 9850 characters each. marveen's condition: at most 6000 per sheet.
// This runs the REAL ensure* writers on an empty sheet -- markers and separators included, exactly
// what lands in a file -- for the main agent and for a sub-agent with a long name.
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const base = vi.hoisted(() => ({ dir: '' }))
vi.mock('../config.js', async (orig) => ({ ...(await orig<typeof import('../config.js')>()), get PROJECT_ROOT() { return join(base.dir, 'root') } }))
vi.mock('../web/agent-config.js', async (orig) => ({ ...(await orig<typeof import('../web/agent-config.js')>()), agentDir: (n: string) => join(base.dir, n) }))

const BUDGET = 6000

describe('the six auto-written sections fit the per-sheet budget (P13)', () => {
  it(`main and a long-named sub-agent each grow by at most ${BUDGET} characters`, async () => {
    base.dir = mkTmp('section-budget-')
    const sc = await import('../web/agent-scaffold.js')
    const { MAIN_AGENT_ID } = await import('../config.js')
    const writers = [sc.ensureSystemDirectiveAuthSection, sc.ensureMemorySearchLabelSection, sc.ensureFleetAuthSection,
      sc.ensureEvidenceSection, sc.ensureMcpListChannelSection, sc.ensureMessageCloseSection]
    const sheets: Array<[string, string]> = [[MAIN_AGENT_ID, join(base.dir, 'root', 'CLAUDE.md')],
      ['a-long-agent-name-x', join(base.dir, 'a-long-agent-name-x', 'CLAUDE.md')]]
    for (const [name, file] of sheets) {
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, '# persona\n')
      const before = readFileSync(file, 'utf-8').length
      for (const w of writers) w(name)
      const growth = readFileSync(file, 'utf-8').length - before
      // CONTROL: every writer really wrote -- a writer that silently skips would make the budget trivial
      expect(growth).toBeGreaterThan(3000)
      expect(growth).toBeLessThanOrEqual(BUDGET)
    }
  })
})
