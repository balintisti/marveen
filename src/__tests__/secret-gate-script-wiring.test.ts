import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The gate's WIRING: does the exit code still follow the verdict?
//
// Why this file exists (card 2c4717dc). secret-gate.test.ts covers the pure
// core thoroughly -- fail-closed on an empty set, three detectors, placeholder
// counter-examples, and the promise never to echo a matched secret. What
// nothing covered is the script that CI and the pre-commit hook actually run.
// Measured on the trunk: changing its last line to `process.exit(0)` makes the
// gate pass everything, and all 4464 tests stay green.
//
// A control on the same subject DOES fire (mutating the core's fail-closed
// branch fails one test), so the suite is not blind here -- it simply never
// looked at the script. The commit that introduced the gate says the author
// verified this by hand once: "a synthetic key-shaped string makes the gate
// print BLOCKED and exit 1". A hand-verified wiring holds exactly until
// someone touches it.
//
// The fixture is assembled at runtime, as the core's own tests do, so this file
// contains no key-shaped literal and needs no allowlist entry.

const REPO = join(__dirname, '..', '..')
const TSX = join(REPO, 'node_modules', '.bin', 'tsx')
const SCRIPT = join(REPO, 'scripts', 'secret-gate.ts')

const STRIPE_FIXTURE = ['sk', 'live', '51ABCDEFGHIJKLMNOPQRSTUV'].join('_')

function repoWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'secret-gate-wiring-'))
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf-8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  git('add', '-A')
  return dir
}

function runGateScript(cwd: string) {
  // --all is the mode the CI job falls back to, and the only one that needs no
  // range plumbing. The script resolves the file list with git inside cwd.
  return spawnSync(TSX, [SCRIPT, '--all'], { cwd, encoding: 'utf-8' })
}

describe('the secret gate script: the exit code follows the verdict', () => {
  it('a key-shaped string makes it FAIL, and the key is not echoed back', () => {
    const dir = repoWith({ 'app/config.ts': `const k = "${STRIPE_FIXTURE}";\n` })
    try {
      const r = runGateScript(dir)
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`

      // The wiring itself: a blocked verdict must reach the process exit code.
      // With `process.exit(0)` hard-coded, this is the assertion that fails.
      expect(r.status).not.toBe(0)
      // And it must name the file, or the operator cannot act on it.
      expect(out).toContain('app/config.ts')
      // The core promises never to echo a matched secret. That promise is only
      // worth anything if it survives the script's own reporting, which is
      // where the text actually reaches a CI log.
      expect(out).not.toContain(STRIPE_FIXTURE)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a clean tree PASSES -- the gate is not simply always-fail', () => {
    // Without this the first case alone is satisfied by a gate that rejects
    // everything, which would be just as broken and much louder.
    const dir = repoWith({ 'app/config.ts': 'export const enabled = true\n' })
    try {
      const r = runGateScript(dir)
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
