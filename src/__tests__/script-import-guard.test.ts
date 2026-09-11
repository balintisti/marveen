/**
 * A WRAPPER, AND THE REASON IS THE CARD ITSELF (`e479b940`).
 *
 * The contract lives in `scripts/__tests__/script-import-guard.test.py`, in the
 * house form every other scripts/ contract uses. Measured while writing it:
 * NOTHING GLOBS THAT DIRECTORY. `npm test` is `vitest run`, and vitest only
 * collects `src/`; an anchored search for `scripts/__tests__` across .ts, .mjs,
 * .sh, .yml and .json finds only prose -- docblock references and the `# Run:`
 * line each of those files carries for a human.
 *
 * So shipping the guard test alone would have repeated, in the same commit, the
 * exact defect the card is about: a correct artefact with no caller. Four lines
 * of wrapper is the difference between a contract and a decoration.
 *
 * WHAT THIS DOES NOT CLAIM: that the other contract tests in that directory are
 * wired. They are not, and that is a separate finding with a separate owner --
 * not something to fix by quietly adding thirty wrappers here.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')

describe('scripts that act at import stay inert when imported', () => {
  it('runs the python contract, and carries its output when it fails', () => {
    const r = spawnSync('python3', ['scripts/__tests__/script-import-guard.test.py'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    })
    // The output is in the message on purpose: a bare `rc !== 0` sends the
    // reader to a file the runner already printed the answer about.
    expect(`${r.status}\n${r.stdout ?? ''}${r.stderr ?? ''}`).toMatch(/^0\n/)
  })
})
