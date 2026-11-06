// Card 74161546 (didi 55441 K4): the fleet restore keeps memory rows the
// injection filter would refuse and reports them (memoriesFlagged); the
// dashboard's apply result must show that report, or a restore of poisoned
// rows reads as the same green tick. String contract, the house idiom for
// web/app.js (federation-ui-contract.test.ts): the backend field, the
// rendering condition and both languages.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const read = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf-8')
const APP = read('web/app.js')
const BACKEND = read('src/web/fleet-transfer.ts')

describe('fleet import result shows the rows the filter would refuse', () => {
  it('the field the dashboard reads is the one the import returns', () => {
    expect(BACKEND).toMatch(/memoriesFlagged: \{ count: number; firstIds: number\[\] \}/)
    expect(APP).toContain('const flagged = data.memoriesFlagged || { count: 0, firstIds: [] }')
  })

  it('a line is rendered when the count is above zero, escaped, with the count and the ids', () => {
    expect(APP).toMatch(
      /\$\{flagged\.count > 0 \? `<div class="fleet-apply-flagged">[^`]*\$\{escapeHtml\(t\('fleet\.import\.memories_flagged', \{ n: flagged\.count, ids: flaggedIds \}\)\)\}<\/div>` : ''\}/,
    )
  })

  it('both languages carry the text with both placeholders', () => {
    for (const lang of ['hu', 'en']) {
      const line = read(`web/lang/${lang}.js`).split('\n').find(l => l.includes("'fleet.import.memories_flagged'"))
      expect(line, `${lang}: key missing`).toBeTruthy()
      expect(line).toContain('{n}')
      expect(line).toContain('{ids}')
    }
  })
})
