// The one definition of "which entries of the scheduled-tasks directory are tasks", shared by the
// runner (scheduled-tasks-io.ts listScheduledTasks) and the scheduler census (card fe838f28).
// Two copies of this filter drifted once: the census skipped dot-names and did not follow
// symlinks, so a `.hidden` or symlinked task dir the runner fires was invisible to the census.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Every entry of `root` that resolves to a directory (symlinks followed, dot-names included).
 *  A dangling link or an unstat-able entry is not a task. readdir errors are the caller's. */
export function scheduledTaskDirNames(root: string): string[] {
  return readdirSync(root).filter((f) => {
    try { return statSync(join(root, f)).isDirectory() } catch { return false }
  })
}
