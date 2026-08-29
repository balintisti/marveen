import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// The meter for card 64968e12 carries its own controls (`--self-check`): it builds a
// throwaway repo, then asserts the tool can say CONFLICT, CLEAN, ALREADY, and can fail
// on an unknown ref. This runs them as part of the suite rather than leaving them to be
// remembered -- a control nobody runs is a control that is not there.
//
// It asserts the SELF-CHECK, not a fixed repository's history: the answers must come from
// commits the check makes itself, or the test would decay the moment a branch moves.
const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'applies-cleanly.sh')

describe('applies-cleanly.sh proves it can say both answers', () => {
  it('passes its own controls, each named', () => {
    const out = execFileSync('bash', [SCRIPT, '--self-check'], { encoding: 'utf8' })
    // Named individually: "four ok lines" would also pass if one control silently
    // stopped running and another printed twice.
    expect(out).toMatch(/ok\s+negativ/)
    expect(out).toMatch(/ok\s+pozitiv/)
    expect(out).toMatch(/ok\s+mar benne/)
    expect(out).toMatch(/ok\s+nem letezo ref/)
    expect(out).toMatch(/ok\s+commit-kerdes/)
    expect(out).toContain('MINDEN KONTROLL RENDBEN')
  })

  it('refuses an unknown target ref with a non-zero exit, not an empty list', () => {
    // THE LOAD-BEARING ONE. An empty result reads exactly like "everything is clean",
    // and that shape has cost this fleet twice in one night.
    let code = 0
    let stdout = ''
    try {
      stdout = execFileSync('bash', [SCRIPT, '--target', 'nincs-ilyen-ref-xyz', 'HEAD'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      code = (err as { status?: number }).status ?? 0
      stdout = (err as { stdout?: string }).stdout ?? ''
    }
    expect(code).toBe(2)
    expect(stdout.trim()).toBe('')
  })
})
