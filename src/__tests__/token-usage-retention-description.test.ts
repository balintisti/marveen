import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SETTINGS_REGISTRY } from '../config-registry.js'

// Card 6d19bf25: the TOKEN_USAGE_RETENTION_DAYS description claimed 90 days was enough for "every
// consumer" while naming only the 30-day model suggestion. The token-usage report routes take an
// OPTIONAL `from` (no lower bound when it is missing) and the cost ledger takes any month, so the
// retention value also bounds THEIR history. The description must say so, as long as the code does.
const desc = (): string => {
  const entry = SETTINGS_REGISTRY.find((e) => e.key === 'TOKEN_USAGE_RETENTION_DAYS')
  if (!entry) throw new Error('TOKEN_USAGE_RETENTION_DAYS is missing from the registry')
  return entry.description
}

describe('TOKEN_USAGE_RETENTION_DAYS description names its unbounded readers (6d19bf25)', () => {
  it('the premise still holds: a report route reads token_usage with an optional lower bound', () => {
    const src = readFileSync(join(__dirname, '..', 'web', 'token-usage.ts'), 'utf-8')
    expect(src).toMatch(/if \(from\) \{ conditions\.push\('timestamp >= \?'\)/)
  })

  it('does not claim the retention is enough for every consumer', () => {
    expect(desc()).not.toMatch(/minden fogyasztónak/)
  })

  it('names the reports and the monthly cost ledger as readers bounded by it', () => {
    expect(desc()).toMatch(/token-használati riportok/)
    expect(desc()).toMatch(/havi költség-főkönyv/)
  })
})
