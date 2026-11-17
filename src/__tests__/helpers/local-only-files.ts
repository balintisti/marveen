// Some scripts live on disk in the main checkout but are NOT tracked in this repo
// (listed in .git/info/exclude; e.g. the quota-ceiling guard moved to the L2 repo in
// 50ccf32e5, the backup scripts are local-only). Tests for them stay tracked, so a
// clean checkout (CI, a fresh worktree) used to fail with ENOENT: 37 red tests that
// hid any 38th (card 0816284f).
//
// A suite that needs such a file goes through describeWithLocalFiles: when a file is
// absent the suite is registered as SKIPPED with the missing paths in its title, so
// the skip shows in the run output instead of being a silent green or a wall of red.
// Where the files exist (the main checkout) the suite runs exactly as before.
import { describe, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** The relative paths (to `root`) that do not exist on disk. */
export function missingLocalFiles(root: string, rels: readonly string[]): string[] {
  return rels.filter((rel) => !existsSync(join(root, rel)))
}

/** `describe`, or a visibly named skip when a local-only file is missing. `fn` is not
 *  called when skipped: a suite body may read the file while it is being collected. */
export function describeWithLocalFiles(
  root: string,
  rels: readonly string[],
  name: string,
  fn: () => void,
): void {
  const missing = missingLocalFiles(root, rels)
  if (missing.length === 0) {
    describe(name, fn)
    return
  }
  describe.skip(`${name} [SKIPPED: local-only file(s) not tracked in this tree: ${missing.join(', ')}]`, () => {
    it('needs the local-only component', () => {})
  })
}
