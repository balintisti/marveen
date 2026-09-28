/**
 * EVERY HOOK INSTALLER IS CLASSIFIED FOR THE DRIFT CHECK (card db782525).
 *
 * installed-drift-check.ts refuses to measure anything while one `scripts/install-*hook*.sh` is on
 * neither SAFE_INSTALLERS nor KNOWN_UNSAFE_INSTALLERS -- by design, so a new installer forces a
 * decision. But the refusal only shows when someone runs the tool, and nobody did: the upstream
 * merge (88c366f2) brought install-slack-progress-hook.sh, and from then on the full check printed
 * a single "NEM MERHETO" line. Measured 2026-09-28: with it classified, 23 comparisons and 4
 * findings instead of 10 and 1 (the plist lane alone). The suite runs on every change; the tool
 * does not. So the class condition lives here too, read from the tool's own source.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SRC = readFileSync(join(ROOT, 'scripts', 'installed-drift-check.ts'), 'utf-8')

function listOf(name: string): string[] {
  const m = SRC.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const`))
  if (!m) throw new Error(`${name} not found in installed-drift-check.ts`)
  return [...m[1].matchAll(/'([^']+\.sh)'/g)].map((x) => x[1])
}

const SAFE = listOf('SAFE_INSTALLERS')
const UNSAFE = listOf('KNOWN_UNSAFE_INSTALLERS')
// The same selection laneD() makes.
const PRESENT = readdirSync(join(ROOT, 'scripts')).filter((f) => /^install-.*hook.*\.sh$/.test(f)).sort()

describe('installed-drift installer classification', () => {
  it('CONTROL: both lists and the directory were read (else "all classified" proves nothing)', () => {
    expect(SAFE.length).toBeGreaterThan(0)
    expect(UNSAFE.length).toBeGreaterThan(0)
    expect(PRESENT.length).toBeGreaterThan(SAFE.length)
  })

  it('every hook installer in scripts/ is on exactly one list', () => {
    const unclassified = PRESENT.filter((f) => !SAFE.includes(f) && !UNSAFE.includes(f))
    const both = PRESENT.filter((f) => SAFE.includes(f) && UNSAFE.includes(f))
    expect(unclassified).toEqual([])
    expect(both).toEqual([])
  })

  it('every listed installer exists -- a list entry does not outlive its file', () => {
    expect([...SAFE, ...UNSAFE].filter((f) => !existsSync(join(ROOT, 'scripts', f)))).toEqual([])
  })
})
