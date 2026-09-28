/**
 * Temporary directories that are REMOVED when the test file finishes (card b610c593 (c)).
 *
 * Six test files made their fixtures with a bare `mkdtempSync(join(tmpdir(), ...))` and never
 * removed them. Measured 2026-09-25 04:31 in $TMPDIR: 3776 such entries older than two hours,
 * 1.43 GB, on a disk at 90%. One suite run left ~90 more directories behind.
 *
 * CALL IT ONCE, AT THE TOP LEVEL of the test file: it registers its own afterAll there. That
 * keeps it independent of whether vitest isolates modules per file -- a helper that registered
 * the hook on import would clean up only the first file that loaded it.
 *
 *   const mkTmp = tmpDirs()
 *   const dir = mkTmp('doccmd-')
 *
 * A directory that must live somewhere else than $TMPDIR (a hook that refuses paths under /tmp)
 * gives its base: `mkTmp('.dbgate-literal-', homedir())` -- made and removed the same way.
 *
 * A directory that has to exist BEFORE the imports -- made inside vi.hoisted(), where mkTmp does
 * not exist yet -- is handed over with `mkTmp.adopt(dir)` and removed the same way (card 66756e73).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

export interface TmpDirs {
  (prefix: string, base?: string): string
  /** Remove `dir` with the others -- for a directory made where mkTmp was not yet available. */
  adopt(dir: string): string
}

export function tmpDirs(): TmpDirs {
  const made: string[] = []
  // An explicit, generous hook timeout: a file that builds many throwaway trees removes them all
  // here, and under a loaded host (load average 37-50 measured 2026-09-28, several suites at once)
  // rulebook-snapshot.test.ts's cleanup passed vitest's 10 s default, failing a file whose 23 tests
  // were all green. A slow cleanup must never read as a failed test.
  afterAll(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
  }, 120_000)
  const mk = ((prefix: string, base: string = tmpdir()) => {
    const d = mkdtempSync(join(base, prefix))
    made.push(d)
    return d
  }) as TmpDirs
  mk.adopt = (dir: string) => {
    made.push(dir)
    return dir
  }
  return mk
}
